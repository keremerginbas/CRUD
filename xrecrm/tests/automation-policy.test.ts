import { describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import {
  evaluateAutomationPolicy,
  AutomationPolicySchema,
} from "../shared/automation-policy";
import { createMemoryStore } from "../server/db";
import { registerAutomationPlanningRoutes } from "../server/automation-planning";

const lead = {
  id: "lead-1",
  name: "Ayşe",
  phone: "+905551112233",
  email: "ayse@example.com",
  company: "XRE",
  stage: "new" as const,
  owner: "Zeynep",
  value: 1250000,
  source: "web",
  notes: "",
  createdAt: "2026-10-12T08:00:00.000Z",
  lastActivity: "2026-10-12T08:00:00.000Z",
  tags: ["VIP", "Kadıköy"],
  city: "Kadıköy",
};

describe("automation policy", () => {
  it("starts delay at the transition and moves a Friday evening run to Monday Turkey time", () => {
    const result = evaluateAutomationPolicy(
      {
        policy: {
          mode: "all",
          conditions: [{ field: "city", op: "eq", value: "kadıköy" }],
          delayMinutes: 10,
          businessHours: true,
        },
      },
      lead,
      "2026-10-16T17:55:00+03:00",
    );
    expect(result.eligible).toBe(true);
    expect(result.conditionResults[0].matched).toBe(true);
    expect(result.runAt).toBe("2026-10-19T06:00:00.000Z");

    const immediate = evaluateAutomationPolicy(
      {},
      lead,
      "2026-10-16T17:55:00+03:00",
    );
    expect(immediate).toMatchObject({
      eligible: true,
      runAt: "2026-10-16T14:55:00.000Z",
      conditionResults: [],
    });
  });

  it("supports bounded tag and numeric comparisons without dynamic evaluation", () => {
    const result = evaluateAutomationPolicy(
      {
        policy: {
          mode: "any",
          conditions: [
            { field: "tags", op: "contains", value: "vip" },
            { field: "value", op: "gte", value: 2000000 },
          ],
          delayMinutes: 0,
          businessHours: false,
        },
      },
      lead,
      "2026-10-13T09:00:00+03:00",
    );
    expect(result.eligible).toBe(true);
    expect(result.conditionResults.map((item) => item.matched)).toEqual([
      true,
      false,
    ]);
  });

  it("rejects unknown policy keys and invalid delay bounds", () => {
    expect(
      AutomationPolicySchema.safeParse({
        mode: "all",
        conditions: [],
        delayMinutes: 10,
        businessHours: false,
        execute: "return true",
      }).success,
    ).toBe(false);
    expect(
      AutomationPolicySchema.safeParse({
        mode: "all",
        conditions: [],
        delayMinutes: 5,
        businessHours: false,
      }).success,
    ).toBe(false);
  });

  it("performs a memory dry-run with no events or records written", async () => {
    const store = createMemoryStore();
    await store.claimOwner({ openId: "owner", name: "Owner" });
    await store.put("lead", lead.id, lead, "owner");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).auth = {
        user: { openId: "owner", name: "Owner" },
        ownerOpenId: "owner",
        isOwner: true,
      };
      next();
    });
    registerAutomationPlanningRoutes(app, store);
    const server = http.createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const beforeLeads = await store.list("lead", "owner");
    const beforeRules = await store.list("rule", "owner");
    const beforeEvents = await store.listEvents("owner");
    try {
      const response = await fetch(`${base}/api/automations/dry-run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          rule: {
            id: "draft-rule",
            name: "Draft",
            triggerStage: "new",
            action: "task",
            enabled: true,
            config: {},
            policy: {
              mode: "all",
              conditions: [{ field: "city", op: "contains", value: "kad" }],
              delayMinutes: 0,
              businessHours: false,
            },
          },
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        dryRun: true,
        eligible: true,
        leadId: lead.id,
        ruleId: "draft-rule",
      });
      expect(await store.list("lead", "owner")).toEqual(beforeLeads);
      expect(await store.list("rule", "owner")).toEqual(beforeRules);
      expect(await store.listEvents("owner")).toEqual(beforeEvents);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
