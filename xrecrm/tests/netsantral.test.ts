import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import net from "node:net";
import { createApp, processOutboxOnce } from "../server/app";
import { createMemoryStore } from "../server/db";
import { pbxDriver, resetPbxClients, stopPbxSupervisor } from "../server/pbx";
import {
  NETSANTRAL_DEFAULT_API_URL,
  NETSANTRAL_EVENTS_PER_MINUTE,
  netsantralAccepted,
  netsantralCdrOutcome,
  netsantralCdrParties,
  netsantralConfig,
  netsantralErrorMessage,
  netsantralOriginateUrl,
  netsantralPhone,
  netsantralRecordingUrl,
  normalizeNetsantralId,
  parseNetsantralBody,
  resetNetsantralState,
} from "../server/netsantral";

// Tümü uydurma değerlerdir; gerçek hesap, şifre ya da numara değildir.
const PASSWORD = "sifre-degil";
const SECRET = "deneme-bildirim-anahtari-0123456789";
const savedEnv = { ...process.env };
const servers: { close(): void }[] = [];

beforeEach(() => {
  for (const key of Object.keys(process.env))
    if (/^(NETSANTRAL_|PBX_|AMI_)/.test(key) || ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "PUBLIC_ORIGIN"].includes(key))
      delete process.env[key];
  process.env.XRE_SESSION_SECRET = "netsantral-test-secret-0123456789abcdef";
  resetNetsantralState();
});
afterEach(() => {
  stopPbxSupervisor();
  resetPbxClients();
  for (const s of servers.splice(0)) s.close();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

/** Netsantral API'sini taklit eden yerel sunucu; gerçek ağa çıkılmaz. */
async function fakeNetsantral() {
  const requests: URL[] = [];
  const state: { status: number; body: string; before?: () => Promise<unknown> } = { status: 200, body: JSON.stringify({ unique_id: "sip3-1700000001.55", caller_num: "101", called_num: "05553000007", response: "originate", status: "Success", message: "Successfully" }) };
  const server = http.createServer(async (req, res) => {
    requests.push(new URL(req.url || "/", "http://stub"));
    // Yanıt dönmeden önce çalışır: santralin olayı yanıttan önce göndermesini taklit eder.
    await state.before?.().catch(() => undefined);
    res.writeHead(state.status, { "content-type": "application/json" });
    res.end(state.body);
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  Object.assign(process.env, {
    PBX_DRIVER: "netsantral",
    NETSANTRAL_USERCODE: "8500000000",
    NETSANTRAL_PASSWORD: PASSWORD,
    NETSANTRAL_PBX_NUMBER: "8500000000",
    NETSANTRAL_API_URL: `http://127.0.0.1:${port}`,
    NETSANTRAL_WEBHOOK_SECRET: SECRET,
    OUTBOUND_ALLOW_PRIVATE_HOSTS: "127.0.0.1",
  });
  return { requests, state, port };
}

async function startApp() {
  const store = createMemoryStore();
  const server = http.createServer(createApp({ store }));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  const setup = await fetch(`${base}/api/auth/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Santral Sahibi", email: "netsantral@xre.test", password: "Santral123" }),
  });
  const cookie = (setup.headers.get("set-cookie") || "").split(";")[0];
  const headers = { "content-type": "application/json", cookie };
  const stamp = new Date().toISOString();
  await fetch(`${base}/api/leads`, {
    method: "POST",
    headers,
    body: JSON.stringify({ lead: { id: "lead-ns", name: "Aranan Müşteri", phone: "0555 300 00 07", email: "", company: "ABC", stage: "new", owner: "Ali", value: 0, source: "Web", notes: "", createdAt: stamp, lastActivity: stamp, tags: [] } }),
  });
  await fetch(`${base}/api/pbx/me`, { method: "PUT", headers, body: JSON.stringify({ extension: "101" }) });
  const hook = (body: unknown, secret = SECRET, contentType = "application/json") =>
    fetch(`${base}/api/webhooks/netsantral/${secret}`, {
      method: "POST",
      headers: { "content-type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const state = async () => (await fetch(`${base}/api/state`, { headers })).json() as Promise<any>;
  // Genel durum ucu arama kaydının yalnız bir bölümünü döndürür; ayrıntılar depodan okunur.
  const owner = (await store.resolveOwner())!;
  const netsantralCalls = async () =>
    (await store.list<any>("call", owner)).map((r) => r.payload).filter((c) => c.provider === "netsantral");
  const stored = async () => JSON.stringify([await store.list("call", owner), await store.listEvents(owner)]);
  return { store, base, headers, hook, state, netsantralCalls, stored };
}

describe("Netsantral yardımcıları", () => {
  it("tıkla-ara adresini sağlayıcının beklediği alanlarla kurar", () => {
    Object.assign(process.env, { NETSANTRAL_USERCODE: "8500000000", NETSANTRAL_PASSWORD: PASSWORD, NETSANTRAL_PBX_NUMBER: "0850 000 00 00" });
    const cfg = netsantralConfig();
    expect(cfg).toMatchObject({ apiUrl: NETSANTRAL_DEFAULT_API_URL, ringTimeout: 20, originateOrder: "if", pbxnum: "08500000000", trunk: "08500000000" });
    const url = new URL(netsantralOriginateUrl(cfg, { ext: "101", number: "05553000007", callId: "pbx-orig-1" }));
    expect(`${url.origin}${url.pathname}`).toBe("http://crmsntrl.netgsm.com.tr:9111/8500000000/originate");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      username: "8500000000",
      password: PASSWORD,
      customer_num: "05553000007",
      pbxnum: "08500000000",
      internal_num: "101",
      ring_timeout: "20",
      crm_id: "pbx-orig-1",
      wait_response: "0",
      originate_order: "if",
      trunk: "08500000000",
    });

    Object.assign(process.env, { NETSANTRAL_API_URL: "https://yeni.example.test/v2/hesap/", NETSANTRAL_ORIGINATE_ORDER: "OF", NETSANTRAL_RING_TIMEOUT: "45", NETSANTRAL_TRUNK: "2120000000" });
    const custom = new URL(netsantralOriginateUrl(netsantralConfig(), { ext: "102", number: "05553000007", callId: "x" }));
    expect(`${custom.origin}${custom.pathname}`).toBe("https://yeni.example.test/v2/hesap/originate");
    expect(custom.searchParams.get("originate_order")).toBe("of");
    expect(custom.searchParams.get("ring_timeout")).toBe("45");
    expect(custom.searchParams.get("trunk")).toBe("2120000000");
  });

  it("sürücü adını tanır ve ayarlar doluysa kendiliğinden seçer", () => {
    expect(pbxDriver()).toBe("");
    process.env.PBX_DRIVER = "netsantral";
    expect(pbxDriver()).toBe("netsantral");
    delete process.env.PBX_DRIVER;
    Object.assign(process.env, { NETSANTRAL_USERCODE: "8500000000", NETSANTRAL_PASSWORD: PASSWORD, NETSANTRAL_PBX_NUMBER: "8500000000" });
    expect(pbxDriver()).toBe("netsantral");
  });

  it("arama kimliklerini tek biçime indirir", () => {
    expect(normalizeNetsantralId("sip8-1611752738.106785")).toBe("1611752738.106785");
    expect(normalizeNetsantralId("1611752738.106785")).toBe("1611752738.106785");
    expect(normalizeNetsantralId(" sip12-1700000001.55 ")).toBe("1700000001.55");
    expect(normalizeNetsantralId("abc/../x y")).toBe("abc..xy");
    expect(normalizeNetsantralId(undefined)).toBe("");
  });

  it("ses kaydı bağlantısını yalnız Netgsm indirme sunucusundan kabul eder", () => {
    const ok = "https://dosyaindir.netgsm.com.tr/upload.php?tip=1&q=ornek";
    expect(netsantralRecordingUrl(ok)).toBe(ok);
    for (const bad of [
      "http://dosyaindir.netgsm.com.tr/upload.php?q=1",
      "https://dosyaindir.netgsm.com.tr.kotu.example/upload.php",
      "https://kotu.example/?u=https://dosyaindir.netgsm.com.tr/",
      "https://kullanici:parola@dosyaindir.netgsm.com.tr/x",
      "https://dosyaindir.netgsm.com.tr:8443/x",
      "javascript:alert(1)",
      "",
    ])
      expect(netsantralRecordingUrl(bad)).toBe("");
  });

  it("sağlayıcı hatalarını anlaşılır Türkçe iletiye çevirir", () => {
    process.env.NETSANTRAL_PASSWORD = PASSWORD;
    expect(netsantralErrorMessage({ code: 30, status: "Error", message: "Eksik yada yanlis parametre 2" }, 200)).toContain("dahili numaranız ya da dış hat");
    expect(netsantralErrorMessage({ code: 30, status: "Error", message: "Kullanıcı doğrulanamadi" }, 200)).toContain("IP kısıtlaması");
    expect(netsantralErrorMessage({ code: 30 }, 200)).toContain("API kullanıcı adı ya da şifresi");
    expect(netsantralErrorMessage({ code: "80" }, 200)).toContain("Bir dakika bekleyip");
    expect(netsantralErrorMessage({ status: "Error", message: "Channel not specified" }, 200)).toContain("Arama sırası");
    expect(netsantralErrorMessage(null, 500)).toContain("500");
    const leaked = netsantralErrorMessage({ status: "Error", message: `hata http://x.test/originate?password=${PASSWORD} ${PASSWORD}` }, 200);
    expect(leaked).not.toContain(PASSWORD);
    expect(leaked).not.toContain("http://");
  });

  it("görüşme sonu kaydında müşteriyi ve yönü bulur, bilinmeyen kodlarda çökmez", () => {
    process.env.NETSANTRAL_PBX_NUMBER = "8500000000";
    expect(netsantralCdrParties({ arayan: "05550000001", aranan: "8500000000-queue-Destek", santral: "8500000000" })).toEqual({ direction: "inbound", phone: "05550000001", agent: "" });
    expect(netsantralCdrParties({ arayan: "101", aranan: "05550000001" })).toEqual({ direction: "outbound", phone: "05550000001", agent: "101" });
    expect(netsantralCdrParties({ arayan: "8500000000", aranan: "05550000001" })).toMatchObject({ direction: "outbound", phone: "05550000001" });
    expect(netsantralCdrParties({ arayan: "05550000001", aranan: "102" })).toEqual({ direction: "inbound", phone: "05550000001", agent: "102" });
    expect(netsantralCdrParties({ arayan: "101", aranan: "102" })).toBeNull();
    expect(netsantralCdrParties({})).toBeNull();
    expect(netsantralCdrOutcome({ sure: 164, sondurum: "3", yon: "1" })).toEqual({ answered: true });
    expect(netsantralCdrOutcome({ sure: 0, sondurum: "bilinmeyen", yon: "99" })).toEqual({ answered: false });
    // Süre 0 bildirildiyse cevap olayı tek başına yetmez (tıkla-arada çalışanın kendi dahilisi de açmış olabilir).
    expect(netsantralCdrOutcome({ sure: 0, sondurum: "", yon: "", sawAnswer: true })).toEqual({ answered: false });
    expect(netsantralCdrOutcome({ sure: 0, sondurum: "", yon: "", sawAnswer: true, talktime: 45 })).toEqual({ answered: true });
    // Süre alanı hiç gelmediyse cevap olayına bakılır.
    expect(netsantralCdrOutcome({ sure: null, sondurum: "", yon: "", sawAnswer: true })).toEqual({ answered: true });
    expect(netsantralCdrOutcome({ sure: null, sondurum: "", yon: "" })).toEqual({ answered: false });
  });

  it("başında 0 olmayan yurt içi numarayı tamamlar, tıkla-ara yanıtını sıkı okur", () => {
    expect(netsantralPhone("2125550000")).toBe("02125550000");
    expect(netsantralPhone("5550000001")).toBe("05550000001");
    expect(netsantralPhone("05550000001")).toBe("05550000001");
    expect(netsantralPhone("905550000001")).toBe("905550000001");
    expect(netsantralPhone("101")).toBe("101");
    expect(netsantralAccepted({ status: "Success", unique_id: "sip3-1700000001.55" })).toBe(true);
    expect(netsantralAccepted({ status: "Success" })).toBe(true);
    expect(netsantralAccepted({ unique_id: "1700000001.55" })).toBe(true);
    expect(netsantralAccepted({ status: "Failed", message: "No registration" })).toBe(false);
    expect(netsantralAccepted({ code: 30, status: "Error" })).toBe(false);
    expect(netsantralAccepted({ message: "Busy" })).toBe(false);
  });

  it("JSON ve form gövdelerini okur", () => {
    expect(parseNetsantralBody(Buffer.from('{"scenario":"cdr","sure":5}'))).toEqual([{ scenario: "cdr", sure: 5 }]);
    expect(parseNetsantralBody(Buffer.from("scenario=Inbound_call&customer_num=05550000001"))).toEqual([{ scenario: "Inbound_call", customer_num: "05550000001" }]);
    expect(parseNetsantralBody(Buffer.from(`data=${encodeURIComponent('{"scenario":"Queue"}')}`))).toEqual([{ scenario: "Queue" }]);
    expect(parseNetsantralBody(Buffer.from("{bozuk"))).toEqual([]);
    expect(parseNetsantralBody(Buffer.alloc(0))).toEqual([]);
  });
});

describe("Netsantral tıkla-ara", () => {
  it("dahiliyle arama başlatır, santral kimliğini kayda yazar, şifreyi hiçbir yere sızdırmaz", async () => {
    const vendor = await fakeNetsantral();
    const { base, headers, state, netsantralCalls, stored } = await startApp();
    expect((await (await fetch(`${base}/api/pbx/me`, { headers })).json()).driver).toBe("netsantral");

    const call = await fetch(`${base}/api/pbx/call`, { method: "POST", headers, body: JSON.stringify({ leadId: "lead-ns" }) });
    expect(call.status).toBe(200);
    const result = await call.json();
    const sent = vendor.requests[0];
    expect(sent.pathname).toBe("/8500000000/originate");
    expect(Object.fromEntries(sent.searchParams)).toMatchObject({
      username: "8500000000",
      password: PASSWORD,
      customer_num: "05553000007",
      pbxnum: "8500000000",
      internal_num: "101",
      ring_timeout: "20",
      wait_response: "0",
      originate_order: "if",
      trunk: "8500000000",
      crm_id: result.callId,
    });
    const calls = await netsantralCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: result.callId, leadId: "lead-ns", direction: "outbound", status: "queued", agent: "101", providerCallId: "1700000001.55" });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(JSON.stringify(await state())).not.toContain(PASSWORD);
    expect((await state()).calls[0]).toMatchObject({ id: result.callId, provider: "netsantral", status: "queued" });
    expect(await stored()).not.toContain(PASSWORD);
  });

  it("sağlayıcı hatalarını şifresiz ve anlaşılır biçimde döndürür", async () => {
    const vendor = await fakeNetsantral();
    const { base, headers, state } = await startApp();
    const attempt = async () => {
      const r = await fetch(`${base}/api/pbx/call`, { method: "POST", headers, body: JSON.stringify({ leadId: "lead-ns" }) });
      return { status: r.status, text: await r.text() };
    };

    vendor.state.body = JSON.stringify({ code: 30, status: "Error", message: "Eksik yada yanlis parametre 2" });
    const wrongExt = await attempt();
    expect(wrongExt.status).toBe(502);
    expect(wrongExt.text).toContain("dahili numaranız");

    vendor.state.body = JSON.stringify({ code: 80, status: "Error", message: "limit" });
    expect((await attempt()).text).toContain("Bir dakika bekleyip");

    // HTTP 200 ama "Success" değil: arama başlamış sayılmaz.
    vendor.state.body = JSON.stringify({ response: "originate", status: "Failed", message: "No registration" });
    const offline = await attempt();
    expect(offline.status).toBe(502);
    expect(offline.text).toContain("santrale bağlı görünmüyor");
    vendor.state.body = "OK";
    const odd = await attempt();
    expect(odd.status).toBe(502);
    expect(odd.text).toContain("beklenmeyen bir yanıt");
    expect((await state()).calls).toHaveLength(0);

    vendor.state.status = 500;
    vendor.state.body = `<html>hata: /originate?username=8500000000&password=${PASSWORD}</html>`;
    const broken = await attempt();
    expect(broken.status).toBe(502);
    expect(broken.text).not.toContain(PASSWORD);

    // Kapalı bir kapı: bağlantı hatası adresi (ve şifreyi) göstermemeli.
    process.env.NETSANTRAL_API_URL = "http://127.0.0.1:9";
    const down = await attempt();
    expect(down.status).toBe(502);
    expect(down.text).toContain("ulaşılamadı");
    expect(down.text).not.toContain(PASSWORD);
    expect(down.text).not.toContain("originate");

    // İzin verilmeyen düz HTTP adresi reddedilir.
    process.env.NETSANTRAL_API_URL = "http://baska-santral.example.test";
    const unsafe = await attempt();
    expect(unsafe.status).toBe(400);
    expect(unsafe.text).not.toContain(PASSWORD);

    delete process.env.NETSANTRAL_PASSWORD;
    process.env.PBX_DRIVER = "netsantral";
    const missing = await attempt();
    expect(missing.status).toBe(503);
    expect(missing.text).toContain("API şifresi");
    expect((await state()).calls).toHaveLength(0);
  });

  it("sonradan gelen olayları ve görüşme sonu kaydını AYNI kayda işler", async () => {
    await fakeNetsantral();
    const { base, headers, hook, netsantralCalls } = await startApp();
    const { callId } = await (await fetch(`${base}/api/pbx/call`, { method: "POST", headers, body: JSON.stringify({ leadId: "lead-ns" }) })).json();

    expect((await hook({ pbx_num: "8500000000", unique_id: "1700000001.55", internal_num: "101", scenario: "Outbound_call", customer_num: "05553000007", timestamp: "1794000000000" })).status).toBe(200);
    expect(await netsantralCalls()).toMatchObject([{ id: callId, status: "ringing", direction: "outbound" }]);

    const cdr = { bas: "2026-11-16 10:05:38", kimlik: 1866400001, arayan: "101", aranan: "05553000007", sure: 42, sondurum: 3, santral: "8500000000", yon: 1, seskaydi: "https://dosyaindir.netgsm.com.tr/upload.php?tip=1&q=ornek", asteriskId: "sip8-1700000001.55", scenario: "cdr", timestamp: "1794000050000" };
    expect((await hook(cdr)).status).toBe(200);
    // Aynı bildirim yeniden gelirse ikinci kayıt oluşmaz.
    expect((await hook(cdr)).status).toBe(200);
    const calls = await netsantralCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: callId,
      leadId: "lead-ns",
      direction: "outbound",
      status: "ended",
      durationSeconds: 42,
      agent: "101",
      recording: "https://dosyaindir.netgsm.com.tr/upload.php?tip=1&q=ornek",
      startedAt: "2026-11-16T07:05:38.000Z",
      providerCallId: "1700000001.55",
      providerMeta: { cdr: true, sondurum: "3", yon: "1", sure: 42 },
    });
  });

  it("santral kimlik döndürmezse olayı telefon numarasından aynı kayıtla eşleştirir", async () => {
    const vendor = await fakeNetsantral();
    vendor.state.body = JSON.stringify({ response: "originate", status: "Success", message: "Successfully" });
    const { base, headers, hook, netsantralCalls } = await startApp();
    const { callId } = await (await fetch(`${base}/api/pbx/call`, { method: "POST", headers, body: JSON.stringify({ leadId: "lead-ns" }) })).json();
    expect((await netsantralCalls())[0].providerCallId).toBeUndefined();
    await hook({ unique_id: "1700000009.1", internal_num: "101", scenario: "Outbound_call", customer_num: "05553000007" });
    await hook({ arayan: "101", aranan: "05553000007", sure: 0, sondurum: 7, yon: 2, asteriskId: "sip2-1700000009.1", scenario: "cdr" });
    const calls = await netsantralCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: callId, status: "missed", providerCallId: "1700000009.1", providerMeta: { sondurum: "7", yon: "2" } });
  });
});

describe("Netsantral tek arama tek kayıt", () => {
  const dial = async (base: string, headers: Record<string, string>) =>
    (await (await fetch(`${base}/api/pbx/call`, { method: "POST", headers, body: JSON.stringify({ leadId: "lead-ns" }) })).json()) as { callId: string };

  it("olaylar tıkla-ara yanıtındakinden FARKLI bir kimlikle gelse de aynı kayda yazılır", async () => {
    await fakeNetsantral();
    const { base, headers, hook, netsantralCalls } = await startApp();
    const { callId } = await dial(base, headers);
    // Yanıttaki kimlik 1700000001.55 idi; olaylar aramanın diğer bacağının kimliğiyle geliyor.
    await hook({ pbx_num: "8500000000", unique_id: "1700000001.77", internal_num: "101", scenario: "Outbound_call", customer_num: "05553000007" });
    expect(await netsantralCalls()).toMatchObject([{ id: callId, status: "ringing", providerCallId: "1700000001.55", providerMeta: { altIds: ["1700000001.77"] } }]);
    // Müşteri numarası taşımayan olay artık bilinen ikinci kimlikle eşleşir.
    await hook({ scenario: "Answer", unique_id: "1700000001.77", internal_num: "101" });
    await hook({ scenario: "Hangup", unique_id: "1700000001.77", talktime: "12" });
    // Görüşme sonu kaydı üçüncü bir kimlikle gelse de aynı numaraya giden, kaydı henüz gelmemiş aramaya yazılır.
    await hook({ arayan: "101", aranan: "05553000007", sure: 12, sondurum: 3, yon: 1, asteriskId: "sip8-1700000001.99", scenario: "cdr" });
    const calls = await netsantralCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: callId, leadId: "lead-ns", status: "ended", durationSeconds: 12, providerMeta: { cdr: true } });
  });

  it("santral olayda crm_id gönderirse kayıt doğrudan onunla bulunur", async () => {
    await fakeNetsantral();
    const { base, headers, hook, netsantralCalls } = await startApp();
    const { callId } = await dial(base, headers);
    await hook({ scenario: "Answer", unique_id: "1700000005.1", crm_id: callId, internal_num: "101" });
    const calls = await netsantralCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: callId, status: "in-progress", direction: "outbound" });
    // Uydurma ya da başka sağlayıcıya ait crm_id kayıt açmaz, eşleşmez.
    await hook({ scenario: "Answer", unique_id: "1700000005.2", crm_id: "pbx-orig-yok", internal_num: "101" });
    expect(await netsantralCalls()).toHaveLength(1);
  });

  it("santralin ilk olayı tıkla-ara yanıtından önce gelirse ikinci kayıt açılmaz", async () => {
    const vendor = await fakeNetsantral();
    const { base, headers, hook, netsantralCalls } = await startApp();
    vendor.state.before = () =>
      hook({ pbx_num: "8500000000", unique_id: "1700000001.55", internal_num: "101", scenario: "Outbound_call", customer_num: "05553000007" });
    const { callId } = await dial(base, headers);
    const calls = await netsantralCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: callId, leadId: "lead-ns", status: "ringing", providerCallId: "1700000001.55" });
  });

  it("aynı görüşmenin birden çok görüşme sonu satırı ortak kimlikle tek kayıtta toplanır", async () => {
    await fakeNetsantral();
    const { hook, netsantralCalls } = await startApp();
    await hook({ arayan: "05550000003", aranan: "8500000000-queue-Destek", sure: 0, santral: "8500000000", kimlik: 1, ortakkimlik: "ortak-77", asteriskId: "sip8-1700000006.1", scenario: "cdr" });
    await hook({ arayan: "05550000003", aranan: "101", sure: 20, santral: "8500000000", kimlik: 2, ortakkimlik: "ortak-77", asteriskId: "sip8-1700000006.2", scenario: "cdr" });
    const calls = await netsantralCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: "pbx-1700000006.1", status: "ended", durationSeconds: 20, agent: "101", providerMeta: { ortakkimlik: "ortak-77", altIds: ["1700000006.2"] } });
  });

  it("görüşme sonu kaydı süre bildirmezse bilinen konuşma süresini silmez", async () => {
    await fakeNetsantral();
    const { hook, netsantralCalls } = await startApp();
    await hook({ scenario: "Inbound_call", pbx_num: "101", unique_id: "1700000007.1", customer_num: "05550000004" });
    await hook({ scenario: "Answer", unique_id: "1700000007.1", internal_num: "101" });
    await hook({ scenario: "Hangup", unique_id: "1700000007.1", talktime: "45" });
    await hook({ arayan: "05550000004", aranan: "101", santral: "8500000000", asteriskId: "sip8-1700000007.1", scenario: "cdr" });
    expect(await netsantralCalls()).toMatchObject([{ status: "ended", durationSeconds: 45, providerMeta: { cdr: true } }]);
    // Süre 0 olarak gelse de kapanış olayının bildirdiği konuşma süresi korunur.
    await hook({ arayan: "05550000004", aranan: "101", sure: 0, santral: "8500000000", asteriskId: "sip8-1700000007.1", scenario: "cdr", timestamp: "1794000000001" });
    expect(await netsantralCalls()).toMatchObject([{ status: "ended", durationSeconds: 45 }]);
  });

  it("tıkla-arada yalnız cevap olayı görülüp süre 0 gelirse arama cevapsız sayılır", async () => {
    await fakeNetsantral();
    const { base, headers, hook, netsantralCalls } = await startApp();
    const { callId } = await dial(base, headers);
    // Çalışan kendi dahilisini açtı (cevap olayı), müşteri açmadı.
    await hook({ scenario: "Answer", unique_id: "1700000001.55", internal_num: "101" });
    await hook({ arayan: "101", aranan: "05553000007", sure: 0, sondurum: 7, yon: 2, asteriskId: "sip8-1700000001.55", scenario: "cdr" });
    expect(await netsantralCalls()).toMatchObject([{ id: callId, status: "missed", durationSeconds: 0 }]);
  });

  it("başında 0 olmadan gelen sabit hat numarası kayıtlı müşteriyle eşleşir", async () => {
    await fakeNetsantral();
    const { base, headers, hook, state, netsantralCalls } = await startApp();
    const stamp = new Date().toISOString();
    await fetch(`${base}/api/leads`, {
      method: "POST",
      headers,
      body: JSON.stringify({ lead: { id: "lead-sabit", name: "Sabit Hat", phone: "0212 555 00 00", email: "", company: "", stage: "new", owner: "Ali", value: 0, source: "Web", notes: "", createdAt: stamp, lastActivity: stamp, tags: [] } }),
    });
    const before = (await state()).leads.length;
    await hook({ scenario: "Inbound_call", pbx_num: "101", unique_id: "1700000008.1", customer_num: "2125550000" });
    await hook({ arayan: "2125550000", aranan: "101", sure: 9, santral: "8500000000", asteriskId: "sip8-1700000008.1", scenario: "cdr" });
    expect((await state()).leads).toHaveLength(before);
    expect(await netsantralCalls()).toMatchObject([{ id: "pbx-1700000008.1", leadId: "lead-sabit", phone: "902125550000", status: "ended" }]);
  });
});

describe("Netsantral bildirim adresi", () => {
  it("işlenemeyen bildirimi kaybetmez: arka plan işçisi saklanan kopyadan yeniden işler", async () => {
    await fakeNetsantral();
    const { store, hook, netsantralCalls } = await startApp();
    const owner = (await store.resolveOwner())!;
    const realPut = store.put.bind(store);
    let failures = 1;
    // Geçici bir veritabanı hatasını taklit eder: ilk arama kaydı yazılamaz.
    store.put = (async (kind: string, ...rest: any[]) => {
      if (kind === "call" && failures-- > 0) throw new Error("geçici veritabanı hatası");
      return (realPut as any)(kind, ...rest);
    }) as typeof store.put;
    const cdr = { arayan: "05550000005", aranan: "101", sure: 15, sondurum: 3, yon: 1, santral: "8500000000", asteriskId: "sip8-1700000010.1", scenario: "cdr" };
    expect((await hook(cdr)).status).toBe(200);
    expect(await netsantralCalls()).toHaveLength(0);
    const event = () => store.listEvents(owner).then((list) => list.find((e) => e.payload.provider === "netsantral")!);
    const failed = await event();
    expect(failed).toMatchObject({ status: "failed", lastError: "geçici veritabanı hatası" });
    // Hemen değil, kısa bir süre sonra yeniden denenmek üzere sıraya alınır.
    expect(Date.parse(String(failed.nextAttemptAt))).toBeGreaterThan(Date.now());
    expect(await processOutboxOnce(store)).toBe(0);

    await store.updateEvent(failed.id, owner, { nextAttemptAt: new Date(Date.now() - 1000).toISOString() });
    expect(await processOutboxOnce(store)).toBe(1);
    expect(await event()).toMatchObject({ status: "completed" });
    expect(await netsantralCalls()).toMatchObject([{ id: "pbx-1700000010.1", status: "ended", durationSeconds: 15, agent: "101" }]);
    // Aynı bildirim sonradan yeniden gelirse ikinci kez işlenmez.
    await hook(cdr);
    expect(await netsantralCalls()).toHaveLength(1);
  });

  it("işlenemeyen bildirim santral tarafından yeniden gönderilirse o anda işlenir", async () => {
    await fakeNetsantral();
    const { store, hook, netsantralCalls } = await startApp();
    const realPut = store.put.bind(store);
    let failures = 1;
    store.put = (async (kind: string, ...rest: any[]) => {
      if (kind === "call" && failures-- > 0) throw new Error("geçici veritabanı hatası");
      return (realPut as any)(kind, ...rest);
    }) as typeof store.put;
    const cdr = { arayan: "05550000006", aranan: "101", sure: 8, santral: "8500000000", asteriskId: "sip8-1700000011.1", scenario: "cdr" };
    await hook(cdr);
    expect(await netsantralCalls()).toHaveLength(0);
    await hook(cdr);
    expect(await netsantralCalls()).toMatchObject([{ id: "pbx-1700000011.1", status: "ended" }]);
  });

  it("dakikalık sınırı aşan bildirimleri 429 ile geri çevirir", async () => {
    await fakeNetsantral();
    const { hook, state, netsantralCalls } = await startApp();
    const batch = (n: number) =>
      Array.from({ length: 20 }, (_, i) => ({ scenario: "Inbound_call", pbx_num: "101", unique_id: `17000001${String(n).padStart(2, "0")}.${i}`, customer_num: "05550000007" }));
    const full = NETSANTRAL_EVENTS_PER_MINUTE / 20;
    for (let n = 0; n < full; n++) expect((await hook(batch(n))).status).toBe(200);
    const leads = (await state()).leads.length;
    const blocked = await hook(batch(full));
    expect(blocked.status).toBe(429);
    expect(await netsantralCalls()).toHaveLength(NETSANTRAL_EVENTS_PER_MINUTE);
    expect((await state()).leads).toHaveLength(leads);
    // Yanlış anahtarlı istekler sayaca yazılmadan reddedilir.
    expect((await hook(batch(full), "yanlis-anahtar-0123456789")).status).toBe(404);
  });

  it("Netsantral bildirimleri gelirken tarayıcı telefonu aynı görüşmeyi ikinci kez yazmaz", async () => {
    await fakeNetsantral();
    const { base, headers, hook, netsantralCalls, store } = await startApp();
    const owner = (await store.resolveOwner())!;
    const log = async (sessionId: string) =>
      (await fetch(`${base}/api/pbx/webphone/log`, { method: "POST", headers, body: JSON.stringify({ phone: "05550000008", sessionId, direction: "inbound", status: "ended", durationSeconds: 5 }) })).json();
    // Henüz hiç bildirim gelmedi: tek kaynak tarayıcı telefonudur, kayıt yazılır.
    expect((await log("oturum-1")).skipped).toBeUndefined();
    await hook({ scenario: "Inbound_call", pbx_num: "101", unique_id: "1700000012.1", customer_num: "05550000008" });
    expect(await log("oturum-2")).toMatchObject({ ok: true, skipped: true });
    const all = (await store.list<any>("call", owner)).map((r) => r.payload).filter((c) => c.phone === "905550000008");
    expect(all.map((c) => c.provider).sort()).toEqual(["netsantral", "webphone"]);
    expect(await netsantralCalls()).toHaveLength(1);
  });


  it("yanlış ya da eksik anahtarı 404 ile reddeder, bilinmeyen senaryoyu yok sayar", async () => {
    await fakeNetsantral();
    const { base, hook, state } = await startApp();
    const sample = { scenario: "Inbound_call", pbx_num: "101", customer_num: "05550000001", unique_id: "1700000003.1" };
    expect((await hook(sample, "yanlis-anahtar-0123456789")).status).toBe(404);
    expect((await hook(sample, SECRET.slice(0, -1))).status).toBe(404);
    expect((await fetch(`${base}/api/webhooks/netsantral/${SECRET}`)).status).not.toBe(200);
    for (const ignored of [{ scenario: "Queue", queue_name: "8500000000-queue-Destek", unique_id: "" }, { scenario: "DTMF", digit: "0" }, { scenario: "YeniBirSey", x: 1 }, { foo: "bar" }, "{bozuk", ""]) {
      const r = await hook(ignored);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ received: true });
    }
    // Dahiliden dahiliye ve müşteri numarası olmayan olaylar da kayıt açmaz.
    await hook({ scenario: "Inbound_call", pbx_num: "101", customer_num: "102", unique_id: "1700000003.2" });
    await hook({ scenario: "Answer", unique_id: "1700000003.3", internal_num: "101" });
    await hook({ scenario: "cdr", arayan: "101", aranan: "102", sure: 5, asteriskId: "sip1-1700000003.4" });
    expect((await state()).calls).toHaveLength(0);
    expect((await hook("x".repeat(70_000))).status).toBe(413);

    // Anahtar ayarlı değilken ya da çok kısayken adres kapalıdır.
    process.env.NETSANTRAL_WEBHOOK_SECRET = "kisa";
    expect((await hook(sample, "kisa")).status).toBe(404);
    delete process.env.NETSANTRAL_WEBHOOK_SECRET;
    expect((await hook(sample, "undefined")).status).toBe(404);
  });

  it("gelen aramada doğru dahiliye bildirim gönderir ve müşteri kartı açar", async () => {
    await fakeNetsantral();
    const { base, headers, hook, state, netsantralCalls } = await startApp();
    const received = new Promise<string>((resolve) => {
      const req = http.get(`${base}/api/pbx/stream`, { headers: { cookie: headers.cookie } }, (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk;
          if (text.includes("event: ringing")) {
            req.destroy();
            resolve(text);
          }
        });
      });
    });
    await new Promise((r) => setTimeout(r, 150));
    // Sağlayıcı örneğindeki gibi dahili "pbx_num" alanında; gövde form olarak gönderiliyor.
    const form = new URLSearchParams({ pbx_num: "101", unique_id: "1700000002.7", scenario: "Inbound_call", customer_num: "05550000001", timestamp: "1794000000000" });
    expect((await hook(form.toString(), SECRET, "application/x-www-form-urlencoded")).status).toBe(200);
    const data = JSON.parse((await received).split("data: ")[1].split("\n")[0]);
    expect(data).toMatchObject({ ext: "101", phone: "905550000001", direction: "inbound", lead: { phone: "905550000001" } });

    const snapshot = await state();
    const lead = snapshot.leads.find((l: any) => l.phone === "905550000001");
    expect(lead).toMatchObject({ source: "Telefon", stage: "new" });
    expect(await netsantralCalls()).toMatchObject([{ id: "pbx-1700000002.7", leadId: lead.id, direction: "inbound", status: "ringing", agent: "101" }]);

    await hook({ scenario: "Answer", unique_id: "1700000002.7", internal_num: "101", holdtime: "4" });
    expect((await netsantralCalls())[0]).toMatchObject({ status: "in-progress", providerMeta: { answered: true, holdtime: 4 } });
    // Geç gelen "çalıyor" olayı cevaplanmış aramayı geri götürmez.
    await hook({ scenario: "Inbound_call", pbx_num: "102", unique_id: "1700000002.7", customer_num: "05550000001" });
    expect((await netsantralCalls())[0].status).toBe("in-progress");
    await hook({ scenario: "Hangup", unique_id: "1700000002.7", talktime: "30" });
    expect((await netsantralCalls())[0]).toMatchObject({ status: "ended", durationSeconds: 30 });

    // Görüşme sonu kaydı "sip8-" ön ekiyle gelir; izin verilmeyen kayıt adresi atılır.
    await hook({ bas: "2026-11-16 11:00:00", arayan: "05550000001", aranan: "8500000000-queue-Destek", sure: 31, sondurum: "tuhaf<script>", yon: null, santral: "8500000000", seskaydi: "https://kotu.example/kayit.mp3", asteriskId: "sip8-1700000002.7", scenario: "cdr" });
    const calls = await netsantralCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: "pbx-1700000002.7", status: "ended", durationSeconds: 31, direction: "inbound", agent: "101", providerMeta: { cdr: true, sondurum: "tuhafscript" } });
    expect(calls[0].recording || null).toBeNull();
    expect((await state()).leads.filter((l: any) => l.phone === "905550000001")).toHaveLength(1);
  });

  it("cevaplanmayan gelen aramayı cevapsız olarak kaydeder", async () => {
    await fakeNetsantral();
    const { hook, netsantralCalls } = await startApp();
    await hook({ scenario: "Inbound_call", pbx_num: "8500000000", internal_num: "101", unique_id: "1700000004.2", customer_num: "05550000002" });
    await hook({ arayan: "05550000002", aranan: "8500000000", sure: 0, sondurum: 99, yon: 42, santral: "8500000000", asteriskId: "sip8-1700000004.2", scenario: "cdr" });
    const calls = await netsantralCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: "pbx-1700000004.2", status: "missed", direction: "inbound", durationSeconds: 0 });
  });
});

describe("Netsantral kurulum denetimi", () => {
  it("eksik ayarı bildirir, tamamsa yapıştırılacak adresi verir; şifre tarayıcıya gitmez", async () => {
    const { base, headers } = await startApp();
    Object.assign(process.env, { PBX_DRIVER: "netsantral", NETSANTRAL_USERCODE: "8500000000", PUBLIC_ORIGIN: "https://crm.example.test/" });
    const incomplete = await fetch(`${base}/api/pbx/test`, { method: "POST", headers, body: "{}" });
    expect(incomplete.status).toBe(503);
    expect((await incomplete.json()).message).toContain("API şifresi");

    Object.assign(process.env, { NETSANTRAL_PASSWORD: PASSWORD, NETSANTRAL_PBX_NUMBER: "8500000000" });
    const ok = await fetch(`${base}/api/pbx/test`, { method: "POST", headers, body: "{}" });
    const okText = await ok.text();
    expect(ok.status).toBe(200);
    expect(okText).not.toContain(PASSWORD);
    const tested = JSON.parse(okText);
    // Anahtar girilmemişti; kendiliğinden üretildi ve adres ona göre kuruldu.
    const secret = process.env.NETSANTRAL_WEBHOOK_SECRET || "";
    expect(secret.length).toBeGreaterThanOrEqual(24);
    expect(tested.webhookUrl).toBe(`https://crm.example.test/api/webhooks/netsantral/${secret}`);
    expect(tested.message).toContain("API Talep Ayarları");

    const infoText = await (await fetch(`${base}/api/pbx/netsantral`, { headers })).text();
    expect(infoText).not.toContain(PASSWORD);
    expect(JSON.parse(infoText)).toMatchObject({ active: true, missing: [], webhookUrl: tested.webhookUrl });
    // Üretilen adres gerçekten çalışır.
    const delivered = await fetch(tested.webhookUrl.replace("https://crm.example.test", base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: "Queue" }) });
    expect(delivered.status).toBe(200);

    // Başka sürücü seçiliyken Netsantral bölümünün test düğmesi yine Netsantral'ı denetler.
    process.env.PBX_DRIVER = "http";
    process.env.PBX_CLICK_TO_CALL_URL = "https://santral.example.test/call?ext={ext}";
    const other = await (await fetch(`${base}/api/pbx/test`, { method: "POST", headers, body: JSON.stringify({ driver: "netsantral" }) })).json();
    expect(other.message).toContain("başka bir santral sürücüsü");
    expect((await fetch(`${base}/api/pbx/netsantral`)).status).toBe(401);
  });
});
