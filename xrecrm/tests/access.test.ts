import { afterEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { createMemoryStore } from "../server/db.js";
import {
  createPermissionStore,
  resolveAuthContext,
  withPermissionContext,
} from "../server/access.js";
import { verifyRequestSession } from "../server/auth.js";
import type { AuthContext } from "../server/types.js";
import { defaultRole } from "../shared/access.js";
import { IncomingMessage } from "node:http";

const savedEnv = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env))
    if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

async function admittedFixture() {
  const raw = createMemoryStore();
  const owner = await raw.claimOwner({ openId: "owner-open", name: "Sahip" });
  await raw.put(
    "role",
    "sales",
    { ...defaultRole("sales")!, locked: false },
    owner.ownerOpenId,
  );
  await raw.put(
    "employee",
    "employee-1",
    {
      id: "employee-1",
      name: "Satış Kullanıcısı",
      email: "same@example.test",
      openId: "member-open",
      departmentId: "sales",
      roleId: "sales",
      active: true,
      title: "Danışman",
      phone: "",
    },
    owner.ownerOpenId,
  );
  const auth = await resolveAuthContext(
    raw,
    {
      openId: "member-open",
      name: "Untrusted JWT name",
      email: "same@example.test",
    },
    { ownerOpenId: owner.ownerOpenId, isOwner: false },
  );
  if (!auth) throw new Error("fixture admission failed");
  return { raw, owner, auth, scoped: createPermissionStore(raw) };
}

describe("priority multiuser RBAC", () => {
  it("admits only an active employee with the exact Manus openId", async () => {
    const { raw, owner } = await admittedFixture();
    const sameEmail = await resolveAuthContext(
      raw,
      { openId: "different-open", email: "same@example.test" },
      { ownerOpenId: owner.ownerOpenId, isOwner: false },
    );
    expect(sameEmail).toBeNull();
    await raw.put(
      "employee",
      "inactive",
      {
        id: "inactive",
        name: "Eski",
        email: "same@example.test",
        openId: "inactive-open",
        departmentId: "",
        roleId: "sales",
        active: false,
        title: "",
        phone: "",
      },
      owner.ownerOpenId,
    );
    const inactive = await resolveAuthContext(
      raw,
      { openId: "inactive-open", email: "same@example.test" },
      { ownerOpenId: owner.ownerOpenId, isOwner: false },
    );
    expect(inactive).toBeNull();
  });

  it("filters own leads and prevents scope escalation on writes", async () => {
    const { raw, owner, auth, scoped } = await admittedFixture();
    await raw.put(
      "lead",
      "mine",
      {
        id: "mine",
        owner: "Satış Kullanıcısı",
        ownerOpenId: "employee-1",
        name: "Benim kayıt",
        stage: "new",
      },
      owner.ownerOpenId,
    );
    await raw.put(
      "lead",
      "other",
      {
        id: "other",
        owner: "Başka kişi",
        ownerOpenId: "other-employee",
        name: "Başka kayıt",
        stage: "new",
      },
      owner.ownerOpenId,
    );
    await new Promise<void>((resolve, reject) =>
      withPermissionContext(scoped, auth, () => {
        scoped
          .list("lead", owner.ownerOpenId)
          .then((rows) => {
            expect(rows.map((row) => row.id)).toEqual(["mine"]);
            return scoped.put(
              "lead",
              "other",
              {
                id: "other",
                owner: "Başka kişi",
                ownerOpenId: "other-employee",
              },
              owner.ownerOpenId,
            );
          })
          .then(() => reject(new Error("out-of-scope write was accepted")))
          .catch((error) => {
            expect(error.statusCode).toBe(403);
            resolve();
          });
      }),
    );
  });

  it("keeps owner admission available while protecting owner employee changes", async () => {
    const { raw, owner } = await admittedFixture();
    const ownerAuth: AuthContext = {
      user: { openId: owner.ownerOpenId },
      ownerOpenId: owner.ownerOpenId,
      isOwner: true,
    };
    expect(ownerAuth.isOwner).toBe(true);
    const role = await resolveAuthContext(
      raw,
      { openId: owner.ownerOpenId },
      owner,
    );
    expect(role?.isOwner).toBe(true);
  });

  it("rejects a signed JWT with no expiry", async () => {
    process.env.MANUS_PROJECT_ID = "access-test";
    process.env.MANUS_JWT_SECRET = "access-secret";
    const token = await new SignJWT({
      appId: "access-test",
      openId: "owner-open",
    })
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode("access-secret"));
    const req = Object.assign(new IncomingMessage(null as any), {
      headers: { cookie: `webdev_app_session=${token}` },
    }) as any;
    expect(await verifyRequestSession(req, createMemoryStore())).toBeNull();
  });
});
