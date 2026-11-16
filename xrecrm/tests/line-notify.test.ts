import { beforeEach, describe, expect, it, vi } from "vitest";

const pushed: { notice: any; filter: any }[] = [];
vi.mock("../server/pbx", async (original) => ({
  ...(await original<typeof import("../server/pbx")>()),
  pushNotice: (notice: any, filter: any) => {
    pushed.push({ notice, filter });
    return 0;
  },
}));

import { createMemoryStore } from "../server/db";
import { liveNotifyStore } from "../server/live-notify";

const OWNER = "local:sahip";
const inbound = (id: string, lineId: string | null) => ({
  id,
  lineId,
  leadId: null,
  phone: "905550000001",
  direction: "inbound",
  text: "Fiyat alabilir miyim?",
  createdAt: "2026-03-10T08:00:00.000Z",
});

async function setup() {
  const base = createMemoryStore();
  await base.put("user", OWNER, { openId: OWNER, name: "Sahip", email: "sahip@x.test", isOwner: true }, OWNER);
  await base.put("user", "local:mert", { openId: "local:mert", name: "Mert Danışman", email: "mert@x.test" }, OWNER);
  await base.put("employee", "emp-ayse", { id: "emp-ayse", openId: "local:ayse", name: "Ayşe Danışman", email: "ayse@x.test", active: true }, OWNER);
  await base.put("employee", "emp-mert", { id: "emp-mert", openId: "local:mert", name: "Mert Danışman", active: true }, OWNER);
  return { base, store: liveNotifyStore(base) };
}
const targets = () => pushed.map((p) => p.filter.assigneeName).sort();

describe("Gelen mesaj bildirimi ve hat yetkisi", () => {
  beforeEach(() => {
    pushed.length = 0;
  });

  it("kısıt yokken WhatsApp yetkisi olan herkese tek bildirim gider", async () => {
    const { store } = await setup();
    await store.put("message", "m1", inbound("m1", "cloud-1"), OWNER);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].filter).toEqual({ module: "whatsapp", owner: OWNER });
  });

  it("hatta yetkili personel seçilmişse bildirim yalnız o kişilere ve sahibe gider", async () => {
    const { base, store } = await setup();
    await base.put("line-staff", "cloud-1", { id: "cloud-1", employeeIds: ["emp-mert"] }, OWNER);
    await store.put("message", "m1", inbound("m1", "cloud-1"), OWNER);
    expect(targets()).toEqual(["mert@x.test", "sahip@x.test"]);
    expect(pushed.every((p) => p.filter.module === "whatsapp" && p.filter.owner === OWNER)).toBe(true);
    expect(pushed[0].notice.body).toBe("Fiyat alabilir miyim?");
    // Diğer hat ve hat bilgisi olmayan mesaj herkese gider.
    pushed.length = 0;
    await store.put("message", "m2", inbound("m2", "cloud-2"), OWNER);
    await store.put("message", "m3", inbound("m3", null), OWNER);
    expect(pushed.map((p) => p.filter.assigneeName)).toEqual([undefined, undefined]);
  });

  it("numaraya göre kısıtlanan personel yalnız kendi hattının bildirimini alır", async () => {
    const { base, store } = await setup();
    // Ayşe yalnız cloud-2'nin numarasında yetkili; Mert'te numara kısıtı yok.
    await base.put("employee", "emp-ayse", { id: "emp-ayse", openId: "local:ayse", name: "Ayşe Danışman", email: "ayse@x.test", active: true, whatsappPhones: ["905553000002"] }, OWNER);
    await store.put("message", "m1", inbound("m1", "cloud-1"), OWNER);
    expect(targets()).toEqual(["mert@x.test", "sahip@x.test"]);
    pushed.length = 0;
    await store.put("message", "m2", inbound("m2", "cloud-2"), OWNER);
    expect(targets()).toEqual(["ayse@x.test", "mert@x.test", "sahip@x.test"]);
  });
});
