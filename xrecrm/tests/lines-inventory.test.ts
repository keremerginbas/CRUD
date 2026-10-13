import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { loadLineInventoryFromStore } from "../server/line-inventory";
import { formatLineText, lines, parseLineText, resetLineInventory } from "../shared/lines";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];
beforeEach(() => {
  for (const k of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID"]) delete process.env[k];
  process.env.XRE_SESSION_SECRET = "lines-test-secret-0123456789abcdef";
});
afterEach(() => {
  resetLineInventory();
  for (const s of servers.splice(0)) s.close();
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});

describe("Hat envanteri düzenleme", () => {
  it("yapıştırılan metni çözer ve geri biçimlendirir", () => {
    const parsed = parseLineText("0532 111 22 33;ai;;Vapi satış\n# not\n02121112233;OFİX PBX\n5331112233\t;8990000000000000001");
    expect(parsed).toEqual([
      { id: "ai-1", phone: "+905321112233", group: "ai", label: "Vapi satış" },
      { id: "office-1", phone: "+902121112233", group: "office" },
      { id: "cloud-1", phone: "+905331112233", group: "cloud", iccid: "8990000000000000001" },
    ]);
    expect(parseLineText(formatLineText(parsed))).toEqual(parsed);
    expect(() => parseLineText("123")).toThrow(/geçerli bir telefon/);
    expect(() => parseLineText("05321112233\n0532 111 22 33")).toThrow(/iki kez/);
  });

  it("sahip arayüzden kaydeder, yeniden başlatmada yüklenir", async () => {
    const store = createMemoryStore();
    const server = http.createServer(createApp({ store }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const setup = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sahip", email: "s@x.test", password: "Sahip12345" }) });
    const headers = { "content-type": "application/json", cookie: (setup.headers.get("set-cookie") || "").split(";")[0] };
    const next = parseLineText("05321112233;ai\n05331112233;cloud");
    const saved = await fetch(`${base}/api/lines`, { method: "PUT", headers, body: JSON.stringify({ lines: next }) });
    expect(saved.status).toBe(200);
    expect(lines).toHaveLength(2);
    const state = await (await fetch(`${base}/api/state`, { headers })).json();
    expect(state.lines.map((l: any) => l.phone)).toEqual(["+905321112233", "+905331112233"]);
    resetLineInventory();
    expect(await loadLineInventoryFromStore(store)).toBe(2);
    expect((await fetch(`${base}/api/lines`, { method: "PUT", headers, body: JSON.stringify({ lines: [] }) })).status).toBe(400);
  });
});
