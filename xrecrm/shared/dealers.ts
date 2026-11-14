// Bayi sistemi: ana bayi + alt bayiler ve müşteri kaydı koruması.
// Kural: bir bayi bir müşteriyi (telefon numarası) bir proje için kaydettiğinde, başka bayi aynı müşteriyi
// aynı proje için kaydedemez ("daha önce kayıtlı"). Koruma süresi (varsayılan 60 gün) içinde satış olmazsa
// kayıt ana bayiye devredilir ve diğer bayiler o müşteriyi o proje için bir daha kaydedemez.
import { z } from "zod";

export const DEALER_KIND = "re_dealer";
export const DEALER_REG_KIND = "re_dealer_reg";
export const DEALER_SETTINGS_KIND = "re_dealer_settings";
export const DEALER_SETTINGS_ID = "settings";
export const DEFAULT_PROTECTION_DAYS = 60;

export const DealerSchema = z.object({
  id: z.string().trim().min(1).max(191),
  name: z.string().trim().min(1, "Bayi adı gerekli.").max(200),
  /** Ana bayi: süresi dolan kayıtlar buraya devredilir. Yalnız bir tane olabilir. */
  main: z.boolean().default(false),
  active: z.boolean().default(true),
  /** Bu bayide çalışan kullanıcıların kimlikleri (openId). */
  members: z.array(z.string().trim().min(1).max(191)).max(500).default([]),
  phone: z.string().trim().max(60).default(""),
  note: z.string().trim().max(500).default(""),
});
export type Dealer = z.infer<typeof DealerSchema>;

export type RegistrationStatus = "aktif" | "satıldı" | "ana bayiye devredildi";
export interface DealerRegistration {
  id: string;
  /** Telefonun karşılaştırma anahtarı (son 10 hane). */
  phoneKey: string;
  projectId: string;
  projectName: string;
  leadId: string;
  customerName: string;
  customerPhone: string;
  /** Kaydın şu anki sahibi bayi. */
  dealerId: string;
  /** Kaydı ilk yapan bayi (devirden sonra da saklanır). */
  originalDealerId: string;
  registeredBy: string;
  registeredAt: string;
  /** Korumanın bittiği gün (YYYY-AA-GG); bu günden sonra satış yoksa ana bayiye devredilir. */
  protectedUntil: string;
  status: RegistrationStatus;
  transferredAt: string | null;
  soldAt: string | null;
}

export class DealerError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "INVALID_REQUEST",
  ) {
    super(message);
  }
}

/** Telefonu karşılaştırma anahtarına çevirir: yalnız rakamlar, son 10 hane (ülke kodu ve baştaki 0 atılır). */
export function phoneKey(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

export const registrationId = (key: string, projectId: string) => `${projectId}:${key}`.slice(0, 191);

export const addDaysIso = (day: string, days: number) => {
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

export const mainDealerOf = (dealers: Dealer[]) => dealers.find((d) => d.main && d.active) || dealers.find((d) => d.main) || null;
export const dealerOfUser = (dealers: Dealer[], openId: string) => dealers.find((d) => d.active && d.members.includes(openId)) || null;

/**
 * Süresi dolan kaydı ana bayiye devreder. Satılan kayıt ve zaten devredilmiş kayıt değişmez.
 * Ana bayinin kendi kaydı da süre dolunca "devredildi" sayılır (artık kalıcı olarak ana bayidedir).
 */
export function settleRegistration(reg: DealerRegistration, today: string, main: Dealer | null, sold: boolean, now: string): DealerRegistration {
  if (reg.status !== "aktif") return reg;
  if (sold) return { ...reg, status: "satıldı", soldAt: now };
  if (today <= reg.protectedUntil || !main) return reg;
  return { ...reg, status: "ana bayiye devredildi", dealerId: main.id, transferredAt: now };
}

export interface RegisterInput {
  lead: { id: string; name: string; phone?: string };
  project: { id: string; name: string };
  dealer: Dealer;
  byName: string;
  today: string;
  now: string;
  protectionDays: number;
}

/**
 * Müşteri kaydı kuralı. `existing` aynı telefon + proje için (önceden `settleRegistration` uygulanmış) kayıttır.
 * Kaydedilemiyorsa DealerError fırlatır; kaydedilebiliyorsa yeni kaydı döndürür.
 */
export function registerCustomer(existing: DealerRegistration | null, input: RegisterInput): DealerRegistration {
  const key = phoneKey(input.lead.phone || "");
  if (!key) throw new DealerError("Müşterinin geçerli bir telefon numarası olmalı; kayıt telefon numarası ve proje ile tanınır.");
  if (!input.dealer.active) throw new DealerError("Pasif bayi müşteri kaydedemez.", 409, "DEALER_INACTIVE");
  if (existing) {
    if (existing.status === "satıldı")
      throw new DealerError(`Bu müşteri “${existing.projectName}” projesi için daha önce kayıtlı ve satış yapılmış.`, 409, "ALREADY_REGISTERED");
    if (existing.status === "ana bayiye devredildi")
      throw new DealerError(
        existing.dealerId === input.dealer.id
          ? `Bu müşteri “${existing.projectName}” projesi için zaten ana bayide kayıtlı.`
          : `Bu müşteri “${existing.projectName}” projesi için daha önce kayıtlı. Koruma süresi dolduğu için kayıt ana bayiye devredildi; yeniden kaydedilemez.`,
        409,
        "ALREADY_REGISTERED",
      );
    throw new DealerError(
      existing.dealerId === input.dealer.id
        ? `Bu müşteri “${existing.projectName}” projesi için zaten bayinizde kayıtlı (koruma ${existing.protectedUntil.split("-").reverse().join(".")} tarihine kadar).`
        : `Bu müşteri “${existing.projectName}” projesi için daha önce kayıtlı. Başka bayi tarafından kaydedilemez.`,
      409,
      "ALREADY_REGISTERED",
    );
  }
  return {
    id: registrationId(key, input.project.id),
    phoneKey: key,
    projectId: input.project.id,
    projectName: input.project.name,
    leadId: input.lead.id,
    customerName: input.lead.name,
    customerPhone: input.lead.phone || "",
    dealerId: input.dealer.id,
    originalDealerId: input.dealer.id,
    registeredBy: input.byName,
    registeredAt: input.now,
    protectedUntil: addDaysIso(input.today, input.protectionDays),
    status: "aktif",
    transferredAt: null,
    soldAt: null,
  };
}

/** Başka bayinin kaydında müşteri bilgisi gizlenir; yalnız "kayıtlı" olduğu bilinir. */
export function canSeeRegistration(reg: DealerRegistration, viewer: { manager: boolean; dealerId: string | null; mainDealerId: string | null }): boolean {
  if (viewer.manager) return true;
  if (!viewer.dealerId) return false;
  return reg.dealerId === viewer.dealerId || reg.originalDealerId === viewer.dealerId || viewer.dealerId === viewer.mainDealerId;
}

export const REG_STATUS_LABEL: Record<RegistrationStatus, string> = { aktif: "Korumada", satıldı: "Satıldı", "ana bayiye devredildi": "Ana bayiye devredildi" };
