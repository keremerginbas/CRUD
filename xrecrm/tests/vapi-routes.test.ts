import http from "node:http";
import { afterEach, it, expect, vi } from "vitest";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createSessionToken } from "../server/auth";
const mocks = vi.hoisted(() => ({ catalog: vi.fn() }));
vi.mock("../server/vapi-catalog.js", () => ({
  getVapiCatalog: mocks.catalog,
  vapiLineIsCallable: () => true,
}));
const env = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env))
    if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
  mocks.catalog.mockReset();
});
it("oturumsuz veya davetsiz kimlik Vapi kataloğu için sağlayıcıya ulaşamaz; sahibi izinli katalog okur", async () => {
  process.env.MANUS_PROJECT_ID = "test-vapi-routes";
  process.env.MANUS_JWT_SECRET = "test-only-not-real";
  delete process.env.MANUS_OWNER_OPEN_ID;
  delete process.env.XRE_OWNER_OPEN_ID;
  const store = createMemoryStore();
  await store.claimOwner({ openId: "owner-catalog", name: "Test Owner" });
  const app = createApp({ store });
  const server = http.createServer(app);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  mocks.catalog.mockResolvedValue({
    keyConfigured: true,
    assistants: [{ id: "a", name: "Proje asistanı" }],
    lines: [],
    unavailableLineIds: [],
    unmatchedNumbers: 0,
    webhookConfigured: false,
    checkedAt: new Date().toISOString(),
  });
  try {
    for (const path of [
      "/api/calls/options",
      "/api/integrations/vapi/catalog",
    ]) {
      expect((await fetch(base + path)).status).toBe(401);
      const outsider = await createSessionToken({ openId: "not-invited" });
      expect(
        (
          await fetch(base + path, {
            headers: {
              cookie: `webdev_app_session=${encodeURIComponent(outsider)}`,
            },
          })
        ).status,
      ).toBe(401);
    }
    expect(mocks.catalog).not.toHaveBeenCalled();
    const owner = await createSessionToken({ openId: "owner-catalog" });
    const response = await fetch(base + "/api/calls/options", {
      headers: { cookie: `webdev_app_session=${encodeURIComponent(owner)}` },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).assistants[0].name).toBe("Proje asistanı");
    expect(mocks.catalog).toHaveBeenCalledTimes(1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
