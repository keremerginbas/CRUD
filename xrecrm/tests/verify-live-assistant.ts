import express from "express";
import http from "node:http";
import { registerAssistantRoutes } from "../server/assistant";
import { createMemoryStore } from "../server/db";
async function main() {
  const store = createMemoryStore();
  const owner = "synthetic-validation";
  await store.put(
    "lead",
    "synthetic-lead",
    {
      id: "synthetic-lead",
      name: "Sentetik Test Müşterisi",
      stage: "new",
      owner: "Test Danışman",
      value: 1000,
      createdAt: new Date().toISOString(),
      phone: "+905550000000",
      notes: "Bu yalnız sentetik test kaydıdır.",
    },
    owner,
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).auth = { ownerOpenId: owner, isOwner: true };
    next();
  });
  registerAssistantRoutes(app, store);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const status = await fetch(base + "/api/assistant/status");
    console.log(
      "AI yapılandırma:",
      status.status,
      (await status.json()).configured,
    );
    const r = await fetch(base + "/api/assistant/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message:
          'Sentetik Test Müşterisi için Test Danışman sorumlusunda 2030-01-02T10:00:00+03:00 son tarihli "Sentetik takip" görevi hazırla. Sadece öner, uygulama.',
        history: [],
        context: { path: "/tasks", leadId: "synthetic-lead" },
      }),
      signal: AbortSignal.timeout(55000),
    });
    const d = await r.json();
    console.log("Gerçek OpenAI sohbet:", r.status, {
      answerPresent: !!d.answer,
      actionKinds: d.actions?.map((a: any) => a.kind),
      model: d.model,
      sources: d.sources?.length,
      error: d.error,
    });
    if (!r.ok || !d.answer || !d.actions?.some((a: any) => a.kind === "task"))
      throw new Error("Canlı AI öneri doğrulaması başarısız");
    const history = await fetch(base + "/api/assistant/history");
    console.log(
      "Sentetik sohbet geçmişi:",
      (await history.json()).messages.length,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
