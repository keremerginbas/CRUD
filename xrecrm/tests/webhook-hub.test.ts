import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import { createApp, processOutboxOnce } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createSessionToken } from "../server/auth";
import { eventsForWrite } from "../server/webhook-hub";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const key of Object.keys(process.env))
    if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

async function listen(server: http.Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function start() {
  process.env.MANUS_PROJECT_ID = "hub-test";
  process.env.MANUS_JWT_SECRET = "hub-secret";
  process.env.XRE_OWNER_OPEN_ID = "hub-owner";
  process.env.OUTBOUND_ALLOW_PRIVATE_HOSTS = "127.0.0.1";
  const store = createMemoryStore();
  const base = await listen(http.createServer(createApp({ store })));
  const token = await createSessionToken({ openId: "hub-owner", name: "Hub" });
  const headers = {
    cookie: `webdev_app_session=${token}`,
    "content-type": "application/json",
  };
  return { store, base, headers };
}

async function receiver() {
  const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  let status = 200;
  const url = await listen(
    http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.writeHead(status, { "content-type": "application/json" });
        res.end("{}");
      });
    }),
  );
  return { url: `${url}/hook`, received, setStatus: (s: number) => (status = s) };
}

const post = (url: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

describe("Webhook merkezi", () => {
  it("gelen webhook kapsam, token ve tekrar korumasıyla CRM kaydı oluşturur", async () => {
    const { base, headers } = await start();
    const created = await post(
      `${base}/api/webhook-hub/inbound`,
      { name: "Web formu", actions: ["lead.create", "lead.find", "call.log"] },
      headers,
    );
    expect(created.status).toBe(201);
    const { hook, token } = await created.json();
    expect(token).toBeTruthy();
    const list = await (await fetch(`${base}/api/webhook-hub`, { headers })).json();
    expect(JSON.stringify(list)).not.toContain(token);

    const hookUrl = `${base}/api/hooks/in/${hook.id}/${token}`;
    expect((await post(`${base}/api/hooks/in/${hook.id}/yanlis`, { action: "lead.find" })).status).toBe(401);
    expect((await post(`${hookUrl}/task.create`, { title: "x" })).status).toBe(403);

    const lead = await post(`${hookUrl}/lead.create`, {
      data: { name: "Form Müşterisi", phone: "0555 300 00 01", source: "Web" },
    });
    expect(lead.status).toBe(200);
    const leadBody = await lead.json();
    expect(leadBody.result).toMatchObject({ duplicate: false, lead: { name: "Form Müşterisi", stage: "new" } });

    const again = await (await post(`${hookUrl}/lead.create`, { name: "Aynı", phone: "+905553000001" })).json();
    expect(again.result).toMatchObject({ duplicate: true, leadId: leadBody.result.leadId });

    const idem = { "content-type": "application/json", "x-idempotency-key": "evt-1" };
    const first = await (await post(`${hookUrl}/call.log`, { phone: "05553000001", status: "no-answer", callId: "abc" }, idem)).json();
    const second = await (await post(`${hookUrl}/call.log`, { phone: "05553000001", status: "no-answer", callId: "abc" }, idem)).json();
    expect(first.result).toMatchObject({ callId: "pbx-abc", leadId: leadBody.result.leadId });
    expect(second.duplicate).toBe(true);

    const found = await (await post(`${hookUrl}/lead.find`, { phone: "905553000001" })).json();
    expect(found.result.found).toBe(true);

    const state = await (await fetch(`${base}/api/state`, { headers })).json();
    expect(state.calls.find((c: any) => c.id === "pbx-abc")).toMatchObject({ status: "missed", direction: "inbound" });

    await fetch(`${base}/api/webhook-hub/inbound/${hook.id}`, { method: "PATCH", headers, body: JSON.stringify({ enabled: false }) });
    expect((await post(`${hookUrl}/lead.find`, { phone: "905553000001" })).status).toBe(403);
  });

  it("giden webhook olaylara abone olur, imzalı teslim eder ve hatayı kaydeder", async () => {
    const { store, base, headers } = await start();
    const target = await receiver();
    const res = await post(
      `${base}/api/webhook-hub/outbound`,
      {
        name: "n8n",
        url: target.url,
        events: ["lead.created", "lead.stage_changed", "call.missed"],
        headers: [{ name: "X-N8N-Key", value: "n8n-header-secret" }],
      },
      headers,
    );
    expect(res.status).toBe(201);
    const { hook, secret } = await res.json();
    expect(hook.headers[0].valuePreview).not.toContain("n8n-header-secret");

    const ping = await (await post(`${base}/api/webhook-hub/outbound/${hook.id}/test`, {}, headers)).json();
    expect(ping).toMatchObject({ ok: true, status: 200 });
    expect(JSON.parse(target.received[0].body).event).toBe("ping");

    const stamp = new Date().toISOString();
    const lead = await post(
      `${base}/api/leads`,
      {
        lead: {
          id: "lead-hub-1",
          name: "Giden Test",
          phone: "+905553000002",
          email: "",
          company: "",
          stage: "new",
          owner: "Ali",
          value: 0,
          source: "Test",
          notes: "",
          createdAt: stamp,
          lastActivity: stamp,
          tags: [],
        },
      },
      headers,
    );
    expect(lead.status).toBeLessThan(300);
    await fetch(`${base}/api/leads/lead-hub-1`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ stage: "contacted" }),
    });
    while (await processOutboxOnce(store));

    const deliveries = target.received.slice(1).map((r) => ({ ...r, json: JSON.parse(r.body) }));
    expect(deliveries.map((d) => d.json.event)).toEqual(["lead.created", "lead.stage_changed"]);
    const stage = deliveries[1];
    expect(stage.json).toMatchObject({ data: { id: "lead-hub-1", stage: "contacted" }, previous: { stage: "new" } });
    expect(stage.headers["x-n8n-key"]).toBe("n8n-header-secret");
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${stage.headers["x-xre-timestamp"]}.${stage.body}`)
      .digest("hex");
    expect(stage.headers["x-xre-signature"]).toBe(`sha256=${expected}`);
    expect(stage.body).not.toContain("stageTransitionToken");

    target.setStatus(410);
    await fetch(`${base}/api/leads/lead-hub-1`, { method: "PATCH", headers, body: JSON.stringify({ stage: "proposal" }) });
    while (await processOutboxOnce(store));
    const state = await (await fetch(`${base}/api/state`, { headers })).json();
    expect(state.events.find((e: any) => e.type === "hook-delivery" && e.status === "failed")).toBeTruthy();
    const hub = await (await fetch(`${base}/api/webhook-hub`, { headers })).json();
    expect(hub.outbound[0]).toMatchObject({ lastStatus: 410, successCount: 3, failureCount: 1 });
  });

  it("özel ağ adreslerini izin listesi olmadan reddeder", async () => {
    const { base, headers } = await start();
    delete process.env.OUTBOUND_ALLOW_PRIVATE_HOSTS;
    const res = await post(
      `${base}/api/webhook-hub/outbound`,
      { name: "iç", url: "http://192.168.1.10/hook", events: ["lead.created"] },
      headers,
    );
    expect(res.status).toBe(400);
  });

  it("olay farkını doğru hesaplar", () => {
    expect(eventsForWrite("lead", null, { stage: "new" }).map((e) => e.type)).toEqual(["lead.created"]);
    expect(
      eventsForWrite("lead", { stage: "new", lastActivity: "a" }, { stage: "new", lastActivity: "b" }),
    ).toEqual([]);
    expect(eventsForWrite("tasks", { status: "todo" }, { status: "done" }).map((e) => e.type)).toEqual(["task.completed"]);
    expect(eventsForWrite("call", null, { status: "missed" }).map((e) => e.type)).toEqual(["call.missed"]);
    expect(eventsForWrite("call", { status: "queued" }, { status: "ended" }).map((e) => e.type)).toEqual(["call.ended"]);
  });
});
