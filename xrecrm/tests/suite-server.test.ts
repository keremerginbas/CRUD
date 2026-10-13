import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { createApp, processOutboxOnce } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createSessionToken } from "../server/auth";

const savedEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env))
    if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

async function start() {
  process.env.MANUS_PROJECT_ID = "suite-test";
  process.env.MANUS_JWT_SECRET = "suite-secret";
  process.env.XRE_OWNER_OPEN_ID = "suite-owner";
  const store = createMemoryStore();
  const server = http.createServer(createApp({ store }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const token = await createSessionToken({
    openId: "suite-owner",
    name: "Suite Owner",
  });
  const headers = {
    cookie: `webdev_app_session=${token}`,
    "content-type": "application/json",
  };
  return { server, store, base: `http://127.0.0.1:${address.port}`, headers };
}

const stamp = (minutes = 0) =>
  new Date(Date.now() + minutes * 60_000).toISOString();
const stages = [
  { id: "new", label: "Yeni", color: "#111111" },
  { id: "contacted", label: "Arandı", color: "#222222" },
  { id: "qualified", label: "Nitelikli", color: "#333333" },
  { id: "proposal", label: "Teklif", color: "#444444" },
  { id: "won", label: "Kazanıldı", color: "#555555" },
  { id: "lost", label: "Kaybedildi", color: "#666666" },
];

describe("CRM v3 suite server", () => {
  it("state dizilerini boş başlatır ve owner dışını reddeder", async () => {
    const { server, base, headers } = await start();
    try {
      const state = await fetch(`${base}/api/state`, { headers });
      expect(state.status).toBe(200);
      expect(await state.json()).toMatchObject({
        contacts: [],
        companies: [],
        pipelines: [],
        tasks: [],
        activities: [],
        feed: [],
        members: [],
      });

      const outsider = await createSessionToken({ openId: "other-user" });
      const denied = await fetch(`${base}/api/state`, {
        headers: { cookie: `webdev_app_session=${outsider}` },
      });
      expect(denied.status).toBe(401);
    } finally {
      server.close();
    }
  });

  it("şirket ve kişi duplicate/FK kurallarını owner scope içinde uygular", async () => {
    const { server, base, headers } = await start();
    try {
      const company = await fetch(`${base}/api/companies`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "company-a",
          name: "  Acme   Yapı ",
          industry: "Gayrimenkul",
          phone: "",
          email: "",
          website: "",
          address: "",
          owner: "Owner",
          notes: "",
        }),
      });
      expect(company.status).toBe(201);
      const duplicateCompany = await fetch(`${base}/api/companies`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "company-b",
          name: "acme yapı",
          industry: "",
          phone: "",
          email: "",
          website: "",
          address: "",
          owner: "",
          notes: "",
        }),
      });
      expect(duplicateCompany.status).toBe(409);

      const badContact = await fetch(`${base}/api/contacts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "contact-bad",
          name: "Bad",
          phone: "+905551112233",
          email: "bad@example.com",
          companyId: "foreign-company",
          owner: "Owner",
          tags: [],
          notes: "",
        }),
      });
      expect(badContact.status).toBe(400);
      const contact = await fetch(`${base}/api/contacts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "contact-a",
          name: "Ada",
          phone: "+90 555 111 22 33",
          email: "Ada@Example.com",
          companyId: "company-a",
          owner: "Owner",
          tags: [],
          notes: "",
        }),
      });
      expect(contact.status).toBe(201);
      const duplicateContact = await fetch(`${base}/api/contacts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "contact-b",
          name: "Ada 2",
          phone: "05551112233",
          email: "other@example.com",
          companyId: "",
          owner: "Owner",
          tags: [],
          notes: "",
        }),
      });
      expect(duplicateContact.status).toBe(409);
    } finally {
      server.close();
    }
  });

  it("pipeline label patch, task/activity doğrulaması ve feed controlled patch çalışır", async () => {
    const { server, base, headers } = await start();
    try {
      const pipeline = await fetch(`${base}/api/pipelines`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "rent",
          name: "Kiralama",
          description: "",
          stages,
        }),
      });
      expect(pipeline.status).toBe(201);
      const label = await fetch(`${base}/api/pipelines/rent`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          stages: stages.map((stage) =>
            stage.id === "won" ? { ...stage, label: "Kiralandı" } : stage,
          ),
        }),
      });
      expect(label.status).toBe(200);
      expect(
        (await label.json()).stages.find((stage: any) => stage.id === "won")
          .label,
      ).toBe("Kiralandı");

      const lead = await fetch(`${base}/api/leads`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          lead: {
            id: "lead-suite",
            name: "Lead",
            phone: "05550000000",
            pipelineId: "rent",
          },
        }),
      });
      expect(lead.status).toBe(201);
      const task = await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "task-suite",
          title: "Ara",
          description: "",
          status: "todo",
          priority: "high",
          assignee: "Owner",
          leadId: "lead-suite",
          dueAt: stamp(30),
          checklist: [],
        }),
      });
      expect(task.status).toBe(201);
      const badActivity = await fetch(`${base}/api/activities`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "activity-bad",
          leadId: "lead-suite",
          type: "call",
          title: "Arama",
          description: "",
          startAt: stamp(20),
          endAt: stamp(10),
          assignee: "Owner",
          completed: false,
        }),
      });
      expect(badActivity.status).toBe(400);
      const activity = await fetch(`${base}/api/activities`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "activity-suite",
          leadId: "lead-suite",
          type: "meeting",
          title: "Toplantı",
          description: "",
          startAt: stamp(10),
          endAt: stamp(20),
          assignee: "Owner",
          completed: false,
        }),
      });
      expect(activity.status).toBe(201);
      const feed = await fetch(`${base}/api/feed`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "feed-suite",
          author: "Owner",
          text: "Not",
          leadId: "lead-suite",
          likes: [],
          comments: [],
        }),
      });
      expect(feed.status).toBe(201);
      const feedPatch = await fetch(`${base}/api/feed/feed-suite`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          likes: ["Owner"],
          comments: [
            {
              id: "comment-1",
              author: "Owner",
              text: "Tamam",
              createdAt: stamp(),
            },
          ],
        }),
      });
      expect(feedPatch.status).toBe(200);
      const state = await fetch(`${base}/api/state`, { headers });
      const payload = await state.json();
      expect(payload.tasks[0].id).toBe("task-suite");
      expect(payload.feed[0].likes).toEqual(["Owner"]);
      expect(
        payload.events.some(
          (event: any) => event.title === "Pipeline güncellendi",
        ),
      ).toBe(true);
    } finally {
      server.close();
    }
  });

  it("task rule outbox sonucu event id ile bağlı gerçek görev saklar", async () => {
    const { server, store, base, headers } = await start();
    try {
      const rule = await fetch(`${base}/api/rules`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "task-rule-suite",
          name: "Takip",
          triggerStage: "new",
          action: "task",
          enabled: true,
          config: { assignee: "Zeynep", dueHours: "2", template: "İlk arama" },
        }),
      });
      expect(rule.status).toBe(201);
      const lead = await fetch(`${base}/api/leads`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          lead: { id: "lead-task-rule", name: "Kural lead'i", phone: "" },
        }),
      });
      expect(lead.status).toBe(201);
      expect(await processOutboxOnce(store)).toBe(1);
      const state = await fetch(`${base}/api/state`, { headers });
      const payload = await state.json();
      expect(payload.tasks).toHaveLength(1);
      expect(payload.tasks[0]).toMatchObject({
        title: "İlk arama",
        assignee: "Zeynep",
        leadId: "lead-task-rule",
      });
      expect(
        payload.events.find(
          (event: any) => event.payload?.type === "rule-action",
        )?.payload?.result?.taskId,
      ).toBe(payload.tasks[0].id);
    } finally {
      server.close();
    }
  });
});
