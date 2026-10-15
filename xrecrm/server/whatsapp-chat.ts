// WhatCRM tarzı WhatsApp sohbeti: kayıtlı olmayan numaralara yazma, numara
// kontrolü, sohbetten müşteri oluşturma, Meta şablonları ve ban koruması.
//
// QR (Evolution / WhatsApp Web) hatlarında ilk mesajı şablonsuz atmak mümkündür.
// Meta Cloud API hatlarında müşteri son 24 saatte yazmadıysa Meta yalnız
// onaylı şablona izin verir; bu kural burada da uygulanır.
import crypto from "node:crypto";
import type { Express, Request } from "express";
import type { Store } from "./db.js";
import type { AuthContext, Lead } from "./types.js";
import { canAccess, rawStoreOf } from "./access.js";
import {
  envConfigured,
  fetchWithTimeout,
  normalizePhone,
  readJsonResponse,
} from "./security.js";
import {
  evolutionInstances,
  providerConfigured,
  resolveLineId,
  sendEvolutionText,
  sendMetaText,
} from "./integrations.js";
import { lines } from "../shared/lines.js";
import { allowedPhones, lineAllowed, linePhones } from "./line-access.js";

const env = (k: string) => process.env[k]?.trim() || "";
const DAY = 86_400_000;

export type WaProvider = "evolution" | "meta";

export interface WhatsappChatDeps {
  ensureLead(store: Store, owner: string, phone: string, name: string | undefined, source: string): Promise<Lead | null>;
}

function fail(status: number, message: string, code = "WHATSAPP_ERROR"): never {
  throw Object.assign(new Error(message), { statusCode: status, code });
}

export async function lineProvider(store: Store, owner: string, lineId: string): Promise<WaProvider | null> {
  const connected = (await rawStoreOf(store).get<any>("connection", lineId, owner))?.payload?.status === "connected";
  if (connected && providerConfigured("evolution")) return "evolution";
  if (providerConfigured("meta")) {
    try {
      resolveLineId("meta", lineId);
      return "meta";
    } catch {
      return null;
    }
  }
  return null;
}

const turkeyDay = (t: number | string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(t));

// --- Ban koruması -------------------------------------------------------------
const lastSend = new Map<string, number>();
export function resetWhatsappThrottle() {
  lastSend.clear();
}

/**
 * Gönderimden önce kuralları uygular. Dönen bilgi mesaj kaydına eklenir.
 * - Hat başına iki mesaj arasında en az WHATSAPP_MIN_INTERVAL_MS (varsayılan 1500 ms)
 * - QR hatlarında günde en fazla WHATSAPP_DAILY_NEW_CONTACTS (varsayılan 40) yeni kişiye ilk mesaj
 * - Meta hatlarında 24 saat penceresi kapalıysa serbest metin engellenir
 */
export async function guardOutbound(
  store: Store,
  owner: string,
  input: { lineId: string; phone: string; provider: WaProvider; template?: boolean },
): Promise<{ firstContact: boolean }> {
  const minInterval = Number(env("WHATSAPP_MIN_INTERVAL_MS") || 1500);
  const last = lastSend.get(input.lineId) || 0;
  if (Date.now() - last < minInterval)
    fail(429, "Çok hızlı gönderim. Hesabınızın kısıtlanmaması için birkaç saniye bekleyin.", "RATE_LIMITED");
  const messages = (await rawStoreOf(store).list<any>("message", owner)).map((r) => r.payload);
  const history = messages.filter((m) => normalizePhone(m.phone || "") === input.phone);
  const firstContact = history.length === 0;
  if (input.provider === "meta" && !input.template) {
    const lastInbound = history
      .filter((m) => m.direction === "inbound" || m.direction === "in")
      .map((m) => Date.parse(m.createdAt))
      .sort((a, b) => b - a)[0];
    if (!lastInbound || Date.now() - lastInbound > DAY)
      fail(
        409,
        "Bu kişi son 24 saatte size yazmadı. Meta (resmî API) hattında yalnız onaylı şablon gönderilebilir. Şablon seçin veya QR ile bağlı bir hattan yazın.",
        "TEMPLATE_REQUIRED",
      );
  }
  if (input.provider === "evolution" && firstContact) {
    const cap = Number(env("WHATSAPP_DAILY_NEW_CONTACTS") || 40);
    const today = turkeyDay(Date.now());
    const used = messages.filter((m) => m.firstContact && m.lineId === input.lineId && turkeyDay(m.createdAt) === today).length;
    if (used >= cap)
      fail(
        429,
        `Bu hattan bugün ${cap} yeni kişiye ilk mesaj atıldı. Numaranızın engellenmemesi için yarın devam edin (sınır: Entegrasyonlar → WhatsApp).`,
        "DAILY_LIMIT",
      );
  }
  lastSend.set(input.lineId, Date.now());
  return { firstContact };
}

// --- Numara kontrolü ---------------------------------------------------------------
export async function checkWhatsappNumber(lineId: string, phone: string) {
  if (!envConfigured("EVOLUTION_API_URL", "EVOLUTION_API_KEY"))
    return { checked: false, exists: null as boolean | null };
  const response = await fetchWithTimeout(
    `${env("EVOLUTION_API_URL").replace(/\/$/, "")}/chat/whatsappNumbers/${encodeURIComponent(lineId)}`,
    {
      method: "POST",
      headers: { apikey: env("EVOLUTION_API_KEY"), "content-type": "application/json" },
      body: JSON.stringify({ numbers: [phone] }),
    },
  );
  const body = await readJsonResponse(response);
  const row = Array.isArray(body) ? body[0] : body?.[0] || body;
  return { checked: true, exists: Boolean(row?.exists), name: row?.name || null };
}

// --- Meta şablonları -----------------------------------------------------------------
const metaBase = () => (env("META_GRAPH_URL") || "https://graph.facebook.com/v23.0").replace(/\/$/, "");

export async function listMetaTemplates() {
  if (!env("META_ACCESS_TOKEN") || !env("META_WABA_ID"))
    fail(503, "Şablonlar için Meta erişim anahtarı ve WhatsApp Business Hesap ID (META_WABA_ID) gerekli.");
  const response = await fetchWithTimeout(
    `${metaBase()}/${encodeURIComponent(env("META_WABA_ID"))}/message_templates?limit=200&fields=name,language,status,category,components`,
    { headers: { authorization: `Bearer ${env("META_ACCESS_TOKEN")}` } },
  );
  const body = await readJsonResponse(response);
  return (body.data || [])
    .filter((t: any) => t.status === "APPROVED")
    .map((t: any) => {
      const bodyText = String(t.components?.find((c: any) => c.type === "BODY")?.text || "");
      return {
        name: String(t.name),
        language: String(t.language),
        category: String(t.category || ""),
        body: bodyText,
        params: (bodyText.match(/\{\{\d+\}\}/g) || []).length,
      };
    });
}

export async function sendMetaTemplate(lineId: string, to: string, name: string, language: string, params: string[]) {
  const phoneNumberId = resolveLineId("meta", lineId);
  const response = await fetchWithTimeout(`${metaBase()}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${env("META_ACCESS_TOKEN")}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name,
        language: { code: language },
        ...(params.length
          ? { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] }
          : {}),
      },
    }),
  });
  return readJsonResponse(response);
}

// --- Rotalar --------------------------------------------------------------------------
export function registerWhatsappChatRoutes(app: Express, store: Store, deps: WhatsappChatDeps) {
  const raw = rawStoreOf(store);
  const authOf = (req: Request) => (req as Request & { auth: AuthContext }).auth;
  const send = (res: any, error: unknown) => {
    const status = Number((error as any)?.statusCode) || 502;
    res.status(status).json({ error: (error as any)?.code || "WHATSAPP_ERROR", message: (error as Error).message });
  };

  /** Hedef: leadId veya serbest numara. Kayıtlı müşteri telefonla bulunursa bağlanır. */
  const resolveTarget = async (owner: string, body: any) => {
    let lead: Lead | null = null;
    if (body?.leadId) {
      lead = (await store.get<Lead>("lead", String(body.leadId), owner))?.payload || null;
      if (!lead) fail(404, "Müşteri bulunamadı.");
    }
    const phone = normalizePhone(lead?.phone || body?.to || body?.phone || "");
    if (phone.length < 10 || phone.length > 15) fail(400, "Geçerli bir telefon numarası girin (ör. 0532 123 45 67).");
    if (!lead)
      lead =
        (await raw.list<Lead>("lead", owner)).map((r) => r.payload).find((l) => normalizePhone(l.phone) === phone) || null;
    return { lead, phone };
  };

  app.get("/api/whatsapp/lines", async (req, res) => {
    const owner = authOf(req).ownerOpenId;
    const result = await Promise.all(
      lines.map(async (line) => {
        const connection = (await rawStoreOf(store).get<any>("connection", line.id, owner))?.payload;
        return {
          lineId: line.id,
          // Bağlı WhatsApp'ın gerçek numarası envanterdeki numaradan önceliklidir.
          phone: (connection?.status === "connected" && connection?.phone) || line.phone,
          group: line.group,
          provider: await lineProvider(store, owner, line.id),
        };
      }),
    );
    const allowed = await allowedPhones(store, authOf(req));
    const phones = allowed ? await linePhones(store, owner) : new Map<string, string>();
    res.json({
      lines: result.filter((l) => l.provider && lineAllowed(allowed, phones, l.lineId)),
      autoLead: env("WHATSAPP_AUTO_LEAD") === "1",
      dailyNewContacts: Number(env("WHATSAPP_DAILY_NEW_CONTACTS") || 40),
      templatesAvailable: Boolean(env("META_WABA_ID") && env("META_ACCESS_TOKEN")),
    });
  });

  // Evolution'daki oturumları okuyup hat kartlarına bağlı numarayı ve durumu yazar.
  app.post("/api/whatsapp/connections/sync", async (req, res) => {
    const owner = authOf(req).ownerOpenId;
    try {
      if (!providerConfigured("evolution")) return res.json({ synced: 0 });
      const raw = rawStoreOf(store);
      const known = new Set(lines.map((l) => l.id));
      let synced = 0;
      for (const info of await evolutionInstances()) {
        if (!known.has(info.name)) continue;
        const previous = (await raw.get<any>("connection", info.name, owner))?.payload || {};
        const open = ["open", "connected"].includes(info.state);
        await raw.put(
          "connection",
          info.name,
          {
            ...previous,
            id: info.name,
            provider: "evolution",
            state: info.state || previous.state || "",
            status: open ? "connected" : "disconnected",
            connected: open,
            ...(open && info.phone ? { phone: info.phone } : {}),
            ...(open && info.profileName ? { profileName: info.profileName.slice(0, 120) } : {}),
            updatedAt: new Date().toISOString(),
          },
          owner,
        );
        synced += 1;
      }
      res.json({ synced });
    } catch (error) {
      const e = error as Error & { statusCode?: number };
      res.status(e.statusCode && e.statusCode < 600 ? e.statusCode : 502).json({ error: "SYNC_FAILED", message: e.message });
    }
  });

  app.post("/api/whatsapp/send", async (req, res) => {
    const auth = authOf(req);
    try {
      const text = String(req.body?.text || "").trim();
      const lineId = String(req.body?.lineId || "");
      if (!text) fail(400, "Mesaj boş olamaz.");
      if (text.length > 4096) fail(400, "Mesaj 4096 karakteri geçemez.");
      const { lead, phone } = await resolveTarget(auth.ownerOpenId, req.body);
      const provider = await lineProvider(store, auth.ownerOpenId, lineId);
      if (!provider) fail(503, "Bu hat WhatsApp'a bağlı değil. WhatsApp → Bağlantılar'dan QR ile bağlayın.", "LINE_NOT_CONNECTED");
      const guard = await guardOutbound(store, auth.ownerOpenId, { lineId, phone, provider });
      const result = provider === "evolution" ? await sendEvolutionText(lineId, phone, text) : await sendMetaText(lineId, phone, text);
      const providerMessageId = String(result?.messages?.[0]?.id || result?.key?.id || "");
      const message = {
        id: providerMessageId || `wa-${crypto.randomUUID()}`,
        leadId: lead?.id || null,
        lineId,
        phone,
        provider,
        direction: "outbound",
        type: "text",
        text,
        status: "sent",
        providerMessageId,
        firstContact: guard.firstContact,
        sentBy: auth.displayName || auth.user.name || "",
        createdAt: new Date().toISOString(),
      };
      await store.put("message", message.id, message, auth.ownerOpenId);
      res.status(201).json(message);
    } catch (error) {
      send(res, error);
    }
  });

  app.post("/api/whatsapp/check", async (req, res) => {
    try {
      const phone = normalizePhone(req.body?.phone || "");
      if (phone.length < 10) fail(400, "Geçerli bir telefon numarası girin.");
      res.json({ phone, ...(await checkWhatsappNumber(String(req.body?.lineId || ""), phone)) });
    } catch (error) {
      send(res, error);
    }
  });

  app.post("/api/whatsapp/contacts", async (req, res) => {
    const auth = authOf(req);
    try {
      if (!auth.isOwner && !canAccess(auth, "crm", "write")) fail(403, "Müşteri oluşturma yetkiniz yok.");
      const phone = normalizePhone(req.body?.phone || "");
      if (phone.length < 10) fail(400, "Geçerli bir telefon numarası girin.");
      const name = String(req.body?.name || "").trim().slice(0, 200);
      const lead = await deps.ensureLead(store, auth.ownerOpenId, phone, name || undefined, "WhatsApp");
      if (!lead) fail(400, "Müşteri oluşturulamadı.");
      // Bu numaradaki kayıtsız mesajları müşteriye bağla.
      let linked = 0;
      for (const row of await raw.list<any>("message", auth.ownerOpenId)) {
        if (row.payload.leadId || normalizePhone(row.payload.phone || "") !== phone) continue;
        await raw.put("message", row.id, { ...row.payload, leadId: lead!.id }, auth.ownerOpenId);
        linked += 1;
      }
      res.status(201).json({ lead, linked });
    } catch (error) {
      send(res, error);
    }
  });

  app.get("/api/whatsapp/templates", async (_req, res) => {
    try {
      res.json({ templates: await listMetaTemplates() });
    } catch (error) {
      send(res, error);
    }
  });

  app.post("/api/whatsapp/template", async (req, res) => {
    const auth = authOf(req);
    try {
      const lineId = String(req.body?.lineId || "");
      const name = String(req.body?.name || "");
      const language = String(req.body?.language || "tr");
      const params = Array.isArray(req.body?.params) ? req.body.params.map((p: unknown) => String(p).slice(0, 500)) : [];
      if (!/^[a-z0-9_]{1,512}$/.test(name)) fail(400, "Şablon seçin.");
      const { lead, phone } = await resolveTarget(auth.ownerOpenId, req.body);
      if ((await lineProvider(store, auth.ownerOpenId, lineId)) !== "meta") fail(400, "Şablonlar yalnız Meta (resmî API) hattından gönderilir.");
      const guard = await guardOutbound(store, auth.ownerOpenId, { lineId, phone, provider: "meta", template: true });
      const result = await sendMetaTemplate(lineId, phone, name, language, params);
      const providerMessageId = String(result?.messages?.[0]?.id || "");
      const message = {
        id: providerMessageId || `wa-${crypto.randomUUID()}`,
        leadId: lead?.id || null,
        lineId,
        phone,
        provider: "meta",
        direction: "outbound",
        type: "template",
        templateName: name,
        text: String(req.body?.preview || `[Şablon: ${name}]`).slice(0, 4096),
        status: "sent",
        providerMessageId,
        firstContact: guard.firstContact,
        sentBy: auth.displayName || auth.user.name || "",
        createdAt: new Date().toISOString(),
      };
      await store.put("message", message.id, message, auth.ownerOpenId);
      res.status(201).json(message);
    } catch (error) {
      send(res, error);
    }
  });
}
