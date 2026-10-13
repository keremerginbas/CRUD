export type AppointmentLead = {
  id: string;
  stage: string;
  pipelineId?: string;
  appointmentAt?: string;
  name?: string;
  owner?: string;
  [key: string]: unknown;
};
export function appointmentStage(
  lead: Pick<AppointmentLead, "stage" | "pipelineId">,
  pipelines: { id: string; stages: { id: string; label: string }[] }[] = [],
): boolean {
  const label =
    pipelines
      .find((p) => p.id === (lead.pipelineId || "sales"))
      ?.stages.find((s) => s.id === lead.stage)?.label || "";
  return lead.stage === "qualified" || /randevu|appointment/i.test(label);
}
export function appointmentIso(day: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time))
    throw new Error("Randevu için tarih ve saat seçmelisiniz.");
  const raw = `${day}T${time}:00+03:00`;
  const d = new Date(raw);
  if (
    !Number.isFinite(d.getTime()) ||
    appointmentParts(d.toISOString()).day !== day ||
    appointmentParts(d.toISOString()).time !== time
  )
    throw new Error("Geçerli randevu tarih ve saati gerekli.");
  return d.toISOString();
}
export function appointmentParts(iso?: string): { day: string; time: string } {
  if (!iso || !Number.isFinite(Date.parse(iso))) return { day: "", time: "" };
  const tr = new Date(Date.parse(iso) + 10800000).toISOString();
  return { day: tr.slice(0, 10), time: tr.slice(11, 16) };
}
export function validateAppointment(iso?: string, now = Date.now()) {
  if (
    !iso ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
      iso,
    ) ||
    !Number.isFinite(Date.parse(iso))
  )
    throw new Error("Randevu aşamasına geçmek için tarih ve saat zorunludur.");
  if (Date.parse(iso) <= now)
    throw new Error("Randevu tarih ve saati gelecekte olmalıdır.");
  return iso;
}
