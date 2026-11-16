// Hat yönetimi ekranındaki WhatsApp hat kartları: hat başına özet (durum, profil,
// bugünkü mesaj sayıları, sohbet ve yanıt bekleyen sayısı, yetkili personel) ve
// hattın adı ile yetkili personelinin kaydedilmesi.
//
// Özet, mesajların üzerinden TEK geçişte hesaplanır; hat sayısı kadar tekrar okunmaz.
// Kullanıcının göremeyeceği hatlar ve sohbetler sayılara katılmaz.
import type { Express, Request } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import type { AuthContext, StoredRecord } from "./types.js";
import { canAccess, ownMessageMatcher, rawStoreOf } from "./access.js";
import { normalizePhone } from "./security.js";
import { logicalLineId, providerConfigured, resolveLineId } from "./integrations.js";
import { communicationAllowed } from "./workspaces.js";
import { LINE_STAFF_KIND, lineAccess, lineStaffMap } from "./line-access.js";
import { saveLineInventory } from "./line-inventory.js";
import { lineDisplayName, lines } from "../shared/lines.js";

export interface LineActivity {
  lastMessageAt: number;
  todayIn: number;
  todayOut: number;
  chats: number;
  waiting: number;
}

/** Verilen anın Türkiye gününün başlangıcı (Türkiye yıl boyu UTC+3'tür). */
export function istanbulDayStart(now: number): number {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(now));
  return Date.parse(`${day}T00:00:00+03:00`);
}

/** Telefondan (WhatsApp uygulamasından) verilen son yanıtın kaydı; mesajın kendisi saklanmaz. */
export const LINE_REPLY_KIND = "line-reply";
/** Bu süreden eski yanıtsız mesajlar "bekliyor" sayılmaz (sayı yıllarca birikmesin). */
export const WAITING_WINDOW_MS = 7 * 86_400_000;
export const lineReplyKey = (lineId: string, phone: string) => `${lineId}:${phone}`;

/** Telefondan yazılan yanıtı not eder; böylece o sohbet "bekliyor" görünmez. */
export async function noteLineReply(store: Store, owner: string, lineId: string, phone: string, at: number) {
  const raw = rawStoreOf(store);
  const id = lineReplyKey(lineId, phone);
  const old = (await raw.get<{ at?: number }>(LINE_REPLY_KIND, id, owner))?.payload;
  if (old && Number(old.at) >= at) return;
  await raw.put(LINE_REPLY_KIND, id, { id, lineId, phone, at }, owner);
}

/**
 * Mesajları tek geçişte hat başına toplar.
 * - Sohbet: aynı hatta aynı kişiyle (numara, yoksa müşteri kaydı) yapılan yazışma.
 * - Bekleyen: son mesajı son 7 gün içinde müşteriden gelen ve telefondan da yanıtlanmamış sohbet.
 * Depo sıralaması veritabanına göre değiştiği için sıraya güvenilmez; en yeni mesaj karşılaştırılarak bulunur.
 */
export function summarizeLineMessages(
  rows: Iterable<StoredRecord<any>>,
  options: {
    now: number;
    /** Sayılacak hatlar; listede olmayan hatların mesajları atlanır. */
    lineIds: Set<string>;
    /** Kullanıcının bu mesajı görmeye yetkisi var mı? */
    visible?: (payload: Record<string, any>) => boolean;
    /** Müşteri kaydı → telefon (telefonsuz kayıtlı mesajları aynı sohbete bağlamak için). */
    leadPhones?: Map<string, string>;
    /** Telefondan verilen son yanıtlar: lineReplyKey(hat, numara) → zaman. */
    replies?: Map<string, number>;
  },
): Map<string, LineActivity> {
  const dayStart = istanbulDayStart(options.now);
  const dayEnd = dayStart + 86_400_000;
  const out = new Map<string, LineActivity>();
  const chats = new Map<string, Map<string, { at: number; inbound: boolean }>>();
  for (const id of options.lineIds) {
    out.set(id, { lastMessageAt: 0, todayIn: 0, todayOut: 0, chats: 0, waiting: 0 });
    chats.set(id, new Map());
  }
  for (const row of rows) {
    const message = row.payload as Record<string, any> | undefined;
    if (!message?.lineId) continue;
    const lineId = logicalLineId(String(message.lineId));
    const activity = out.get(lineId);
    if (!activity) continue;
    if (options.visible && !options.visible(message)) continue;
    const at = Date.parse(String(message.createdAt || row.createdAt || "")) || 0;
    const inbound = message.direction === "inbound" || message.direction === "in";
    if (at > activity.lastMessageAt) activity.lastMessageAt = at;
    if (at >= dayStart && at < dayEnd) {
      if (inbound) activity.todayIn += 1;
      else activity.todayOut += 1;
    }
    const leadId = message.leadId ? String(message.leadId) : "";
    const key =
      normalizePhone(message.phone || "") ||
      (leadId && options.leadPhones?.get(leadId)) ||
      (leadId ? `lead:${leadId}` : "");
    if (!key) continue;
    const lineChats = chats.get(lineId)!;
    const chat = lineChats.get(key);
    // Aynı ana düşen iki mesajda yanıt verilmiş sayılır (bekleyen sayısı şişmesin).
    if (!chat) lineChats.set(key, { at, inbound });
    else if (at > chat.at || (at === chat.at && !inbound)) {
      chat.at = at;
      chat.inbound = inbound;
    }
  }
  for (const [lineId, lineChats] of chats) {
    const activity = out.get(lineId)!;
    activity.chats = lineChats.size;
    for (const [key, chat] of lineChats) {
      if (!chat.inbound || options.now - chat.at > WAITING_WINDOW_MS) continue;
      if ((options.replies?.get(lineReplyKey(lineId, key)) || 0) >= chat.at) continue;
      activity.waiting += 1;
    }
  }
  return out;
}

/** Hat adını ve yetkili personelini kim değiştirebilir: sahip ya da tüm sohbetleri yöneten yönetici. */
function canManageLines(auth: AuthContext): boolean {
  if (auth.isOwner) return true;
  return (
    canAccess(auth, "whatsapp", "write") &&
    auth.permissions?.whatsapp?.scope === "all" &&
    canAccess(auth, "integrations", "read")
  );
}

const settingsSchema = z.object({
  name: z.string().trim().max(120).optional(),
  employeeIds: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
});

export function registerLinePanelRoutes(app: Express, store: Store) {
  const raw = rawStoreOf(store);
  const authOf = (req: Request) => (req as Request & { auth: AuthContext }).auth;

  const allEmployees = async (owner: string) =>
    (await raw.list<any>("employee", owner))
      .map((row) => row.payload)
      .filter((employee) => employee?.id)
      .map((employee) => ({
        id: String(employee.id),
        name: String(employee.name || employee.email || "Personel"),
        active: employee.active !== false,
      }));

  app.get("/api/whatsapp/lines/summary", async (req, res) => {
    const auth = authOf(req);
    const owner = auth.ownerOpenId;
    try {
      // Hat envanteri varsayılan alana aittir; diğer firmalara gösterilmez.
      if (!(await communicationAllowed(store, owner)))
        return res.json({ lines: [], employees: [], canManage: false });
      const access = await lineAccess(store, auth);
      const visibleLines = lines.filter((line) => !access || access.allows(line.id));
      const [connectionRows, staff, everyone, messages, leads, replyRows] = await Promise.all([
        raw.list<any>("connection", owner),
        lineStaffMap(store, owner),
        allEmployees(owner),
        raw.list<any>("message", owner),
        raw.list<any>("lead", owner),
        raw.list<any>(LINE_REPLY_KIND, owner),
      ]);
      const employees = everyone.filter((e) => e.active).map(({ id, name }) => ({ id, name }));
      const replies = new Map(replyRows.map((row) => [row.id, Number(row.payload?.at) || 0]));
      const connections = new Map(connectionRows.map((row) => [row.id, row.payload || {}]));
      const byId = new Map(everyone.map((e) => [e.id, e]));
      const leadPhones = new Map<string, string>();
      for (const row of leads) {
        const phone = normalizePhone(row.payload?.phone || "");
        if (phone) leadPhones.set(row.id, phone);
      }
      // "Yalnız kendi kayıtları" yetkisindeki personel, göremediği sohbetlerin sayısını da almaz.
      const ownOnly = !auth.isOwner && auth.permissions?.whatsapp?.scope !== "all";
      const activity = summarizeLineMessages(messages, {
        now: Date.now(),
        lineIds: new Set(visibleLines.map((line) => line.id)),
        visible: ownOnly ? await ownMessageMatcher(store, auth) : undefined,
        leadPhones,
        replies,
      });
      const metaReady = providerConfigured("meta");
      const evolutionReady = providerConfigured("evolution");
      const result = visibleLines.map((line) => {
        const connection = connections.get(line.id) || {};
        const qrConnected = connection.status === "connected";
        let viaMeta = false;
        if (!qrConnected && metaReady) {
          try {
            resolveLineId("meta", line.id);
            viaMeta = true;
          } catch {
            viaMeta = false;
          }
        }
        const connected = qrConnected || viaMeta;
        const a = activity.get(line.id)!;
        const chosen = staff.get(line.id) || [];
        return {
          id: line.id,
          name: lineDisplayName(line),
          label: line.label || "",
          group: line.group,
          inventoryPhone: line.phone,
          phone: qrConnected && connection.phone ? `+${normalizePhone(connection.phone)}` : line.phone,
          profileName: qrConnected && connection.profileName ? String(connection.profileName) : "",
          status: connected ? "connected" : "disconnected",
          provider: qrConnected && evolutionReady ? "evolution" : viaMeta ? "meta" : null,
          connectedAt: qrConnected && connection.connectedAt ? String(connection.connectedAt) : null,
          lastMessageAt: a.lastMessageAt ? new Date(a.lastMessageAt).toISOString() : null,
          todayIn: a.todayIn,
          todayOut: a.todayOut,
          chats: a.chats,
          waiting: a.waiting,
          // Boş liste: WhatsApp yetkisi olan herkes.
          // Pasife alınan ya da silinen personel de listede görünür; yönetici bilerek çıkarabilsin.
          staff: chosen.map((id) => ({
            id,
            name: byId.get(id)?.name || "Ayrılan personel",
            active: Boolean(byId.get(id)?.active),
          })),
        };
      });
      const canManage = canManageLines(auth);
      res.setHeader("cache-control", "no-store");
      res.json({ lines: result, employees: canManage ? employees : [], canManage });
    } catch (error) {
      res.status(500).json({ error: "LINE_SUMMARY_FAILED", message: (error as Error).message });
    }
  });

  app.put("/api/whatsapp/lines/:id/settings", async (req, res) => {
    const auth = authOf(req);
    const owner = auth.ownerOpenId;
    try {
      if (!canManageLines(auth))
        return res
          .status(403)
          .json({ error: "FORBIDDEN", message: "Hat ayarlarını yalnız sahip veya yönetici değiştirebilir." });
      const line = (await communicationAllowed(store, owner)) ? lines.find((l) => l.id === req.params.id) : undefined;
      if (!line) return res.status(404).json({ error: "NOT_FOUND", message: "Hat bulunamadı." });
      const access = await lineAccess(store, auth);
      if (access && !access.allows(line.id))
        return res.status(403).json({ error: "LINE_FORBIDDEN", message: "Bu hat için yetkiniz yok." });
      const parsed = settingsSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: "INVALID_SETTINGS", message: "Hat adı veya personel listesi geçersiz." });
      const { name, employeeIds } = parsed.data;
      if (employeeIds) {
        // Seçilebilenler: çalışan personel. Listede zaten bulunan (pasife alınmış ya da silinmiş)
        // kişiler de korunur; aksi halde yalnız ad değiştirilirken hat sessizce herkese açılırdı.
        const known = new Set((await allEmployees(owner)).filter((e) => e.active).map((e) => e.id));
        for (const id of (await lineStaffMap(store, owner)).get(line.id) || []) known.add(id);
        const chosen = [...new Set(employeeIds)].filter((id) => known.has(id));
        if (employeeIds.length && !chosen.length)
          return res
            .status(400)
            .json({ error: "INVALID_SETTINGS", message: "Seçilen personel bulunamadı. Sayfayı yenileyip yeniden deneyin." });
        // Yönetici kendini listeden çıkarıp hattı yanlışlıkla kendine kapatmasın.
        if (chosen.length && !auth.isOwner && auth.employeeId && !chosen.includes(auth.employeeId))
          chosen.push(auth.employeeId);
        if (chosen.length)
          await raw.put(
            LINE_STAFF_KIND,
            line.id,
            { id: line.id, employeeIds: chosen, updatedAt: new Date().toISOString(), updatedBy: auth.user.openId },
            owner,
          );
        else await raw.delete(LINE_STAFF_KIND, line.id, owner);
      }
      if (name !== undefined && name !== (line.label || "")) {
        const next = lines.map((l) => {
          if (l.id !== line.id) return l;
          const { label: _old, ...rest } = l;
          return name ? { ...rest, label: name } : rest;
        });
        await saveLineInventory(store, owner, next, auth.user.openId);
      }
      const saved = lines.find((l) => l.id === line.id) || line;
      res.json({
        id: saved.id,
        name: lineDisplayName(saved),
        employeeIds: (await lineStaffMap(store, owner)).get(saved.id) || [],
      });
    } catch (error) {
      res.status(400).json({ error: "LINE_SETTINGS_FAILED", message: (error as Error).message });
    }
  });
}
