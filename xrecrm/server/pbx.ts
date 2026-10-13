// Santral entegrasyonu: tıkla-ara, gelen aramada müşteri kartı (screen-pop)
// ve santral arama kayıtlarının (CDR) CRM'e işlenmesi.
//
// Sürücüler:
//  - asterisk: Asterisk / FreePBX / Issabel AMI (TCP 5038). Originate ile arama
//    başlatır; DialBegin olaylarıyla çalan dahiliye kart açar; Cdr olaylarını kaydeder.
//  - http: Netgsm Netsantral gibi URL tabanlı santraller. Tıkla-ara için URL şablonu
//    çağrılır; çalma/CDR bilgisi Webhook merkezindeki call.ringing / call.log ile gelir.
import crypto from "node:crypto";
import net from "node:net";
import type { Express, Request, Response } from "express";
import type { Store } from "./db.js";
import type { AuthContext, Lead } from "./types.js";
import { canAccess, ownsLead, rawStoreOf } from "./access.js";
import { fetchWithTimeout, normalizePhone } from "./security.js";
import { lines } from "../shared/lines.js";

const EXT_KIND = "pbx-extension";
const env = (k: string) => process.env[k]?.trim() || "";

export function pbxDriver(): "asterisk" | "http" | "" {
  const d = env("PBX_DRIVER").toLowerCase();
  if (d === "asterisk" || d === "ami") return "asterisk";
  if (d === "http") return "http";
  if (env("AMI_HOST") && env("AMI_USERNAME")) return "asterisk";
  if (env("PBX_CLICK_TO_CALL_URL")) return "http";
  return "";
}

// ---------------------------------------------------------------------------
// AMI istemcisi
// ---------------------------------------------------------------------------

export type AmiMessage = Record<string, string>;

export function parseAmiBlock(block: string): AmiMessage {
  const message: AmiMessage = {};
  for (const line of block.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) message[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return message;
}

function amiAction(fields: Record<string, string>): string {
  return (
    Object.entries(fields)
      .map(([k, v]) => `${k}: ${String(v).replace(/[\r\n]/g, " ")}`)
      .join("\r\n") + "\r\n\r\n"
  );
}

export class AmiClient {
  private socket: net.Socket | null = null;
  private buffer = "";
  private pending = new Map<string, (m: AmiMessage) => void>();
  onEvent: (m: AmiMessage) => void = () => {};
  onClose: () => void = () => {};

  constructor(
    private opts: { host: string; port: number; username: string; secret: string; events: boolean },
  ) {}

  connect(timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.opts.host, port: this.opts.port });
      this.socket = socket;
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("Santral (AMI) bağlantısı zaman aşımına uğradı."));
      }, timeoutMs);
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => this.receive(chunk));
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`Santral (AMI) bağlantı hatası: ${error.message}`));
      });
      socket.on("close", () => this.onClose());
      socket.once("connect", async () => {
        try {
          const login = await this.send({
            Action: "Login",
            Username: this.opts.username,
            Secret: this.opts.secret,
            Events: this.opts.events ? "on" : "off",
          });
          clearTimeout(timer);
          if (login.Response !== "Success")
            return reject(new Error(`AMI girişi reddedildi: ${login.Message || "yetki hatası"}`));
          resolve();
        } catch (error) {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  private receive(chunk: string) {
    this.buffer += chunk;
    // İlk satır "Asterisk Call Manager/x.y" karşılamasıdır.
    this.buffer = this.buffer.replace(/^Asterisk Call Manager\/[^\r\n]*\r?\n/, "");
    const blocks = this.buffer.split(/\r?\n\r?\n/);
    this.buffer = blocks.pop() || "";
    for (const block of blocks) {
      if (!block.trim()) continue;
      const message = parseAmiBlock(block);
      const waiter = message.ActionID ? this.pending.get(message.ActionID) : undefined;
      if (waiter && message.Response) {
        this.pending.delete(message.ActionID);
        waiter(message);
      } else if (message.Event) this.onEvent(message);
    }
  }

  send(fields: Record<string, string>, timeoutMs = 10000): Promise<AmiMessage> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error("AMI bağlı değil."));
    const ActionID = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(ActionID);
        reject(new Error("Santral yanıt vermedi."));
      }, timeoutMs);
      this.pending.set(ActionID, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      socket.write(amiAction({ ...fields, ActionID }));
    });
  }

  close() {
    try {
      this.socket?.write(amiAction({ Action: "Logoff" }));
    } catch {
      /* zaten kapalı */
    }
    this.socket?.destroy();
    this.socket = null;
  }
}

function amiOptions(events: boolean) {
  return {
    host: env("AMI_HOST"),
    port: Number(env("AMI_PORT") || 5038),
    username: env("AMI_USERNAME"),
    secret: env("AMI_SECRET"),
    events,
  };
}

async function withAmi<T>(fn: (client: AmiClient) => Promise<T>): Promise<T> {
  const options = amiOptions(false);
  if (!options.host || !options.username || !options.secret)
    throw Object.assign(new Error("AMI sunucu, kullanıcı ve şifresi girilmeli."), { statusCode: 503 });
  const client = new AmiClient(options);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

/** Arama numarasını santralin beklediği yerel biçime çevirir (905xx → 05xx). */
export function dialNumber(phone: string): string {
  const digits = normalizePhone(phone);
  const prefix = env("PBX_DIAL_PREFIX");
  const local = digits.startsWith("90") && digits.length === 12 ? `0${digits.slice(2)}` : digits;
  return `${prefix}${local}`;
}

export async function originateCall(input: { ext: string; phone: string; lineId?: string; leadId?: string; callId: string }) {
  const driver = pbxDriver();
  const number = dialNumber(input.phone);
  if (!number) throw Object.assign(new Error("Geçerli müşteri telefonu yok."), { statusCode: 400 });
  const line = lines.find((l) => l.id === input.lineId);
  if (driver === "asterisk") {
    const channel = (env("AMI_CHANNEL_TEMPLATE") || "PJSIP/{ext}").replace("{ext}", input.ext);
    const response = await withAmi((ami) =>
      ami.send(
        {
          Action: "Originate",
          Channel: channel,
          Context: env("AMI_ORIGINATE_CONTEXT") || "from-internal",
          Exten: number,
          Priority: "1",
          CallerID: `XRE CRM <${number}>`,
          Timeout: "30000",
          Async: "true",
          Variable: `XRE_CALL_ID=${input.callId},XRE_LEAD_ID=${input.leadId || ""}${line ? `,XRE_LINE=${normalizePhone(line.phone)}` : ""}`,
        },
        15000,
      ),
    );
    if (response.Response !== "Success")
      throw Object.assign(new Error(`Santral aramayı başlatmadı: ${response.Message || "bilinmeyen hata"}`), { statusCode: 502 });
    return { driver, message: response.Message || "Originate kabul edildi" };
  }
  if (driver === "http") {
    const template = env("PBX_CLICK_TO_CALL_URL");
    const url = template
      .replace("{ext}", encodeURIComponent(input.ext))
      .replace("{number}", encodeURIComponent(number))
      .replace("{line}", encodeURIComponent(line ? normalizePhone(line.phone) : ""))
      .replace("{callId}", encodeURIComponent(input.callId));
    const token = env("PBX_CLICK_TO_CALL_TOKEN");
    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const text = (await response.text()).slice(0, 300);
    if (!response.ok)
      throw Object.assign(new Error(`Santral HTTP ${response.status}: ${text}`), { statusCode: 502 });
    return { driver, message: text || `HTTP ${response.status}` };
  }
  throw Object.assign(new Error("Santral sürücüsü yapılandırılmamış. Entegrasyonlar → Santral ayarlarını girin."), { statusCode: 503 });
}

// ---------------------------------------------------------------------------
// Canlı arama bildirimleri (Server-Sent Events)
// ---------------------------------------------------------------------------

interface StreamClient {
  res: Response;
  openId: string;
  ext: string;
  canCalls: boolean;
  names: string[];
  modules: Set<string>;
}
const clients = new Set<StreamClient>();

export interface LiveNotice {
  id: string;
  kind: "message" | "missed-call" | "task";
  title: string;
  body: string;
  leadId?: string | null;
  at: string;
}

/** Canlı bildirim gönderir: modül yetkisi olanlara, isim verilirse yalnız o kişiye. */
export function pushNotice(notice: LiveNotice, filter: { module: string; assigneeName?: string }): number {
  let delivered = 0;
  const assignee = filter.assigneeName?.trim().toLocaleLowerCase("tr-TR");
  for (const client of clients) {
    if (!client.modules.has(filter.module)) continue;
    if (assignee && !client.names.includes(assignee)) continue;
    client.res.write(`event: notice\ndata: ${JSON.stringify(notice)}\n\n`);
    delivered += 1;
  }
  return delivered;
}

export interface RingingEvent {
  id: string;
  phone: string;
  ext?: string;
  lineId?: string;
  direction: "inbound" | "outbound";
  lead: Record<string, unknown> | null;
  at: string;
}

export function pushRinging(event: RingingEvent): number {
  let delivered = 0;
  const targeted = [...clients].filter((c) => c.canCalls && event.ext && c.ext === event.ext);
  // Dahili bilinmiyorsa (ör. genel gelen hat) arama yetkisi olan herkese gösterilir.
  const audience = targeted.length ? targeted : event.ext ? [] : [...clients].filter((c) => c.canCalls);
  for (const client of audience) {
    client.res.write(`event: ringing\ndata: ${JSON.stringify(event)}\n\n`);
    delivered += 1;
  }
  return delivered;
}

async function leadByPhone(store: Store, owner: string, phone: string): Promise<Lead | null> {
  const target = normalizePhone(phone);
  if (!target) return null;
  return (
    (await rawStoreOf(store).list<Lead>("lead", owner))
      .map((r) => r.payload)
      .find((l) => normalizePhone(l.phone) === target) || null
  );
}

export async function announceRinging(
  store: Store,
  owner: string,
  input: { phone: string; ext?: string; lineId?: string; direction?: "inbound" | "outbound"; id?: string },
): Promise<{ delivered: number; leadId: string | null }> {
  const lead = await leadByPhone(store, owner, input.phone);
  const event: RingingEvent = {
    id: input.id || crypto.randomUUID(),
    phone: normalizePhone(input.phone),
    ext: input.ext || undefined,
    lineId: input.lineId,
    direction: input.direction || "inbound",
    lead: lead
      ? { id: lead.id, name: lead.name, phone: lead.phone, stage: lead.stage, owner: lead.owner, company: lead.company, pipelineId: lead.pipelineId || "sales" }
      : null,
    at: new Date().toISOString(),
  };
  return { delivered: pushRinging(event), leadId: lead?.id || null };
}

// ---------------------------------------------------------------------------
// AMI dinleyici (gelen arama + CDR)
// ---------------------------------------------------------------------------

export type CallLogger = (store: Store, owner: string, input: Record<string, unknown>) => Promise<unknown>;

export function extensionFromChannel(channel: string): string {
  return channel.match(/^(?:PJSIP|SIP|IAX2|DAHDI|Local)\/(\d{2,6})(?:[-@]|$)/i)?.[1] || "";
}

export function cdrToCallLog(event: AmiMessage): Record<string, unknown> | null {
  const src = event.Source || event.CallerID?.match(/<([^>]+)>/)?.[1] || "";
  const dst = event.Destination || "";
  const srcExt = extensionFromChannel(event.Channel || "") || (/^\d{2,6}$/.test(src) ? src : "");
  const dstExt = extensionFromChannel(event.DestinationChannel || "") || (/^\d{2,6}$/.test(dst) ? dst : "");
  // Dahiliden dahiliye aramalar CRM'e yazılmaz.
  if (srcExt && dstExt) return null;
  const outbound = Boolean(srcExt);
  const phone = outbound ? dst : src;
  if (!normalizePhone(phone) || normalizePhone(phone).length < 10) return null;
  const disposition = (event.Disposition || "").toUpperCase();
  return {
    phone,
    direction: outbound ? "outbound" : "inbound",
    status: disposition === "ANSWERED" ? "answered" : "no-answer",
    durationSeconds: Number(event.BillableSeconds || 0),
    startedAt: event.StartTime ? `${event.StartTime.replace(" ", "T")}+03:00` : undefined,
    endedAt: event.EndTime ? `${event.EndTime.replace(" ", "T")}+03:00` : undefined,
    agent: outbound ? srcExt : dstExt || undefined,
    callId: event.UniqueID,
    line: outbound ? undefined : dst,
    provider: "asterisk",
    createLead: !outbound,
  };
}

let supervisor: NodeJS.Timeout | null = null;
let listener: { client: AmiClient; key: string } | null = null;

export function startPbxSupervisor(store: Store, logCall: CallLogger, intervalMs = 15000) {
  if (supervisor) return;
  let backoffUntil = 0;
  const tick = async () => {
    const key = pbxDriver() === "asterisk" ? JSON.stringify(amiOptions(true)) : "";
    if (listener && listener.key !== key) {
      listener.client.close();
      listener = null;
    }
    if (!key || listener || Date.now() < backoffUntil) return;
    const owner = await rawStoreOf(store).resolveOwner().catch(() => undefined);
    if (!owner) return;
    const client = new AmiClient(amiOptions(true));
    const ringing = new Map<string, number>();
    client.onEvent = (event) => {
      if (event.Event === "DialBegin") {
        const ext = extensionFromChannel(event.DestChannel || "");
        const caller = event.CallerIDNum || "";
        if (ext && normalizePhone(caller).length >= 10) {
          const id = event.DestUniqueid || event.Uniqueid || crypto.randomUUID();
          if (ringing.has(id)) return;
          ringing.set(id, Date.now());
          for (const [k, t] of ringing) if (Date.now() - t > 120_000) ringing.delete(k);
          void announceRinging(store, owner, { phone: caller, ext, id, direction: "inbound" }).catch(() => undefined);
        }
      } else if (event.Event === "Cdr") {
        const input = cdrToCallLog(event);
        if (input) void logCall(store, owner, input).catch((e) => console.warn("CDR kaydedilemedi:", e?.message || e));
      }
    };
    client.onClose = () => {
      if (listener?.client === client) listener = null;
    };
    try {
      await client.connect();
      listener = { client, key };
      console.log("Santral (AMI) olay dinleyicisi bağlandı.");
    } catch (error) {
      backoffUntil = Date.now() + 60_000;
      console.warn("Santral (AMI) dinleyicisi bağlanamadı:", error instanceof Error ? error.message : error);
    }
  };
  void tick();
  supervisor = setInterval(() => void tick(), intervalMs);
  supervisor.unref?.();
}

export function pbxListenerConnected() {
  return Boolean(listener);
}

// ---------------------------------------------------------------------------
// HTTP rotaları (requireAuth sonrasında)
// ---------------------------------------------------------------------------

export function registerPbxRoutes(app: Express, store: Store) {
  const raw = rawStoreOf(store);
  const authOf = (req: Request) => (req as Request & { auth: AuthContext }).auth;
  const extensionOf = async (auth: AuthContext) =>
    (await raw.get<{ ext: string }>(EXT_KIND, auth.user.openId, auth.ownerOpenId))?.payload?.ext || "";

  app.get("/api/pbx/me", async (req, res) => {
    const auth = authOf(req);
    res.json({
      driver: pbxDriver(),
      extension: await extensionOf(auth),
      listener: pbxListenerConnected(),
    });
  });

  app.put("/api/pbx/me", async (req, res) => {
    const auth = authOf(req);
    const ext = String(req.body?.extension || "").trim();
    if (ext && !/^\d{2,6}$/.test(ext))
      return res.status(400).json({ error: "INVALID_EXTENSION", message: "Dahili 2-6 haneli sayı olmalı." });
    await raw.put(EXT_KIND, auth.user.openId, { ext, openId: auth.user.openId, updatedAt: new Date().toISOString() }, auth.ownerOpenId);
    res.json({ extension: ext });
  });

  app.post("/api/pbx/call", async (req, res) => {
    const auth = authOf(req);
    try {
      const ext = await extensionOf(auth);
      if (!ext)
        return res.status(400).json({ error: "NO_EXTENSION", message: "Önce dahili numaranızı girin (arama penceresinde)." });
      const leadId = String(req.body?.leadId || "");
      const lead = leadId ? (await store.get<Lead>("lead", leadId, auth.ownerOpenId))?.payload : null;
      if (leadId && !lead) return res.status(404).json({ error: "NOT_FOUND", message: "Müşteri bulunamadı." });
      if (lead && !auth.isOwner && auth.permissions?.calls.scope === "own" && !(await ownsLead(raw, auth, lead.id)))
        return res.status(403).json({ error: "FORBIDDEN", message: "Bu müşteri kayıt kapsamınızda değil." });
      const phone = lead?.phone || String(req.body?.phone || "");
      const callId = `pbx-orig-${crypto.randomUUID()}`;
      const result = await originateCall({ ext, phone, lineId: req.body?.lineId, leadId: lead?.id, callId });
      const stamp = new Date().toISOString();
      await store.put(
        "call",
        callId,
        {
          id: callId,
          leadId: lead?.id || null,
          lineId: req.body?.lineId || null,
          provider: result.driver === "asterisk" ? "asterisk" : "pbx",
          direction: "outbound",
          status: "queued",
          phone: normalizePhone(phone),
          agent: ext,
          startedAt: stamp,
          createdAt: stamp,
          updatedAt: stamp,
        },
        auth.ownerOpenId,
      );
      res.json({ ok: true, callId, message: "Dahili telefonunuz çalıyor; açınca müşteri aranacak." });
    } catch (error) {
      const status = Number((error as any)?.statusCode) || 502;
      res.status(status).json({ error: "PBX_CALL_FAILED", message: (error as Error).message });
    }
  });

  app.post("/api/pbx/test", async (req, res) => {
    if (!authOf(req).isOwner) return res.status(403).json({ error: "OWNER_REQUIRED", message: "Yalnız sahip test edebilir." });
    try {
      const driver = pbxDriver();
      if (driver === "asterisk") {
        const ping = await withAmi((ami) => ami.send({ Action: "Ping" }));
        return res.json({ ok: true, message: `Asterisk AMI bağlantısı başarılı (${ping.Ping || ping.Response}).${pbxListenerConnected() ? " Olay dinleyicisi aktif." : ""}` });
      }
      if (driver === "http")
        return res.json({ ok: true, message: "URL tabanlı tıkla-ara yapılandırıldı. Gerçek denemeyi müşteri kartından yapın." });
      return res.status(503).json({ error: "NOT_CONFIGURED", message: "Santral sürücüsü yapılandırılmamış." });
    } catch (error) {
      res.status(502).json({ error: "PBX_TEST_FAILED", message: (error as Error).message });
    }
  });

  // Canlı arama bildirimi akışı
  app.get("/api/pbx/stream", async (req, res) => {
    const auth = authOf(req);
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(": bağlandı\n\n");
    const client: StreamClient = {
      res,
      openId: auth.user.openId,
      ext: await extensionOf(auth),
      canCalls: auth.isOwner || canAccess(auth, "calls", "read"),
      names: [auth.displayName, auth.user.name, auth.user.email]
        .filter(Boolean)
        .map((n) => String(n).trim().toLocaleLowerCase("tr-TR")),
      modules: new Set(
        (["calls", "whatsapp", "tasks", "crm"] as const).filter(
          (m) => auth.isOwner || canAccess(auth, m, "read"),
        ),
      ),
    };
    clients.add(client);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(client);
    });
  });
}

/** Testler için açık akışları kapatır. */
export function resetPbxClients() {
  for (const c of clients) c.res.end();
  clients.clear();
}
