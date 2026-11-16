import crypto from "node:crypto";
import type { Store } from "./db.js";
import {
  StagePolicySchema,
  validateStagePolicy,
} from "../shared/crm-stage-policy.js";
/** Trusted write boundary shared by request handlers, incoming webhooks and workers. */
export function stagePolicyStore(base: Store): Store {
  return new Proxy(base, {
    get(target, key) {
      if (key === "put" || key === "insertIfAbsent")
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
            validateStagePolicy(payload, pipelines);
            const old = (await target.get<any>("lead", id, owner))?.payload;
            const changed =
              !old ||
              old.stage !== payload.stage ||
              (old.pipelineId || "sales") !== (payload.pipelineId || "sales");
            // Ignore any client-supplied transition token. Edits within an entry preserve it.
            payload = {
              ...payload,
              stageTransitionToken: changed
                ? crypto.randomUUID()
                : old.stageTransitionToken || crypto.randomUUID(),
            };
          }
          if (
            kind === "pipelines" &&
            payload.requiredFieldsByStage !== undefined
          )
            StagePolicySchema.parse(payload.requiredFieldsByStage);
          // Hunide içinde müşteri olan bir aşama kaldırılamaz: o müşteriler hiçbir sütunda görünmez olurdu.
          if (kind === "pipelines" && Array.isArray(payload.stages)) {
            const kept = new Set(payload.stages.map((stage: { id?: string }) => stage?.id));
            const stranded = (await target.list<any>("lead", owner)).filter(
              (row) => (row.payload?.pipelineId || "sales") === id && !kept.has(row.payload?.stage),
            ).length;
            if (stranded)
              throw Object.assign(new Error(`Kaldırılan aşamada ${stranded} müşteri var. Önce onları başka bir aşamaya taşıyın.`), { statusCode: 409 });
          }
          return key === "insertIfAbsent"
            ? target.insertIfAbsent(kind, id, payload, owner)
            : target.put(kind, id, payload, owner);
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
