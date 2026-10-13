import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { decryptValue, encryptValue, loadIntegrationSettings } from "../server/integration-settings";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];
beforeEach(() => {
  for (const key of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "VAPI_API_KEY", "PUBLIC_ORIGIN"])
    delete process.env[key];
  process.env.XRE_SESSION_SECRET = "settings-test-secret-0123456789abcdef";
});
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

describe("Arayüzden entegrasyon ayarları", () => {
  it("şifreler, uygular, maskeler ve yalnız sahibe açar", async () => {
    expect(decryptValue(encryptValue("gizli-değer"))).toBe("gizli-değer");
    const store = createMemoryStore();
    const server = http.createServer(createApp({ store }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const h = (cookie = "") => ({ "content-type": "application/json", cookie });
    const setup = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: h(), body: JSON.stringify({ name: "Sahip", email: "s@x.test", password: "Sahip12345" }) });
    const cookie = (setup.headers.get("set-cookie") || "").split(";")[0];

    const saved = await fetch(`${base}/api/settings/integrations`, {
      method: "PUT",
      headers: h(cookie),
      body: JSON.stringify({ values: { VAPI_API_KEY: "vapi-super-secret-1234", PUBLIC_ORIGIN: "https://crm.xre.test" } }),
    });
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(JSON.stringify(body)).not.toContain("vapi-super-secret");
    expect(body.settings.find((s: any) => s.key === "VAPI_API_KEY")).toMatchObject({ configured: true, source: "ui", preview: "••••1234" });
    expect(process.env.VAPI_API_KEY).toBe("vapi-super-secret-1234");

    const raw = JSON.stringify(await store.list("system-settings", (await store.resolveOwner())!));
    expect(raw).not.toContain("vapi-super-secret");

    expect((await fetch(`${base}/api/settings/integrations`, { method: "PUT", headers: h(cookie), body: JSON.stringify({ values: { DATABASE_URL: "x" } }) })).status).toBe(400);
    expect((await fetch(`${base}/api/settings/integrations`, { headers: h() })).status).toBe(401);

    delete process.env.VAPI_API_KEY;
    expect(await loadIntegrationSettings(store)).toBe(2);
    expect(process.env.VAPI_API_KEY).toBe("vapi-super-secret-1234");

    await fetch(`${base}/api/settings/integrations`, { method: "PUT", headers: h(cookie), body: JSON.stringify({ values: { VAPI_API_KEY: null } }) });
    expect(process.env.VAPI_API_KEY).toBeUndefined();
  });
});
