import { stagePolicyStore } from "./crm-stage-policy.js";
import { appointmentStore } from "./appointments.js";
import "dotenv/config";
import path from "node:path";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp, startOutboxWorker } from "./app.js";
import { createStore } from "./db.js";
import { loadLineInventory, loadLineInventoryFromStore } from "./line-inventory.js";
import { ensureSessionSecret } from "./local-auth.js";
import { loadIntegrationSettings } from "./integration-settings.js";
import { webhookEmitterStore } from "./webhook-hub.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

export async function start(): Promise<void> {
  ensureSessionSecret(projectRoot);
  const inventory = loadLineInventory(projectRoot);
  console.log(`Hat envanteri: ${inventory.count} hat (${inventory.source === "placeholder" ? "yer tutucu" : "yerel yapılandırma"})`);
  const store = createStore();
  try {
    await store.init();
  } catch (error) {
    console.warn(
      "Kalıcı veritabanı hazır değil; gerçek yazma istekleri 503 dönecek.",
      error instanceof Error ? error.message : error,
    );
  }
  try {
    const saved = await loadLineInventoryFromStore(store);
    if (saved) console.log(`Hat envanteri veritabanından yüklendi: ${saved} hat.`);
  } catch (error) {
    console.warn("Kayıtlı hat envanteri okunamadı:", error instanceof Error ? error.message : error);
  }
  try {
    const count = await loadIntegrationSettings(store);
    if (count) console.log(`Arayüzden kaydedilmiş ${count} entegrasyon ayarı yüklendi.`);
  } catch (error) {
    console.warn("Entegrasyon ayarları yüklenemedi:", error instanceof Error ? error.message : error);
  }
  const app = createApp({ store, background: true });
  const httpServer = createHttpServer(app);
  startOutboxWorker(
    stagePolicyStore(appointmentStore(webhookEmitterStore(store))),
    Number(process.env.OUTBOX_INTERVAL_MS || 5000),
  );
  const production = process.env.NODE_ENV === "production";
  if (production) {
    const publicDir = path.join(projectRoot, "dist", "public");
    // index.html her zaman yeniden doğrulanır; güncelleme sonrası eski arayüz açılmaz.
    const noCache = (res: express.Response) =>
      res.setHeader("cache-control", "no-cache");
    app.use(
      express.static(publicDir, {
        index: "index.html",
        setHeaders: (res, file) => {
          if (file.endsWith(".html")) noCache(res);
        },
      }),
    );
    app.get("*", (_req, res) => {
      noCache(res);
      res.sendFile(path.join(publicDir, "index.html"));
    });
  } else {
    const { attachDevelopmentServer } = await import("./development.js");
    await attachDevelopmentServer(app, httpServer, projectRoot);
  }
  const port = Number(process.env.PORT || 3000);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE")
        console.error(
          `\n${port} portu zaten kullanımda. Büyük ihtimalle eski bir XRE CRM penceresi açık.\n` +
            "O pencereyi kapatın (veya Görev Yöneticisi'nde node.exe'yi sonlandırın) ve tekrar başlatın.\n" +
            "Alternatif: .env dosyasında PORT=3001 yapın.\n",
        );
      reject(error);
    });
    httpServer.listen(port, "0.0.0.0", () => {
      console.log(`XRE CRM server listening on 0.0.0.0:${port}`);
      resolve();
    });
  });
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry && path.resolve(fileURLToPath(import.meta.url)) === entry)
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
