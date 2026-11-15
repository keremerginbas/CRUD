// Tarayıcı telefonu (webphone): sunucu ve istemcinin ortak kullandığı saf yardımcılar.

export interface WebphoneIceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface WebphoneConfig {
  enabled: boolean;
  /** enabled=false iken neden: santral ayarı mı eksik, kişisel SIP bilgisi mi. */
  reason?: "not-configured" | "no-credentials";
  wssUrl?: string;
  domain?: string;
  extension?: string;
  authUser?: string;
  password?: string;
  displayName?: string;
  dialPrefix?: string;
  iceServers?: WebphoneIceServer[];
  /** Santral CDR'yi kendisi yazıyorsa tarayıcı arama kaydı göndermez. */
  serverLogsCalls?: boolean;
}

/**
 * Kullanıcının yazdığı numarayı santralin çevireceği biçime getirir.
 * 2-6 haneli dahililer ve *kodlar olduğu gibi kalır; +90/90 ile başlayan
 * Türkiye numaraları 0'lı yerel biçime döner; ön ek yalnız dış numaralara eklenir.
 */
export function sipDialNumber(raw: string, prefix = ""): string {
  const text = String(raw ?? "").trim();
  if (/^[*#][\d*#]{1,15}$/.test(text)) return text;
  let digits = text.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length <= 6) return digits;
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (text.startsWith("+")) {
    /* uluslararası biçim; aşağıda 90 kontrolü yapılır */
  } else if (digits.length === 10 && digits.startsWith("5")) digits = `90${digits}`;
  else if (digits.startsWith("0") && digits.length === 11) digits = `90${digits.slice(1)}`;
  const local = digits.startsWith("90") && digits.length === 12 ? `0${digits.slice(2)}` : digits;
  return `${prefix}${local}`;
}

/** Arama hedefinin SIP adresi. Geçersiz numarada boş döner. */
export function sipTargetUri(raw: string, domain: string, prefix = ""): string {
  const number = sipDialNumber(raw, prefix);
  if (!number || !domain) return "";
  return `sip:${number.replace(/#/g, "%23")}@${domain}`;
}

/** Gelen aramadaki SIP kullanıcı adından karşılaştırılabilir numara çıkarır (905xxxxxxxxx). */
export function comparablePhone(raw: string): string {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = `90${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("5")) digits = `90${digits}`;
  return digits;
}

export function formatCallDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
