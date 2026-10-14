// WhatsApp medya: gönderme (Evolution / Meta), gelen medyayı diske kaydetme ve
// yetkili kullanıcılara sunma. Dosyalar data/media altında, meta bilgisi
// "media" kayıtlarında tutulur; büyük base64 içerik kayıtlara yazılmaz.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express, { type Express, type Request, type Response } from "express";
import type { Store } from "./db.js";
import type { AuthContext, Lead } from "./types.js";
import { rawStoreOf } from "./access.js";
import { envConfigured, fetchWithTimeout, normalizePhone, readJsonResponse } from "./security.js";
import { resolveLineId } from "./integrations.js";

export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const MEDIA_KIND = "media";

export type MediaType = "image" | "video" | "audio" | "document";

export interface MediaRecord {
  id: string;
  mime: string;
  size: number;
  fileName: string;
  mediaType: MediaType;
  sha256: string;
  createdAt: string;
}

const env = (k: string) => process.env[k]?.trim() || "";
const mediaDir = () => path.resolve(env("XRE_DATA_DIR") || "data", "media");

export function mediaTypeOf(mime: string): MediaType {
  if (/^image\//.test(mime)) return "image";
  if (/^video\//.test(mime)) return "video";
  if (/^audio\//.test(mime)) return "audio";
  return "document";
}

const SAFE_INLINE = /^(image\/(png|jpeg|gif|webp)|audio\/|video\/(mp4|webm|3gpp)|application\/pdf)/;

function safeFileName(name: string, mime: string): string {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|\r\n]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  if (cleaned) return cleaned;
  const ext = mime.split("/")[1]?.split(";")[0]?.replace(/[^a-z0-9]/gi, "") || "bin";
  return `dosya.${ext}`;
}

export async function saveMedia(
  store: Store,
  owner: string,
  buffer: Buffer,
  mime: string,
  fileName = "",
): Promise<MediaRecord> {
  if (!buffer.length) throw Object.assign(new Error("Boş dosya."), { statusCode: 400 });
  if (buffer.length > MAX_MEDIA_BYTES)
    throw Object.assign(new Error("Dosya 16 MB sınırını aşıyor."), { statusCode: 413 });
  const cleanMime = /^[a-z]+\/[a-z0-9.+-]+$/i.test(mime.split(";")[0].trim())
    ? mime.split(";")[0].trim().toLowerCase()
    : "application/octet-stream";
  const id = `med_${crypto.randomBytes(12).toString("hex")}`;
  await fs.mkdir(mediaDir(), { recursive: true });
  await fs.writeFile(path.join(mediaDir(), id), buffer, { mode: 0o600 });
  const record: MediaRecord = {
    id,
    mime: cleanMime,
    size: buffer.length,
    fileName: safeFileName(fileName, cleanMime),
    mediaType: mediaTypeOf(cleanMime),
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    createdAt: new Date().toISOString(),
  };
  await rawStoreOf(store).put(MEDIA_KIND, id, record, owner);
  return record;
}

// ---------------------------------------------------------------------------
// Gönderim
// ---------------------------------------------------------------------------

export async function sendEvolutionMedia(
  instance: string,
  to: string,
  media: MediaRecord,
  buffer: Buffer,
  caption: string,
) {
  const base = env("EVOLUTION_API_URL").replace(/\/$/, "");
  const headers = { apikey: env("EVOLUTION_API_KEY"), "content-type": "application/json" };
  const number = normalizePhone(to);
  const response =
    media.mediaType === "audio"
      ? await fetchWithTimeout(
          `${base}/message/sendWhatsAppAudio/${encodeURIComponent(instance)}`,
          { method: "POST", headers, body: JSON.stringify({ number, audio: buffer.toString("base64") }) },
          30_000,
        )
      : await fetchWithTimeout(
          `${base}/message/sendMedia/${encodeURIComponent(instance)}`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              number,
              mediatype: media.mediaType,
              mimetype: media.mime,
              caption,
              media: buffer.toString("base64"),
              fileName: media.fileName,
            }),
          },
          30_000,
        );
  return readJsonResponse(response);
}

const metaBase = () => (env("META_GRAPH_URL") || "https://graph.facebook.com/v23.0").replace(/\/$/, "");

export async function sendMetaMedia(
  logicalLineId: string,
  to: string,
  media: MediaRecord,
  buffer: Buffer,
  caption: string,
) {
  const phoneNumberId = resolveLineId("meta", logicalLineId);
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", media.mime);
  form.append("file", new Blob([new Uint8Array(buffer)], { type: media.mime }), media.fileName);
  const upload = await readJsonResponse(
    await fetchWithTimeout(
      `${metaBase()}/${encodeURIComponent(phoneNumberId)}/media`,
      { method: "POST", headers: { authorization: `Bearer ${env("META_ACCESS_TOKEN")}` }, body: form },
      30_000,
    ),
  );
  const object: Record<string, string> = { id: String(upload.id) };
  if (caption && media.mediaType !== "audio") object.caption = caption;
  if (media.mediaType === "document") object.filename = media.fileName;
  return readJsonResponse(
    await fetchWithTimeout(`${metaBase()}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${env("META_ACCESS_TOKEN")}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizePhone(to),
        type: media.mediaType,
        [media.mediaType]: object,
      }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Gelen medya
// ---------------------------------------------------------------------------

const EVOLUTION_MEDIA_KEYS: Record<string, MediaType> = {
  imageMessage: "image",
  videoMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  documentWithCaptionMessage: "document",
  stickerMessage: "image",
};

/**
 * Evolution webhook mesajındaki medyayı kaydeder. Gövde base64 içeriyorsa
 * onu kullanır, yoksa Evolution'dan indirir. Döndürülen alanlar mesaj kaydına eklenir.
 */
export async function captureEvolutionMedia(
  store: Store,
  owner: string,
  instance: string,
  data: any,
): Promise<Partial<{ mediaId: string; mime: string; fileName: string; mediaType: MediaType; size: number }>> {
  const message = data?.message || {};
  const key = Object.keys(EVOLUTION_MEDIA_KEYS).find((k) => message[k]);
  if (!key) return {};
  const info = key === "documentWithCaptionMessage" ? message[key]?.message?.documentMessage || {} : message[key];
  let base64: string = message.base64 || data?.base64 || "";
  if (!base64 && envConfigured("EVOLUTION_API_URL", "EVOLUTION_API_KEY") && instance) {
    try {
      const response = await fetchWithTimeout(
        `${env("EVOLUTION_API_URL").replace(/\/$/, "")}/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`,
        {
          method: "POST",
          headers: { apikey: env("EVOLUTION_API_KEY"), "content-type": "application/json" },
          body: JSON.stringify({ message: { key: data?.key } }),
        },
        30_000,
      );
      const body = await readJsonResponse(response);
      base64 = body?.base64 || "";
    } catch {
      base64 = "";
    }
  }
  if (!base64) return { mediaType: EVOLUTION_MEDIA_KEYS[key], mime: info?.mimetype || "" };
  const saved = await saveMedia(
    store,
    owner,
    Buffer.from(base64.replace(/^data:[^,]+,/, ""), "base64"),
    String(info?.mimetype || "application/octet-stream"),
    String(info?.fileName || ""),
  );
  return { mediaId: saved.id, mime: saved.mime, fileName: saved.fileName, mediaType: saved.mediaType, size: saved.size };
}

/** Meta webhook mesajındaki medyayı Graph API'den indirip kaydeder. */
export async function captureMetaMedia(
  store: Store,
  owner: string,
  message: any,
): Promise<Partial<{ mediaId: string; mime: string; fileName: string; mediaType: MediaType; size: number }>> {
  const type = String(message?.type || "");
  if (!["image", "video", "audio", "document", "sticker", "voice"].includes(type)) return {};
  const media = message[type] || {};
  if (!media.id || !env("META_ACCESS_TOKEN")) return { mediaType: mediaTypeOf(String(media.mime_type || "")) };
  try {
    const auth = { authorization: `Bearer ${env("META_ACCESS_TOKEN")}` };
    const meta = await readJsonResponse(await fetchWithTimeout(`${metaBase()}/${encodeURIComponent(media.id)}`, { headers: auth }));
    const file = await fetchWithTimeout(String(meta.url), { headers: auth }, 30_000);
    if (!file.ok) return {};
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveMedia(store, owner, buffer, String(media.mime_type || meta.mime_type || ""), String(media.filename || ""));
    return { mediaId: saved.id, mime: saved.mime, fileName: saved.fileName, mediaType: saved.mediaType, size: saved.size };
  } catch {
    return { mediaType: mediaTypeOf(String(media.mime_type || "")) };
  }
}

/** Kayıtlara yazılmadan önce webhook gövdesinden büyük medya içeriğini temizler. */
export function stripMediaPayload<T>(data: T): T {
  if (!data || typeof data !== "object") return data;
  const copy: any = structuredClone(data);
  if (copy.message?.base64) copy.message.base64 = "[kaydedildi]";
  if (copy.base64) copy.base64 = "[kaydedildi]";
  for (const k of Object.keys(EVOLUTION_MEDIA_KEYS))
    if (copy.message?.[k]?.jpegThumbnail) delete copy.message[k].jpegThumbnail;
  return copy;
}

// ---------------------------------------------------------------------------
// Rotalar
// ---------------------------------------------------------------------------

/** Global JSON ayrıştırıcıdan ÖNCE çağrılmalı (büyük gövde sınırı için). */
export function registerMediaBodyParser(app: Express) {
  app.use("/api/messages/media", express.json({ limit: "24mb" }));
}

export function registerMediaRoutes(
  app: Express,
  store: Store,
  deps: {
    providerFor(lineId: string, owner: string): Promise<"evolution" | "meta" | null>;
    guard?(owner: string, lineId: string, phone: string, provider: "evolution" | "meta"): Promise<{ firstContact: boolean }>;
  },
) {
  const raw = rawStoreOf(store);
  const authOf = (req: Request) => (req as Request & { auth: AuthContext }).auth;

  app.post("/api/messages/media", async (req: Request, res: Response) => {
    const auth = authOf(req);
    try {
      const { leadId, to, lineId, caption = "", fileName = "", mime = "", data } = req.body || {};
      if ((!leadId && !to) || !lineId || typeof data !== "string")
        return res.status(400).json({ error: "INVALID_MEDIA", message: "Alıcı (leadId veya numara), lineId ve dosya gerekli." });
      let lead = leadId ? (await store.get<Lead>("lead", String(leadId), auth.ownerOpenId))?.payload || null : null;
      if (leadId && !lead) return res.status(404).json({ error: "NOT_FOUND", message: "Müşteri bulunamadı." });
      const phone = normalizePhone(lead?.phone || to);
      if (phone.length < 10) return res.status(400).json({ error: "INVALID_PHONE", message: "Geçerli bir telefon numarası girin." });
      if (!lead)
        lead = (await store.list<Lead>("lead", auth.ownerOpenId)).map((r) => r.payload).find((l) => normalizePhone(l.phone) === phone) || null;
      const buffer = Buffer.from(data.replace(/^data:[^,]+,/, ""), "base64");
      const provider = await deps.providerFor(String(lineId), auth.ownerOpenId);
      if (!provider)
        return res.status(503).json({ error: "WHATSAPP_NOT_CONFIGURED", message: "Bu hat için bağlı WhatsApp (Evolution) veya Meta yapılandırması yok." });
      const guard = deps.guard ? await deps.guard(auth.ownerOpenId, String(lineId), phone, provider) : { firstContact: false };
      const media = await saveMedia(store, auth.ownerOpenId, buffer, String(mime), String(fileName));
      const text = String(caption).slice(0, 1024);
      const result =
        provider === "evolution"
          ? await sendEvolutionMedia(String(lineId), phone, media, buffer, text)
          : await sendMetaMedia(String(lineId), phone, media, buffer, text);
      const providerMessageId = String(result?.messages?.[0]?.id || result?.key?.id || "");
      const message = {
        id: providerMessageId || `message-${crypto.randomUUID()}`,
        leadId: lead?.id || null,
        lineId: String(lineId),
        phone,
        firstContact: guard.firstContact,
        provider,
        direction: "outbound",
        type: media.mediaType,
        text: text || `[${media.fileName}]`,
        status: "sent",
        providerMessageId,
        mediaId: media.id,
        mime: media.mime,
        fileName: media.fileName,
        mediaType: media.mediaType,
        size: media.size,
        createdAt: new Date().toISOString(),
      };
      await store.put("message", message.id, message, auth.ownerOpenId);
      res.status(201).json(message);
    } catch (error) {
      const status = Number((error as any)?.statusCode) || 502;
      res.status(status).json({ error: "MEDIA_SEND_FAILED", message: (error as Error).message });
    }
  });

  app.get("/api/media/:id", async (req: Request, res: Response) => {
    const auth = authOf(req);
    const id = String(req.params.id);
    if (!/^med_[a-f0-9]{24}$/.test(id)) return res.status(404).end();
    const record = (await raw.get<MediaRecord>(MEDIA_KIND, id, auth.ownerOpenId))?.payload;
    if (!record) return res.status(404).json({ error: "NOT_FOUND" });
    // Kendi kapsamındaki kullanıcı yalnız erişebildiği mesajlardaki medyayı görebilir.
    const visible = (await store.list<any>("message", auth.ownerOpenId)).some((m) => m.payload?.mediaId === id);
    if (!visible && !auth.isOwner) return res.status(404).json({ error: "NOT_FOUND" });
    try {
      const buffer = await fs.readFile(path.join(mediaDir(), id));
      const inline = SAFE_INLINE.test(record.mime);
      res.setHeader("content-type", inline ? record.mime : "application/octet-stream");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("content-security-policy", "default-src 'none'; sandbox");
      res.setHeader("cache-control", "private, max-age=86400");
      res.setHeader(
        "content-disposition",
        `${inline && req.query.download === undefined ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(record.fileName)}`,
      );
      res.end(buffer);
    } catch {
      res.status(404).json({ error: "FILE_MISSING", message: "Dosya sunucuda bulunamadı." });
    }
  });
}
