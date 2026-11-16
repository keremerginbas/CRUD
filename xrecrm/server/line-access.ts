// Personelin hangi WhatsApp hatlarını kullanabileceği.
//
// İki kaynak vardır:
// 1) Hat yönetimi ekranında hatta seçilen yetkili personel ("line-staff" kaydı).
//    Liste doluysa hattı yalnız listedeki personel görür ve kullanır. Liste boşsa
//    WhatsApp yetkisi olan herkes kullanır (eski davranış).
// 2) Çalışan kaydındaki `whatsappPhones` dizisi (Bitrix'ten giren personel için
//    XRE WhatsApp panelindeki rollerden her girişte yeniden hesaplanır). Hatta
//    yetkili personel seçilmemişse bu dizi geçerlidir.
// Sahip her zaman hepsini görür. Otomasyonlar sistem adına çalışır, kısıtlanmaz.
import type { NextFunction, Request, Response } from "express";
import type { Store } from "./db.js";
import type { AuthContext, StoredRecord } from "./types.js";
import { currentPermissionContext, rawStoreOf } from "./access.js";
import { normalizePhone } from "./security.js";
import { logicalLineId } from "./integrations.js";
import { lines } from "../shared/lines.js";

export const LINE_STAFF_KIND = "line-staff";

export interface LineStaffRecord {
  id: string;
  employeeIds: string[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface LineAccess {
  /** Kullanıcı bu hattın sohbetlerini görebilir ve bu hattan yazabilir mi? */
  allows(lineId: unknown): boolean;
}

/** Hat başına yetkili personel listeleri (boş listeler dönmez). */
export async function lineStaffMap(store: Store, owner: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const row of await rawStoreOf(store).list<LineStaffRecord>(LINE_STAFF_KIND, owner)) {
    const ids = Array.isArray(row.payload?.employeeIds) ? row.payload.employeeIds.map(String).filter(Boolean) : [];
    if (ids.length) map.set(row.id, ids);
  }
  return map;
}

/** Hattın gerçek numarası: bağlı WhatsApp numarası, yoksa envanterdeki numara. */
export async function linePhones(store: Store, owner: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const line of lines) map.set(line.id, normalizePhone(line.phone));
  for (const row of await rawStoreOf(store).list<any>("connection", owner))
    if (row.payload?.status === "connected" && row.payload?.phone) map.set(row.id, normalizePhone(row.payload.phone));
  return map;
}

/** Kısıt yoksa null döner (sahip, sistem işleri ya da hiçbir kısıt tanımlanmamışsa). */
export async function lineAccess(store: Store, auth: AuthContext | undefined): Promise<LineAccess | null> {
  if (!auth || auth.isOwner) return null;
  const owner = auth.ownerOpenId;
  const employee = auth.employeeId
    ? (await rawStoreOf(store).get<any>("employee", auth.employeeId, owner))?.payload
    : undefined;
  const list = employee?.whatsappPhones;
  const ownPhones: Set<string> | null = Array.isArray(list)
    ? new Set(list.map((p: unknown) => normalizePhone(p)).filter(Boolean))
    : null;
  const staff = await lineStaffMap(store, owner);
  if (!ownPhones && !staff.size) return null;
  const phones = ownPhones ? await linePhones(store, owner) : new Map<string, string>();
  const me = auth.employeeId || "";
  return {
    allows(lineId: unknown) {
      const id = logicalLineId(String(lineId || ""));
      const chosen = staff.get(id);
      if (chosen) return Boolean(me) && chosen.includes(me);
      if (!ownPhones) return true;
      const phone = phones.get(id);
      return Boolean(phone && ownPhones.has(phone));
    },
  };
}

/**
 * İstek içinde okunan mesaj listesinden, kullanıcının yetkili olmadığı hatlara ait olanları çıkarır.
 * Hat bilgisi taşımayan eski kayıtlar olduğu gibi kalır. İstek dışında (arka plan işleri) süzme yapılmaz.
 */
export async function onlyAllowedLines<T>(store: Store, rows: StoredRecord<T>[]): Promise<StoredRecord<T>[]> {
  const access = await lineAccess(store, currentPermissionContext()?.auth);
  if (!access) return rows;
  return rows.filter((row) => {
    const lineId = (row.payload as any)?.lineId;
    return !lineId || access.allows(lineId);
  });
}

/**
 * Bir hattın sohbetlerini görebilen çalışanlar. Hiç kimse için kısıt yoksa null döner
 * (o hat WhatsApp yetkisi olan herkese açıktır). Canlı bildirimlerin kime gideceğini belirler.
 */
export async function lineAudience(store: Store, owner: string, lineId: unknown): Promise<any[] | null> {
  const id = logicalLineId(String(lineId || ""));
  if (!id) return null;
  const employees = (await rawStoreOf(store).list<any>("employee", owner))
    .map((row) => row.payload)
    .filter((employee) => employee?.id && employee.active !== false);
  const chosen = (await lineStaffMap(store, owner)).get(id);
  if (chosen) return employees.filter((employee) => chosen.includes(String(employee.id)));
  if (!employees.some((employee) => Array.isArray(employee.whatsappPhones))) return null;
  const phone = (await linePhones(store, owner)).get(id);
  return employees.filter(
    (employee) =>
      !Array.isArray(employee.whatsappPhones) ||
      Boolean(phone && employee.whatsappPhones.some((p: unknown) => normalizePhone(p) === phone)),
  );
}

/**
 * Bir sohbetten üretilen kayıtlar (ör. sohbet özeti) hangi hatlardan geldiğini `lineIds` ile taşır.
 * Kullanıcının yetkili olmadığı bir hattan üretilen kayıtları listeden çıkarır.
 */
export async function withoutRestrictedLines<T>(store: Store, items: T[]): Promise<T[]> {
  const access = await lineAccess(store, currentPermissionContext()?.auth);
  if (!access) return items;
  return items.filter((item) => {
    const ids = (item as any)?.lineIds;
    return !Array.isArray(ids) || ids.every((id) => access.allows(id));
  });
}

/** Otomasyon kuralı bir WhatsApp hattından yazıyorsa, kuralı kaydeden kişinin o hatta yetkisi var mı? */
export async function ruleLineAllowed(
  store: Store,
  auth: AuthContext | undefined,
  rule: { action?: string; config?: { lineId?: unknown } | null },
): Promise<boolean> {
  if (rule.action !== "whatsapp" || !rule.config?.lineId) return true;
  const access = await lineAccess(store, auth);
  return !access || access.allows(rule.config.lineId);
}

/** Mesaj gönderen uçlarda (POST /api/messages*, /api/whatsapp/send|template|check) hat yetkisini denetler. */
export function lineAccessGuard(store: Store) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "POST") return next();
    const auth = (req as Request & { auth?: AuthContext }).auth;
    try {
      const lineId = req.body?.lineId;
      if (!lineId) return next();
      const access = await lineAccess(store, auth);
      if (access && !access.allows(lineId))
        return res.status(403).json({ error: "LINE_FORBIDDEN", message: "Bu WhatsApp hattından yazma yetkiniz yok." });
      next();
    } catch (error) {
      next(error);
    }
  };
}
