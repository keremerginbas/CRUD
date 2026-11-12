// E-posta entegrasyonu: sunucu ve arayüzün ortak kullandığı türler ve sağlayıcı ön ayarları.

export type EmailProvider = "gmail" | "outlook" | "other";

export interface EmailPreset {
  id: EmailProvider;
  label: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
}

export const EMAIL_PRESETS: EmailPreset[] = [
  { id: "gmail", label: "Gmail", smtpHost: "smtp.gmail.com", smtpPort: 465, imapHost: "imap.gmail.com", imapPort: 993 },
  { id: "outlook", label: "Outlook / Microsoft 365", smtpHost: "smtp.office365.com", smtpPort: 587, imapHost: "outlook.office365.com", imapPort: 993 },
  { id: "other", label: "Diğer", smtpHost: "", smtpPort: 465, imapHost: "", imapPort: 993 },
];

/** İzin verilen posta portları (başka porta bağlantı kurulmaz). */
export const SMTP_PORTS = [465, 587, 25];
export const IMAP_PORTS = [993, 143];

/** Tarayıcıya dönen hesap özeti; şifre hiçbir biçimde yer almaz. */
export interface EmailAccountInfo {
  provider: EmailProvider;
  address: string;
  displayName: string;
  username: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  connectedAt: string;
}

export interface EmailStatus {
  connected: boolean;
  account: EmailAccountInfo | null;
  sync: { lastSyncAt: string | null; lastError: string | null } | null;
}

export interface EmailMessage {
  id: string;
  leadId: string;
  /** Posta kutusunun sahibi olan kullanıcı. */
  userOpenId: string;
  direction: "inbound" | "outbound";
  from: string;
  fromName: string;
  to: string;
  subject: string;
  /** Düz metin; uzaktan HTML hiçbir zaman saklanmaz/gösterilmez. */
  text: string;
  truncated: boolean;
  /** Yalnız ek adları; ekler indirilmez. */
  attachments: string[];
  messageId: string;
  inReplyTo: string;
  references: string[];
  createdAt: string;
}

/** "Re: Re: Konu" birikmesini önleyerek yanıt konusu üretir. */
export function replySubject(subject: string): string {
  const clean = subject.trim() || "(konu yok)";
  return /^(re|ynt|yan[ıi]t)\s*:/i.test(clean) ? clean : `Re: ${clean}`;
}

export function emailSnippet(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
