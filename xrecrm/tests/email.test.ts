import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createSessionToken } from "../server/auth";
import { resetSignupAttempts, workspaceBySlug } from "../server/workspaces";
import {
  EMAIL_ACCOUNT_KIND,
  EMAIL_MESSAGE_KIND,
  EmailError,
  checkHostSyntax,
  describeMailError,
  htmlToText,
  parseIncoming,
  pollAllMailboxes,
  resetEmailRateLimits,
  resolvePublicHost,
  setEmailDnsLookup,
  setEmailTransports,
  startEmailPoller,
  validateMailboxInput,
  type FetchOptions,
  type MailboxConfig,
  type OutgoingMail,
  type StoredEmailAccount,
} from "../server/email";
import { decryptValue } from "../server/integration-settings";
import { replySubject } from "../shared/email";

// Bu dosyadaki tüm değerler sahtedir; gerçek ağ bağlantısı açılmaz (taşıyıcılar taklit edilir).
const PASSWORD = "test-parola-123";
const savedEnv = { ...process.env };
const servers: http.Server[] = [];

interface Fake {
  verified: MailboxConfig[];
  sent: { cfg: MailboxConfig; mail: OutgoingMail }[];
  inbox: { uid: number; source: Buffer }[];
  fetches: { lastUid?: number }[];
  fetchError: unknown;
}
let fake: Fake;

function rawMail(o: { from: string; to?: string; subject?: string; id?: string; text?: string; html?: string; extra?: string }): Buffer {
  const lines = [
    `From: ${o.from}`,
    `To: ${o.to || "satis@example.test"}`,
    `Subject: ${o.subject || "Teklif hakkında"}`,
    `Message-ID: ${o.id || "<m1@example.test>"}`,
    "Date: Mon, 02 Nov 2026 10:00:00 +0300",
    "MIME-Version: 1.0",
    ...(o.extra ? [o.extra] : []),
    `Content-Type: ${o.html ? "text/html" : "text/plain"}; charset=utf-8`,
    "",
    o.html || o.text || "Merhaba, teklifinizi aldım.",
  ];
  return Buffer.from(lines.join("\r\n"), "utf8");
}

beforeEach(() => {
  for (const key of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "MANUS_OAUTH_PORTAL_URL", "XRE_SIGNUP", "XRE_SIGNUP_VERIFY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "XRE_EMAIL_SEND_PER_MINUTE", "XRE_EMAIL_POLL"])
    delete process.env[key];
  process.env.XRE_SESSION_SECRET = "email-test-secret-0123456789abcdef";
  process.env.XRE_SIGNUP = "1";
  resetSignupAttempts();
  resetEmailRateLimits();
  fake = { verified: [], sent: [], inbox: [], fetches: [], fetchError: null };
  setEmailTransports({
    verifySmtp: async (cfg) => {
      if (cfg.password !== PASSWORD) throw Object.assign(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"), { code: "EAUTH", responseCode: 535 });
      fake.verified.push(cfg);
    },
    verifyImap: async () => undefined,
    send: async (cfg, mail) => {
      fake.sent.push({ cfg, mail });
      return { messageId: `<gonderilen-${fake.sent.length}@example.test>` };
    },
    fetchNew: async (_cfg, state, options: FetchOptions) => {
      if (fake.fetchError) throw fake.fetchError;
      fake.fetches.push({ lastUid: state.lastUid });
      const fresh = fake.inbox.filter((m) => m.uid > (state.lastUid || 0));
      // Gerçek taşıyıcı gibi: yalnız göndereni istenen iletilerin gövdesi döner.
      const messages = fresh.filter((m) => {
        const from = /^From: .*?<?([^\s<>]+@[^\s<>]+)>?\r$/m.exec(m.source.toString("utf8"))?.[1] || "";
        return options.wanted(from.toLowerCase());
      });
      return { uidValidity: "1", lastUid: Math.max(state.lastUid || 0, ...fake.inbox.map((m) => m.uid)), messages };
    },
  });
  // DNS de taklit edilir: sistem çözümleyicisine istek gitmez.
  setEmailDnsLookup(async () => [{ address: "203.0.113.10", family: 4 }]);
});
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  setEmailTransports(null);
  setEmailDnsLookup(null);
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

async function start() {
  const store = createMemoryStore();
  const server = http.createServer(createApp({ store }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, path: string, cookie?: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const cookieOf = (res: Response) => (res.headers.get("set-cookie") || "").split(";")[0];
  const setup = await call("POST", "/api/auth/setup", undefined, { name: "Sistem Sahibi", email: "sahip@example.test", password: "Yonetici123" });
  expect(setup.status).toBe(201);
  const owner = cookieOf(setup);
  const ownerId = (await store.resolveOwner())!;
  return { store, call, cookieOf, owner, ownerId };
}
const lead = (id: string, name: string, email: string, extra: Record<string, unknown> = {}) => ({ lead: { id, name, phone: "+905550000001", email, ...extra } });
const gmail = { provider: "gmail", address: "satis@example.test", displayName: "Satış Ekibi", password: PASSWORD };

describe("E-posta: doğrulama", () => {
  it("özel ağ adreslerini, IP yazımını ve posta dışı portları reddeder", () => {
    const other = { provider: "other", address: "ben@example.test", password: PASSWORD, smtpHost: "mail.example.test", smtpPort: 465, imapHost: "mail.example.test", imapPort: 993 };
    expect(validateMailboxInput(other)).toMatchObject({ smtpHost: "mail.example.test", smtpPort: 465, imapPort: 993, username: "ben@example.test" });
    for (const host of ["127.0.0.1", "10.0.0.5", "192.168.1.10", "169.254.169.254", "localhost", "[::1]", "posta.local", "db.internal", "metadata.google.internal", "8.8.8.8", "tekkelime", "a b.example.test", "mail.example.test:25", "http://mail.example.test"])
      expect(() => validateMailboxInput({ ...other, smtpHost: host }), host).toThrow(EmailError);
    for (const host of ["127.0.0.1", "172.16.4.4", "fd00::1"]) expect(() => validateMailboxInput({ ...other, imapHost: host }), host).toThrow(EmailError);
    for (const port of [22, 80, 443, 3306, 6379, 993, 0, "abc"]) expect(() => validateMailboxInput({ ...other, smtpPort: port }), String(port)).toThrow(/SMTP portu/);
    for (const port of [22, 110, 465, 8080]) expect(() => validateMailboxInput({ ...other, imapPort: port }), String(port)).toThrow(/IMAP portu/);
    expect(() => checkHostSyntax("169.254.169.254", "Sunucu")).toThrow(/özel veya yerel/);
  });

  it("hazır sağlayıcılarda sunucu ayarı istemciden alınmaz", () => {
    const g = validateMailboxInput({ ...gmail, smtpHost: "127.0.0.1", smtpPort: 22, imapHost: "evil.example.test", password: "abcd efgh ijkl mnop" });
    expect(g).toMatchObject({ smtpHost: "smtp.gmail.com", smtpPort: 465, imapHost: "imap.gmail.com", imapPort: 993, password: "abcdefghijklmnop" });
    expect(validateMailboxInput({ ...gmail, provider: "outlook" })).toMatchObject({ smtpHost: "smtp.office365.com", smtpPort: 587, imapHost: "outlook.office365.com", imapPort: 993 });
  });

  it("adres, görünen ad ve şifrede satır sonu/enjeksiyon kabul etmez", () => {
    for (const address of ["", "adres-degil", "a@b", "a@example.test\r\nBcc: x@example.test", "a@example.test, b@example.test", "A <a@example.test>"])
      expect(() => validateMailboxInput({ ...gmail, address }), address).toThrow(EmailError);
    expect(() => validateMailboxInput({ ...gmail, displayName: "Satış\r\nBcc: x@example.test" })).toThrow(/satır sonu/);
    expect(() => validateMailboxInput({ ...gmail, displayName: 'Ad" <x@example.test>' })).toThrow(EmailError);
    expect(() => validateMailboxInput({ ...gmail, password: "" })).toThrow(/Şifre/);
    expect(() => validateMailboxInput({ ...gmail, provider: "yahoo" })).toThrow(EmailError);
  });

  it("DNS özel ağa çıkıyorsa bağlantıyı reddeder, açık adreste IP'yi sabitler", async () => {
    setEmailDnsLookup(async () => [{ address: "203.0.113.10", family: 4 }, { address: "10.0.0.7", family: 4 }]);
    await expect(resolvePublicHost("mail.example.test")).rejects.toThrow(/özel veya yerel/);
    setEmailDnsLookup(async () => [{ address: "::ffff:127.0.0.1", family: 6 }]);
    await expect(resolvePublicHost("mail.example.test")).rejects.toThrow(EmailError);
    setEmailDnsLookup(async () => [{ address: "2001:db8::1", family: 6 }, { address: "203.0.113.10", family: 4 }]);
    expect(await resolvePublicHost("mail.example.test")).toBe("203.0.113.10");
    setEmailDnsLookup(async () => {
      throw new Error("ENOTFOUND");
    });
    await expect(resolvePublicHost("yok.example.test")).rejects.toThrow(/bulunamadı/);
  });

  it("sağlayıcı hatalarını anlaşılır Türkçe iletiye çevirir", () => {
    const hosts = { smtpHost: "smtp.gmail.com", imapHost: "imap.gmail.com" };
    expect(describeMailError({ code: "EAUTH", responseCode: 535 }, hosts, "smtp").message).toMatch(/Gmail.*uygulama şifresi gerekir/);
    expect(describeMailError({ authenticationFailed: true }, { smtpHost: "smtp.office365.com", imapHost: "outlook.office365.com" }, "imap").message).toMatch(/Outlook/);
    const timeout = describeMailError({ code: "ETIMEDOUT" }, { smtpHost: "mail.example.test", imapHost: "mail.example.test" }, "smtp");
    expect(timeout).toMatchObject({ statusCode: 502, code: "CONNECT_FAILED" });
    expect(replySubject("Teklif")).toBe("Re: Teklif");
    expect(replySubject("RE: Teklif")).toBe("RE: Teklif");
  });
});

describe("E-posta: ileti ayrıştırma", () => {
  it("HTML'den düz metin çıkarır; betik, stil ve uzak içerik saklanmaz", async () => {
    expect(htmlToText('<style>p{color:red}</style><p>Merhaba <b>Ayşe</b></p><script>alert(1)</script><img src="https://izleme.example.test/p.gif"><p>Fiyat &lt; 100 &amp; uygun</p>')).toBe("Merhaba Ayşe\nFiyat < 100 & uygun");
    const mail = await parseIncoming(rawMail({ from: "Ayşe Kaya <ayse@example.test>", html: '<html><body><p>Merhaba</p><script>kotu()</script><img src="https://izleme.example.test/p.gif"><p>Görüşelim</p></body></html>' }));
    expect(mail).toMatchObject({ from: "ayse@example.test", fromName: "Ayşe Kaya", subject: "Teklif hakkında", messageId: "<m1@example.test>" });
    expect(mail.text).toContain("Merhaba");
    expect(mail.text).toContain("Görüşelim");
    expect(mail.text).not.toMatch(/<|script|kotu|izleme/);
  });

  it("eklerin yalnız adını alır ve metni sınırlar", async () => {
    const source = Buffer.from(
      [
        "From: ayse@example.test",
        "To: satis@example.test",
        "Subject: Ekli",
        "Message-ID: <ek1@example.test>",
        "MIME-Version: 1.0",
        'Content-Type: multipart/mixed; boundary="sinir"',
        "",
        "--sinir",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Sözleşme ekte.",
        "--sinir",
        'Content-Type: application/pdf; name="sozlesme.pdf"',
        'Content-Disposition: attachment; filename="sozlesme.pdf"',
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from("gizli-ek-icerigi").toString("base64"),
        "--sinir--",
        "",
      ].join("\r\n"),
    );
    const mail = await parseIncoming(source);
    expect(mail.attachments).toEqual(["sozlesme.pdf"]);
    expect(JSON.stringify(mail)).not.toContain("gizli-ek-icerigi");
    const long = await parseIncoming(rawMail({ from: "ayse@example.test", text: "x".repeat(150_000) }));
    expect(long.text.length).toBe(100_000);
    expect(long.truncated).toBe(true);
  });
});

describe("E-posta: bağlantı, gönderim ve gelen iletiler", () => {
  it("bağlantıyı test eder, şifreyi şifreli saklar ve hiçbir yanıtta döndürmez", async () => {
    const { call, owner, ownerId, store } = await start();
    expect((await call("GET", "/api/email/account")).status).toBe(401);
    expect(await (await call("GET", "/api/email/account", owner)).json()).toEqual({ connected: false, account: null, sync: null });

    // Yanlış şifre: Gmail için uygulama şifresi uyarısı döner, hiçbir şey saklanmaz.
    const wrong = await call("PUT", "/api/email/account", owner, { ...gmail, password: "yanlis-parola" });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).message).toMatch(/Gmail için normal şifreniz değil, 16 haneli uygulama şifresi gerekir/);
    expect(await store.list(EMAIL_ACCOUNT_KIND, ownerId)).toHaveLength(0);
    // SSRF denemesi bağlantı kurulmadan reddedilir.
    const ssrf = await call("PUT", "/api/email/account", owner, { ...gmail, provider: "other", smtpHost: "169.254.169.254", smtpPort: 465, imapHost: "mail.example.test", imapPort: 993 });
    expect(ssrf.status).toBe(400);
    expect(fake.verified).toHaveLength(0);

    const saved = await call("PUT", "/api/email/account", owner, gmail);
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body).toMatchObject({ connected: true, tested: { smtp: true, imap: true }, account: { provider: "gmail", address: "satis@example.test", smtpHost: "smtp.gmail.com", smtpPort: 465, imapHost: "imap.gmail.com", imapPort: 993 } });
    expect(JSON.stringify(body)).not.toContain(PASSWORD);
    expect(JSON.stringify(body)).not.toMatch(/password/i);
    expect(fake.verified[0]).toMatchObject({ username: "satis@example.test", password: PASSWORD });

    // Depodaki kayıt düz şifreyi içermez; yalnız sunucu anahtarıyla çözülür.
    const rows = await store.list<StoredEmailAccount>(EMAIL_ACCOUNT_KIND, ownerId);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(PASSWORD);
    expect(decryptValue(rows[0].payload.passwordEnc)).toBe(PASSWORD);
    const status = await (await call("GET", "/api/email/account", owner)).text();
    expect(status).not.toContain(PASSWORD);
    expect(status).not.toContain(rows[0].payload.passwordEnc);
    // /api/state gibi genel uçlar da hesabı veya şifreyi taşımaz.
    expect(await (await call("GET", "/api/state", owner)).text()).not.toContain(rows[0].payload.passwordEnc);

    // Denetim günlüğü: bağlama ve ayırma kaydedilir, şifre görünmez.
    expect((await call("DELETE", "/api/email/account", owner)).status).toBe(200);
    expect(await store.list(EMAIL_ACCOUNT_KIND, ownerId)).toHaveLength(0);
    const audit = await (await call("GET", "/api/audit?kind=email-account", owner)).json();
    expect(audit.entries.map((e: any) => e.action).sort()).toEqual(["create", "delete"]);
    expect(audit.entries[0]).toMatchObject({ kindLabel: "E-posta hesabı", title: "satis@example.test" });
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
    expect(JSON.stringify(audit)).not.toContain(rows[0].payload.passwordEnc);
  });

  it("müşteriye e-posta gönderir, zaman akışına yazar ve yanıtı zincire bağlar", async () => {
    const { call, owner, ownerId, store } = await start();
    await call("POST", "/api/leads", owner, lead("lead_ayse", "Ayşe Kaya", "ayse@example.test"));
    await call("POST", "/api/leads", owner, lead("lead_bos", "E-postasız", ""));
    const mail = { leadId: "lead_ayse", subject: "Teklifimiz", text: "Merhaba Ayşe Hanım,\nteklif ektedir." };
    // Posta kutusu bağlı değilken gönderilemez.
    expect((await call("POST", "/api/email/send", owner, mail)).status).toBe(409);
    await call("PUT", "/api/email/account", owner, gmail);
    expect((await call("POST", "/api/email/send", owner, { ...mail, leadId: "lead_bos" })).status).toBe(400);
    expect((await call("POST", "/api/email/send", owner, { ...mail, leadId: "yok" })).status).toBe(404);

    // Alıcı istemciden alınmaz: gönderilen "to" yok sayılır, müşterinin kayıtlı adresi kullanılır.
    const sent = await call("POST", "/api/email/send", owner, { ...mail, to: "saldirgan@example.test" });
    expect(sent.status).toBe(201);
    const first = (await sent.json()).message;
    expect(first).toMatchObject({ direction: "outbound", leadId: "lead_ayse", to: "ayse@example.test", from: "satis@example.test", subject: "Teklifimiz" });
    expect(fake.sent[0].mail).toEqual({ to: "ayse@example.test", subject: "Teklifimiz", text: mail.text });
    expect(fake.sent[0].cfg.password).toBe(PASSWORD);

    // Müşteri yanıtlar → eşitleme iletiyi karta yazar.
    fake.inbox.push({ uid: 5, source: rawMail({ from: "Ayşe Kaya <ayse@example.test>", subject: "Re: Teklifimiz", id: "<yanit-1@example.test>", extra: `In-Reply-To: ${first.messageId}\r\nReferences: ${first.messageId}` }) });
    expect(await (await call("POST", "/api/email/sync", owner, {})).json()).toEqual({ ok: true, imported: 1 });
    const list = (await (await call("GET", "/api/email/messages?leadId=lead_ayse", owner)).json()).messages;
    expect(list.map((m: any) => m.direction).sort()).toEqual(["inbound", "outbound"]);
    const reply = list.find((m: any) => m.direction === "inbound");
    expect(reply).toMatchObject({ from: "ayse@example.test", subject: "Re: Teklifimiz", inReplyTo: first.messageId });

    // "Yanıtla": In-Reply-To ve References özgün iletiden kurulur.
    const answered = await call("POST", "/api/email/send", owner, { leadId: "lead_ayse", subject: "Re: Teklifimiz", text: "Teşekkürler.", replyToId: reply.id });
    expect(answered.status).toBe(201);
    expect(fake.sent[1].mail).toMatchObject({ inReplyTo: "<yanit-1@example.test>", references: [first.messageId, "<yanit-1@example.test>"] });
    // Başka müşterinin iletisine yanıt zinciri kurulamaz.
    expect((await call("POST", "/api/email/send", owner, { leadId: "lead_bos", subject: "x", text: "y", replyToId: reply.id })).status).toBe(400);
    expect(await store.list(EMAIL_MESSAGE_KIND, ownerId)).toHaveLength(3);
  });

  it("başlık enjeksiyonunu reddeder ve gönderimi hız sınırına tabi tutar", async () => {
    const { call, owner } = await start();
    await call("POST", "/api/leads", owner, lead("lead_ayse", "Ayşe Kaya", "ayse@example.test"));
    await call("PUT", "/api/email/account", owner, gmail);
    for (const subject of ["Merhaba\r\nBcc: kurban@example.test", "Merhaba\nX-Baslik: 1", "Merhaba\rBcc: a@example.test", "Merhaba Bcc: a@example.test", "Merhaba\u0000"]) {
      const res = await call("POST", "/api/email/send", owner, { leadId: "lead_ayse", subject, text: "metin" });
      expect([subject, res.status]).toEqual([subject, 400]);
      expect((await res.json()).error).toBe("HEADER_INJECTION");
    }
    expect((await call("POST", "/api/email/send", owner, { leadId: "lead_ayse", subject: " ", text: "metin" })).status).toBe(400);
    expect((await call("POST", "/api/email/send", owner, { leadId: "lead_ayse", subject: "Konu", text: "" })).status).toBe(400);
    expect(fake.sent).toHaveLength(0);

    process.env.XRE_EMAIL_SEND_PER_MINUTE = "2";
    const send = () => call("POST", "/api/email/send", owner, { leadId: "lead_ayse", subject: "Konu", text: "metin" });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toBe("RATE_LIMITED");
    expect(fake.sent).toHaveLength(2);
  });

  it("gelen kutusundan yalnız müşteriyle eşleşen iletileri alır ve tekrarı önler", async () => {
    const { call, owner, ownerId, store } = await start();
    await call("POST", "/api/leads", owner, lead("lead_ayse", "Ayşe Kaya", "Ayse@Example.test"));
    // Adresi kişi kartında olan müşteri de eşleşir.
    const stamp = new Date().toISOString();
    await store.put("contacts", "kisi_1", { id: "kisi_1", name: "Mehmet Demir", phone: "", email: "mehmet@example.test", companyId: "", owner: "", tags: [], notes: "", createdAt: stamp, updatedAt: stamp }, ownerId);
    await call("POST", "/api/leads", owner, lead("lead_mehmet", "Demir İnşaat", "", { contactId: "kisi_1" }));
    await call("PUT", "/api/email/account", owner, gmail);

    fake.inbox.push(
      { uid: 1, source: rawMail({ from: "Ayşe Kaya <AYSE@example.test>", id: "<a1@example.test>", subject: "Soru" }) },
      { uid: 2, source: rawMail({ from: "banka@example.test", id: "<ozel-1@example.test>", subject: "Hesap özetiniz", text: "ÖZEL-BANKA-BİLGİSİ" }) },
      { uid: 3, source: rawMail({ from: "mehmet@example.test", id: "<m1@example.test>", subject: "Randevu" }) },
      // Kendi adresimizden gelen ileti (ör. kendine kopya) alınmaz.
      { uid: 4, source: rawMail({ from: "satis@example.test", id: "<kendi@example.test>" }) },
    );
    expect(await pollAllMailboxes(store)).toEqual({ mailboxes: 1, imported: 2, failed: 0 });
    const all = (await store.list<any>(EMAIL_MESSAGE_KIND, ownerId)).map((r) => r.payload);
    expect(all.map((m) => [m.leadId, m.subject]).sort()).toEqual([["lead_ayse", "Soru"], ["lead_mehmet", "Randevu"]]);
    // İlgisiz özel yazışma hiçbir kayda girmez.
    expect(JSON.stringify(all)).not.toContain("ÖZEL-BANKA-BİLGİSİ");
    expect(JSON.stringify(all)).not.toContain("banka@example.test");

    // Aynı Message-ID yeniden gelirse (ör. UID sıfırlandı) ikinci kez yazılmaz.
    fake.inbox.push({ uid: 9, source: rawMail({ from: "ayse@example.test", id: "<a1@example.test>", subject: "Soru" }) });
    expect(await pollAllMailboxes(store)).toEqual({ mailboxes: 1, imported: 0, failed: 0 });
    expect(await store.list(EMAIL_MESSAGE_KIND, ownerId)).toHaveLength(2);
    // Eşitleme son görülen UID'den devam eder.
    expect(fake.fetches.map((f) => f.lastUid)).toEqual([undefined, 4]);

    const status = await (await call("GET", "/api/email/account", owner)).json();
    expect(status.sync.lastSyncAt).toBeTruthy();
    expect(status.sync.lastError).toBeNull();
  });

  it("eşitleme hatasında bekleme süresi uygular ve hatayı şifresiz bildirir", async () => {
    const { call, owner, store } = await start();
    await call("PUT", "/api/email/account", owner, gmail);
    fake.fetchError = Object.assign(new Error(`AUTHENTICATIONFAILED ${PASSWORD}`), { authenticationFailed: true });
    expect(await pollAllMailboxes(store)).toEqual({ mailboxes: 1, imported: 0, failed: 1 });
    const status = await (await call("GET", "/api/email/account", owner)).json();
    expect(status.sync.lastError).toMatch(/uygulama şifresi/);
    expect(JSON.stringify(status)).not.toContain(PASSWORD);
    // Bekleme süresi dolmadan yeniden denenmez.
    fake.fetchError = null;
    expect(await pollAllMailboxes(store)).toEqual({ mailboxes: 0, imported: 0, failed: 0 });
  });

  it("test ortamında yoklayıcı başlamaz ve temiz durur", () => {
    const stop = startEmailPoller(createMemoryStore());
    expect(typeof stop).toBe("function");
    stop();
    process.env.NODE_ENV = "production";
    process.env.XRE_EMAIL_POLL = "0";
    startEmailPoller(createMemoryStore())();
    process.env.NODE_ENV = "test";
  });
});

describe("E-posta: sahiplik ve erişim sınırları", () => {
  const firma = { company: "Ahmet İnşaat", slug: "ahmet", name: "Ahmet Yılmaz", email: "ahmet@example.test", password: "Deneme1234" };

  it("çalışma alanları birbirinin posta kutusunu ve iletilerini göremez", async () => {
    const { call, cookieOf, owner, ownerId, store } = await start();
    const tenant = cookieOf(await call("POST", "/api/workspaces/signup", undefined, firma));
    const tenantOwner = (await workspaceBySlug(store, "ahmet"))!.ownerOpenId;

    // A (varsayılan alan) bağlanır ve müşterisine yazar.
    await call("POST", "/api/leads", owner, lead("lead_ayse", "Ayşe Kaya", "ayse@example.test"));
    await call("PUT", "/api/email/account", owner, gmail);
    expect((await call("POST", "/api/email/send", owner, { leadId: "lead_ayse", subject: "Gizli teklif", text: "A-ALANI-GİZLİ" })).status).toBe(201);

    // B (yeni firma alanı) A'nın kutusunu görmez; A'nın müşterisine ait iletileri okuyamaz, gönderemez.
    expect(await (await call("GET", "/api/email/account", tenant)).json()).toEqual({ connected: false, account: null, sync: null });
    expect((await call("GET", "/api/email/messages?leadId=lead_ayse", tenant)).status).toBe(404);
    expect((await call("POST", "/api/email/send", tenant, { leadId: "lead_ayse", subject: "x", text: "y" })).status).toBe(404);
    expect((await call("POST", "/api/email/sync", tenant, {})).status).toBe(409);

    // Yeni alanlar kendi posta kutusunu bağlayabilir (ortak WhatsApp hatlarından farklı olarak).
    const connected = await call("PUT", "/api/email/account", tenant, { ...gmail, address: "ahmet@example.test" });
    expect(connected.status).toBe(200);
    expect((await store.list<StoredEmailAccount>(EMAIL_ACCOUNT_KIND, tenantOwner)).map((r) => r.payload.email)).toEqual(["ahmet@example.test"]);
    expect((await store.list<StoredEmailAccount>(EMAIL_ACCOUNT_KIND, ownerId)).map((r) => r.payload.email)).toEqual(["satis@example.test"]);

    // Aynı kimlikli müşteri B'de açılsa bile A'nın iletileri B'ye sızmaz.
    await call("POST", "/api/leads", tenant, lead("lead_ayse", "Başka Ayşe", "ayse@example.test"));
    const tenantMessages = await (await call("GET", "/api/email/messages?leadId=lead_ayse", tenant)).text();
    expect(tenantMessages).not.toContain("A-ALANI-GİZLİ");
    expect(JSON.parse(tenantMessages).messages).toEqual([]);

    // Gelen ileti yalnız kutunun sahibi olan alana yazılır: aynı müşteri adresi iki alanda da var.
    fake.inbox.push({ uid: 1, source: rawMail({ from: "ayse@example.test", id: "<ortak@example.test>" }) });
    await pollAllMailboxes(store);
    expect(await store.list(EMAIL_MESSAGE_KIND, tenantOwner)).toHaveLength(1);
    expect(await store.list(EMAIL_MESSAGE_KIND, ownerId)).toHaveLength(2);

    // B bağlantısını kaldırınca A'nınki etkilenmez.
    expect((await call("DELETE", "/api/email/account", tenant)).status).toBe(200);
    expect((await (await call("GET", "/api/email/account", owner)).json()).connected).toBe(true);
  });

  it("aynı alandaki çalışan başkasının kutusunu kullanamaz, kapsamı dışındaki müşterinin iletilerini göremez", async () => {
    const { call, owner, ownerId, store } = await start();
    await store.put("employee", "calisan_1", { id: "calisan_1", openId: "calisan-open-id", name: "Zeynep Satış", active: true, roleId: "sales", departmentId: "", title: "", phone: "", email: "" }, ownerId);
    const employee = `webdev_app_session=${await createSessionToken({ openId: "calisan-open-id", name: "Zeynep Satış" })}`;
    await call("POST", "/api/leads", owner, lead("lead_sahip", "Sahibin Müşterisi", "ayse@example.test", { owner: "Sistem Sahibi" }));
    await call("POST", "/api/leads", owner, lead("lead_zeynep", "Zeynep'in Müşterisi", "can@example.test", { owner: "Zeynep Satış" }));
    await call("PUT", "/api/email/account", owner, gmail);
    await call("POST", "/api/email/send", owner, { leadId: "lead_sahip", subject: "Sahibin yazışması", text: "SAHİP-GİZLİ" });
    await call("POST", "/api/email/send", owner, { leadId: "lead_zeynep", subject: "Ortak müşteri", text: "merhaba" });

    // Çalışan, sahibin bağlı kutusunu kendi kutusu olarak görmez ve onun üzerinden gönderemez.
    expect(await (await call("GET", "/api/email/account", employee)).json()).toEqual({ connected: false, account: null, sync: null });
    expect((await call("POST", "/api/email/send", employee, { leadId: "lead_zeynep", subject: "x", text: "y" })).status).toBe(409);
    expect(fake.sent).toHaveLength(2);
    // Kapsamı dışındaki müşterinin yazışması kapalı; kendi müşterisininki açık.
    expect((await call("GET", "/api/email/messages?leadId=lead_sahip", employee)).status).toBe(404);
    const own = await call("GET", "/api/email/messages?leadId=lead_zeynep", employee);
    expect(own.status).toBe(200);
    expect((await own.json()).messages.map((m: any) => m.subject)).toEqual(["Ortak müşteri"]);

    // Çalışan kendi kutusunu bağlar; kayıtlar kullanıcıya göre ayrıdır.
    expect((await call("PUT", "/api/email/account", employee, { ...gmail, address: "zeynep@example.test" })).status).toBe(200);
    const accounts = await store.list<StoredEmailAccount>(EMAIL_ACCOUNT_KIND, ownerId);
    expect(accounts.map((r) => r.payload.email).sort()).toEqual(["satis@example.test", "zeynep@example.test"]);
    expect(accounts.find((r) => r.id === "calisan-open-id")?.payload.email).toBe("zeynep@example.test");
    expect((await call("POST", "/api/email/send", employee, { leadId: "lead_zeynep", subject: "Benden", text: "selam" })).status).toBe(201);
    expect(fake.sent[2].cfg.address).toBe("zeynep@example.test");
    expect((await call("DELETE", "/api/email/account", employee)).status).toBe(200);
    expect((await (await call("GET", "/api/email/account", owner)).json()).account.address).toBe("satis@example.test");
  });
});
