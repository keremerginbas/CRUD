import { it, expect } from "vitest";
import { createMemoryStore } from "../server/db";
import { createPermissionStore, withPermissionContext } from "../server/access";
import { defaultRole } from "../shared/access";
import type { AuthContext } from "../server/types";
import { stagePolicyStore } from "../server/crm-stage-policy";
function scopedRun<T>(
  store: any,
  auth: AuthContext,
  work: () => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) =>
    withPermissionContext(store, auth, () => void work().then(resolve, reject)),
  );
}
it("kendi kapsamındaki kişi/şirket yabancı sorumluya devredilemez", async () => {
  const raw = createMemoryStore();
  const role = defaultRole("sales")!;
  const auth = {
    user: { openId: "employee", name: "Satışçı" },
    ownerOpenId: "o",
    isOwner: false,
    employeeId: "employee",
    displayName: "Satışçı",
    permissions: role.grants,
  } as AuthContext;
  const scoped = createPermissionStore(raw);
  for (const kind of ["contacts", "companies"]) {
    await scopedRun(raw, auth, () =>
      scoped.put(
        kind,
        kind,
        { id: kind, name: "Kendi kaydım", owner: "Yabancı" },
        "o",
      ),
    );
    expect((await raw.get<any>(kind, kind, "o"))?.payload.owner).toBe(
      "Satışçı",
    );
    expect(
      await scopedRun(raw, auth, () => scoped.list(kind, "o")),
    ).toHaveLength(1);
    await expect(
      scopedRun(raw, auth, () =>
        scoped.put(
          kind,
          kind,
          { id: kind, name: "Devir", owner: "Yabancı" },
          "o",
        ),
      ),
    ).rejects.toThrow("sorumlusu");
  }
});
it("atomik ekleme mevcut kayda dokunmaz; tek yeni kimlik yalnız bir kez eklenir", async () => {
  const s = createMemoryStore();
  await s.put("contacts", "x", { name: "Eski" }, "o");
  const result = await s.insertIfAbsent(
    "contacts",
    "x",
    { name: "Üzerine yaz" },
    "o",
  );
  expect(result.inserted).toBe(false);
  expect((await s.get<any>("contacts", "x", "o"))?.payload.name).toBe("Eski");
  const pair = await Promise.all([
    s.insertIfAbsent("contacts", "y", { name: "1" }, "o"),
    s.insertIfAbsent("contacts", "y", { name: "2" }, "o"),
  ]);
  expect(pair.filter((r) => r.inserted)).toHaveLength(1);
});
it("aşamadan çıkıp yeniden giriş geçiş kimliğini değiştirir; istemci kimlik enjekte edemez", async () => {
  const root = createMemoryStore();
  const s = stagePolicyStore(root);
  await s.put(
    "lead",
    "l",
    { id: "l", stage: "new", stageTransitionToken: "client" },
    "o",
  );
  const first = (await s.get<any>("lead", "l", "o"))!.payload;
  expect(first.stageTransitionToken).not.toBe("client");
  await s.put(
    "lead",
    "l",
    { ...first, name: "Alan düzenleme", stageTransitionToken: "fake" },
    "o",
  );
  expect(
    (await s.get<any>("lead", "l", "o"))!.payload.stageTransitionToken,
  ).toBe(first.stageTransitionToken);
  await s.put("lead", "l", { ...first, stage: "contacted" }, "o");
  await s.put("lead", "l", { ...first, stage: "new" }, "o");
  expect(
    (await s.get<any>("lead", "l", "o"))!.payload.stageTransitionToken,
  ).not.toBe(first.stageTransitionToken);
});
it("10 dakikadan eski received webhook tekrar işlenir; taze received olay claim edilmez", async () => {
  const s = createMemoryStore();
  const old = await s.appendEvent(
    "o",
    "old",
    { type: "webhook", provider: "inbound" },
    "received",
  );
  const fresh = await s.appendEvent(
    "o",
    "fresh",
    { type: "webhook", provider: "inbound" },
    "received",
  );
  const event = (s as any).events.get(old.event.id);
  event.updatedAt = new Date(Date.now() - 660000).toISOString();
  const claimed = await s.claimDueEvents();
  expect(claimed.map((e) => e.id)).toEqual([old.event.id]);
  expect((await s.getEvent(fresh.event.id, "o"))?.status).toBe("received");
});
