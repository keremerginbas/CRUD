import { afterEach, beforeEach, expect, it } from "vitest";
import http from "node:http";
import { createApp, processOutboxOnce } from "../server/app";
import { createMemoryStore } from "../server/db";
import { resetEmailRateLimits, setEmailDnsLookup, setEmailTransports, type MailboxConfig, type OutgoingMail } from "../server/email";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];
let sent: { cfg: MailboxConfig; mail: OutgoingMail }[] = [];
beforeEach(() => {
  for (const key of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "MANUS_OAUTH_PORTAL_URL", "XRE_SIGNUP", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"])
    delete process.env[key];
  process.env.XRE_SESSION_SECRET = "automation-actions-secret-0123456789";
  sent = [];
  resetEmailRateLimits();
  setEmailTransports({
    verifySmtp: async () => undefined,
    verifyImap: async () => undefined,
    send: async (cfg, mail) => {
      sent.push({ cfg, mail });
      return { messageId: `<otomasyon-${sent.length}@example.test>` };
    },
    fetchNew: async (_cfg, state) => ({ uidValidity: "1", lastUid: state.lastUid || 0, messages: [] }),
  });
  setEmailDnsLookup(async () => [{ address: "203.0.113.10", family: 4 }]);
});
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  setEmailTransports(null);
  setEmailDnsLookup(null);
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

async function start() {
  const store = createMemoryStore();
  const server = http.createServer(createApp({ store }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const setup = await fetch(`${base}/api/auth/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Sistem Sahibi", email: "sahip@xre.test", password: "Yonetici123" }),
  });
  expect(setup.status).toBe(201);
  const cookie = (setup.headers.get("set-cookie") || "").split(";")[0];
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { store, call };
}
const rule = (id: string, triggerStage: string, action: string, config: Record<string, string>) => ({ id, name: `Kural ${id}`, triggerStage, action, enabled: true, config });
const drain = async (store: ReturnType<typeof createMemoryStore>) => {
  let total = 0;
  for (let i = 0; i < 12; i++) {
    const n = await processOutboxOnce(store);
    if (!n) break;
    total += n;
  }
  return total;
};

it("aşama değiştirme kuralı müşteriyi taşır, yeni aşamanın kurallarını tetikler ve döngüyü keser", async () => {
  const { store, call } = await start();
  // new → contacted → new → … sonsuz döngü kurulur.
  expect((await call("POST", "/api/rules", rule("ileri", "new", "stage", { targetStage: "contacted" }))).status).toBeLessThan(300);
  expect((await call("POST", "/api/rules", rule("geri", "contacted", "stage", { targetStage: "new" }))).status).toBeLessThan(300);
  expect((await call("POST", "/api/rules", rule("not", "contacted", "note", { template: "{{name}} ilk görüşmeye alındı." }))).status).toBeLessThan(300);
  expect((await call("POST", "/api/leads", { lead: { id: "lead_1", name: "Deniz Örnek", phone: "+905550000001" } })).status).toBe(201);
  await drain(store);
  const state = await (await call("GET", "/api/state")).json();
  const lead = state.leads.find((l: any) => l.id === "lead_1");
  expect(["new", "contacted"]).toContain(lead.stage);
  const owner = (await store.resolveOwner())!;
  const events = (await store.listEvents(owner)).filter((e) => e.payload.type === "rule-action");
  const stageRuns = events.filter((e) => e.payload.action === "stage");
  // Zincir en fazla 3 adım derinleşir; sonraki adım "atlandı" olarak kapanır.
  expect(stageRuns.length).toBeLessThanOrEqual(5);
  expect(stageRuns.some((e) => (e.payload.result as any)?.skipped && /zincir/i.test(String((e.payload.result as any).reason)))).toBe(true);
  expect(events.every((e) => e.status === "completed")).toBe(true);
  const suite = await (await call("GET", "/api/suite/state")).json().catch(() => null);
  const notes = (await store.list<any>("feed", owner)).map((r) => r.payload);
  expect(notes.some((n) => n.leadId === "lead_1" && n.author === "Otomasyon" && n.text === "Deniz Örnek ilk görüşmeye alındı.")).toBe(true);
  void suite;
});

it("sorumlu değiştirme yalnızca etkin bir çalışana devreder", async () => {
  const { store, call } = await start();
  const owner = (await store.resolveOwner())!;
  await store.put("employee", "employee_ali", { id: "employee_ali", name: "Ali Kemal", email: "ali@example.test", openId: "local:ali", departmentId: "", roleId: "sales", active: true, title: "", phone: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, owner);
  await call("POST", "/api/rules", rule("devret", "new", "owner", { owner: "ali kemal" }));
  await call("POST", "/api/rules", rule("yok", "new", "owner", { owner: "Olmayan Kişi" }));
  await call("POST", "/api/leads", { lead: { id: "lead_2", name: "Ayşe Deneme", phone: "+905550000002" } });
  await drain(store);
  const lead = (await (await call("GET", "/api/state")).json()).leads.find((l: any) => l.id === "lead_2");
  expect(lead.owner).toBe("Ali Kemal");
  const results = (await store.listEvents(owner)).filter((e) => e.payload.action === "owner").map((e) => e.payload.result as any);
  expect(results.some((r) => r?.skipped && /bulunamadı/.test(r.reason))).toBe(true);
});

it("e-posta kuralı bağlı posta kutusundan müşterinin kayıtlı adresine tek kez gönderir", async () => {
  const { store, call } = await start();
  const owner = (await store.resolveOwner())!;
  await call("POST", "/api/rules", rule("karsila", "new", "email", { subject: "Merhaba {{name}}", template: "Talebiniz bize ulaştı." }));
  // Posta kutusu bağlı değilken kural hata verir, müşteri yine oluşur.
  await call("POST", "/api/leads", { lead: { id: "lead_3", name: "Mehmet Test", phone: "+905550000003", email: "mehmet@example.test" } });
  await drain(store);
  expect(sent).toHaveLength(0);

  expect((await call("PUT", "/api/email/account", { provider: "gmail", address: "satis@example.test", displayName: "Satış Ekibi", password: "test-parola-123" })).status).toBeLessThan(300);
  await call("POST", "/api/leads", { lead: { id: "lead_4", name: "Selin Örnek", phone: "+905550000004", email: "selin@example.test" } });
  await call("POST", "/api/leads", { lead: { id: "lead_5", name: "Adressiz Kişi", phone: "+905550000005" } });
  await drain(store);
  expect(sent.map((s) => [s.mail.to, s.mail.subject])).toEqual([["selin@example.test", "Merhaba Selin Örnek"]]);
  const stored = (await store.list<any>("email-message", owner)).map((r) => r.payload);
  expect(stored.filter((m) => m.leadId === "lead_4" && m.direction === "outbound")).toHaveLength(1);
  // Başlık enjeksiyonu: konuya satır sonu sokan kural gönderim yapmaz.
  await call("POST", "/api/rules", rule("kotu", "contacted", "email", { subject: "Selam\r\nBcc: baska@example.test", template: "x" }));
  await call("PATCH", "/api/leads/lead_4", { stage: "contacted" });
  await drain(store);
  expect(sent).toHaveLength(1);
});

it("tetikleyici olay olduğunda müşteriyi ileri taşır, o aşamanın kuralını çalıştırır; geri taşımaz ve kapanmış müşteriye dokunmaz", async () => {
  const { store, call } = await start();
  const owner = (await store.resolveOwner())!;
  const trigger = (id: string, event: string, targetStage: string, extra: Record<string, unknown> = {}) => ({ id, name: `Tetik ${id}`, event, targetStage, enabled: true, allowBackward: false, ...extra });
  expect((await call("POST", "/api/triggers", trigger("t1", "task.done", "qualified"))).status).toBe(201);
  expect((await call("POST", "/api/triggers", trigger("t2", "task.done", "contacted"))).status).toBe(201);
  expect((await call("POST", "/api/triggers", trigger("bad", "olmayan.olay", "contacted"))).status).toBe(400);
  expect((await (await call("GET", "/api/triggers")).json()).triggers).toHaveLength(2);
  await call("POST", "/api/rules", rule("not-q", "qualified", "note", { template: "Nitelikli aşamaya geçti." }));
  await call("POST", "/api/leads", { lead: { id: "lead_t", name: "Tetik Müşterisi", phone: "+905550000009" } });
  const stageOf = async (id: string) => (await (await call("GET", "/api/state")).json()).leads.find((l: any) => l.id === id).stage;
  const task = (id: string, leadId: string, status: string) => ({ id, title: "Ara", description: "", status, priority: "normal", assignee: "", leadId, dueAt: new Date(Date.now() + 3600_000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  // Depo sarmalayıcısı uygulamanın içindedir; görev API üzerinden açılıp tamamlanır.
  const done = async (id: string, leadId: string) => {
    expect((await call("POST", "/api/tasks", task(id, leadId, "todo"))).status).toBeLessThan(300);
    expect((await call("PATCH", `/api/tasks/${id}`, { status: "done" })).status).toBeLessThan(300);
  };
  await done("task_1", "lead_t");
  // İki tetikleyiciden en ileri aşama (qualified) seçilir.
  expect(await stageOf("lead_t")).toBe("qualified");
  await drain(store);
  const notes = (await store.list<any>("feed", owner)).map((r) => r.payload);
  expect(notes.some((n) => n.leadId === "lead_t" && n.text === "Nitelikli aşamaya geçti.")).toBe(true);

  // Daha ilerideki müşteri geri taşınmaz.
  await call("PATCH", "/api/leads/lead_t", { stage: "proposal" });
  await done("task_2", "lead_t");
  expect(await stageOf("lead_t")).toBe("proposal");
  // Kapanmış müşteri yerinden oynamaz.
  await call("POST", "/api/leads", { lead: { id: "lead_w", name: "Kazanılan", phone: "+905550000010", stage: "won" } });
  await done("task_3", "lead_w");
  expect(await stageOf("lead_w")).toBe("won");
  expect((await call("DELETE", "/api/triggers/t1")).status).toBe(200);
  expect((await (await call("GET", "/api/triggers")).json()).triggers).toHaveLength(1);
});

it("bildirim kuralı çalışanın kutusuna kalıcı not bırakır; yalnız o kişi görür ve okundu yapabilir", async () => {
  const { store, call } = await start();
  await call("POST", "/api/rules", rule("haber", "new", "notify", { owner: "Sistem Sahibi", template: "{{name}} yeni müşteri olarak eklendi" }));
  await call("POST", "/api/rules", rule("baska", "new", "notify", { owner: "Başka Biri", template: "Bu bana gelmemeli" }));
  await call("POST", "/api/leads", { lead: { id: "lead_n", name: "Bildirim Müşterisi", phone: "+905550000011" } });
  await drain(store);
  const inbox = await (await call("GET", "/api/inbox")).json();
  expect(inbox.unread).toBe(1);
  expect(inbox.notifications.map((n: any) => [n.title, n.leadId])).toEqual([["Bildirim Müşterisi yeni müşteri olarak eklendi", "lead_n"]]);
  expect((await call("POST", "/api/inbox/read", {})).status).toBe(200);
  expect((await (await call("GET", "/api/inbox")).json()).unread).toBe(0);
});
