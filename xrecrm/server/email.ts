// E-posta entegrasyonu: her kullanıcı KENDİ posta kutusunu (Gmail, Outlook veya herhangi bir
// IMAP+SMTP sağlayıcı; uygulama şifresiyle) bağlar, müşteri kartından e-posta gönderir ve
// müşterinin yanıtları kartın zaman akışına düşer.
//
// Güvenlik kuralları:
// - Şifre AES-256-GCM ile şifreli saklanır (integration-settings ile aynı anahtar); tarayıcıya
//   hiçbir uçtan dönmez, günlüğe yazılmaz.
// - Sunucu adları doğrulanır: özel/yerel ağ adresleri ve posta dışı portlar reddedilir (SSRF).
//   Bağlantı, doğrulanan IP adresine sabitlenir (DNS yeniden bağlama saldırısına karşı).
// - Tüm kayıtlar çalışma alanı sahibine göre ayrılır; posta kutusu kullanıcıya özeldir.
// - Gelen kutusundan yalnız göndereni bir müşteri/kişi e-postasıyla eşleşen iletiler alınır;
//   diğer özel yazışmaların gövdesi sunucuya hiç indirilmez.
import crypto from "node:crypto";
import net from "node:net";
import { lookup } from "node:dns/promises";
import type { Express, Request, Response } from "express";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { Store } from "./db.js";
import type { AuthContext, Lead } from "./types.js";
import { canAccess, rawStoreOf } from "./access.js";
import { decryptValue, encryptValue } from "./integration-settings.js";
import { isPrivateIp } from "./security.js";
import { listWorkspaces, workspaceState } from "./workspaces.js";
import {
  EMAIL_PRESETS,
  IMAP_PORTS,
  SMTP_PORTS,
  type EmailAccountInfo,
  type EmailMessage,
  type EmailProvider,
  type EmailStatus,
} from "../shared/email.js";

export const EMAIL_ACCOUNT_KIND = "email-account";
export const EMAIL_MESSAGE_KIND = "email-message";
export const EMAIL_SYNC_KIND = "email-sync";

const MAX_TEXT = 100_000; // saklanan düz metin üst sınırı (karakter)
const MAX_SOURCE_BYTES = 2 * 1024 * 1024; // bir iletiden indirilen en fazla ham veri
const MAX_BODY_INPUT = 50_000; // gönderilen ileti metni üst sınırı
const FIRST_SYNC_DAYS = 7; // ilk eşitlemede geriye bakılan gün
const MAX_ENVELOPES = 500; // bir turda bakılan en fazla ileti başlığı
const MAX_DOWNLOADS = 100; // bir turda indirilen en fazla eşleşen ileti

/** Depoda duran hesap kaydı. `email` alanı adrestir (denetim günlüğü başlığı için bu adla). */
export interface StoredEmailAccount {
  id: string; // kullanıcının openId'si
  userOpenId: string;
  provider: EmailProvider;
  email: string;
  displayName: string;
  username: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  /** Şifreli: iv.tag.ciphertext (base64url). Düz şifre hiçbir yerde saklanmaz. */
  passwordEnc: string;
  connectedAt: string;
}

interface SyncState {
  id: string;
  uidValidity?: string;
  lastUid?: number;
  lastSyncAt?: string;
  lastError?: string | null;
  failures?: number;
  nextAttemptAt?: number;
}

/** Bağlantı için çözülmüş ayarlar (şifre düz metin; yalnız bellekte, kısa süreli). */
export interface MailboxConfig {
  address: string;
  displayName: string;
  username: string;
  password: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
}

export interface FetchOptions {
  sinceDays: number;
  maxEnvelopes: number;
  maxMessages: number;
  maxBytes: number;
  /** Gönderen adresi bir müşteriyle eşleşiyor mu? Yalnız eşleşenlerin gövdesi indirilir. */
  wanted: (from: string) => boolean;
}
export interface FetchResult {
  uidValidity: string;
  lastUid: number;
  messages: { uid: number; source: Buffer }[];
}

export interface EmailTransports {
  verifySmtp(cfg: MailboxConfig): Promise<void>;
  verifyImap(cfg: MailboxConfig): Promise<void>;
  send(cfg: MailboxConfig, mail: OutgoingMail): Promise<{ messageId: string }>;
  fetchNew(cfg: MailboxConfig, state: { uidValidity?: string; lastUid?: number }, options: FetchOptions): Promise<FetchResult>;
}

export class EmailError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
    public code = "EMAIL_INVALID",
  ) {
    super(message);
  }
}
const fail = (message: string, status = 400, code = "EMAIL_INVALID"): never => {
  throw new EmailError(message, status, code);
};

// ---------------------------------------------------------------------------
// Doğrulama
// ---------------------------------------------------------------------------

const ADDRESS_RE = /^[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f\u2028\u2029]/;
const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home.arpa", ".intranet", ".corp"];

export const normalizeAddress = (value: unknown) => String(value ?? "").trim().toLowerCase();

/** Geçerli tek bir e-posta adresi mi? (CR/LF, boşluk, virgül, köşeli ayraç içeremez.) */
export function isValidAddress(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && ADDRESS_RE.test(value);
}

/** Başlık enjeksiyonu: satır sonu veya denetim karakteri içeren değer başlığa yazılamaz. */
export function assertHeaderSafe(value: string, label: string): string {
  if (CONTROL_RE.test(value)) fail(`${label} satır sonu veya denetim karakteri içeremez.`, 400, "HEADER_INJECTION");
  return value;
}

/** Sunucu adının biçimini denetler (ağ erişimi yapmaz). Özel ağ adresleri ve IP yazımı reddedilir. */
export function checkHostSyntax(raw: unknown, label: string): string {
  const host = String(raw ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!host) fail(`${label} gerekli.`);
  const bare = host.replace(/^\[|\]$/g, "");
  if (net.isIP(bare))
    fail(
      isPrivateIp(bare)
        ? `${label}: özel veya yerel ağ adresine bağlanılamaz.`
        : `${label}: IP adresi yerine sunucu adını yazın (örn. mail.firma.com).`,
      400,
      "HOST_BLOCKED",
    );
  if (host === "localhost" || host === "metadata.google.internal" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s)))
    fail(`${label}: özel veya yerel ağ adresine bağlanılamaz.`, 400, "HOST_BLOCKED");
  if (!HOST_RE.test(host)) fail(`${label} geçerli bir sunucu adı değil (örn. mail.firma.com).`);
  return host;
}

type DnsLookup = (host: string) => Promise<{ address: string; family: number }[]>;
const systemLookup: DnsLookup = (host) => lookup(host, { all: true, verbatim: true });
let dnsLookup: DnsLookup = systemLookup;
/** Testler için: DNS çözümlemesini değiştirir (null = sistem DNS'i). */
export const setEmailDnsLookup = (fn: DnsLookup | null) => void (dnsLookup = fn || systemLookup);

/**
 * Sunucu adını çözer ve bağlanılacak IP'yi döndürür. Adreslerden biri bile özel/yerel ağa
 * çıkıyorsa reddeder. Bağlantı bu IP'ye yapılır; TLS sertifikası yine sunucu adına göre doğrulanır.
 */
export async function resolvePublicHost(host: string): Promise<string> {
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dnsLookup(host);
  } catch {
    throw new EmailError(`"${host}" sunucu adı bulunamadı. Adresi kontrol edin.`, 400, "HOST_NOT_FOUND");
  }
  if (!addresses.length) fail(`"${host}" sunucu adı bulunamadı. Adresi kontrol edin.`, 400, "HOST_NOT_FOUND");
  if (addresses.some((entry) => !net.isIP(entry.address) || isPrivateIp(entry.address)))
    fail(`"${host}" özel veya yerel bir ağ adresine çıkıyor; bağlanılamaz.`, 400, "HOST_BLOCKED");
  return (addresses.find((entry) => entry.family === 4) || addresses[0]).address;
}

export interface MailboxInput extends MailboxConfig {
  provider: EmailProvider;
}

/** Bağlantı formunu doğrular; Gmail/Outlook için sunucu ayarları ön ayardan gelir (elle değiştirilemez). */
export function validateMailboxInput(body: any): MailboxInput {
  if (!body || typeof body !== "object") fail("Posta kutusu bilgileri gerekli.");
  const provider: EmailProvider = ["gmail", "outlook", "other"].includes(body.provider) ? body.provider : fail("Sağlayıcı seçin: Gmail, Outlook veya Diğer.");
  const address = normalizeAddress(body.address);
  if (!isValidAddress(address)) fail("Geçerli bir e-posta adresi yazın (örn. ad@firma.com).");
  const displayName = String(body.displayName ?? "").trim();
  if (displayName.length > 100) fail("Görünen ad en fazla 100 karakter olabilir.");
  assertHeaderSafe(displayName, "Görünen ad");
  if (/[<>"\\]/.test(displayName)) fail('Görünen ad < > " \\ karakterlerini içeremez.');
  const username = String(body.username ?? "").trim() || address;
  if (username.length > 320 || CONTROL_RE.test(username) || /\s/.test(username)) fail("Kullanıcı adı geçersiz.");
  let password = typeof body.password === "string" ? body.password : "";
  // Google uygulama şifresini dörderli gruplar halinde gösterir; boşluklar şifrenin parçası değildir.
  if (provider === "gmail") password = password.replace(/\s+/g, "");
  if (!password) fail("Şifre (uygulama şifresi) gerekli.");
  if (password.length > 256 || CONTROL_RE.test(password)) fail("Şifre geçersiz karakter içeriyor veya çok uzun.");

  const preset = EMAIL_PRESETS.find((p) => p.id === provider)!;
  const manual = provider === "other";
  const smtpHost = checkHostSyntax(manual ? body.smtpHost : preset.smtpHost, "Gönderim (SMTP) sunucusu");
  const imapHost = checkHostSyntax(manual ? body.imapHost : preset.imapHost, "Gelen (IMAP) sunucusu");
  const smtpPort = manual ? Number(body.smtpPort) : preset.smtpPort;
  const imapPort = manual ? Number(body.imapPort) : preset.imapPort;
  if (!SMTP_PORTS.includes(smtpPort)) fail(`SMTP portu ${SMTP_PORTS.join(", ")} değerlerinden biri olmalı.`, 400, "PORT_BLOCKED");
  if (!IMAP_PORTS.includes(imapPort)) fail(`IMAP portu ${IMAP_PORTS.join(", ")} değerlerinden biri olmalı.`, 400, "PORT_BLOCKED");
  return { provider, address, displayName, username, password, smtpHost, smtpPort, imapHost, imapPort };
}

// ---------------------------------------------------------------------------
// Gerçek bağlantılar (nodemailer + imapflow). Testlerde setEmailTransports ile değiştirilir.
// ---------------------------------------------------------------------------

async function smtpTransport(cfg: MailboxConfig) {
  const ip = await resolvePublicHost(cfg.smtpHost);
  const secure = cfg.smtpPort === 465;
  return nodemailer.createTransport({
    host: ip,
    port: cfg.smtpPort,
    secure,
    // 587/25: şifre yalnız STARTTLS kurulduktan sonra gönderilir.
    requireTLS: !secure,
    auth: { user: cfg.username, pass: cfg.password },
    tls: { servername: cfg.smtpHost },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    logger: false,
  });
}

async function imapClient(cfg: MailboxConfig) {
  const ip = await resolvePublicHost(cfg.imapHost);
  const secure = cfg.imapPort === 993;
  const client = new ImapFlow({
    host: ip,
    port: cfg.imapPort,
    secure,
    servername: cfg.imapHost,
    // 143: STARTTLS zorunlu; şifre açık metin olarak gönderilmez.
    ...(secure ? {} : { doSTARTTLS: true }),
    auth: { user: cfg.username, pass: cfg.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  } as ConstructorParameters<typeof ImapFlow>[0]);
  // Bağlantı kopması gibi olaylar süreci düşürmesin.
  client.on("error", () => undefined);
  return client;
}

const realTransports: EmailTransports = {
  async verifySmtp(cfg) {
    const transport = await smtpTransport(cfg);
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
  },
  async verifyImap(cfg) {
    const client = await imapClient(cfg);
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX", { readOnly: true });
      lock.release();
    } finally {
      await client.logout().catch(() => undefined);
    }
  },
  async send(cfg, mail) {
    const transport = await smtpTransport(cfg);
    try {
      const info = await transport.sendMail({
        from: cfg.displayName ? { name: cfg.displayName, address: cfg.address } : cfg.address,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}),
        ...(mail.references?.length ? { references: mail.references } : {}),
        // Dosya/URL içeriği ileti alanlarından okunamaz.
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      return { messageId: String(info.messageId || "") };
    } finally {
      transport.close();
    }
  },
  async fetchNew(cfg, state, options) {
    const client = await imapClient(cfg);
    try {
      await client.connect();
      // Salt okunur: iletiler "okundu" olarak işaretlenmez, kutuda hiçbir şey değişmez.
      const lock = await client.getMailboxLock("INBOX", { readOnly: true });
      try {
        const box = client.mailbox as any;
        const uidValidity = String(box?.uidValidity ?? "");
        const uidNext = Number(box?.uidNext) || 1;
        const fresh = !state.lastUid || state.uidValidity !== uidValidity;
        const found = fresh
          ? await client.search({ since: new Date(Date.now() - options.sinceDays * 86_400_000) }, { uid: true })
          : await client.search({ uid: `${state.lastUid! + 1}:*` }, { uid: true });
        const uids = (Array.isArray(found) ? found : [])
          .filter((uid) => fresh || uid > state.lastUid!)
          .sort((a, b) => a - b)
          .slice(0, options.maxEnvelopes);
        if (!uids.length) return { uidValidity, lastUid: fresh ? Math.max(0, uidNext - 1) : state.lastUid!, messages: [] };
        // Önce yalnız başlıklar: müşteriyle eşleşmeyen iletilerin gövdesi hiç indirilmez.
        const wantedUids: number[] = [];
        for await (const item of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
          const from = normalizeAddress(item.envelope?.from?.[0]?.address);
          if (from && options.wanted(from)) wantedUids.push(item.uid);
        }
        wantedUids.sort((a, b) => a - b);
        const batch = wantedUids.slice(0, options.maxMessages);
        const messages: FetchResult["messages"] = [];
        for (const uid of batch) {
          const item = await client.fetchOne(String(uid), { uid: true, source: { maxLength: options.maxBytes } }, { uid: true });
          if (item && item.source) messages.push({ uid, source: item.source });
        }
        // Eşleşen ileti sınırı aşıldıysa kalanlar sonraki turda alınır.
        const lastUid = wantedUids.length > batch.length ? batch[batch.length - 1] : uids[uids.length - 1];
        return { uidValidity, lastUid, messages };
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
  },
};

let overrides: Partial<EmailTransports> | null = null;
/** Testler için: gerçek SMTP/IMAP yerine verilen işlevler çağrılır (null = gerçek bağlantı). */
export const setEmailTransports = (value: Partial<EmailTransports> | null) => void (overrides = value);

function transports(): EmailTransports {
  const blocked = async (): Promise<never> => {
    throw new Error("Test ortamında gerçek posta sunucusuna bağlanılmaz.");
  };
  // Test ortamında yanlışlıkla gerçek ağ bağlantısı açılmasın.
  const base: EmailTransports =
    process.env.NODE_ENV === "test" ? { verifySmtp: blocked, verifyImap: blocked, send: blocked, fetchNew: blocked } : realTransports;
  return { ...base, ...(overrides || {}) };
}

/** Sağlayıcı hatasını kullanıcının anlayacağı Türkçe iletiye çevirir (ham yanıt/şifre içermez). */
export function describeMailError(error: unknown, cfg: Pick<MailboxConfig, "smtpHost" | "imapHost">, stage: "smtp" | "imap" | "send"): EmailError {
  if (error instanceof EmailError) return error;
  const e = (error || {}) as Record<string, any>;
  const code = String(e.code || "");
  const text = `${e.message || ""} ${e.response || ""} ${e.responseText || ""}`.toLowerCase();
  const host = stage === "imap" ? cfg.imapHost : cfg.smtpHost;
  const service = stage === "imap" ? "Gelen kutusu (IMAP)" : "Gönderim (SMTP)";
  const authFailed =
    code === "EAUTH" || e.authenticationFailed === true || e.responseCode === 535 || e.responseCode === 534 || /authenticationfailed|invalid credentials|username and password not accepted|auth.*fail|login.*fail|basicauthblocked/.test(text);
  if (authFailed) {
    if (/gmail\.com$|googlemail\.com$/.test(host))
      return new EmailError(
        "Gmail girişi kabul etmedi. Gmail için normal şifreniz değil, 16 haneli uygulama şifresi gerekir (önce 2 adımlı doğrulamayı açın).",
        400,
        "AUTH_FAILED",
      );
    if (/office365\.com$|outlook\.com$|live\.com$|hotmail\.com$/.test(host))
      return new EmailError(
        "Outlook / Microsoft 365 girişi kabul etmedi. Uygulama şifresi gerekir; ayrıca Microsoft birçok hesapta şifreyle IMAP/SMTP girişini kapatmıştır — kurumunuzun yöneticisinden \"SMTP AUTH\" ve IMAP izni isteyin.",
        400,
        "AUTH_FAILED",
      );
    return new EmailError(`${service} girişi kabul edilmedi. Kullanıcı adını ve şifreyi (varsa uygulama şifresini) kontrol edin.`, 400, "AUTH_FAILED");
  }
  if (["ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ESOCKET", "ECONNECTION", "ETIMEOUT", "NoConnection", "EDNS"].includes(code) || /timeout|timed out|greeting never received/.test(text))
    return new EmailError(`${service} sunucusuna ulaşılamadı (${host}). Sunucu adını ve portu kontrol edin; sorun sürerse sistem yöneticinize haber verin.`, 502, "CONNECT_FAILED");
  if (/certificate|self.signed|tls|ssl/.test(text) || /^(CERT_|DEPTH_|UNABLE_TO_|ERR_TLS|ESTARTTLS)/.test(code))
    return new EmailError(`${service} sunucusuyla güvenli bağlantı kurulamadı (${host}). Port ve güvenlik ayarını kontrol edin.`, 502, "TLS_FAILED");
  if (stage === "send") {
    if (e.responseCode === 550 || e.responseCode === 553 || /recipient|mailbox unavailable|user unknown/.test(text))
      return new EmailError("Alıcı adresi sunucu tarafından kabul edilmedi. Müşterinin e-posta adresini kontrol edin.", 400, "RECIPIENT_REJECTED");
    return new EmailError("E-posta gönderilemedi. Posta kutusu bağlantınızı Profilim sayfasından test edin.", 502, "SEND_FAILED");
  }
  return new EmailError(`${service} bağlantısı kurulamadı (${host}). Ayarları kontrol edip yeniden deneyin.`, 502, "CONNECT_FAILED");
}

// ---------------------------------------------------------------------------
// İleti ayrıştırma
// ---------------------------------------------------------------------------

/** HTML'den düz metin çıkarır (etiketler, betik ve stil blokları atılır; uzak içerik yüklenmez). */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|title|svg|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const cleanId = (value: unknown) => String(value ?? "").replace(/[\s\u0000-\u001f]+/g, "").slice(0, 500);
const cleanLine = (value: unknown, max: number) => String(value ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim().slice(0, max);

export interface ParsedMail {
  from: string;
  fromName: string;
  to: string;
  subject: string;
  text: string;
  truncated: boolean;
  attachments: string[];
  messageId: string;
  inReplyTo: string;
  references: string[];
  date: string;
}

/** Ham iletiyi (RFC 822) ayrıştırır. Ek içerikleri saklanmaz; yalnız adları alınır. */
export async function parseIncoming(source: Buffer): Promise<ParsedMail> {
  const mail = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true, skipHtmlToText: true });
  const sender = mail.from?.value?.[0];
  const toField = Array.isArray(mail.to) ? mail.to[0] : mail.to;
  // Düz metin bölümü yoksa HTML kendi sade ayıklayıcımızla metne çevrilir (görsel/izleme adresleri atılır).
  let text = (mail.text || "").trim();
  if (!text && typeof mail.html === "string") text = htmlToText(mail.html);
  const truncated = text.length > MAX_TEXT || source.length >= MAX_SOURCE_BYTES;
  const parsedDate = mail.date instanceof Date && !Number.isNaN(mail.date.getTime()) ? mail.date.getTime() : Date.now();
  const references = (Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : []).map(cleanId).filter(Boolean).slice(-20);
  return {
    from: normalizeAddress(sender?.address),
    fromName: cleanLine(sender?.name, 200),
    to: normalizeAddress(toField?.value?.[0]?.address),
    subject: cleanLine(mail.subject, 500) || "(konu yok)",
    text: text.slice(0, MAX_TEXT),
    truncated,
    attachments: (mail.attachments || [])
      .filter((a) => a.contentDisposition === "attachment" || !a.related)
      .map((a) => cleanLine(a.filename, 200) || "adsız ek")
      .slice(0, 20),
    messageId: cleanId(mail.messageId) || `<${crypto.createHash("sha256").update(source).digest("hex").slice(0, 32)}@xre.yerel>`,
    inReplyTo: cleanId(mail.inReplyTo),
    references,
    // İleri tarihli (hatalı saatli) iletiler akışın tepesine yapışmasın.
    date: new Date(Math.min(parsedDate, Date.now())).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Depo yardımcıları
// ---------------------------------------------------------------------------

function configOf(account: StoredEmailAccount): MailboxConfig {
  return {
    address: account.email,
    displayName: account.displayName,
    username: account.username,
    password: decryptValue(account.passwordEnc),
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    imapHost: account.imapHost,
    imapPort: account.imapPort,
  };
}

function publicAccount(account: StoredEmailAccount): EmailAccountInfo {
  return {
    provider: account.provider,
    address: account.email,
    displayName: account.displayName,
    username: account.username,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    connectedAt: account.connectedAt,
  };
}

const messageRecordId = (messageId: string, leadId: string) => `em_${crypto.createHash("sha256").update(`${messageId}|${leadId}`).digest("hex").slice(0, 32)}`;

/** Sahibin müşteri ve kişi e-postalarından "adres → müşteri kimlikleri" eşlemesi. */
async function leadsByEmail(raw: Store, owner: string): Promise<Map<string, string[]>> {
  const [leads, contacts] = await Promise.all([raw.list<Lead>("lead", owner), raw.list<{ id: string; email?: string }>("contacts", owner)]);
  const contactEmail = new Map<string, string>();
  for (const row of contacts) {
    const email = normalizeAddress(row.payload?.email);
    if (isValidAddress(email)) contactEmail.set(row.id, email);
  }
  const map = new Map<string, string[]>();
  const add = (email: string, leadId: string) => {
    const list = map.get(email) || [];
    if (!list.includes(leadId)) list.push(leadId);
    map.set(email, list);
  };
  for (const row of leads) {
    const email = normalizeAddress(row.payload?.email);
    if (isValidAddress(email)) add(email, row.id);
    const viaContact = row.payload?.contactId ? contactEmail.get(String(row.payload.contactId)) : undefined;
    if (viaContact) add(viaContact, row.id);
  }
  return map;
}

/** Müşterinin e-posta adresi; yoksa bağlı kişinin adresi. */
async function recipientOf(raw: Store, owner: string, lead: Lead): Promise<string> {
  const own = normalizeAddress(lead.email);
  if (isValidAddress(own)) return own;
  if (lead.contactId) {
    const contact = await raw.get<{ email?: string }>("contacts", String(lead.contactId), owner);
    const email = normalizeAddress(contact?.payload?.email);
    if (isValidAddress(email)) return email;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Gelen kutusu eşitleme
// ---------------------------------------------------------------------------

const pollSeconds = () => Math.max(60, Math.min(3600, Number(process.env.XRE_EMAIL_POLL_SECONDS) || 120));
const syncing = new Set<string>();

/**
 * Tek bir posta kutusunu eşitler: son görülen UID'den sonraki iletilerden, göndereni sahibin bir
 * müşterisi/kişisiyle eşleşenleri müşteri kartına yazar. Aynı ileti (Message-ID) iki kez yazılmaz.
 */
export async function syncMailbox(store: Store, owner: string, account: StoredEmailAccount): Promise<{ imported: number }> {
  const raw = rawStoreOf(store);
  const key = `${owner}:${account.id}`;
  if (syncing.has(key)) return { imported: 0 };
  syncing.add(key);
  const state: SyncState = (await raw.get<SyncState>(EMAIL_SYNC_KIND, account.id, owner))?.payload || { id: account.id };
  try {
    const byEmail = await leadsByEmail(raw, owner);
    const self = normalizeAddress(account.email);
    const wanted = (from: string) => from !== self && byEmail.has(normalizeAddress(from));
    const result = await transports().fetchNew(configOf(account), { uidValidity: state.uidValidity, lastUid: state.lastUid }, {
      sinceDays: FIRST_SYNC_DAYS,
      maxEnvelopes: MAX_ENVELOPES,
      maxMessages: MAX_DOWNLOADS,
      maxBytes: MAX_SOURCE_BYTES,
      wanted,
    });
    let imported = 0;
    for (const item of result.messages) {
      let mail: ParsedMail;
      try {
        mail = await parseIncoming(item.source.subarray(0, MAX_SOURCE_BYTES));
      } catch {
        continue; // bozuk ileti atlanır
      }
      // Başlıktaki gönderen, ayrıştırılan iletide de bir müşteriyle eşleşmeli.
      if (!mail.from || !wanted(mail.from)) continue;
      for (const leadId of (byEmail.get(mail.from) || []).slice(0, 5)) {
        const id = messageRecordId(mail.messageId, leadId);
        const record: EmailMessage = {
          id,
          leadId,
          userOpenId: account.userOpenId,
          direction: "inbound",
          from: mail.from,
          fromName: mail.fromName,
          to: mail.to || self,
          subject: mail.subject,
          text: mail.text,
          truncated: mail.truncated,
          attachments: mail.attachments,
          messageId: mail.messageId,
          inReplyTo: mail.inReplyTo,
          references: mail.references,
          createdAt: mail.date,
        };
        if ((await raw.insertIfAbsent(EMAIL_MESSAGE_KIND, id, record, owner)).inserted) imported += 1;
      }
    }
    await raw.put<SyncState>(
      EMAIL_SYNC_KIND,
      account.id,
      { id: account.id, uidValidity: result.uidValidity, lastUid: result.lastUid, lastSyncAt: new Date().toISOString(), lastError: null, failures: 0, nextAttemptAt: 0 },
      owner,
    );
    return { imported };
  } catch (error) {
    const failures = (state.failures || 0) + 1;
    // Üstel bekleme: 2, 4, 8 … dakika; en çok 1 saat.
    const wait = Math.min(3_600_000, pollSeconds() * 1000 * 2 ** Math.min(failures, 6));
    const described = describeMailError(error, account, "imap");
    await raw
      .put<SyncState>(EMAIL_SYNC_KIND, account.id, { ...state, id: account.id, lastError: described.message, failures, nextAttemptAt: Date.now() + wait }, owner)
      .catch(() => undefined);
    throw described;
  } finally {
    syncing.delete(key);
  }
}

/** Tüm çalışma alanlarındaki bağlı posta kutularını sırayla eşitler (bekleme süresi dolmayanlar atlanır). */
export async function pollAllMailboxes(store: Store): Promise<{ mailboxes: number; imported: number; failed: number }> {
  const raw = rawStoreOf(store);
  const owners = new Set<string>();
  const defaultOwner = await raw.resolveOwner().catch(() => undefined);
  if (defaultOwner) owners.add(defaultOwner);
  for (const ws of await listWorkspaces(store).catch(() => [])) {
    const { state } = workspaceState(ws);
    if (state === "trial" || state === "active") owners.add(ws.ownerOpenId);
  }
  const summary = { mailboxes: 0, imported: 0, failed: 0 };
  for (const owner of owners) {
    const accounts = await raw.list<StoredEmailAccount>(EMAIL_ACCOUNT_KIND, owner).catch(() => []);
    for (const row of accounts) {
      const state = (await raw.get<SyncState>(EMAIL_SYNC_KIND, row.id, owner))?.payload;
      if (state?.nextAttemptAt && state.nextAttemptAt > Date.now()) continue;
      summary.mailboxes += 1;
      try {
        summary.imported += (await syncMailbox(store, owner, row.payload)).imported;
      } catch {
        summary.failed += 1; // ayrıntı eşitleme durumuna yazıldı; şifre/ham yanıt günlüğe yazılmaz
      }
    }
  }
  return summary;
}

/**
 * Gelen kutusu yoklayıcısı. Test ortamında veya XRE_EMAIL_POLL=0 iken başlamaz.
 * Aynı anda tek tur çalışır; dönen işlev zamanlayıcıyı durdurur.
 */
export function startEmailPoller(store: Store): () => void {
  if (process.env.NODE_ENV === "test" || process.env.XRE_EMAIL_POLL?.trim() === "0") return () => undefined;
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await pollAllMailboxes(store);
    } catch (error) {
      console.warn("E-posta eşitleme turu tamamlanamadı:", (error as Error)?.message || "bilinmeyen hata");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), pollSeconds() * 1000);
  timer.unref();
  const first = setTimeout(() => void tick(), 20_000);
  first.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(first);
  };
}

// ---------------------------------------------------------------------------
// Hız sınırı (kullanıcı başına, bellekte)
// ---------------------------------------------------------------------------

const hits = new Map<string, number[]>();
function limited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((at) => now - at < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}
/** Testler için: hız sınırı sayaçlarını sıfırlar. */
export const resetEmailRateLimits = () => hits.clear();
const sendPerMinute = () => Math.max(1, Math.min(60, Number(process.env.XRE_EMAIL_SEND_PER_MINUTE) || 10));
const sendPerDay = () => Math.max(1, Math.min(2000, Number(process.env.XRE_EMAIL_SEND_PER_DAY) || 200));

// ---------------------------------------------------------------------------
// Uçlar
// ---------------------------------------------------------------------------

export function registerEmailRoutes(app: Express, store: Store) {
  const raw = rawStoreOf(store);
  const authOf = (req: Request) => (req as Request & { auth: AuthContext }).auth;
  const userKey = (auth: AuthContext) => `${auth.ownerOpenId}:${auth.user.openId}`;
  const accountOf = async (auth: AuthContext) => (await raw.get<StoredEmailAccount>(EMAIL_ACCOUNT_KIND, auth.user.openId, auth.ownerOpenId))?.payload || null;
  const statusOf = async (auth: AuthContext): Promise<EmailStatus> => {
    const account = await accountOf(auth);
    if (!account) return { connected: false, account: null, sync: null };
    const sync = (await raw.get<SyncState>(EMAIL_SYNC_KIND, account.id, auth.ownerOpenId))?.payload;
    return { connected: true, account: publicAccount(account), sync: { lastSyncAt: sync?.lastSyncAt || null, lastError: sync?.lastError || null } };
  };
  const handle = (fn: (req: Request, res: Response, auth: AuthContext) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      await fn(req, res, authOf(req));
    } catch (error) {
      const known = error instanceof EmailError;
      const status = known ? error.statusCode : Number((error as any)?.statusCode) || 500;
      // Bilinmeyen hataların ayrıntısı istemciye gönderilmez (sunucu yanıtı/kimlik bilgisi sızmasın).
      res.status(status).json({
        error: known ? error.code : "EMAIL_FAILED",
        message: known || status !== 500 ? (error as Error).message : "E-posta işlemi tamamlanamadı.",
      });
    }
  };
  /** İstek sahibinin görebildiği müşteri (rol kapsamı izin deposu üzerinden uygulanır). */
  const visibleLead = async (auth: AuthContext, leadId: unknown): Promise<Lead> => {
    const id = typeof leadId === "string" ? leadId.trim() : "";
    if (!id || id.length > 191) fail("Müşteri seçilmedi.");
    if (!canAccess(auth, "crm", "read")) fail("Müşteri kayıtlarını görme yetkiniz yok.", 403, "FORBIDDEN");
    const row = await store.get<Lead>("lead", id, auth.ownerOpenId);
    if (!row) fail("Müşteri bulunamadı.", 404, "NOT_FOUND");
    return row!.payload;
  };

  app.get(
    "/api/email/account",
    handle(async (_req, res, auth) => {
      res.json(await statusOf(auth));
    }),
  );

  // Kaydetmeden önce SMTP ve IMAP girişi gerçekten denenir; başarısızsa hiçbir şey saklanmaz.
  app.put(
    "/api/email/account",
    handle(async (req, res, auth) => {
      if (limited(`connect:${userKey(auth)}`, 6, 10 * 60_000)) fail("Çok fazla bağlantı denemesi. Birkaç dakika sonra tekrar deneyin.", 429, "RATE_LIMITED");
      const input = validateMailboxInput(req.body);
      const t = transports();
      try {
        await t.verifySmtp(input);
      } catch (error) {
        throw describeMailError(error, input, "smtp");
      }
      try {
        await t.verifyImap(input);
      } catch (error) {
        throw describeMailError(error, input, "imap");
      }
      const previous = await accountOf(auth);
      const record: StoredEmailAccount = {
        id: auth.user.openId,
        userOpenId: auth.user.openId,
        provider: input.provider,
        email: input.address,
        displayName: input.displayName || auth.displayName || auth.user.name || "",
        username: input.username,
        smtpHost: input.smtpHost,
        smtpPort: input.smtpPort,
        imapHost: input.imapHost,
        imapPort: input.imapPort,
        passwordEnc: encryptValue(input.password),
        connectedAt: new Date().toISOString(),
      };
      // Denetim günlüğü: bu kayıt türü audit.ts içinde izlenir (şifre alanı maskelenir).
      await raw.put(EMAIL_ACCOUNT_KIND, record.id, record, auth.ownerOpenId);
      // Başka bir kutuya geçildiyse eski kutunun UID bilgisi geçersizdir.
      if (!previous || previous.email !== record.email || previous.imapHost !== record.imapHost)
        await raw.delete(EMAIL_SYNC_KIND, record.id, auth.ownerOpenId).catch(() => undefined);
      res.json({ ...(await statusOf(auth)), tested: { smtp: true, imap: true } });
    }),
  );

  app.delete(
    "/api/email/account",
    handle(async (_req, res, auth) => {
      // Bağlantı ve şifre silinir; müşteri kartlarındaki yazışma geçmişi CRM kaydı olarak kalır.
      await raw.delete(EMAIL_ACCOUNT_KIND, auth.user.openId, auth.ownerOpenId);
      await raw.delete(EMAIL_SYNC_KIND, auth.user.openId, auth.ownerOpenId).catch(() => undefined);
      res.json({ connected: false, account: null, sync: null } satisfies EmailStatus);
    }),
  );

  app.post(
    "/api/email/sync",
    handle(async (_req, res, auth) => {
      const account = await accountOf(auth);
      if (!account) fail("Önce posta kutunuzu bağlayın.", 409, "NOT_CONNECTED");
      if (limited(`sync:${userKey(auth)}`, 2, 60_000)) fail("Az önce eşitlendi. Bir dakika sonra tekrar deneyin.", 429, "RATE_LIMITED");
      const result = await syncMailbox(store, auth.ownerOpenId, account!);
      res.json({ ok: true, imported: result.imported });
    }),
  );

  app.get(
    "/api/email/messages",
    handle(async (req, res, auth) => {
      const lead = await visibleLead(auth, req.query.leadId);
      const messages = (await raw.list<EmailMessage>(EMAIL_MESSAGE_KIND, auth.ownerOpenId))
        .map((row) => row.payload)
        .filter((m) => m.leadId === lead.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 200);
      res.json({ messages });
    }),
  );

  app.post(
    "/api/email/send",
    handle(async (req, res, auth) => {
      const lead = await visibleLead(auth, req.body?.leadId);
      if (!canAccess(auth, "crm", "write")) fail("E-posta göndermek için müşteri kayıtlarında yazma yetkisi gerekir.", 403, "FORBIDDEN");
      const account = await accountOf(auth);
      if (!account) fail("Önce Profilim sayfasından posta kutunuzu bağlayın.", 409, "NOT_CONNECTED");
      const subject = typeof req.body?.subject === "string" ? req.body.subject : "";
      assertHeaderSafe(subject, "Konu");
      if (!subject.trim()) fail("Konu gerekli.");
      if (subject.length > 300) fail("Konu en fazla 300 karakter olabilir.");
      const text = typeof req.body?.text === "string" ? req.body.text.replace(/\r\n?/g, "\n").trim() : "";
      if (!text) fail("İleti metni gerekli.");
      if (text.length > MAX_BODY_INPUT) fail("İleti metni çok uzun.");
      // Alıcı istemciden alınmaz: her zaman müşterinin (veya bağlı kişinin) kayıtlı adresidir.
      const to = await recipientOf(raw, auth.ownerOpenId, lead);
      if (!to) fail("Bu müşterinin geçerli bir e-posta adresi yok.", 400, "NO_RECIPIENT");

      let inReplyTo = "";
      let references: string[] = [];
      if (req.body?.replyToId) {
        const original = (await raw.get<EmailMessage>(EMAIL_MESSAGE_KIND, String(req.body.replyToId).slice(0, 191), auth.ownerOpenId))?.payload;
        if (!original || original.leadId !== lead.id) fail("Yanıtlanacak ileti bulunamadı.", 404, "NOT_FOUND");
        inReplyTo = assertHeaderSafe(original!.messageId, "İleti kimliği");
        references = [...(original!.references || []), original!.messageId].filter((r) => r && !CONTROL_RE.test(r)).slice(-20);
      }
      if (limited(`send-min:${userKey(auth)}`, sendPerMinute(), 60_000) || limited(`send-day:${userKey(auth)}`, sendPerDay(), 86_400_000))
        fail("Çok hızlı gönderim. Hesabınızın kısıtlanmaması için biraz bekleyip tekrar deneyin.", 429, "RATE_LIMITED");

      let sent: { messageId: string };
      try {
        sent = await transports().send(configOf(account!), { to, subject: subject.trim(), text, ...(inReplyTo ? { inReplyTo, references } : {}) });
      } catch (error) {
        throw describeMailError(error, account!, "send");
      }
      const messageId = cleanId(sent.messageId) || `<${crypto.randomUUID()}@xre.yerel>`;
      const record: EmailMessage = {
        id: messageRecordId(messageId, lead.id),
        leadId: lead.id,
        userOpenId: auth.user.openId,
        direction: "outbound",
        from: account!.email,
        fromName: account!.displayName,
        to,
        subject: subject.trim(),
        text,
        truncated: false,
        attachments: [],
        messageId,
        inReplyTo,
        references,
        createdAt: new Date().toISOString(),
      };
      await raw.put(EMAIL_MESSAGE_KIND, record.id, record, auth.ownerOpenId);
      res.status(201).json({ message: record });
    }),
  );
}
