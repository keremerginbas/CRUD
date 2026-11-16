// WhatsApp bazı sohbetlerde telefon numarası yerine gizli bir kimlik (…@lid) gönderir.
// Bu kimlik numara sanılırsa aynı kişinin yazdıkları ve ona yazılanlar iki ayrı sohbete bölünür.
// Burada gizli kimlik gerçek numaraya çevrilir, eşleşme saklanır ve bölünmüş sohbetler birleştirilir.
import type { Store } from "./db.js";
import { envConfigured, fetchWithTimeout, normalizePhone, readJsonResponse } from "./security.js";
import { evolutionBase } from "./integrations.js";

export const WA_LID_KIND = "wa-lid";
const PN = "@s.whatsapp.net";
const lidDigits = (jid: string) => jid.split("@")[0].replace(/\D/g, "");
const mapId = (lineId: string, lid: string) => `${lineId}:${lid}`;

/** Nesnede (en fazla 3 seviye) verilen sonekle biten ilk kimlik; mesaj içeriği taranmaz. */
export function findJid(obj: unknown, suffix: string, skip: string[] = [], depth = 0): string {
  if (typeof obj === "string") return obj.endsWith(suffix) && !skip.includes(obj) ? obj : "";
  if (!obj || typeof obj !== "object" || depth > 3) return "";
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === "message" || k === "contextInfo" || k === "quoted") continue;
    const hit = findJid(v, suffix, skip, depth + 1);
    if (hit) return hit;
  }
  return "";
}

interface StoredMessage {
  id: string;
  lineId?: string | null;
  phone?: string;
  leadId?: string | null;
  direction?: string;
  createdAt?: string;
  hidden?: boolean;
  payload?: { key?: { remoteJid?: string } };
}
/** Gizli kimlikle kaydedilmiş (numarası bilinmeyen) mesaj mı? Eski kayıtlar ham veriden tanınır. */
export const isHiddenMessage = (m: StoredMessage) => m.hidden === true || String(m.payload?.key?.remoteJid || "").endsWith("@lid");

async function ownJids(store: Store, owner: string, lineId: string): Promise<string[]> {
  const phone = normalizePhone((await store.get<{ phone?: string }>("connection", lineId, owner))?.payload?.phone || "");
  return phone ? [`${phone}${PN}`] : [];
}

/** Eşleşmeyi saklar ve bu hatta gizli kimlikle açılmış sohbetin mesajlarını gerçek numaraya taşır. */
export async function saveLidPhone(store: Store, owner: string, lineId: string, lid: string, phone: string, leadId?: string | null): Promise<number> {
  const real = normalizePhone(phone);
  if (!lineId || !lid || !real || real === lid) return 0;
  await store.put(WA_LID_KIND, mapId(lineId, lid), { lineId, lid, phone: real, updatedAt: new Date().toISOString() }, owner);
  let moved = 0;
  for (const row of await store.list<StoredMessage>("message", owner)) {
    const m = row.payload;
    if (m.lineId !== lineId || m.phone !== lid || !isHiddenMessage(m)) continue;
    await store.put("message", m.id, { ...m, phone: real, hidden: false, leadId: m.leadId || leadId || null }, owner);
    moved += 1;
  }
  return moved;
}

/**
 * Son çare: bu hattan son 12 saatte yazılmış ve henüz yanıt gelmemiş TEK bir sohbet varsa
 * gizli kimlikli yanıt ona aittir. Birden fazla aday varsa tahmin edilmez.
 */
async function guessPhone(store: Store, owner: string, lineId: string, lid: string): Promise<string> {
  const since = new Date(Date.now() - 12 * 3_600_000).toISOString();
  const last = new Map<string, StoredMessage>();
  for (const row of await store.list<StoredMessage>("message", owner)) {
    const m = row.payload;
    if (m.lineId !== lineId || !m.phone || !m.createdAt) continue;
    // Bu gizli kimlikle daha önce sohbet açıldıysa (eski kayıt) tahmine gerek yok: o sohbet sürer.
    if (m.phone === lid && isHiddenMessage(m)) continue;
    const seen = last.get(m.phone);
    if (!seen || (seen.createdAt || "") < m.createdAt) last.set(m.phone, m);
  }
  const candidates = [...last.values()].filter((m) => m.direction === "outbound" && !isHiddenMessage(m) && (m.createdAt || "") > since);
  return candidates.length === 1 ? normalizePhone(candidates[0].phone || "") : "";
}

/**
 * Gelen (ya da telefondan giden) mesajın karşı tarafını bulur. Numara biliniyorsa onu,
 * bilinmiyorsa gizli kimliğin rakamlarını döndürür (hidden: true).
 */
export async function resolveWaPeer(store: Store, owner: string, lineId: string, key: any, data: any, opts: { guess?: boolean } = {}): Promise<{ phone: string; hidden: boolean }> {
  const raw = String(key?.remoteJid || data?.remoteJid || "");
  if (!raw.endsWith("@lid")) return { phone: normalizePhone(raw.split("@")[0]) || raw.split("@")[0], hidden: false };
  const lid = lidDigits(raw);
  if (!lid) return { phone: "", hidden: true };
  const own = await ownJids(store, owner, lineId);
  // Gerçek numara sürüme göre farklı alanlarda gelir (remoteJidAlt, senderPn…): kendi hattımız hariç ara.
  const found = findJid(key, PN, own) || findJid({ ...data, key: undefined, message: undefined }, PN, own);
  if (found) {
    const phone = normalizePhone(found.split("@")[0]);
    if (phone) {
      await saveLidPhone(store, owner, lineId, lid, phone);
      return { phone, hidden: false };
    }
  }
  const known = (await store.get<{ phone: string }>(WA_LID_KIND, mapId(lineId, lid), owner))?.payload?.phone;
  if (known) return { phone: known, hidden: false };
  if (opts.guess) {
    const guessed = await guessPhone(store, owner, lineId, lid);
    if (guessed) {
      await saveLidPhone(store, owner, lineId, lid, guessed);
      return { phone: guessed, hidden: false };
    }
  }
  return { phone: lid, hidden: true };
}

const asked = new Set<string>();
/**
 * Bir numaraya mesaj gönderildikten sonra o numaranın gizli kimliğini öğrenir: önce gönderim
 * yanıtından, yoksa WhatsApp sunucusuna sorarak (numara başına bir kez). Hata sessizce geçilir.
 */
export async function learnWaLid(store: Store, owner: string, lineId: string, phone: string, sendResult?: unknown): Promise<void> {
  const real = normalizePhone(phone);
  if (!lineId || !/^\d{8,15}$/.test(real)) return;
  try {
    let lid = findJid(sendResult, "@lid");
    const cacheKey = `${owner}:${lineId}:${real}`;
    if (!lid && !asked.has(cacheKey) && envConfigured("EVOLUTION_API_URL", "EVOLUTION_API_KEY")) {
      asked.add(cacheKey);
      const response = await fetchWithTimeout(`${evolutionBase()}/chat/whatsappNumbers/${encodeURIComponent(lineId)}`, {
        method: "POST",
        headers: { apikey: process.env.EVOLUTION_API_KEY!, "content-type": "application/json" },
        body: JSON.stringify({ numbers: [real] }),
      });
      lid = findJid(await readJsonResponse(response), "@lid");
    }
    if (lid) await saveLidPhone(store, owner, lineId, lidDigits(lid), real);
  } catch {
    asked.delete(`${owner}:${lineId}:${real}`);
  }
}
/** Testler için: "bir kez sor" belleğini temizler. */
export const resetWaLidCache = () => asked.clear();
