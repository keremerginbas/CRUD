import { it, expect } from "vitest";
import {
  StagePolicySchema,
  validateStagePolicy,
  missingStageFields,
} from "../shared/crm-stage-policy";
import { stagePolicyStore } from "../server/crm-stage-policy";
import { appointmentStore } from "../server/appointments";
import { createMemoryStore } from "../server/db";
const stamp = "2026-10-13T08:00:00Z";
const pipeline = {
  id: "sales",
  name: "Satış",
  requiredFieldsByStage: { contacted: ["phone", "city"] as const },
  stages: [{ id: "contacted", label: "İlk görüşme" }],
};
it("seyrek aşama politikası kabul edilir; bilinmeyen alan ve tekrar reddedilir", () => {
  expect(StagePolicySchema.parse({ contacted: ["phone"] })).toEqual({
    contacted: ["phone"],
  });
  expect(() => StagePolicySchema.parse({ contacted: ["token"] })).toThrow();
  expect(() =>
    StagePolicySchema.parse({ contacted: ["phone", "phone"] }),
  ).toThrow();
});
it("zorunlu alanlar kullanıcıya açıklanır; başka huni ve boş politikada blok olmaz", () => {
  const p = {
    ...pipeline,
    requiredFieldsByStage: {
      contacted: ["phone", "city"] as ("phone" | "city")[],
    },
  };
  expect(
    missingStageFields({ stage: "contacted", phone: "  ", city: "" }, [p]),
  ).toEqual(["phone", "city"]);
  expect(() =>
    validateStagePolicy({ stage: "contacted", phone: "", city: "Ankara" }, [p]),
  ).toThrow("Telefon");
  expect(() =>
    validateStagePolicy({ stage: "contacted", pipelineId: "rent" }, [p]),
  ).not.toThrow();
});
it("sunucu politikası randevu yan etkisinden önce doğrular ve diğer kayıtları korur", async () => {
  const raw = createMemoryStore();
  await raw.put(
    "pipelines",
    "sales",
    {
      ...pipeline,
      requiredFieldsByStage: { qualified: ["phone"] },
      stages: [{ id: "qualified", label: "Randevu" }],
    },
    "o",
  );
  const store = stagePolicyStore(appointmentStore(raw));
  await expect(
    store.put(
      "lead",
      "l",
      {
        id: "l",
        stage: "qualified",
        phone: "",
        appointmentAt: "2099-10-13T09:00:00Z",
        createdAt: stamp,
      },
      "o",
    ),
  ).rejects.toThrow("Telefon");
  expect(await raw.get("lead", "l", "o")).toBeNull();
  expect(await raw.list("activities", "o")).toHaveLength(0);
  await store.put(
    "lead",
    "l",
    {
      id: "l",
      stage: "qualified",
      phone: "+905550000000",
      appointmentAt: "2099-10-13T09:00:00Z",
      createdAt: stamp,
    },
    "o",
  );
  expect(await raw.get("lead", "l", "o")).not.toBeNull();
  expect(await raw.list("activities", "o")).toHaveLength(1);
});
