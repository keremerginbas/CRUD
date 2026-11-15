// Canlı güncelleme: bir çalışma alanında veri değiştiğinde o alanın açık oturumlarına haber verilir;
// arayüz 15 saniyelik yenilemeyi beklemeden güncellenir. Akış yalnız "değişti" işareti taşır, veri taşımaz:
// tarayıcı veriyi her zamanki yetki denetimli /api/state üzerinden alır.
import type { Express, Request, Response } from "express";
import type { AuthContext } from "./types.js";

// Yalnız /api/state içinde görünen kayıt türleri haber üretir (denetim günlüğü, oturum vb. üretmez).
const STATE_KINDS = new Set([
  "lead", "rule", "message", "connection", "call", "stage-history", "event",
  "contacts", "companies", "pipelines", "tasks", "activities", "feed", "members", "employee",
]);
const DEBOUNCE_MS = 350;
const MAX_STREAMS_PER_USER = 6;

interface LiveClient {
  res: Response;
  owner: string;
  openId: string;
}
const clients = new Set<LiveClient>();
const timers = new Map<string, NodeJS.Timeout>();

/** Depo yazımlarından çağrılır. Art arda değişiklikler (toplu içe aktarma) tek habere toplanır. */
export function emitStoreChange(owner: string, kind: string): void {
  if (!clients.size || !owner || !STATE_KINDS.has(kind) || timers.has(owner)) return;
  const timer = setTimeout(() => {
    timers.delete(owner);
    for (const client of clients) if (client.owner === owner) client.res.write("event: changed\ndata: {}\n\n");
  }, DEBOUNCE_MS);
  timer.unref?.();
  timers.set(owner, timer);
}

/** Oturumu iptal edilen kullanıcının akışlarını kapatır; tarayıcı hemen yeniden doğrulamaya gider. */
export function dropLiveClients(openId: string): void {
  for (const client of clients) if (client.openId === openId) client.res.end();
}

export const liveClientCount = () => clients.size;

export function registerLiveRoutes(app: Express): void {
  app.get("/api/live", (req: Request, res: Response) => {
    const auth = (req as Request & { auth?: AuthContext }).auth;
    if (!auth?.ownerOpenId) return void res.status(401).json({ error: "UNAUTHORIZED" });
    // Aynı kullanıcının çok sayıda sekmesi sunucuyu tüketmesin: en eski akış kapatılır.
    const mine = [...clients].filter((c) => c.openId === auth.user.openId && c.owner === auth.ownerOpenId);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_STREAMS_PER_USER + 1))) old.res.end();
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 5000\n: bağlandı\n\n");
    const client: LiveClient = { res, owner: auth.ownerOpenId, openId: auth.user.openId };
    clients.add(client);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    const close = () => {
      clearInterval(ping);
      clients.delete(client);
    };
    req.on("close", close);
    res.on("close", close);
  });
}

/** Testler için açık akışları kapatır. */
export function resetLiveClients(): void {
  for (const c of clients) c.res.end();
  clients.clear();
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}
