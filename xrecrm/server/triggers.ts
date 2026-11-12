// Tetikleyiciler ve kalıcı bildirimler.
// Tetikleyici: bir olay olduğunda (gelen mesaj, cevapsız arama, gelen e-posta…) müşteriyi
// seçilen aşamaya taşır; o aşamanın otomasyon kuralları da böylece çalışır.
// Bildirim: otomasyon kuralının bir çalışana bıraktığı, çevrimdışıyken de kaybolmayan not.
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import type { AuthContext, Lead } from "./types.js";
import { canAccess, rawStoreOf } from "./access.js";
import { pushNotice } from "./pbx.js";
import { TRIGGER_EVENTS, type TriggerEvent, type AutomationTrigger, type InboxNotification } from "../shared/triggers.js";

export const TRIGGER_KIND = "trigger";
export const INBOX_KIND = "inbox-notification";
const STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;
const MAX_TRIGGERS = 200;
const INBOX_KEEP = 200;

const now = () => new Date().toISOString();
const fold = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("tr-TR");

const TriggerSchema = z.object({
  id: z.string().min(1).max(191),
  name: z.string().trim().min(1, "Tetikleyici adı gerekli.").max(200),
  event: z.enum(TRIGGER_EVENTS),
  pipelineId: z.string().max(191).optional(),
  targetStage: z.enum(STAGES),
  enabled: z.boolean(),
  allowBackward: z.boolean().default(false),
});

/** Müşteriyi otomasyon adına başka aşamaya taşıyan işlev; app.ts kurulumda bağlar. */
type StageMover = (store: Store, owner: string, lead: Lead, targetStage: string, key: string, actorName: string) => Promise<void>;
let stageMover: StageMover | null = null;
export const setTriggerStageMover = (fn: StageMover | null) => void (stageMover = fn);

const pipelineMatches = (trigger: AutomationTrigger, lead: Lead) =>
  !trigger.pipelineId ||
  trigger.pipelineId === "all" ||
  trigger.pipelineId === (lead.pipelineId || "sales");

/**
 * Bir olay için tanımlı tetikleyicileri çalıştırır. Birden çok tetikleyici uyarsa
 * en ileri aşama seçilir. Kapanmış (kazanıldı/kaybedildi) müşteriler yerinden oynatılmaz;
 * "geri taşımaya izin ver" açık değilse müşteri yalnızca ileri gider.
 */
export async function fireTrigger(store: Store, owner: string, leadId: string | null | undefined, event: TriggerEvent, eventKey: string): Promise<string | null> {
  if (!leadId || !stageMover) return null;
  const raw = rawStoreOf(store);
  const triggers = (await raw.list<AutomationTrigger>(TRIGGER_KIND, owner))
    .map((row) => row.payload)
    .filter((t) => t.enabled && t.event === event);
  if (!triggers.length) return null;
  const lead = (await raw.get<Lead>("lead", leadId, owner))?.payload;
  if (!lead) return null;
  if (lead.stage === "won" || lead.stage === "lost") return null;
  const current = STAGES.indexOf(lead.stage as (typeof STAGES)[number]);
  const eligible = triggers
    .filter((t) => pipelineMatches(t, lead))
    .map((t) => ({ t, index: STAGES.indexOf(t.targetStage as (typeof STAGES)[number]) }))
    .filter(({ t, index }) => index >= 0 && index !== current && (t.allowBackward || index > current))
    .sort((a, b) => b.index - a.index);
  const chosen = eligible[0]?.t;
  if (!chosen) return null;
  await stageMover(store, owner, lead, chosen.targetStage, `trigger:${chosen.id}:${eventKey}`, `Tetikleyici · ${chosen.name}`);
  return chosen.targetStage;
}

/** Mesaj, arama ve görev kayıtlarını izleyip ilgili tetikleyicileri çalıştıran depo sarmalayıcısı. */
export function triggerStore(base: Store): Store {
  const inboundOf = (m: any) => m?.direction === "inbound" || m?.direction === "in";
  const outboundOf = (m: any) => m?.direction === "outbound" || m?.direction === "out";
  const react = async (kind: string, id: string, old: any, next: any, owner: string) => {
    const leadId = typeof next?.leadId === "string" ? next.leadId : "";
    if (!leadId) return;
    // Tetikleyici tanımlı değilse hiçbir ek sorgu yapılmaz.
    const active = (await base.list<AutomationTrigger>(TRIGGER_KIND, owner)).map((row) => row.payload).filter((t) => t.enabled);
    if (!active.length) return;
    const wants = (event: TriggerEvent) => active.some((t) => t.event === event);
    const fire = (event: TriggerEvent) => fireTrigger(base, owner, leadId, event, `${kind}:${id}`).catch(() => null);
    if (kind === "message" && !old) {
      if (inboundOf(next)) {
        if (wants("message.first")) {
          const earlier = (await base.list<any>("message", owner)).some(
            (row) => row.payload?.leadId === leadId && row.id !== id && inboundOf(row.payload),
          );
          if (!earlier) await fire("message.first");
        }
        await fire("message.inbound");
      } else if (outboundOf(next) && !String(id).startsWith("event-")) {
        // Otomasyonun kendi gönderdiği mesaj (event-…) tetikleyici sayılmaz.
        await fire("message.outbound");
      }
    }
    if (kind === "call") {
      if (next.status === "missed" && old?.status !== "missed") await fire("call.missed");
      else if (!old && next.direction === "inbound") await fire("call.inbound");
      else if (!old && next.direction === "outbound" && next.provider !== "vapi") await fire("call.outbound");
    }
    if (kind === "tasks" && next.status === "done" && old?.status !== "done") await fire("task.done");
  };
  return new Proxy(base, {
    get(target, key) {
      if (key === "put" || key === "insertIfAbsent")
        return async (kind: string, id: string, payload: any, owner: string) => {
          if (kind !== "message" && kind !== "call" && kind !== "tasks")
            return key === "put" ? target.put(kind, id, payload, owner) : target.insertIfAbsent(kind, id, payload, owner);
          const old = (await target.get<any>(kind, id, owner))?.payload;
          const result: any = key === "put" ? await target.put(kind, id, payload, owner) : await target.insertIfAbsent(kind, id, payload, owner);
          if (key === "insertIfAbsent" && !result?.inserted) return result;
          await react(kind, id, old, payload, owner).catch(() => undefined);
          return result;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Bir çalışana kalıcı bildirim bırakır ve çevrimiçiyse anında gösterir. */
export async function addInboxNotification(
  store: Store,
  owner: string,
  input: { recipient: string; title: string; body?: string; leadId?: string | null; id?: string },
): Promise<InboxNotification | null> {
  const recipient = String(input.recipient || "").trim();
  const title = String(input.title || "").trim().slice(0, 200);
  if (!recipient || !title) return null;
  const raw = rawStoreOf(store);
  const item: InboxNotification = {
    id: input.id || `ntf_${crypto.randomBytes(10).toString("hex")}`,
    recipient,
    title,
    body: String(input.body || "").trim().slice(0, 1000),
    leadId: input.leadId || null,
    createdAt: now(),
    readAt: null,
  };
  const inserted = await raw.insertIfAbsent(INBOX_KIND, item.id, item, owner);
  if (!inserted.inserted) return inserted.record?.payload || null;
  pushNotice(
    { id: item.id, kind: "task", title: item.title, body: item.body, leadId: item.leadId, at: item.createdAt },
    { module: "crm", assigneeName: recipient },
  );
  // Kişi başına en yeni kayıtlar tutulur; eskiler silinir.
  const mine = (await raw.list<InboxNotification>(INBOX_KIND, owner))
    .map((row) => row.payload)
    .filter((n) => fold(n.recipient) === fold(recipient))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const old of mine.slice(INBOX_KEEP)) await raw.delete(INBOX_KIND, old.id, owner);
  return item;
}

export function registerTriggerRoutes(app: Express, store: Store) {
  const raw = rawStoreOf(store);
  const authOf = (req: Request) => (req as Request & { auth: AuthContext }).auth;
  const namesOf = (auth: AuthContext) =>
    new Set([auth.displayName, auth.user.name].map(fold).filter(Boolean));
  const deny = (res: Response) =>
    res.status(403).json({ error: "FORBIDDEN", message: "Otomasyonları düzenleme yetkiniz yok." });

  app.get("/api/triggers", async (req, res) => {
    const auth = authOf(req);
    if (!canAccess(auth, "automations", "read")) return deny(res);
    const triggers = (await raw.list<AutomationTrigger>(TRIGGER_KIND, auth.ownerOpenId)).map((row) => row.payload);
    res.json({ triggers });
  });

  app.post("/api/triggers", async (req, res) => {
    const auth = authOf(req);
    if (!canAccess(auth, "automations", "write")) return deny(res);
    const parsed = TriggerSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "INVALID_TRIGGER", message: parsed.error.issues[0]?.message || "Geçersiz tetikleyici." });
    const existing = await raw.list<AutomationTrigger>(TRIGGER_KIND, auth.ownerOpenId);
    if (!existing.some((row) => row.id === parsed.data.id) && existing.length >= MAX_TRIGGERS)
      return res.status(400).json({ error: "TOO_MANY", message: "En fazla 200 tetikleyici tanımlanabilir." });
    const trigger: AutomationTrigger = { ...parsed.data, pipelineId: parsed.data.pipelineId || "all" };
    await raw.put(TRIGGER_KIND, trigger.id, trigger, auth.ownerOpenId);
    res.status(201).json({ trigger });
  });

  app.delete("/api/triggers/:id", async (req, res) => {
    const auth = authOf(req);
    if (!canAccess(auth, "automations", "write")) return deny(res);
    await raw.delete(TRIGGER_KIND, String(req.params.id).slice(0, 191), auth.ownerOpenId);
    res.json({ ok: true });
  });

  // Kullanıcının kendi bildirim kutusu.
  const mineOf = async (auth: AuthContext) => {
    const names = namesOf(auth);
    return (await raw.list<InboxNotification>(INBOX_KIND, auth.ownerOpenId))
      .map((row) => row.payload)
      .filter((n) => names.has(fold(n.recipient)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  };
  app.get("/api/inbox", async (req, res) => {
    const items = await mineOf(authOf(req));
    res.json({ notifications: items.slice(0, 50), unread: items.filter((n) => !n.readAt).length });
  });
  app.post("/api/inbox/read", async (req, res) => {
    const auth = authOf(req);
    const stamp = now();
    for (const item of (await mineOf(auth)).filter((n) => !n.readAt))
      await raw.put(INBOX_KIND, item.id, { ...item, readAt: stamp }, auth.ownerOpenId);
    res.json({ ok: true });
  });
}
