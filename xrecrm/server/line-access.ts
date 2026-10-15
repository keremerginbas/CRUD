// Personelin hangi WhatsApp hatlarını kullanabileceği.
//
// Çalışan kaydında `whatsappPhones` dizisi varsa personel yalnız bu numaralara
// ait hatları görür ve yalnız onlardan yazar; o hatlardan gelen mesajları
// görür. Dizi yoksa kısıt yoktur (eski davranış). Sahip her zaman hepsini görür.
// Bitrix'ten giren personel için dizi, XRE WhatsApp panelindeki rollerden
// her girişte yeniden hesaplanır.
import type { NextFunction, Request, Response } from "express";
import type { Store } from "./db.js";
import type { AuthContext } from "./types.js";
import { rawStoreOf } from "./access.js";
import { normalizePhone } from "./security.js";
import { lines } from "../shared/lines.js";

export async function allowedPhones(store: Store, auth: AuthContext | undefined): Promise<Set<string> | null> {
  if (!auth || auth.isOwner || !auth.employeeId) return null;
  const employee = (await rawStoreOf(store).get<any>("employee", auth.employeeId, auth.ownerOpenId))?.payload;
  const list = employee?.whatsappPhones;
  return Array.isArray(list) ? new Set(list.map((p: unknown) => normalizePhone(p)).filter(Boolean)) : null;
}

/** Hattın gerçek numarası: bağlı WhatsApp numarası, yoksa envanterdeki numara. */
export async function linePhones(store: Store, owner: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const line of lines) map.set(line.id, normalizePhone(line.phone));
  for (const row of await rawStoreOf(store).list<any>("connection", owner))
    if (row.payload?.status === "connected" && row.payload?.phone) map.set(row.id, normalizePhone(row.payload.phone));
  return map;
}

export function lineAllowed(allowed: Set<string> | null, phones: Map<string, string>, lineId: unknown): boolean {
  if (!allowed) return true;
  const phone = phones.get(String(lineId || ""));
  return Boolean(phone && allowed.has(phone));
}

/** Mesaj gönderen uçlarda (POST /api/messages*, /api/whatsapp/send) hat yetkisini denetler. */
export function lineAccessGuard(store: Store) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "POST") return next();
    const auth = (req as Request & { auth?: AuthContext }).auth;
    try {
      const allowed = await allowedPhones(store, auth);
      if (!allowed) return next();
      const lineId = req.body?.lineId;
      if (!lineId) return next();
      if (!lineAllowed(allowed, await linePhones(store, auth!.ownerOpenId), lineId))
        return res.status(403).json({ error: "LINE_FORBIDDEN", message: "Bu WhatsApp hattından yazma yetkiniz yok." });
      next();
    } catch (error) {
      next(error);
    }
  };
}
