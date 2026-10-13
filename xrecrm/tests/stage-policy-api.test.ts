import { it, expect, afterEach } from "vitest";
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
it("API huni politikası kaybolmaz; yetki deposundan yazılan CRM ve randevu değişiklikleri doğrulanır", async () => {
  process.env.MANUS_PROJECT_ID = "policy-api";
  process.env.MANUS_JWT_SECRET = "testpolicy";
  process.env.XRE_OWNER_OPEN_ID = "p-owner";
  const store = createMemoryStore();
  const server = http.createServer(createApp({ store }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const token = await createSessionToken({ openId: "p-owner" });
  const headers = {
    "content-type": "application/json",
    cookie: `webdev_app_session=${token}`,
  };
  const send = (path: string, body: any, method = "POST") =>
    fetch(base + path, { method, headers, body: JSON.stringify(body) });
  try {
    const stamp = new Date().toISOString();
    const p = {
      id: "sales",
      name: "Test",
      description: "",
      stages: ["new", "contacted", "qualified", "proposal", "won", "lost"].map(
        (id) => ({
          id,
          label: id === "qualified" ? "Randevu" : id,
          color: "#123456",
        }),
      ),
      requiredFieldsByStage: { new: ["phone"], qualified: ["city"] },
      createdAt: stamp,
      updatedAt: stamp,
    };
    const saved = await send("/api/pipelines", p);
    expect(saved.status).toBe(201);
    expect(
      (await store.get<any>("pipelines", "sales", "p-owner"))?.payload
        .requiredFieldsByStage,
    ).toEqual({ new: ["phone"], qualified: ["city"] });
    expect(
      (await send("/api/leads", { lead: { id: "no-phone", name: "Test" } }))
        .status,
    ).toBe(422);
    expect(await store.get("lead", "no-phone", "p-owner")).toBeNull();
    expect(
      (
        await send("/api/leads", {
          lead: { id: "valid", name: "Geçerli", phone: "+905550000000" },
        })
      ).status,
    ).toBe(201);
    expect(
      (await send("/api/leads/valid", { stage: "qualified" }, "PATCH")).status,
    ).toBe(422);
    expect(await store.list("activities", "p-owner")).toHaveLength(0);
    expect(
      (
        await send(
          "/api/leads/valid",
          { stage: "qualified", city: "Ankara" },
          "PATCH",
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await send(
          "/api/leads/valid",
          {
            stage: "qualified",
            city: "Ankara",
            appointmentAt: "2099-01-01T10:00:00Z",
          },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    expect(await store.list("activities", "p-owner")).toHaveLength(1);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
