import { afterEach, beforeEach, expect, it } from "vitest";
import http from "node:http";
import { createApp, processOutboxOnce } from "../server/app";
import { createMemoryStore } from "../server/db";
import { resetSmsLimits, setSmsTransport, smsReceiver } from "../server/sms";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];
let logins = 0;
let sent: { token: string; body: any }[] = [];
let reject: string | null = null;
beforeEach(() => {
  for (const key of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "MANUS_OAUTH_PORTAL_URL", "XRE_SIGNUP", "XRE_SIGNUP_VERIFY", "TURKCELL_SMS_USERNAME", "TURKCELL_SMS_PASSWORD", "TURKCELL_SMS_SENDER", "TURKCELL_SMS_NUMBER_FORMAT", "TURKCELL_SMS_COMMERCIAL", "TURKCELL_SMS_BASE_URL"])
    delete process.env[key];
  process.env.XRE_SESSION_SECRET = "sms-test-secret-0123456789abcdef";
  logins = 0;
  sent = [];
  reject = null;
  resetSmsLimits();
  setSmsTransport({
    login: async (_base, username, password) => {
      logins += 1;
      if (password !== "test-parola-123") throw Object.assign(new Error("giriş reddedildi"), { statusCode: 502 });
      return `tok-${username}-${logins}`;
    },
    send: async (_base, token, body) => {
      if (reject) return { ok: false, code: reject, detail: "reddedildi" };
      sent.push({ token, body });
      return { ok: true, code: "200", detail: "" };
    },
  });
});
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  setSmsTransport(null);
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});
async function start() {
  const store = createMemoryStore();
  const server = http.createServer(createApp({ store }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const make = (cookie: string) => (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const setup = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sistem Sahibi", email: "sahip@xre.test", password: "Yonetici123" }) });
  return { store, base, call: make((setup.headers.get("set-cookie") || "").split(";")[0]), make };
}
const configure = () => {
  process.env.TURKCELL_SMS_USERNAME = "5550000000";
  process.env.TURKCELL_SMS_PASSWORD = "test-parola-123";
  process.env.TURKCELL_SMS_SENDER = "XRETEST";
};

it("numarayı sağlayıcının beklediği biçime çevirir", () => {
  expect(smsReceiver("+90 555 000 10 20")).toBe("5550001020");
  expect(smsReceiver("0555 000 10 20")).toBe("5550001020");
  process.env.TURKCELL_SMS_NUMBER_FORMAT = "90";
  expect(smsReceiver("0555 000 10 20")).toBe("905550001020");
  expect(() => smsReceiver("123")).toThrow();
});

it("yapılandırılmadan gönderilmez; yapılandırılınca müşteriye gönderir, karta kayıt düşer ve token yeniden kullanılır", async () => {
  const { store, call } = await start();
  const owner = (await store.resolveOwner())!;
  await call("POST", "/api/leads", { lead: { id: "lead_s", name: "Selin Örnek", phone: "+90 555 000 10 20" } });
  expect((await call("POST", "/api/sms/send", { leadId: "lead_s", text: "Merhaba" })).status).toBe(503);
  expect(await (await call("GET", "/api/sms/status")).json()).toMatchObject({ configured: false });
  configure();
  expect(await (await call("GET", "/api/sms/status")).json()).toMatchObject({ configured: true, sender: "XRETEST" });
  expect((await call("POST", "/api/integrations/sms/test", {})).status).toBe(200);
  expect((await call("POST", "/api/sms/send", { leadId: "lead_s", text: "   " })).status).toBe(400);
  expect((await call("POST", "/api/sms/send", { leadId: "yok", text: "Merhaba" })).status).toBe(404);
  const ok = await call("POST", "/api/sms/send", { leadId: "lead_s", text: "Randevunuz yarın 14:00'te." });
  expect(ok.status).toBe(201);
  await call("POST", "/api/sms/send", { leadId: "lead_s", text: "İkinci ileti" });
  expect(sent.map((s) => s.body)).toEqual([
    { messageText: "Randevunuz yarın 14:00'te.", sender: "XRETEST", campaignName: "XRE CRM", etkFlag: false, receivers: [5550001020] },
    { messageText: "İkinci ileti", sender: "XRETEST", campaignName: "XRE CRM", etkFlag: false, receivers: [5550001020] },
  ]);
  // Test girişi + ilk gönderim girişi; ikinci gönderim aynı token ile gider.
  expect(sent[0].token).toBe(sent[1].token);
  const notes = (await store.list<any>("feed", owner)).map((r) => r.payload);
  expect(notes.filter((n) => n.leadId === "lead_s" && n.text.startsWith("SMS gönderildi:"))).toHaveLength(2);
  // Şifre hiçbir yanıtta ve kayıtta yer almaz.
  expect(JSON.stringify(notes)).not.toContain("test-parola-123");
  reject = "1013";
  const bad = await call("POST", "/api/sms/send", { leadId: "lead_s", text: "Reddedilecek" });
  expect(bad.status).toBe(502);
  expect((await bad.json()).message).toContain("1013");
});

it("otomasyon kuralı SMS gönderir; kayıtla açılan firma ortak SMS hesabını kullanamaz", async () => {
  process.env.XRE_SIGNUP = "1";
  process.env.XRE_SIGNUP_VERIFY = "0";
  configure();
  const { store, base, call, make } = await start();
  await call("POST", "/api/rules", { id: "sms-kural", name: "Karşılama SMS", triggerStage: "new", action: "sms", enabled: true, config: { template: "Merhaba {{name}}, talebiniz alındı." } });
  await call("POST", "/api/leads", { lead: { id: "lead_a", name: "Ayşe Deneme", phone: "0555 000 10 30" } });
  for (let i = 0; i < 5 && (await processOutboxOnce(store)); i++);
  expect(sent.map((s) => [s.body.messageText, s.body.receivers])).toEqual([["Merhaba Ayşe Deneme, talebiniz alındı.", [5550001030]]]);

  const signup = await fetch(`${base}/api/workspaces/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company: "Ahmet İnşaat", slug: "ahmet", name: "Ahmet Yılmaz", email: "ahmet@firma.test", password: "Deneme1234" }) });
  expect(signup.status).toBe(201);
  const tenant = make((signup.headers.get("set-cookie") || "").split(";")[0]);
  await tenant("POST", "/api/leads", { lead: { id: "lead_t", name: "Kiracı Müşterisi", phone: "0555 000 10 40" } });
  expect((await tenant("POST", "/api/sms/send", { leadId: "lead_t", text: "Merhaba" })).status).toBe(403);
  expect(sent).toHaveLength(1);
});
