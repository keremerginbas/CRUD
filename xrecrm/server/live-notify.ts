// Kayıt yazımlarından canlı bildirim üretir (yeni gelen mesaj, cevapsız arama,
// kişiye atanan görev). Bildirimler açık oturumlara /api/pbx/stream ile gider.
import crypto from "node:crypto";
import type { Store } from "./db.js";
import type { Lead } from "./types.js";
import { pushNotice } from "./pbx.js";

const WATCHED = new Set(["message", "call", "tasks"]);

export function liveNotifyStore(base: Store): Store {
  const leadName = async (owner: string, leadId?: string | null) =>
    leadId ? (await base.get<Lead>("lead", leadId, owner))?.payload?.name || "" : "";
  const notify = async (kind: string, old: any, next: any, owner: string) => {
    const at = new Date().toISOString();
    if (kind === "message" && !old && (next.direction === "inbound" || next.direction === "in")) {
      const name = (await leadName(owner, next.leadId)) || "Yeni kişi";
      pushNotice(
        { id: crypto.randomUUID(), kind: "message", title: `${name} mesaj gönderdi`, body: String(next.text || "").slice(0, 140), leadId: next.leadId, at },
        { module: "whatsapp" },
      );
    }
    if (kind === "call" && next.status === "missed" && old?.status !== "missed") {
      const name = (await leadName(owner, next.leadId)) || (next.phone ? `+${next.phone}` : "Bilinmeyen numara");
      pushNotice(
        { id: crypto.randomUUID(), kind: "missed-call", title: `Cevapsız arama · ${name}`, body: "Geri aramayı unutmayın.", leadId: next.leadId, at },
        { module: "calls" },
      );
    }
    if (kind === "tasks" && next.assignee && next.status !== "done" && (!old || old.assignee !== next.assignee)) {
      const name = await leadName(owner, next.leadId);
      pushNotice(
        { id: crypto.randomUUID(), kind: "task", title: `Size görev atandı: ${next.title}`, body: [name, next.dueAt ? `Son tarih ${new Date(next.dueAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}` : ""].filter(Boolean).join(" · "), leadId: next.leadId || null, at },
        { module: "tasks", assigneeName: next.assignee },
      );
    }
  };
  return new Proxy(base, {
    get(target, key) {
      if (key === "put" || key === "insertIfAbsent")
        return async (kind: string, id: string, payload: any, owner: string) => {
          if (!WATCHED.has(kind)) return key === "put" ? target.put(kind, id, payload, owner) : target.insertIfAbsent(kind, id, payload, owner);
          const old = (await target.get<any>(kind, id, owner))?.payload;
          const result: any = key === "put" ? await target.put(kind, id, payload, owner) : await target.insertIfAbsent(kind, id, payload, owner);
          if (key === "insertIfAbsent" && !result?.inserted) return result;
          await notify(kind, old, payload, owner).catch(() => undefined);
          return result;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
