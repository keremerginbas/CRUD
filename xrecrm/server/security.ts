import crypto from "node:crypto";
import net from "node:net";
import { lookup } from "node:dns/promises";

export class OutboundSecurityError extends Error {
  statusCode = 400;
}

function isPrivateIp(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      parts[0] >= 224
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) return true;
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("::ffff:127.")
    );
  }
  return false;
}

export async function assertSafeOutboundUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundSecurityError("Dış istek URLsi geçersiz.");
  }
  if (url.protocol !== "https:")
    throw new OutboundSecurityError("Dış istekler yalnızca HTTPS olabilir.");
  if (url.username || url.password)
    throw new OutboundSecurityError("Dış istek URLsi kimlik bilgisi içeremez.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal"
  )
    throw new OutboundSecurityError("Özel ağ adresine istek engellendi.");
  if (isPrivateIp(host))
    throw new OutboundSecurityError("Özel ağ adresine istek engellendi.");
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (
      !addresses.length ||
      addresses.some((entry) => isPrivateIp(entry.address))
    )
      throw new OutboundSecurityError("Özel ağ adresine istek engellendi.");
  } catch (error) {
    if (error instanceof OutboundSecurityError) throw error;
    throw new OutboundSecurityError("Dış istek hedefi çözümlenemedi.");
  }
  return url;
}

export async function fetchWithTimeout(
  rawUrl: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  const url = await assertSafeOutboundUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function readJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 4000) };
  }
  if (!response.ok) {
    const error = new Error(
      body?.error?.message ||
        body?.message ||
        `Dış servis HTTP ${response.status}`,
    ) as Error & {
      statusCode?: number;
      providerStatus?: number;
      body?: unknown;
    };
    error.statusCode = 502;
    error.providerStatus = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export function timingSafeEqualText(
  a: string | undefined,
  b: string | undefined,
): boolean {
  if (!a || !b) return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function verifyHmac(
  raw: Buffer,
  secret: string | undefined,
  signature: string | undefined,
  prefix = "sha256=",
): boolean {
  if (!secret || !signature || !signature.startsWith(prefix)) return false;
  const expected =
    prefix + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return timingSafeEqualText(expected, signature);
}

export function bearerMatches(
  header: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !header) return false;
  const value = header.replace(/^Bearer\s+/i, "").trim();
  return (
    timingSafeEqualText(value, secret) ||
    timingSafeEqualText(header.trim(), secret)
  );
}

export function signedOutboundHeaders(
  body: string,
  secret: string,
): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-xre-timestamp": timestamp,
    "x-xre-signature": `sha256=${signature}`,
  };
}

export function normalizePhone(raw: unknown): string {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11)
    digits = `90${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("5")) digits = `90${digits}`;
  return digits;
}

export function envConfigured(...names: string[]): boolean {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}
