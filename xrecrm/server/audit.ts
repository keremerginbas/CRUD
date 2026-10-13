// Denetim günlüğü ve aşama geçmişi.
// Önemli kayıt türlerindeki her oluşturma/güncelleme/silme, işlemi yapan kişiyle
// birlikte "audit" kaydı olarak saklanır. Müşteri aşama değişimleri ayrıca
// "stage-history" kaydına yazılır; raporlar kazanım tarihini buradan alır.
import crypto from "node:crypto";
import type { Express, Request } from "express";
import type { Store } from "./db.js";
import type { AuthContext } from "./types.js";
import { canAccess, currentPermissionContext, rawStoreOf } from "./access.js";
import { currentInboundHookId } from "./webhook-hub.js";

export const AUDIT_KIND = "audit";
export const STAGE_KIND = "stage-history";

const AUDITED: Record<string, string> = {
  lead: "Müşteri",
  contacts: "Kişi",
  companies: "Şirket",
  tasks: "Görev",
  activities: "Etkinlik",
  pipelines: "Satış hunisi",
  rule: "Otomasyon kuralı",
  employee: "Çalışan",
  role: "Rol",
  department: "Departman",
  "local-account": "Giriş hesabı",
  "webhook-in": "Gelen webhook",
  "webhook-out": "Giden webhook",
  "system-settings": "Entegrasyon ayarları",
  "line-inventory": "Hat envanteri",
};
const IGNORED_FIELDS = new Set(["updatedAt", "lastActivity", "stageTransitionToken", "lastUsedAt", "useCount", "lastLoginAt", "lastDeliveryAt", "lastStatus", "lastError", "successCount", "failureCount"]);
const SECRET_FIELDS = /passwordHash|secret|token|values|apiKey|password/i;

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  actorId: string;
  via: "kullanıcı" | "webhook" | "sistem";
  action: "create" | "update" | "delete";
  kind: string;
  kindLabel: string;
  entityId: string;
  title: string;
  changes: { field: string; from: unknown; to: unknown }[];
}

function short(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "string") return value.length > 300 ? `${value.slice(0, 297)}…` : value;
  const json = JSON.stringify(value);
  return json && json.length > 300 ? `${json.slice(0, 297)}…` : value;
}

export function diffRecords(old: any, next: any): AuditEntry["changes"] {
  const keys = new Set([...Object.keys(old || {}), ...Object.keys(next || {})]);
  const changes: AuditEntry["changes"] = [];
  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue;
    if (JSON.stringify(old?.[key]) === JSON.stringify(next?.[key])) continue;
    const secret = SECRET_FIELDS.test(key);
    changes.push({ field: key, from: secret ? "••••" : short(old?.[key]), to: secret ? "••••" : short(next?.[key]) });
    if (changes.length >= 30) break;
  }
  return changes;
}

function actor(): Pick<AuditEntry, "actor" | "actorId" | "via"> {
  const hook = currentInboundHookId();
  if (hook) return { actor: `Webhook (${hook})`, actorId: `hook:${hook}`, via: "webhook" };
  const auth = currentPermissionContext()?.auth;
  if (auth)
    return { actor: auth.displayName || auth.user.name || auth.user.email || "Kullanıcı", actorId: auth.user.openId, via: "kullanıcı" };
  return { actor: "Sistem", actorId: "system", via: "sistem" };
}

const titleOf = (p: any) => String(p?.name || p?.title || p?.dealTitle || p?.email || p?.id || "").slice(0, 200);

export function auditStore(base: Store): Store {
  const record = async (owner: string, kind: string, id: string, old: any, next: any, action: AuditEntry["action"]) => {
    const changes = action === "update" ? diffRecords(old, next) : [];
    if (action === "update" && !changes.length) return;
    const entry: AuditEntry = {
      id: `aud_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
      at: new Date().toISOString(),
      ...actor(),
      action,
      kind,
      kindLabel: AUDITED[kind],
      entityId: id,
      title: titleOf(next || old),
      changes,
    };
    await base.put(AUDIT_KIND, entry.id, entry, owner);
    if (kind === "lead" && next && (!old || old.stage !== next.stage || (old.pipelineId || "sales") !== (next.pipelineId || "sales")))
      await base.put(
        STAGE_KIND,
        entry.id.replace("aud_", "stg_"),
        { id: entry.id.replace("aud_", "stg_"), leadId: id, from: old?.stage || null, to: next.stage, pipelineId: next.pipelineId || "sales", at: entry.at, actor: entry.actor, value: Number(next.value) || 0 },
        owner,
      );
  };
  return new Proxy(base, {
    get(target, key) {
      if (key === "put" || key === "insertIfAbsent")
        return async (kind: string, id: string, payload: any, owner: string) => {
          if (!AUDITED[kind]) return key === "put" ? target.put(kind, id, payload, owner) : target.insertIfAbsent(kind, id, payload, owner);
          const old = (await target.get<any>(kind, id, owner))?.payload;
          const result: any = key === "put" ? await target.put(kind, id, payload, owner) : await target.insertIfAbsent(kind, id, payload, owner);
          if (key === "insertIfAbsent" && !result?.inserted) return result;
          await record(owner, kind, id, old, payload, old ? "update" : "create").catch((e) =>
            console.warn("Denetim kaydı yazılamadı:", e?.message || e),
          );
          return result;
        };
      if (key === "delete")
        return async (kind: string, id: string, owner: string) => {
          const old = AUDITED[kind] ? (await target.get<any>(kind, id, owner))?.payload : undefined;
          await target.delete(kind, id, owner);
          if (old) await record(owner, kind, id, old, null, "delete").catch(() => undefined);
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function registerAuditRoutes(app: Express, store: Store) {
  const raw = rawStoreOf(store);
  app.get("/api/audit", async (req: Request, res) => {
    const auth = (req as Request & { auth: AuthContext }).auth;
    const full = auth.isOwner || (canAccess(auth, "access", "read") && auth.permissions?.access.scope === "all");
    const entityId = typeof req.query.entityId === "string" ? req.query.entityId : "";
    if (!full && !entityId)
      return res.status(403).json({ error: "FORBIDDEN", message: "Tüm denetim günlüğünü yalnız yöneticiler görebilir." });
    if (!full && entityId && !(await store.get("lead", entityId, auth.ownerOpenId)))
      return res.status(404).json({ error: "NOT_FOUND", message: "Kayıt bulunamadı." });
    const kind = typeof req.query.kind === "string" ? req.query.kind : "";
    const q = typeof req.query.q === "string" ? req.query.q.toLocaleLowerCase("tr-TR") : "";
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const entries = (await raw.list<AuditEntry>(AUDIT_KIND, auth.ownerOpenId))
      .map((r) => r.payload)
      .filter((e) => (!entityId || e.entityId === entityId) && (!kind || e.kind === kind))
      .filter((e) => !q || `${e.actor} ${e.title} ${e.kindLabel}`.toLocaleLowerCase("tr-TR").includes(q))
      .sort((a, b) => b.at.localeCompare(a.at));
    res.json({ total: entries.length, entries: entries.slice(0, limit), kinds: AUDITED });
  });
}
