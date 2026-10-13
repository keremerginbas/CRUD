import express from "express";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryStore } from "../server/db";
import { createSessionToken, requireAuth } from "../server/auth";
import { registerCrmWorkspaceRoutes } from "../server/crm-workspace";
import {
  CRM_WORKSPACE_PREFERENCE_KIND,
  filterCrmWorkspaceRecords,
  parseCrmWorkspaceFilters,
  parseCrmWorkspacePreferences,
  matchesCrmWorkspaceFilters,
} from "../shared/crm-workspace";

const savedEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env))
    if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

describe("CRM workspace shared contract", () => {
  it("uses the safe defaults and accepts legacy advanced filter names", () => {
    expect(
      parseCrmWorkspaceFilters({
        amountMin: 100,
        amountMax: "500",
        linkedContact: "yes",
      }),
    ).toMatchObject({
      pipeline: "sales",
      minValue: "100",
      maxValue: "500",
      contact: "yes",
      company: "any",
    });
  });

  it("rejects unknown preference keys and keeps name and communication columns", () => {
    expect(() =>
      parseCrmWorkspacePreferences({
        views: [],
        cardProfile: "standard",
        listColumns: ["stage"],
        extra: true,
      }),
    ).toThrow();
    expect(
      parseCrmWorkspacePreferences({ views: [], listColumns: ["stage"] })
        .listColumns,
    ).toEqual(["name", "stage", "communication"]);
  });

  it("matches advanced filters without querying a provider", () => {
    const record = {
      name: "Ada",
      city: "İstanbul",
      stage: "qualified",
      pipelineId: "sales",
      value: 250,
      contactId: "contact-1",
      companyId: "",
      createdAt: "2025-01-15T12:00:00.000Z",
    };
    const filters = parseCrmWorkspaceFilters({
      city: "istanbul",
      stage: "qualified",
      minValue: "200",
      maxValue: "300",
      contact: "yes",
      company: "no",
    });
    expect(matchesCrmWorkspaceFilters(record, filters)).toBe(true);
    expect(
      filterCrmWorkspaceRecords([record, { ...record, stage: "won" }], filters),
    ).toHaveLength(1);
  });

  it("uses Istanbul +03 date-only bounds, defaults missing pipelines to sales, and ignores freeform company text", () => {
    const endOfIstanbulDay = {
      name: "Ada",
      company: "Portföy başlığı",
      value: 10,
      createdAt: "2026-10-13T20:59:59.999Z",
    };
    const nextIstanbulDay = {
      ...endOfIstanbulDay,
      createdAt: "2026-10-13T21:00:00.000Z",
    };
    expect(
      matchesCrmWorkspaceFilters(
        endOfIstanbulDay,
        parseCrmWorkspaceFilters({ createdTo: "2026-10-13" }),
      ),
    ).toBe(true);
    expect(
      matchesCrmWorkspaceFilters(
        nextIstanbulDay,
        parseCrmWorkspaceFilters({ createdTo: "2026-10-13" }),
      ),
    ).toBe(false);
    expect(
      matchesCrmWorkspaceFilters(
        endOfIstanbulDay,
        parseCrmWorkspaceFilters({ pipeline: "sales" }),
      ),
    ).toBe(true);
    expect(
      matchesCrmWorkspaceFilters(
        endOfIstanbulDay,
        parseCrmWorkspaceFilters({ company: "yes" }),
      ),
    ).toBe(false);
    expect(
      matchesCrmWorkspaceFilters(
        endOfIstanbulDay,
        parseCrmWorkspaceFilters({ company: "no" }),
      ),
    ).toBe(true);
    expect(
      matchesCrmWorkspaceFilters(
        { ...endOfIstanbulDay, linkedCompany: { id: "company-1" } },
        parseCrmWorkspaceFilters({ company: "yes" }),
      ),
    ).toBe(true);
  });
});

describe("CRM workspace preferences route", () => {
  it("stores only the authenticated actor's exact preference key", async () => {
    process.env.MANUS_PROJECT_ID = "crm-workspace-test";
    process.env.MANUS_JWT_SECRET = "crm-workspace-secret";
    process.env.XRE_OWNER_OPEN_ID = "workspace-owner";
    const store = createMemoryStore();
    const app = express();
    app.use(express.json());
    app.use("/api", requireAuth(store));
    registerCrmWorkspaceRoutes(app, store);
    const server = http.createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    const token = await createSessionToken({
      openId: "workspace-owner",
      name: "Test",
    });
    const headers = {
      cookie: `webdev_app_session=${token}`,
      "content-type": "application/json",
    };
    try {
      const saved = await fetch(
        `http://127.0.0.1:${port}/api/crm-workspace/preferences`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({
            views: [],
            cardProfile: "compact",
            listColumns: ["name", "communication"],
          }),
        },
      );
      expect(saved.status).toBe(200);
      const stored = await store.get(
        CRM_WORKSPACE_PREFERENCE_KIND,
        "workspace-owner",
        "workspace-owner",
      );
      expect(stored?.payload).toMatchObject({ cardProfile: "compact" });
      const loaded = await fetch(
        `http://127.0.0.1:${port}/api/crm-workspace/preferences`,
        { headers },
      );
      expect(await loaded.json()).toMatchObject({ cardProfile: "compact" });
    } finally {
      server.close();
    }
  });
});
