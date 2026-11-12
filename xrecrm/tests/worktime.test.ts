import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStore, type Store } from "../server/db";
import { registerWorktimeRoutes } from "../server/worktime";

function id(): string {
  return crypto.randomUUID();
}

describe("worktime native API", () => {
  let store: Store;
  let server: ReturnType<express.Application["listen"]>;
  let auth: any;
  let base = "";

  beforeEach(async () => {
    store = createMemoryStore();
    auth = {
      user: { openId: "employee-1", name: "Çalışan" },
      ownerOpenId: "owner-1",
      isOwner: true,
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).auth = auth;
      next();
    });
    registerWorktimeRoutes(app, store);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("test server adresi alınamadı");
    base = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function call(path: string, init?: RequestInit) {
    const response = await fetch(`${base}${path}`, {
      credentials: "include",
      ...init,
    });
    const body = await response.json();
    return { response, body };
  }

  async function transition(
    action: "start" | "pause" | "resume" | "finish",
    operationId = id(),
    expectedVersion?: number,
    pauseType?: string,
  ) {
    return call("/api/worktime/transition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, operationId, expectedVersion, pauseType }),
    });
  }

  it("persists start → pause → resume → finish and the same operation is idempotent", async () => {
    const operationId = id();
    const started = await transition("start", operationId, 0);
    expect(started.response.status).toBe(200);
    expect(started.body.today.status).toBe("working");
    expect(started.body.today.version).toBe(1);

    const duplicate = await transition("start", operationId, 0);
    expect(duplicate.response.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);

    const paused = await transition("pause", id(), 1, "meal");
    expect(paused.response.status).toBe(200);
    expect(paused.body.today.status).toBe("paused");
    expect(
      paused.body.today.periods.filter((p: any) => p.type === "meal"),
    ).toHaveLength(1);

    const resumed = await transition("resume", id(), 2);
    expect(resumed.body.today.status).toBe("working");
    const finished = await transition("finish", id(), 3);
    expect(finished.body.today.status).toBe("finished");
    expect(finished.body.today.periods.every((p: any) => p.endAt)).toBe(true);
    expect(finished.body.summary.breakMs).toBeGreaterThanOrEqual(0);
  });

  it("online randevu kimle ve hangi proje için görüşüldüğü yazılmadan başlatılamaz", async () => {
    await transition("start", id(), 0);
    const send = (extra: Record<string, unknown>) =>
      call("/api/worktime/transition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "pause", pauseType: "appointment", operationId: id(), expectedVersion: 1, ...extra }),
      });
    for (const missing of [{}, { meetingWith: "Deniz Arslan" }, { meetingProject: "Nova Life" }, { meetingWith: "   ", meetingProject: "Nova Life" }]) {
      const denied = await send(missing);
      expect(denied.response.status).toBe(400);
      expect(denied.body.error).toBe("MEETING_DETAILS_REQUIRED");
    }
    const ok = await send({ meetingWith: " Deniz Arslan ", meetingProject: "Nova Life" });
    expect(ok.response.status).toBe(200);
    const period = ok.body.today.periods.find((p: any) => p.type === "appointment");
    expect(period).toMatchObject({ meetingWith: "Deniz Arslan", meetingProject: "Nova Life" });
    // Yeniden okunduğunda da saklanmış olmalı.
    const again = await call("/api/worktime");
    expect(again.body.today.periods.find((p: any) => p.type === "appointment")).toMatchObject({ meetingWith: "Deniz Arslan", meetingProject: "Nova Life" });
  });

  it("does not reset a finished day when the employee restarts", async () => {
    await transition("start", id(), 0);
    await transition("finish", id(), 1);
    const restarted = await transition("start", id(), 2);
    expect(restarted.body.today.status).toBe("working");
    expect(
      restarted.body.today.periods.filter((p: any) => p.type === "work"),
    ).toHaveLength(2);
    expect(restarted.body.today.version).toBe(3);
  });

  it("never uses a client employeeId for ownership and denies all-team scope to own-only users", async () => {
    auth = {
      user: { openId: "employee-2", name: "İkinci çalışan" },
      ownerOpenId: "owner-1",
      isOwner: false,
      employeeId: "employee-1",
      permissions: { worktime: { read: true, write: true, scope: "own" } },
    };
    const own = await call("/api/worktime");
    expect(own.response.status).toBe(200);
    expect(own.body.today.userOpenId).toBe("employee-2");
    const team = await call("/api/worktime/team");
    expect(team.response.status).toBe(403);
  });

  it("allows an explicit all/read worktime grant on the team endpoint", async () => {
    auth = {
      user: { openId: "manager-1", name: "Yönetici" },
      ownerOpenId: "owner-1",
      isOwner: false,
      permissions: { worktime: { read: true, write: false, scope: "all" } },
    };
    const team = await call("/api/worktime/team");
    expect(team.response.status).toBe(200);
    expect(team.body.records).toEqual([]);
    expect(team.body.timezone).toBe("Europe/Istanbul");
  });
});
