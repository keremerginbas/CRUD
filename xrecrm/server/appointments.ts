import crypto from "node:crypto";
import type { Store } from "./db.js";
import type { Express, Request } from "express";
import type { AuthContext } from "./types.js";
import {
  appointmentStage,
  validateAppointment,
} from "../shared/appointments.js";
import { scheduleConversationAnalysis } from "./conversation-analysis.js";

export function appointmentStore(base: Store): Store {
  return new Proxy(base, {
    get(target, key) {
      if (key === "__rawStore") return base;
      if (key === "insertIfAbsent")
        return async (
          kind: string,
          id: string,
          payload: any,
          owner: string,
        ) => {
          if (kind === "lead") {
            const pipelines = (await target.list<any>("pipelines", owner)).map(
              (r) => r.payload,
            );
            if (appointmentStage(payload, pipelines) || payload.appointmentAt) {
              try {
                validateAppointment(payload.appointmentAt);
              } catch (e) {
                throw Object.assign(e as Error, { statusCode: 422 });
              }
            }
          }
          const result = await target.insertIfAbsent(kind, id, payload, owner);
          if (result.inserted && kind === "lead" && payload.appointmentAt) {
            const stamp = new Date().toISOString();
            await target.put(
              "activities",
              `appointment-${id}`,
              {
                id: `appointment-${id}`,
                leadId: id,
                type: "meeting",
                title: "Müşteriyle görüşün",
                description: "CRM randevu aşaması için planlandı.",
                startAt: payload.appointmentAt,
                endAt: new Date(
                  Date.parse(payload.appointmentAt) + 1800000,
                ).toISOString(),
                assignee: payload.owner,
                completed: false,
                cancelled: false,
                appointmentLinked: true,
                createdAt: stamp,
                updatedAt: stamp,
              },
              owner,
            );
          }
          return result;
        };
      if (key === "put")
        return async (
          kind: string,
          id: string,
          payload: any,
          owner: string,
        ) => {
          if (kind === "pipelines") {
            const old = (await target.get<any>(kind, id, owner))?.payload;
            for (const stage of payload.stages || []) {
              const previous = old?.stages?.find((s: any) => s.id === stage.id);
              const becomes =
                appointmentStage({ stage: stage.id, pipelineId: id }, [
                  payload,
                ]) &&
                !appointmentStage(
                  { stage: stage.id, pipelineId: id },
                  old ? [old] : [],
                );
              if (becomes && (!previous || previous.label !== stage.label)) {
                const affected = (await target.list<any>("lead", owner)).filter(
                  (r) =>
                    (r.payload.pipelineId || "sales") === id &&
                    r.payload.stage === stage.id,
                );
                for (const row of affected) {
                  try {
                    validateAppointment(row.payload.appointmentAt);
                  } catch {
                    throw Object.assign(
                      new Error(
                        "Bu aşamadaki tüm müşterilere tarih ve saat atamadan aşama Randevu olarak değiştirilemez.",
                      ),
                      { statusCode: 422 },
                    );
                  }
                }
              }
            }
          }
          if (kind !== "lead") {
            const saved = await target.put(kind, id, payload, owner);
            if (
              kind === "message" ||
              (kind === "call" &&
                ["ended", "completed"].includes(String(payload.status)))
            ) {
              try {
                await scheduleConversationAnalysis(
                  target,
                  owner,
                  kind === "call" ? "call" : "whatsapp",
                  id,
                );
              } catch {
                await target
                  .put(
                    kind,
                    id,
                    { ...saved.payload, analysisStatus: "queue_failed" },
                    owner,
                  )
                  .catch(() =>
                    console.warn(
                      "Görüşme analizi kuyruk kaydı yapılamadı; kaynak kaydı korunuyor.",
                    ),
                  );
              }
            }
            return saved;
          }
          const old = await target.get<any>("lead", id, owner);
          const pipelines = (await target.list<any>("pipelines", owner)).map(
            (r) => r.payload,
          );
          const was = old && appointmentStage(old.payload, pipelines);
          const isAppointment = appointmentStage(payload, pipelines);
          const entering =
            isAppointment &&
            (!old ||
              old.payload.stage !== payload.stage ||
              old.payload.pipelineId !== payload.pipelineId);
          const leaving = was && !isAppointment;
          if (leaving) payload = { ...payload, appointmentAt: "" };
          const newDate = payload.appointmentAt !== old?.payload.appointmentAt;
          if (
            entering ||
            (newDate && isAppointment) ||
            (newDate && payload.appointmentAt)
          ) {
            try {
              validateAppointment(payload.appointmentAt);
            } catch (e) {
              throw Object.assign(e as Error, { statusCode: 422 });
            }
          }
          if (entering || newDate || leaving) {
            const stamp = new Date().toISOString();
            const prior = await target.get<any>(
              "activities",
              `appointment-${id}`,
              owner,
            );
            if (payload.appointmentAt) {
              await target.put(
                "activities",
                `appointment-${id}`,
                {
                  ...prior?.payload,
                  id: `appointment-${id}`,
                  leadId: id,
                  type: "meeting",
                  title: "Müşteriyle görüşün",
                  description: "CRM randevu aşaması için planlandı.",
                  startAt: payload.appointmentAt,
                  endAt: new Date(
                    Date.parse(payload.appointmentAt) + 1800000,
                  ).toISOString(),
                  assignee: payload.owner,
                  completed: false,
                  cancelled: false,
                  appointmentLinked: true,
                  createdAt: prior?.payload?.createdAt || stamp,
                  updatedAt: stamp,
                },
                owner,
              );
            } else if (prior)
              await target.put(
                "activities",
                prior.id,
                { ...prior.payload, cancelled: true, updatedAt: stamp },
                owner,
              );
          }
          return target.put(kind, id, payload, owner);
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
function auth(req: Request) {
  return (req as Request & { auth: AuthContext }).auth;
}
function notificationId(leadId: string, start: string) {
  return (
    "appointment-" +
    crypto
      .createHash("sha256")
      .update(leadId + ":" + start)
      .digest("hex")
      .slice(0, 28)
  );
}
export async function appointmentNotifications(
  store: Store,
  owner: string,
  actor: string,
  now = Date.now(),
) {
  const leads = (await store.list<any>("lead", owner)).map((r) => r.payload);
  const activities = (await store.list<any>("activities", owner)).map(
    (r) => r.payload,
  );
  const items: any[] = [];
  for (const a of activities) {
    if (a.completed || a.cancelled || !a.startAt || !a.leadId) continue;
    const lead = leads.find((l) => l.id === a.leadId);
    if (!lead) continue;
    const delta = Date.parse(a.startAt) - now;
    if (!Number.isFinite(delta) || delta < 0 || delta > 600000) continue;
    const id = notificationId(a.id, a.startAt);
    const seen = await store.get<any>(
      "notification_ack",
      `${actor}:${id}`,
      owner,
    );
    items.push({
      id,
      leadId: lead.id,
      activityId: a.id,
      title: `${lead.name} · randevunuza ${Math.max(1, Math.ceil(delta / 60000))} dk kaldı`,
      detail: a.title,
      startAt: a.startAt,
      createdAt: new Date(Date.parse(a.startAt) - 600000).toISOString(),
      read: Boolean(seen),
      kind: "appointment",
    });
  }
  return items.sort((a, b) => a.startAt.localeCompare(b.startAt));
}
export function registerAppointmentRoutes(app: Express, store: Store) {
  app.get("/api/notifications", async (req, res) => {
    try {
      const a = auth(req);
      res.json({
        data: await appointmentNotifications(
          store,
          a.ownerOpenId,
          a.user.openId,
        ),
      });
    } catch {
      res.status(500).json({
        error: "NOTIFICATIONS_FAILED",
        message: "Bildirimler okunamadı.",
      });
    }
  });
  app.post("/api/notifications/:id/read", async (req, res) => {
    try {
      const a = auth(req);
      const item = (
        await appointmentNotifications(store, a.ownerOpenId, a.user.openId)
      ).find((i) => i.id === req.params.id);
      if (!item) return res.status(404).json({ error: "NOT_FOUND" });
      await store.put(
        "notification_ack",
        `${a.user.openId}:${item.id}`,
        {
          id: item.id,
          userOpenId: a.user.openId,
          leadId: item.leadId,
          readAt: new Date().toISOString(),
        },
        a.ownerOpenId,
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "NOTIFICATION_UPDATE_FAILED" });
    }
  });
}
