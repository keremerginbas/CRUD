import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { captureEvolutionMedia, saveMedia, stripMediaPayload } from "../server/whatsapp-media";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

beforeEach(() => {
  for (const k of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "META_ACCESS_TOKEN"]) delete process.env[k];
  process.env.XRE_SESSION_SECRET = "media-test-secret-0123456789abcdef";
  process.env.XRE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "xre-media-"));
  process.env.OUTBOUND_ALLOW_PRIVATE_HOSTS = "127.0.0.1";
});
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});

async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as any).port}`;
}

describe("WhatsApp medya", () => {
  it("Evolution üzerinden dosya gönderir, saklar ve yetkiliye sunar", async () => {
    const calls: { url: string; body: any }[] = [];
    process.env.EVOLUTION_API_URL = await listen((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        calls.push({ url: req.url || "", body: JSON.parse(body || "{}") });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ key: { id: "WA-MEDIA-1" } }));
      });
    });
    process.env.EVOLUTION_API_KEY = "evo-key";
    const store = createMemoryStore();
    const base = await listen(createApp({ store }));
    const setup = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sahip", email: "s@x.test", password: "Sahip12345" }) });
    const headers = { "content-type": "application/json", cookie: (setup.headers.get("set-cookie") || "").split(";")[0] };
    const owner = (await store.resolveOwner())!;
    const stamp = new Date().toISOString();
    await store.put("lead", "lead-m", { id: "lead-m", name: "Medya", phone: "05553000009", email: "", company: "", stage: "new", owner: "Ali", value: 0, source: "x", notes: "", createdAt: stamp, lastActivity: stamp, tags: [] }, owner);
    await store.put("connection", "cloud-1", { id: "cloud-1", status: "connected" }, owner);

    const sent = await fetch(`${base}/api/messages/media`, {
      method: "POST",
      headers,
      body: JSON.stringify({ leadId: "lead-m", lineId: "cloud-1", caption: "Tapu fotoğrafı", fileName: "tapu.png", mime: "image/png", data: `data:image/png;base64,${PNG.toString("base64")}` }),
    });
    expect(sent.status).toBe(201);
    const message = await sent.json();
    expect(calls[0].url).toBe("/message/sendMedia/cloud-1");
    expect(calls[0].body).toMatchObject({ number: "905553000009", mediatype: "image", mimetype: "image/png", caption: "Tapu fotoğrafı", fileName: "tapu.png" });
    expect(Buffer.from(calls[0].body.media, "base64").equals(PNG)).toBe(true);

    const file = await fetch(`${base}/api/media/${message.mediaId}`, { headers });
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);
    expect((await fetch(`${base}/api/media/${message.mediaId}`)).status).toBe(401);

    const state = await (await fetch(`${base}/api/state`, { headers })).json();
    expect(state.messages[0]).toMatchObject({ mediaId: message.mediaId, mediaType: "image", text: "Tapu fotoğrafı" });

    const html = await saveMedia(store, owner, Buffer.from("<script>alert(1)</script>"), "text/html", "x.html");
    await store.put("message", "m-html", { id: "m-html", mediaId: html.id, leadId: "lead-m", direction: "inbound", text: "x", createdAt: stamp }, owner);
    const risky = await fetch(`${base}/api/media/${html.id}`, { headers });
    expect(risky.headers.get("content-type")).toBe("application/octet-stream");
    expect(risky.headers.get("content-disposition")).toContain("attachment");
  });

  it("gelen Evolution medyasını kaydeder ve büyük içeriği kayıttan çıkarır", async () => {
    const store = createMemoryStore();
    const data = { key: { id: "IN1" }, message: { imageMessage: { mimetype: "image/png", caption: "Ev" }, base64: PNG.toString("base64") } };
    const media = await captureEvolutionMedia(store, "owner", "cloud-1", data);
    expect(media).toMatchObject({ mediaType: "image", mime: "image/png", size: PNG.length });
    expect(JSON.stringify(stripMediaPayload(data))).not.toContain(PNG.toString("base64"));
  });
});
