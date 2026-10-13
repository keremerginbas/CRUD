import { afterEach, describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createSessionToken } from "../server/auth";
const env = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env))
    if (!(k in env)) delete process.env[k];
  Object.assign(process.env, env);
});
async function start() {
  const store = createMemoryStore();
  const server = http.createServer(createApp({ store }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address() as any;
  return { store, server, base: `http://127.0.0.1:${a.port}` };
}
describe("Canlı CRM erişim güvenliği", () => {
  it("geçerli imzalı ama süresiz JWT ile erişimi reddeder", async () => {
    process.env.MANUS_PROJECT_ID = "auth-test";
    process.env.MANUS_JWT_SECRET = "auth-test-secret";
    const token = await new SignJWT({ appId: "auth-test", openId: "owner" })
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode("auth-test-secret"));
    const { server, base } = await start();
    try {
      const r = await fetch(base + "/api/state", {
        headers: { cookie: `webdev_app_session=${token}` },
      });
      expect(r.status).toBe(401);
    } finally {
      server.close();
    }
  });
  it("oturum açmış sahip dışı kullanıcıya müşteri kayıtlarını göstermez", async () => {
    process.env.MANUS_PROJECT_ID = "auth-test";
    process.env.MANUS_JWT_SECRET = "auth-test-secret";
    process.env.XRE_OWNER_OPEN_ID = "expected-owner";
    const token = await createSessionToken({ openId: "unrelated-user" });
    const { server, base } = await start();
    try {
      const r = await fetch(base + "/api/state", {
        headers: { cookie: `webdev_app_session=${token}` },
      });
      expect(r.status).toBe(401);
    } finally {
      server.close();
    }
  });
});
