import { 
  int, 
  mysqlEnum, 
  mysqlTable, 
  text, 
  timestamp, 
  varchar,
  decimal,
  boolean,
  json,
  longtext,
  datetime,
  tinyint
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", "sales_manager", "sales_rep", "accountant", "call_center"]).default("user").notNull(),
  phone: varchar("phone", { length: 20 }),
  department: varchar("department", { length: 100 }),
  avatarUrl: text("avatarUrl"),
  passwordHash: varchar("passwordHash", { length: 255 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Kullanıcı Tercihleri - bildirim, çalışma durumu, tema, yoğunluk
 * DB tablosu: user_preferences (sütunlar snake_case)
 */
export const userPreferences = mysqlTable("user_preferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  notifyLead: boolean("notify_lead").default(true).notNull(),
  notifyAppointment: boolean("notify_appointment").default(true).notNull(),
  notifyEmail: boolean("notify_email").default(false).notNull(),
  workStatus: varchar("work_status", { length: 30 }).default("active").notNull(),
  themeChoice: varchar("theme_choice", { length: 30 }).default("system").notNull(),
  densityChoice: varchar("density_choice", { length: 30 }).default("comfortable").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type UserPreference = typeof userPreferences.$inferSelect;
export type InsertUserPreference = typeof userPreferences.$inferInsert;

/**
 * Pipeline statüsü tablosu - Hukuk, Auto, Topraktan, Ankaport vb.
 */
export const statuses = mysqlTable("statuses", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  displayName: varchar("displayName", { length: 100 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 7 }).default("#3b82f6").notNull(), // Hex color
  order: int("order").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Status = typeof statuses.$inferSelect;
export type InsertStatus = typeof statuses.$inferInsert;

/**
 * Lead/Müşteri tablosu
 */
export const leads = mysqlTable("leads", {
  id: int("id").autoincrement().primaryKey(),
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }).notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }),
  projectName: varchar("projectName", { length: 200 }),
  city: varchar("city", { length: 100 }),
  source: varchar("source", { length: 100 }), // WhatsApp, Form, Call, Manual, vb.
  notes: longtext("notes"),
  statusId: int("statusId").notNull(),
  assignedToId: int("assignedToId"), // Satış temsilcisinin user ID'si
  priority: mysqlEnum("priority", ["low", "medium", "high", "urgent"]).default("medium").notNull(),
  lastContactDate: datetime("lastContactDate"),
  nextFollowUpDate: datetime("nextFollowUpDate"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

/**
 * Aktivite/Etkinlik tablosu - notlar, görevler, hatırlatıcılar
 */
export const activities = mysqlTable("activities", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId").notNull(),
  type: mysqlEnum("type", ["note", "task", "call", "email", "meeting", "whatsapp", "sms", "form_submission"]).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: longtext("description"),
  status: mysqlEnum("status", ["pending", "completed", "cancelled"]).default("pending").notNull(),
  dueDate: datetime("dueDate"),
  reminderDate: datetime("reminderDate"),
  assignedToId: int("assignedToId"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Activity = typeof activities.$inferSelect;
export type InsertActivity = typeof activities.$inferInsert;

/**
 * İletişim Geçmişi - WhatsApp, SMS, E-posta, Telefon
 */
export const communications = mysqlTable("communications", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId").notNull(),
  type: mysqlEnum("type", ["whatsapp", "sms", "email", "phone", "video_call"]).notNull(),
  direction: mysqlEnum("direction", ["inbound", "outbound"]).notNull(),
  subject: varchar("subject", { length: 255 }),
  message: longtext("message"),
  senderPhone: varchar("senderPhone", { length: 20 }),
  recipientPhone: varchar("recipientPhone", { length: 20 }),
  senderEmail: varchar("senderEmail", { length: 320 }),
  recipientEmail: varchar("recipientEmail", { length: 320 }),
  externalId: varchar("externalId", { length: 255 }), // WhatCRM, NetGSM vb. harici ID
  status: mysqlEnum("status", ["sent", "delivered", "read", "failed", "pending"]).default("pending").notNull(),
  metadata: json("metadata"), // API response veya ek bilgiler
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Communication = typeof communications.$inferSelect;
export type InsertCommunication = typeof communications.$inferInsert;

/**
 * Randevu/Görüşme tablosu
 */
export const meetings = mysqlTable("meetings", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: longtext("description"),
  startTime: datetime("startTime").notNull(),
  endTime: datetime("endTime"),
  meetingLink: varchar("meetingLink", { length: 500 }), // Microsoft Meet, Teams linki
  meetingType: mysqlEnum("meetingType", ["video", "phone", "in_person"]).default("video").notNull(),
  participants: json("participants"), // JSON array of participant objects
  recordingUrl: varchar("recordingUrl", { length: 500 }),
  notes: longtext("notes"),
  organizerId: int("organizerId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Meeting = typeof meetings.$inferSelect;
export type InsertMeeting = typeof meetings.$inferInsert;

/**
 * Form Şablonları
 */
export const formTemplates = mysqlTable("formTemplates", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  fields: json("fields").notNull(), // JSON array of form fields
  embedCode: longtext("embedCode"), // HTML embed kodu
  successMessage: text("successMessage"),
  redirectUrl: varchar("redirectUrl", { length: 500 }),
  createdBy: int("createdBy").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FormTemplate = typeof formTemplates.$inferSelect;
export type InsertFormTemplate = typeof formTemplates.$inferInsert;

/**
 * Form Gönderileri - formdan gelen lead'ler
 */
export const formSubmissions = mysqlTable("formSubmissions", {
  id: int("id").autoincrement().primaryKey(),
  formTemplateId: int("formTemplateId").notNull(),
  leadId: int("leadId"), // Eğer mevcut lead ile eşleştirilmişse
  formData: json("formData").notNull(), // Gönderilen form verileri
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type FormSubmission = typeof formSubmissions.$inferSelect;
export type InsertFormSubmission = typeof formSubmissions.$inferInsert;

/**
 * Webhook Konfigürasyonu
 */
export const webhooks = mysqlTable("webhooks", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  url: varchar("url", { length: 500 }).notNull(),
  events: json("events").notNull(), // JSON array of event types
  secret: varchar("secret", { length: 255 }).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Webhook = typeof webhooks.$inferSelect;
export type InsertWebhook = typeof webhooks.$inferInsert;

/**
 * Webhook Logları
 */
export const webhookLogs = mysqlTable("webhookLogs", {
  id: int("id").autoincrement().primaryKey(),
  webhookId: int("webhookId").notNull(),
  event: varchar("event", { length: 100 }).notNull(),
  payload: json("payload").notNull(),
  response: json("response"),
  statusCode: int("statusCode"),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WebhookLog = typeof webhookLogs.$inferSelect;
export type InsertWebhookLog = typeof webhookLogs.$inferInsert;

/**
 * Atama Kuralları - otomatik lead atama
 */
export const assignmentRules = mysqlTable("assignmentRules", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  conditions: json("conditions").notNull(), // JSON array of conditions
  assignToId: int("assignToId").notNull(), // Atanacak user
  priority: int("priority").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AssignmentRule = typeof assignmentRules.$inferSelect;
export type InsertAssignmentRule = typeof assignmentRules.$inferInsert;

/**
 * Bildirim Tercihler
 */
export const notificationPreferences = mysqlTable("notificationPreferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  newLeadEmail: boolean("newLeadEmail").default(true).notNull(),
  newLeadInApp: boolean("newLeadInApp").default(true).notNull(),
  newLeadSMS: boolean("newLeadSMS").default(false).notNull(),
  statusChangeEmail: boolean("statusChangeEmail").default(true).notNull(),
  statusChangeInApp: boolean("statusChangeInApp").default(true).notNull(),
  taskReminderEmail: boolean("taskReminderEmail").default(true).notNull(),
  taskReminderInApp: boolean("taskReminderInApp").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference = typeof notificationPreferences.$inferInsert;

/**
 * Ses Transkripsiyon Kayıtları
 */
export const transcriptions = mysqlTable("transcriptions", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId").notNull(),
  meetingId: int("meetingId"),
  audioUrl: varchar("audioUrl", { length: 500 }).notNull(),
  audioFileKey: varchar("audioFileKey", { length: 255 }), // S3 storage key
  transcriptText: longtext("transcriptText"),
  summary: longtext("summary"), // LLM ile oluşturulan özet
  suggestedStatus: varchar("suggestedStatus", { length: 100 }), // Önerilen statü
  language: varchar("language", { length: 10 }).default("tr").notNull(),
  duration: int("duration"), // Saniye cinsinden
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Transcription = typeof transcriptions.$inferSelect;
export type InsertTranscription = typeof transcriptions.$inferInsert;

/**
 * Retell AI Arama Kayıtları
 */
export const aiCalls = mysqlTable("aiCalls", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId").notNull(),
  phoneNumber: varchar("phoneNumber", { length: 20 }).notNull(),
  externalCallId: varchar("externalCallId", { length: 255 }), // Retell API call ID
  status: mysqlEnum("status", ["pending", "ringing", "connected", "completed", "failed"]).default("pending").notNull(),
  duration: int("duration"), // Saniye cinsinden
  recordingUrl: varchar("recordingUrl", { length: 500 }),
  transcriptText: longtext("transcriptText"),
  summary: longtext("summary"),
  suggestedStatus: varchar("suggestedStatus", { length: 100 }),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AICall = typeof aiCalls.$inferSelect;
export type InsertAICall = typeof aiCalls.$inferInsert;

/**
 * Raporlama ve Analytics
 */
export const analytics = mysqlTable("analytics", {
  id: int("id").autoincrement().primaryKey(),
  date: datetime("date").notNull(),
  userId: int("userId"),
  source: varchar("source", { length: 100 }),
  statusId: int("statusId"),
  leadsCreated: int("leadsCreated").default(0).notNull(),
  leadsConverted: int("leadsConverted").default(0).notNull(),
  communicationsSent: int("communicationsSent").default(0).notNull(),
  meetingsScheduled: int("meetingsScheduled").default(0).notNull(),
  tasksCompleted: int("tasksCompleted").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Analytics = typeof analytics.$inferSelect;
export type InsertAnalytics = typeof analytics.$inferInsert;

/**
 * Entegrasyon Kimlik Bilgileri (API Keys, Tokens)
 */
export const integrations = mysqlTable("integrations", {
  id: int("id").autoincrement().primaryKey(),
  type: mysqlEnum("type", ["whatcrm", "netgsm", "ercell", "microsoft_graph", "retell", "zapier", "email"]).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  apiKey: varchar("apiKey", { length: 500 }).notNull(),
  apiSecret: varchar("apiSecret", { length: 500 }),
  apiUrl: varchar("apiUrl", { length: 500 }),
  metadata: json("metadata"),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Integration = typeof integrations.$inferSelect;
export type InsertIntegration = typeof integrations.$inferInsert;

/**
 * Denetim Izi - Sistem aktiviteleri
 */
export const auditLogs = mysqlTable("auditLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entityType", { length: 100 }).notNull(),
  entityId: int("entityId"),
  changes: json("changes"), // Değişiklik detayları
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;