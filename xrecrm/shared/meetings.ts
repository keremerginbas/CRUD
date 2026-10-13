import { z } from "zod";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MANUAL_MEETING_URL_RE = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

function validCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validTurkeyTime(value: string): boolean {
  return TIME_RE.test(value);
}

const attendeeEmail = z
  .string()
  .trim()
  .max(320)
  .email("Geçerli bir katılımcı e-postası gerekli.")
  .transform((value) => value.toLocaleLowerCase("en-US"));

/**
 * The public meeting request is deliberately strict: unknown keys must not be
 * accepted from the browser. Turkey uses UTC+03:00 year round for this CRM.
 */
export const MeetingInputSchema = z
  .object({
    requestId: z.string().uuid(),
    leadId: z.string().trim().min(1).max(191),
    title: z.string().trim().min(1).max(300),
    date: z
      .string()
      .regex(DATE_RE, "Tarih YYYY-AA-GG biçiminde olmalı.")
      .refine(validCalendarDate, "Geçerli bir takvim günü gerekli."),
    time: z
      .string()
      .regex(TIME_RE, "Saat Türkiye saatiyle SS:DD biçiminde olmalı.")
      .refine(validTurkeyTime, "Geçerli bir Türkiye saati gerekli."),
    durationMinutes: z.number().int().min(15).max(240),
    assignee: z.string().trim().max(191),
    attendees: z.array(attendeeEmail).max(100),
    description: z.string().max(10000),
    sendInvites: z.boolean().default(false),
    provider: z.enum(["google", "manual"]),
    meetingUrl: z.string().trim().max(2048).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.provider === "manual") {
      if (!value.meetingUrl) {
        context.addIssue({
          code: "custom",
          path: ["meetingUrl"],
          message: "Manuel toplantı için Google Meet bağlantısı gerekli.",
        });
      } else if (!MANUAL_MEETING_URL_RE.test(value.meetingUrl)) {
        context.addIssue({
          code: "custom",
          path: ["meetingUrl"],
          message: "Manuel bağlantı geçerli Google Meet biçiminde olmalı.",
        });
      }
    } else if (value.meetingUrl !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["meetingUrl"],
        message: "Google toplantısının bağlantısı sağlayıcıdan alınmalı.",
      });
    }
  });

export type MeetingInput = z.infer<typeof MeetingInputSchema>;

export const manualMeetingUrlPattern = MANUAL_MEETING_URL_RE;

/** Convert a CRM date/time pair to an RFC3339 instant in Turkey (UTC+03:00). */
export function meetingStartIso(date: string, time: string): string {
  if (!validCalendarDate(date) || !validTurkeyTime(time))
    throw new Error("Geçersiz Türkiye tarihi veya saati.");
  return new Date(`${date}T${time}:00+03:00`).toISOString();
}

export function meetingEndIso(
  date: string,
  time: string,
  durationMinutes: number,
): string {
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240)
    throw new Error("Geçersiz toplantı süresi.");
  return new Date(
    Date.parse(meetingStartIso(date, time)) + durationMinutes * 60_000,
  ).toISOString();
}

export function isMeetingInFuture(startIso: string, now = Date.now()): boolean {
  const start = Date.parse(startIso);
  return Number.isFinite(start) && start > now;
}

export function assertMeetingInFuture(startIso: string, now = Date.now()): void {
  if (!isMeetingInFuture(startIso, now))
    throw new Error("Toplantı başlangıcı gelecekte olmalı.");
}
