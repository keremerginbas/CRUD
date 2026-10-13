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
} from "../server/pbx";

const savedEnv = { ...process.env };
const servers: { close(): void }[] = [];

beforeEach(() => {
  for (const key of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "PBX_DRIVER", "AMI_HOST", "PBX_CLICK_TO_CALL_URL", "PBX_DIAL_PREFIX"])
    delete process.env[key];
  process.env.XRE_SESSION_SECRET = "pbx-test-secret-0123456789abcdef";
});
afterEach(() => {
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
