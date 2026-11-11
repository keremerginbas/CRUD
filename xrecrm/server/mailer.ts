// E-posta gönderimi (SMTP). Ayarlar .env'den okunur:
//   SMTP_HOST, SMTP_PORT (465 = SSL, 587 = STARTTLS), SMTP_USER, SMTP_PASS, SMTP_FROM
// Ayarlar yoksa e-posta gönderilmez; çağıran taraf mailConfigured() ile kontrol eder.
import nodemailer from "nodemailer";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
type Sender = (mail: Mail) => Promise<void>;

let override: Sender | null = null;
/** Testler için: gerçek SMTP yerine verilen işlev çağrılır (null = eski hali). */
export const setMailSender = (fn: Sender | null) => void (override = fn);

const env = (k: string) => process.env[k]?.trim() || "";
export const mailConfigured = () => Boolean(override || (env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASS")));
export const mailFrom = () => env("SMTP_FROM") || env("SMTP_USER");

let cached: { key: string; transport: nodemailer.Transporter } | null = null;
function transport() {
  const port = Number(env("SMTP_PORT")) || 465;
  const key = [env("SMTP_HOST"), port, env("SMTP_USER"), env("SMTP_PASS")].join("|");
  if (cached?.key !== key)
    cached = {
      key,
      transport: nodemailer.createTransport({
        host: env("SMTP_HOST"),
        port,
        secure: port === 465,
        auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS") },
        connectionTimeout: 15_000,
        socketTimeout: 20_000,
      }),
    };
  return cached.transport;
}

export async function sendMail(mail: Mail): Promise<void> {
  if (override) return override(mail);
  if (!mailConfigured()) throw new Error("E-posta gönderimi yapılandırılmamış (SMTP_HOST, SMTP_USER, SMTP_PASS).");
  const from = mailFrom();
  await transport().sendMail({ from: from.includes("<") ? from : `XRE CRM <${from}>`, ...mail });
}
