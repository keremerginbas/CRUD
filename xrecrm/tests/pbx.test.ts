import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import net from "node:net";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import {
  cdrToCallLog,
  dialNumber,
  extensionFromChannel,
  parseAmiBlock,
  resetPbxClients,
  stopPbxSupervisor,
} from "../server/pbx";

const savedEnv = { ...process.env };
const servers: { close(): void }[] = [];

beforeEach(() => {
  for (const key of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "PBX_DRIVER", "AMI_HOST", "PBX_CLICK_TO_CALL_URL", "PBX_DIAL_PREFIX"])
    delete process.env[key];
  process.env.XRE_SESSION_SECRET = "pbx-test-secret-0123456789abcdef";
});
afterEach(() => {
  stopPbxSupervisor();
  resetPbxClients();
  for (const s of servers.splice(0)) s.close();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

/** Asterisk AMI protokolünü taklit eden küçük sunucu. */
async function fakeAmi() {
  const actions: Record<string, string>[] = [];
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    socket.write("Asterisk Call Manager/7.0.3\r\n");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const blocks = buffer.split("\r\n\r\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const action = parseAmiBlock(block);
        actions.push(action);
        const reply =
          action.Action === "Login"
            ? action.Secret === "dogru"
              ? "Response: Success\r\nMessage: Authentication accepted"
              : "Response: Error\r\nMessage: Authentication failed"
            : action.Action === "Ping"
              ? "Response: Success\r\nPing: Pong"
              : "Response: Success\r\nMessage: Originate successfully queued";
        socket.write(`${reply}\r\nActionID: ${action.ActionID}\r\n\r\n`);
      }
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: (server.address() as net.AddressInfo).port,
    actions,
    emit: (fields: Record<string, string>) =>
      sockets.forEach((s) =>
        s.write(Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n"),
      ),
  };
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
    body: JSON.stringify({ name: "Santral Sahibi", email: "pbx@xre.test", password: "Santral123" }),
  });
  const cookie = (setup.headers.get("set-cookie") || "").split(";")[0];
  const headers = { "content-type": "application/json", cookie };
  const stamp = new Date().toISOString();
  await fetch(`${base}/api/leads`, {
    method: "POST",
    headers,
    body: JSON.stringify({ lead: { id: "lead-pbx", name: "Arayan Müşteri", phone: "0555 300 00 07", email: "", company: "ABC", stage: "new", owner: "Ali", value: 0, source: "Web", notes: "", createdAt: stamp, lastActivity: stamp, tags: [] } }),
  });
  return { store, base, headers };
}

describe("Santral yardımcıları", () => {
  it("AMI bloklarını, dahilileri, numaraları ve CDR'yi çözer", () => {
    expect(parseAmiBlock("Event: Cdr\r\nSource: 05551112233\r\nDisposition: NO ANSWER")).toMatchObject({ Event: "Cdr", Disposition: "NO ANSWER" });
    expect(extensionFromChannel("PJSIP/101-0000002a")).toBe("101");
    expect(extensionFromChannel("SIP/trunk-netgsm-0001")).toBe("");
    expect(dialNumber("+90 555 300 00 07")).toBe("05553000007");
    process.env.PBX_DIAL_PREFIX = "9";
    expect(dialNumber("905553000007")).toBe("905553000007");
    delete process.env.PBX_DIAL_PREFIX;
    expect(
      cdrToCallLog({ Event: "Cdr", Source: "05553000007", Destination: "101", Channel: "SIP/netgsm-01", DestinationChannel: "PJSIP/101-02", Disposition: "NO ANSWER", BillableSeconds: "0", UniqueID: "17.1", StartTime: "2026-10-13 10:00:00" }),
    ).toMatchObject({ direction: "inbound", status: "no-answer", agent: "101", callId: "17.1", startedAt: "2026-10-13T10:00:00+03:00" });
    expect(cdrToCallLog({ Event: "Cdr", Source: "101", Destination: "102", Channel: "PJSIP/101-1", DestinationChannel: "PJSIP/102-1" })).toBeNull();
  });
});

describe("Santral entegrasyonu", () => {
  it("dahiliyi çaldırıp müşteriyi arar (Asterisk Originate)", async () => {
    const ami = await fakeAmi();
    Object.assign(process.env, { PBX_DRIVER: "asterisk", AMI_HOST: "127.0.0.1", AMI_PORT: String(ami.port), AMI_USERNAME: "xre", AMI_SECRET: "dogru" });
    const { base, headers } = await startApp();
    expect((await fetch(`${base}/api/pbx/call`, { method: "POST", headers, body: JSON.stringify({ leadId: "lead-pbx" }) })).status).toBe(400);
    expect((await fetch(`${base}/api/pbx/me`, { method: "PUT", headers, body: JSON.stringify({ extension: "abc" }) })).status).toBe(400);
    await fetch(`${base}/api/pbx/me`, { method: "PUT", headers, body: JSON.stringify({ extension: "101" }) });
    const call = await fetch(`${base}/api/pbx/call`, { method: "POST", headers, body: JSON.stringify({ leadId: "lead-pbx" }) });
    expect(call.status).toBe(200);
    const originate = ami.actions.find((a) => a.Action === "Originate");
    expect(originate).toMatchObject({ Channel: "PJSIP/101", Exten: "05553000007", Context: "from-internal" });
    const state = await (await fetch(`${base}/api/state`, { headers })).json();
    expect(state.calls[0]).toMatchObject({ leadId: "lead-pbx", direction: "outbound", status: "queued" });
    const test = await (await fetch(`${base}/api/pbx/test`, { method: "POST", headers, body: "{}" })).json();
    expect(test.message).toContain("başarılı");

    process.env.AMI_SECRET = "yanlis";
    const failed = await fetch(`${base}/api/pbx/call`, { method: "POST", headers, body: JSON.stringify({ leadId: "lead-pbx" }) });
    expect(failed.status).toBe(502);
  });

  it("gelen arama bildirimi dahiliye müşteri kartıyla ulaşır", async () => {
    const { base, headers } = await startApp();
    await fetch(`${base}/api/pbx/me`, { method: "PUT", headers, body: JSON.stringify({ extension: "101" }) });
    const hook = await (await fetch(`${base}/api/webhook-hub/inbound`, { method: "POST", headers, body: JSON.stringify({ name: "Netgsm", actions: ["call.ringing"] }) })).json();

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
    const ring = await fetch(`${base}/api/hooks/in/${hook.hook.id}/${hook.token}/call.ringing`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "05553000007", ext: "101" }),
    });
    expect((await ring.json()).result).toMatchObject({ delivered: 1, leadId: "lead-pbx" });
    const text = await received;
    const data = JSON.parse(text.split("data: ")[1].split("\n")[0]);
    expect(data).toMatchObject({ ext: "101", lead: { id: "lead-pbx", name: "Arayan Müşteri" } });
  });

  it("AMI dinleyicisi santral CDR'sini CRM arama kaydına çevirir", async () => {
    const ami = await fakeAmi();
    Object.assign(process.env, { PBX_DRIVER: "asterisk", AMI_HOST: "127.0.0.1", AMI_PORT: String(ami.port), AMI_USERNAME: "xre", AMI_SECRET: "dogru" });
    const { store, base, headers } = await startApp();
    const { startPbxSupervisor } = await import("../server/pbx");
    const { runInboundAction } = await import("../server/webhook-hub");
    const owner = (await store.resolveOwner())!;
    startPbxSupervisor(store, (target, o, input) =>
      runInboundAction(target, o, { id: "asterisk", name: "Santral" }, "call.log", input, {
        ownerScope: async () => owner,
        processInboundWebhook: async () => {},
        ensureInboundLead: async () => null,
      }),
    60_000);
    for (let i = 0; i < 40 && !ami.actions.some((a) => a.Action === "Login" && a.Events === "on"); i++)
      await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 50));
    ami.emit({ Event: "Cdr", Source: "05553000007", Destination: "101", Channel: "SIP/netgsm-01", DestinationChannel: "PJSIP/101-02", Disposition: "NO ANSWER", BillableSeconds: "0", UniqueID: "1700.9", StartTime: "2026-10-13 10:00:00" });
    let call: any;
    for (let i = 0; i < 40 && !call; i++) {
      await new Promise((r) => setTimeout(r, 50));
      call = (await (await fetch(`${base}/api/state`, { headers })).json()).calls.find((c: any) => c.id === "pbx-1700.9");
    }
    expect(call).toMatchObject({ leadId: "lead-pbx", status: "missed", direction: "inbound" });
  });
});

describe("Tarayıcı telefonu (webphone)", () => {
  it("numaraları santral biçimine ve SIP adresine çevirir", async () => {
    const { sipDialNumber, sipTargetUri, comparablePhone, formatCallDuration } = await import("../shared/webphone");
    expect(sipDialNumber("+90 555 300 00 07")).toBe("05553000007");
    expect(sipDialNumber("0555 300 00 07")).toBe("05553000007");
    expect(sipDialNumber("5553000007", "9")).toBe("905553000007");
    expect(sipDialNumber("0212 555 00 00")).toBe("02125550000");
    expect(sipDialNumber("+44 20 7946 0000")).toBe("442079460000");
    expect(sipDialNumber("102", "9")).toBe("102");
    expect(sipDialNumber("*72")).toBe("*72");
    expect(sipDialNumber("abc")).toBe("");
    expect(sipTargetUri("0555 300 00 07", "pbx.xre.test")).toBe("sip:05553000007@pbx.xre.test");
    expect(sipTargetUri("", "pbx.xre.test")).toBe("");
    expect(comparablePhone("05553000007")).toBe("905553000007");
    expect(formatCallDuration(65)).toBe("01:05");
    expect(formatCallDuration(3725)).toBe("1:02:05");
  });

  it("STUN/TURN listesini ve süreli TURN kimliğini üretir", async () => {
    const { webphoneIceServers, webphoneServer } = await import("../server/pbx");
    const crypto = await import("node:crypto");
    for (const k of ["WEBPHONE_WSS_URL", "WEBPHONE_SIP_DOMAIN", "WEBPHONE_STUN_URLS", "WEBPHONE_TURN_URLS", "WEBPHONE_TURN_SECRET", "WEBPHONE_TURN_USERNAME", "WEBPHONE_TURN_PASSWORD"]) delete process.env[k];
    expect(webphoneServer()).toBeNull();
    process.env.WEBPHONE_WSS_URL = "https://pbx.xre.test/ws";
    expect(webphoneServer()).toBeNull();
    process.env.WEBPHONE_WSS_URL = "wss://pbx.xre.test:8089/ws";
    expect(webphoneServer()).toEqual({ wssUrl: "wss://pbx.xre.test:8089/ws", domain: "pbx.xre.test" });
    process.env.WEBPHONE_SIP_DOMAIN = "sip.xre.test";
    expect(webphoneServer()?.domain).toBe("sip.xre.test");

    expect(webphoneIceServers("u1")).toEqual([{ urls: ["stun:stun.l.google.com:19302"] }]);
    process.env.WEBPHONE_STUN_URLS = "none";
    expect(webphoneIceServers("u1")).toEqual([]);
    Object.assign(process.env, { WEBPHONE_TURN_URLS: "turn:turn.xre.test:3478, turns:turn.xre.test:5349", WEBPHONE_TURN_SECRET: "paylasilan" });
    const [turn] = webphoneIceServers("kullanici-1", 1_800_000_000_000);
    expect(turn.urls).toEqual(["turn:turn.xre.test:3478", "turns:turn.xre.test:5349"]);
    expect(turn.username).toBe("1800003600:kullanici-1");
    expect(turn.credential).toBe(crypto.createHmac("sha1", "paylasilan").update(turn.username!).digest("base64"));
    delete process.env.WEBPHONE_TURN_SECRET;
    expect(webphoneIceServers("u1")).toEqual([]);
    Object.assign(process.env, { WEBPHONE_TURN_USERNAME: "crm", WEBPHONE_TURN_PASSWORD: "sabit" });
    expect(webphoneIceServers("u1")).toEqual([{ urls: turn.urls, username: "crm", credential: "sabit" }]);
  });

  it("SIP şifresini şifreli saklar, yalnız sahibine verir ve görüşmeyi kaydeder", async () => {
    delete process.env.WEBPHONE_WSS_URL;
    const { store, base, headers } = await startApp();
    const get = async (path: string) => (await fetch(`${base}${path}`, { headers })).json();
    const put = (body: unknown) => fetch(`${base}/api/pbx/me`, { method: "PUT", headers, body: JSON.stringify(body) });

    expect(await get("/api/pbx/webphone")).toEqual({ enabled: false, reason: "not-configured" });
    process.env.WEBPHONE_WSS_URL = "wss://pbx.xre.test:8089/ws";
    process.env.WEBPHONE_STUN_URLS = "none";
    expect(await get("/api/pbx/webphone")).toEqual({ enabled: false, reason: "no-credentials" });

    expect((await put({ sipUser: "kötü kullanıcı" })).status).toBe(400);
    expect((await put({ sipPassword: "x".repeat(129) })).status).toBe(400);
    expect(await (await put({ extension: "101", sipPassword: "çok-gizli" })).json()).toEqual({ extension: "101", webphone: { configured: true, sipUser: "", hasPassword: true } });

    // Şifre düz metin olarak saklanmaz ve /pbx/me yanıtında yer almaz.
    const owner = (await store.resolveOwner())!;
    const [record] = await store.list<any>("pbx-extension", owner);
    expect(JSON.stringify(record.payload)).not.toContain("çok-gizli");
    expect(record.payload.sipPasswordEnc).toBeTruthy();
    const me = await get("/api/pbx/me");
    expect(JSON.stringify(me)).not.toContain("çok-gizli");
    expect(me).toMatchObject({ extension: "101", webphone: { configured: true, hasPassword: true } });

    const response = await fetch(`${base}/api/pbx/webphone`, { headers });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      enabled: true,
      wssUrl: "wss://pbx.xre.test:8089/ws",
      domain: "pbx.xre.test",
      extension: "101",
      authUser: "101",
      password: "çok-gizli",
      displayName: "Santral Sahibi",
      dialPrefix: "",
      iceServers: [],
      serverLogsCalls: false,
    });

    // Yalnız dahiliyi değiştirmek şifreyi silmez; SIP kullanıcı adı dahilinin önüne geçer.
    await put({ extension: "102", sipUser: "8501234567-102" });
    expect(await get("/api/pbx/webphone")).toMatchObject({ enabled: true, extension: "102", authUser: "8501234567-102", password: "çok-gizli" });

    expect((await fetch(`${base}/api/pbx/webphone`)).status).toBe(401);

    const log = (body: unknown) => fetch(`${base}/api/pbx/webphone/log`, { method: "POST", headers, body: JSON.stringify(body) });
    expect((await log({ phone: "05553000007", direction: "outbound", answered: true })).status).toBe(400);
    const logged = await (await log({ sessionId: "s-1", phone: "0555 300 00 07", direction: "outbound", answered: true, durationSeconds: 42.4, startedAt: "2026-11-13T10:00:00Z", endedAt: "2026-11-13T10:00:50Z" })).json();
    expect(logged).toMatchObject({ ok: true, leadId: "lead-pbx" });
    // Aynı görüşme ikinci kez gönderilirse yeni kayıt açılmaz.
    await log({ sessionId: "s-1", phone: "05553000007", direction: "outbound", answered: true, durationSeconds: 42 });
    await log({ sessionId: "s-2", phone: "05559998877", direction: "inbound", answered: false, leadId: "lead-pbx" });
    expect(await (await log({ sessionId: "s-3", phone: "102", direction: "outbound", answered: true })).json()).toEqual({ ok: true, skipped: true });
    const calls = (await get("/api/state")).calls.filter((c: any) => c.provider === "webphone");
    expect(calls).toHaveLength(2);
    expect(calls.find((c: any) => c.id === logged.callId)).toMatchObject({ leadId: "lead-pbx", direction: "outbound", status: "ended", durationSeconds: 42, startedAt: "2026-11-13T10:00:00.000Z" });
    const stored = (await store.list<any>("call", owner)).find((r) => r.id === logged.callId)!.payload;
    expect(stored).toMatchObject({ phone: "905553000007", agent: "102", provider: "webphone" });
    // Başka numaradan gelen aramaya yanlış müşteri bağlanmaz.
    expect(calls.find((c: any) => c.direction === "inbound")).toMatchObject({ leadId: null, status: "missed", durationSeconds: 0 });

    await put({ sipPassword: "" });
    expect(await get("/api/pbx/webphone")).toEqual({ enabled: false, reason: "no-credentials" });
  });
});
