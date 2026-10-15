// Bitrix24 "yerel uygulama": CRM'in WhatsApp gelen kutusunu Bitrix içinde açar.
//
// Bitrix uygulamayı iframe içinde POST ile açar (DOMAIN, AUTH_ID, PLACEMENT...).
// AUTH_ID yalnızca ayarlarda tanımlı Bitrix alan adında user.current ile doğrulanır;
// Bitrix kullanıcısının e-postası CRM'deki aktif bir hesapla eşleşirse oturum açılır.
// Müşteri kartı sekmelerinde (lead / anlaşma / kişi / şirket) kaydın telefonu
// okunur ve o numaranın sohbeti açılır.
import crypto from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import type { Store } from "./db.js";
import type { AccessEmployee } from "../shared/access.js";
import { allRoles, rawStoreOf } from "./access.js";
import { forwardedOrigin } from "./auth.js";
import { allowedPhonesForBitrixUser } from "./b24-connector.js";
import { ACCOUNT_KIND, hashPassword, setSession, type LocalAccount } from "./local-auth.js";
import { fetchWithTimeout, normalizePhone, readJsonResponse } from "./security.js";

export const BITRIX_PLACEMENTS = [
  "CRM_LEAD_DETAIL_TAB",
  "CRM_DEAL_DETAIL_TAB",
  "CRM_CONTACT_DETAIL_TAB",
  "CRM_COMPANY_DETAIL_TAB",
] as const;

type Fetcher = (url: string, init?: RequestInit) => Promise<any>;
let fetcher: Fetcher = async (url, init) => readJsonResponse(await fetchWithTimeout(url, init));
/** Testler için Bitrix REST çağrılarını değiştirir. */
export function setBitrixAppFetch(next: Fetcher | null) {
  fetcher = next || (async (url, init) => readJsonResponse(await fetchWithTimeout(url, init)));
}

const cleanDomain = (v: unknown) =>
  String(v || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");

/** Ayarlardaki Bitrix alan adı (BITRIX_DOMAIN, yoksa BITRIX_WEBHOOK adresinden). */
export function configuredBitrixDomain(): string {
  const direct = cleanDomain(process.env.BITRIX_DOMAIN);
  if (direct) return direct;
  try {
    return cleanDomain(new URL(String(process.env.BITRIX_WEBHOOK || "")).host);
  } catch {
    return "";
  }
}

const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(res: Response, status: number, title: string, body: string, script = "") {
  res
    .status(status)
    .type("html")
    .setHeader("cache-control", "no-store")
    .send(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XRE CRM</title>
<style>body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#f5f8fb;color:#1d2b3a;display:grid;place-items:center;min-height:100vh}
.card{max-width:520px;margin:24px;padding:28px 30px;background:#fff;border:1px solid #dfe7ee;border-radius:14px;box-shadow:0 8px 30px rgba(15,40,70,.08)}
h1{font-size:18px;margin:0 0 8px}p{margin:6px 0;color:#4b5d70}a.btn{display:inline-block;margin-top:14px;padding:9px 16px;border-radius:9px;background:#0e5a7a;color:#fff;text-decoration:none;font-weight:600}
code{background:#eef3f7;padding:1px 6px;border-radius:5px}</style>${script}</head>
<body><div class="card"><h1>${escapeHtml(title)}</h1>${body}</div></body></html>`);
}

function crmOrigin(req: Request) {
  return (process.env.PUBLIC_ORIGIN?.trim() || forwardedOrigin(req)).replace(/\/$/, "");
}

interface BitrixParams {
  domain: string;
  authId: string;
  placement: string;
  options: Record<string, unknown>;
}

function readParams(req: Request): BitrixParams {
  const all = { ...(req.query as Record<string, unknown>), ...((req.body as Record<string, unknown>) || {}) };
  let options: Record<string, unknown> = {};
  const rawOptions = all.PLACEMENT_OPTIONS;
  if (typeof rawOptions === "string" && rawOptions.length < 10_000) {
    try {
      const parsed = JSON.parse(rawOptions);
      if (parsed && typeof parsed === "object") options = parsed;
    } catch {
      /* geçersiz seçenekler yok sayılır */
    }
  } else if (rawOptions && typeof rawOptions === "object") options = rawOptions as Record<string, unknown>;
  return {
    domain: cleanDomain(all.DOMAIN),
    authId: String(all.AUTH_ID || "").slice(0, 4096),
    placement: String(all.PLACEMENT || "DEFAULT"),
    options,
  };
}

async function rest(domain: string, authId: string, method: string, params: Record<string, unknown> = {}) {
  const data = await fetcher(`https://${domain}/rest/${method}.json?auth=${encodeURIComponent(authId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  if (data?.error) throw new Error(String(data.error_description || data.error));
  return data?.result;
}

const firstPhone = (entity: any): string => {
  const list = Array.isArray(entity?.PHONE) ? entity.PHONE : [];
  return normalizePhone(list.find((p: any) => p?.VALUE)?.VALUE || "");
};

/** Bitrix kartındaki kaydın telefonunu bulur (anlaşmada bağlı kişi, yoksa şirket). */
export async function placementPhone(domain: string, authId: string, placement: string, options: Record<string, unknown>) {
  const id = String(options.ID || options.id || "").replace(/\D/g, "");
  if (!id) return "";
  if (placement === "CRM_LEAD_DETAIL_TAB") return firstPhone(await rest(domain, authId, "crm.lead.get", { id }));
  if (placement === "CRM_CONTACT_DETAIL_TAB") return firstPhone(await rest(domain, authId, "crm.contact.get", { id }));
  if (placement === "CRM_COMPANY_DETAIL_TAB") return firstPhone(await rest(domain, authId, "crm.company.get", { id }));
  if (placement === "CRM_DEAL_DETAIL_TAB") {
    const deal = await rest(domain, authId, "crm.deal.get", { id });
    if (Number(deal?.CONTACT_ID) > 0) {
      const phone = firstPhone(await rest(domain, authId, "crm.contact.get", { id: deal.CONTACT_ID }));
      if (phone) return phone;
    }
    if (Number(deal?.COMPANY_ID) > 0)
      return firstPhone(await rest(domain, authId, "crm.company.get", { id: deal.COMPANY_ID }));
  }
  return "";
}

/** İstek ayarlı Bitrix portalından mı geliyor; geliyorsa AUTH_ID'nin sahibi kim. */
async function verify(params: BitrixParams) {
  const expected = configuredBitrixDomain();
  if (!expected)
    throw Object.assign(new Error("CRM'de Bitrix alan adı tanımlı değil. Yönetici Entegrasyonlar → Bitrix24 bölümüne alan adını girmeli."), { statusCode: 503 });
  if (!params.domain || params.domain !== expected)
    throw Object.assign(new Error(`Bu uygulama yalnızca ${expected} portalında çalışır.`), { statusCode: 403 });
  if (!params.authId) throw Object.assign(new Error("Bitrix oturum bilgisi gelmedi. Uygulamayı Bitrix içinden açın."), { statusCode: 401 });
  const user = await rest(params.domain, params.authId, "user.current").catch(() => null);
  if (!user?.ID) throw Object.assign(new Error("Bitrix oturumu doğrulanamadı."), { statusCode: 401 });
  let admin = false;
  try {
    admin = (await rest(params.domain, params.authId, "user.admin")) === true;
  } catch {
    admin = false;
  }
  return {
    id: String(user.ID),
    email: String(user.EMAIL || "").trim().toLowerCase(),
    name: [user.NAME, user.LAST_NAME].filter(Boolean).join(" ").trim() || `Bitrix kullanıcısı ${user.ID}`,
    phone: String(user.PERSONAL_MOBILE || user.WORK_PHONE || "").slice(0, 40),
    title: String(user.WORK_POSITION || "").slice(0, 120),
    admin,
  };
}

export const BITRIX_IDENTITY_KIND = "bitrix-identity";
type BitrixUser = Awaited<ReturnType<typeof verify>>;

/**
 * Bitrix kullanıcısını CRM hesabına bağlar. Önce Bitrix kullanıcı kimliğiyle
 * (e-posta olmasa da çalışır), sonra e-postayla eşler; hiçbiri yoksa ve
 * otomatik hesap kapalı değilse hesabı açar: Bitrix yöneticisi → Yönetici,
 * diğerleri → Satış danışmanı. Otomatik hesapların şifresi yoktur; yalnızca
 * Bitrix üzerinden girilir (sahip isterse sonradan şifre verebilir).
 */
export async function bitrixAccount(raw: Store, owner: string, domain: string, user: BitrixUser) {
  const identityId = `${domain}:${user.id}`;
  const accounts = (await raw.list<LocalAccount>(ACCOUNT_KIND, owner)).map((r) => r.payload);
  const linked = (await raw.get<{ accountId: string }>(BITRIX_IDENTITY_KIND, identityId, owner))?.payload;
  let account = linked ? accounts.find((a) => a.id === linked.accountId) : undefined;
  if (!account && user.email) account = accounts.find((a) => a.email.toLowerCase() === user.email);
  const now = new Date().toISOString();
  if (!account) {
    if (process.env.BITRIX_AUTO_ACCOUNTS?.trim() === "0") return null;
    const roles = await allRoles(raw, owner);
    const role =
      roles.find((r) => r.id === (user.admin ? "manager" : "sales")) ||
      roles.find((r) => r.id !== "owner");
    if (!role) return null;
    const id = `acc_${crypto.randomBytes(8).toString("hex")}`;
    const openId = `local:${id}`;
    const email =
      user.email && !accounts.some((a) => a.email.toLowerCase() === user.email)
        ? user.email
        : `bitrix-${user.id.replace(/\D/g, "")}@${domain}`;
    const employee: AccessEmployee = {
      id: `employee_${crypto.randomBytes(6).toString("hex")}`,
      name: user.name.slice(0, 120),
      email,
      openId,
      departmentId: "",
      roleId: role.id,
      active: true,
      title: user.title,
      phone: user.phone,
      createdAt: now,
      updatedAt: now,
    };
    account = {
      id,
      openId,
      name: employee.name,
      email,
      // Kullanılamaz rastgele şifre: hesap yalnız Bitrix'ten açılır.
      passwordHash: await hashPassword(crypto.randomBytes(32).toString("base64url")),
      active: true,
      employeeId: employee.id,
      createdAt: now,
      updatedAt: now,
    };
    await raw.put("employee", employee.id, employee, owner);
    await raw.put(ACCOUNT_KIND, id, account, owner);
  }
  if (!linked || linked.accountId !== account.id)
    await raw.put(BITRIX_IDENTITY_KIND, identityId, { id: identityId, domain, bitrixUserId: user.id, accountId: account.id, linkedAt: now }, owner);
  return account;
}

export function registerBitrixAppRoutes(app: Express, store: Store) {
  const raw = rawStoreOf(store);
  const form = express.urlencoded({ extended: false, limit: "64kb" });

  const open = async (req: Request, res: Response) => {
    const params = readParams(req);
    try {
      const bitrixUser = await verify(params);
      const owner = await raw.resolveOwner();
      if (!owner) return page(res, 503, "CRM kurulumu tamamlanmamış", "<p>Önce CRM'de yönetici hesabı oluşturulmalı.</p>");
      const account = await bitrixAccount(raw, owner, params.domain, bitrixUser);
      if (!account)
        return page(
          res,
          403,
          "CRM hesabınız bulunamadı",
          `<p>${escapeHtml(bitrixUser.name)} için CRM'de hesap yok ve otomatik hesap açma kapalı.</p>
<p>Yöneticiniz CRM'de <b>Çalışanlar</b> sayfasından hesap açmalı.</p>`,
        );
      if (!account.active)
        return page(res, 403, "CRM hesabınız pasif", "<p>Yöneticiniz CRM'de <b>Çalışanlar</b> sayfasından hesabınızı etkinleştirmeli.</p>");
      // XRE WhatsApp panelindeki rol, CRM gelen kutusunda hangi numaraların görüneceğini de belirler.
      if (account.employeeId) {
        const employee = (await raw.get<any>("employee", account.employeeId, owner))?.payload;
        if (employee) {
          const phones = await allowedPhonesForBitrixUser(raw, params.domain, bitrixUser.id);
          const next = { ...employee };
          if (phones) next.whatsappPhones = phones;
          else delete next.whatsappPhones;
          if (JSON.stringify(next.whatsappPhones) !== JSON.stringify(employee.whatsappPhones))
            await raw.put("employee", employee.id, { ...next, updatedAt: new Date().toISOString() }, owner);
        }
      }
      await setSession(req, res, account, { partitioned: true });
      await raw.put(ACCOUNT_KIND, account.id, { ...account, lastLoginAt: new Date().toISOString() }, owner);
      let phone = "";
      if ((BITRIX_PLACEMENTS as readonly string[]).includes(params.placement)) {
        try {
          phone = await placementPhone(params.domain, params.authId, params.placement, params.options);
        } catch (error) {
          console.warn("Bitrix kart telefonu okunamadı:", error instanceof Error ? error.message : error);
        }
        if (!phone)
          return page(
            res,
            200,
            "Bu kayıtta telefon yok",
            `<p>WhatsApp sohbeti açmak için Bitrix kaydına bir telefon numarası ekleyin.</p>
<a class="btn" href="/whatsapp?embed=bitrix">Tüm WhatsApp sohbetleri</a>`,
          );
      }
      const target = `/whatsapp?embed=bitrix${phone ? `&phone=${phone}` : ""}`;
      res.redirect(303, target);
    } catch (error) {
      const e = error as Error & { statusCode?: number };
      page(res, e.statusCode && e.statusCode < 600 ? e.statusCode : 502, "Bitrix bağlantısı kurulamadı", `<p>${escapeHtml(e.message)}</p>`);
    }
  };
  app.get("/bitrix/app", open);
  app.post("/bitrix/app", form, open);

  // Kurulum: müşteri kartlarına "WhatsApp" sekmesini ekler, sonra BX24.installFinish().
  const install = async (req: Request, res: Response) => {
    const params = readParams(req);
    const handler = `${crmOrigin(req)}/bitrix/app`;
    const results: string[] = [];
    try {
      await verify(params);
      for (const placement of BITRIX_PLACEMENTS) {
        try {
          await rest(params.domain, params.authId, "placement.unbind", { PLACEMENT: placement, HANDLER: handler }).catch(() => undefined);
          await rest(params.domain, params.authId, "placement.bind", {
            PLACEMENT: placement,
            HANDLER: handler,
            TITLE: "WhatsApp",
            LANG_ALL: { tr: { TITLE: "WhatsApp" }, en: { TITLE: "WhatsApp" }, ru: { TITLE: "WhatsApp" } },
          });
          results.push(`<li>${placement}: eklendi</li>`);
        } catch (error) {
          results.push(`<li>${placement}: ${escapeHtml(error instanceof Error ? error.message : String(error))}</li>`);
        }
      }
    } catch (error) {
      const e = error as Error & { statusCode?: number };
      return page(res, e.statusCode && e.statusCode < 600 ? e.statusCode : 502, "Kurulum tamamlanamadı", `<p>${escapeHtml(e.message)}</p>`);
    }
    page(
      res,
      200,
      "XRE CRM WhatsApp kuruldu",
      `<p>Müşteri kartlarına <b>WhatsApp</b> sekmesi eklendi:</p><ul>${results.join("")}</ul>
<p>Pencereyi kapatıp sol menüden uygulamayı açabilirsiniz.</p>`,
      `<script src="https://api.bitrix24.com/api/v1/"></script><script>window.addEventListener("load",function(){try{BX24.init(function(){BX24.installFinish();});}catch(e){}});</script>`,
    );
  };
  app.get("/bitrix/install", install);
  app.post("/bitrix/install", form, install);
}
