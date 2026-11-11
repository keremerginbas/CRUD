// WhatsApp by XRE'nin CRM'den bağımsız çalışan sunucusu (XRE_APP_MODE=connector).
// Yalnız Bitrix24 Market uygulamasının uçları, WhatsApp webhook'u ve uygulama
// yönetim ekranı açıktır; CRM ekranları, API'leri ve CRM verisi bu süreçte yoktur.
import fs from "node:fs";
import path from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Store } from "./db.js";
import type { StoredRecord } from "./types.js";
import { handleConnectorEvolution, isConnectorInstance, registerB24ConnectorRoutes, rebindPortals, startLineHealthMonitor } from "./b24-connector.js";
import { registerBillingAdminRoutes, startBillingReminders } from "./b24-billing.js";
import { startReportScheduler } from "./b24-live.js";
import { startWaitAlerts } from "./b24-alerts.js";
import { resumeCampaigns } from "./b24-campaigns.js";
import { registerVendorAdminAuth } from "./b24-vendor-auth.js";
import { CONNECTOR_SETTINGS_OWNER, CONNECTOR_SETTING_KEYS, SETTINGS_ID, SETTINGS_KIND } from "./integration-settings.js";
import { bearerMatches } from "./security.js";

export type AppMode = "all" | "crm" | "connector";
/** Çalışma modu: all (eskisi gibi tek uygulama), crm (WhatsApp by XRE kapalı), connector (yalnız WhatsApp by XRE). */
export const appMode = (): AppMode => {
  const v = String(process.env.XRE_APP_MODE || "").trim().toLowerCase();
  return v === "crm" || v === "connector" ? v : "all";
};

export function createConnectorApp(options: { store: Store; background?: boolean }): Express {
  const { store } = options;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  // Express 4 reddedilen async işleyicileri kendisi yakalamaz.
  for (const method of ["get", "post", "put", "patch", "delete"] as const) {
    const original = (app[method] as any).bind(app);
    (app as any)[method] = (...args: any[]) =>
      original(
        ...args.map((arg) =>
          typeof arg === "function" && arg.length < 4
            ? (req: Request, res: Response, next: NextFunction) => {
                Promise.resolve(arg(req, res, next)).catch((error) => {
                  console.error(error);
                  if (!res.headersSent) res.status(500).json({ error: "FAILED", message: "İşlem tamamlanamadı." });
                });
              }
            : arg,
        ),
      );
  }
  app.use((_req, res, next) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
    next();
  });

  app.get("/health", async (_req, res) => {
    const readiness = await store.readiness().catch(() => ({ database: false }));
    res.status(readiness.database ? 200 : 503).json({ ok: readiness.database, service: "whatsapp-by-xre", time: new Date().toISOString() });
  });

  // WhatsApp sunucusundan gelen olaylar: yalnız bu uygulamanın oturumları işlenir.
  app.post("/api/webhooks/evolution", express.json({ limit: "64mb" }), (req, res) => {
    const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (!secret) return res.status(503).send("EVOLUTION_WEBHOOK_SECRET yapılandırılmamış.");
    const ok =
      bearerMatches(String(req.headers.authorization || ""), secret) ||
      bearerMatches(String(req.headers["x-evolution-webhook-secret"] || ""), secret) ||
      bearerMatches(typeof req.query.token === "string" ? req.query.token : "", secret);
    if (!ok) return res.status(401).send("unauthorized");
    res.status(200).json({ ok: true });
    if (isConnectorInstance(req.body?.instance))
      void handleConnectorEvolution(store, req.body).catch((error) => console.warn("Bitrix bağlayıcısına iletilemedi:", (error as Error).message));
  });

  registerB24ConnectorRoutes(app, store);
  registerVendorAdminAuth(app);
  app.use("/api/b24-admin", express.json({ limit: "1mb" }));
  registerBillingAdminRoutes(app, store);

  app.get("/", (_req, res) => res.redirect(302, "/b24/support"));
  app.use((_req, res) => res.status(404).type("text").send("Bulunamadı."));

  if (options.background) {
    startReportScheduler(store);
    startLineHealthMonitor(store);
    startBillingReminders(store);
    startWaitAlerts(store);
    void resumeCampaigns(store).catch((e) => console.warn("Kampanyalar devam ettirilemedi:", (e as Error).message));
    // Adres değiştiyse kurulu portalların Bitrix bağlantıları yeni adrese taşınır.
    setTimeout(() => void rebindPortals(store).catch((e) => console.warn("Bitrix bağlantıları taşınamadı:", (e as Error).message)), 5_000).unref?.();
  }
  return app;
}

// --- CRM veri dosyasından taşıma ---------------------------------------------

const CONNECTOR_OWNER = "b24-connector";
const MEDIA_OWNER = /^b24(q|qu)?:/;

/** CRM veri dosyasındaki kayıtlardan WhatsApp by XRE'ye ait olanları seçer. */
export function pickConnectorRecords(records: StoredRecord[]): StoredRecord[] {
  const out: StoredRecord[] = [];
  for (const r of records) {
    if (r.ownerOpenId === CONNECTOR_OWNER) out.push(r);
    else if (r.kind === "media" && MEDIA_OWNER.test(r.ownerOpenId)) out.push(r);
    else if (r.kind === SETTINGS_KIND && r.id === SETTINGS_ID) {
      // Yalnız uygulamanın ihtiyaç duyduğu ayarlar (OpenAI, Bitrix uygulama anahtarları, satıcı bilgileri).
      const payload = (r.payload || {}) as { values?: Record<string, string> };
      const values = Object.fromEntries(Object.entries(payload.values || {}).filter(([k]) => CONNECTOR_SETTING_KEYS.includes(k)));
      if (Object.keys(values).length) out.push({ ...r, ownerOpenId: CONNECTOR_SETTINGS_OWNER, payload: { ...payload, values } });
    }
  }
  return out;
}

/**
 * CRM veri klasöründen (xrecrm-data.json + media + b24-video + b24-rest) WhatsApp by XRE
 * verisini bu uygulamanın veri klasörüne kopyalar. CRM verisi değiştirilmez.
 */
export async function migrateFromCrm(store: Store, fromDir: string, opts: { force?: boolean } = {}) {
  const file = path.join(fromDir, "xrecrm-data.json");
  if (!fs.existsSync(file)) throw new Error(`CRM veri dosyası bulunamadı: ${file}`);
  const already = await store.list("b24-portal", CONNECTOR_OWNER);
  if (already.length && !opts.force) throw new Error(`Hedefte zaten ${already.length} portal var; tekrar taşımak için --force kullanın.`);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const records = pickConnectorRecords(data.records || []);
  for (const r of records) await store.put(r.kind, r.id, r.payload, r.ownerOpenId);
  const toDir = path.resolve(process.env.XRE_DATA_DIR || "data");
  let files = 0;
  const copy = (src: string, dst: string) => {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    files++;
  };
  for (const r of records) if (r.kind === "media") copy(path.join(fromDir, "media", r.id), path.join(toDir, "media", r.id));
  for (const dir of ["b24-video", "b24-rest"]) {
    const src = path.join(fromDir, dir);
    if (fs.existsSync(src)) for (const name of fs.readdirSync(src)) copy(path.join(src, name), path.join(toDir, dir, name));
  }
  const kinds: Record<string, number> = {};
  for (const r of records) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  return { records: records.length, files, kinds };
}
