// "E-posta" bağlantı kartı (Profilim sayfası): kullanıcı kendi posta kutusunu bağlar.
import { useState } from "react";
import type { FormEvent } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, Mail, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { openEmailSettings, useEmailStatus } from "../email";
import { Badge } from "./ui";
import { EMAIL_PRESETS, IMAP_PORTS, SMTP_PORTS, type EmailProvider, type EmailStatus } from "../../../../shared/email";
import "../email.css";

const PORT_LABEL: Record<number, string> = { 465: "465 (SSL)", 587: "587 (STARTTLS)", 25: "25", 993: "993 (SSL)", 143: "143 (STARTTLS)" };
const providerLabel = (id: EmailProvider) => EMAIL_PRESETS.find((p) => p.id === id)?.label || "Diğer";
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

export default function EmailConnect() {
  const { demo, request, user } = useStore();
  const { status, error, setStatus, loading } = useEmailStatus();
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState<EmailProvider>("gmail");
  const [form, setForm] = useState({ address: "", displayName: "", password: "", username: "", smtpHost: "", smtpPort: 465, imapHost: "", imapPort: 993 });
  const [busy, setBusy] = useState<"" | "save" | "sync" | "remove">("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (key: keyof typeof form, value: string | number) => setForm((f) => ({ ...f, [key]: value }));
  const connected = Boolean(status?.connected && status.account);
  const showForm = !connected || editing;

  function startEdit() {
    const a = status?.account;
    if (a) {
      setProvider(a.provider);
      setForm({ address: a.address, displayName: a.displayName, password: "", username: a.username === a.address ? "" : a.username, smtpHost: a.smtpHost, smtpPort: a.smtpPort, imapHost: a.imapHost, imapPort: a.imapPort });
    }
    setResult(null);
    setEditing(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy("save");
    setResult(null);
    try {
      let next: EmailStatus;
      if (demo) {
        // Demo: gerçek bağlantı kurulmaz, şifre hiçbir yere gönderilmez.
        const preset = EMAIL_PRESETS.find((p) => p.id === provider)!;
        next = {
          connected: true,
          account: {
            provider,
            address: form.address.trim().toLowerCase(),
            displayName: form.displayName.trim() || "Örnek Kullanıcı",
            username: form.username.trim() || form.address.trim().toLowerCase(),
            smtpHost: provider === "other" ? form.smtpHost : preset.smtpHost,
            smtpPort: provider === "other" ? form.smtpPort : preset.smtpPort,
            imapHost: provider === "other" ? form.imapHost : preset.imapHost,
            imapPort: provider === "other" ? form.imapPort : preset.imapPort,
            connectedAt: new Date().toISOString(),
          },
          sync: { lastSyncAt: null, lastError: null },
        };
      } else {
        const body = { provider, ...form };
        const saved = await request("/api/email/account", body, "PUT");
        next = { connected: saved.connected, account: saved.account, sync: saved.sync };
      }
      setStatus(next);
      setForm((f) => ({ ...f, password: "" }));
      setEditing(false);
      setResult({ ok: true, text: demo ? "Örnek bağlantı kaydedildi (demo: gerçek giriş yapılmadı)." : "Bağlantı test edildi: gönderim ve gelen kutusu girişi başarılı." });
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy("");
    }
  }

  async function syncNow() {
    if (busy) return;
    if (demo) return void toast.info("Demo modunda gelen kutusu okunmaz.");
    setBusy("sync");
    try {
      const r = await request("/api/email/sync", {});
      toast.success(r.imported ? `${r.imported} yeni ileti müşteri kartlarına eklendi.` : "Müşterilerinizden yeni ileti yok.");
      setStatus(await request("/api/email/account"));
    } catch (err) {
      toast.error((err as Error).message);
      void request("/api/email/account").then(setStatus).catch(() => undefined);
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    if (busy) return;
    if (!window.confirm("Posta kutusu bağlantısı kaldırılsın mı? Kayıtlı şifre silinir; müşteri kartlarındaki yazışma geçmişi kalır.")) return;
    setBusy("remove");
    try {
      if (!demo) await request("/api/email/account", {}, "DELETE");
      setStatus({ connected: false, account: null, sync: null });
      setEditing(false);
      setResult(null);
      toast.success("Posta kutusu bağlantısı kaldırıldı.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  const account = status?.account;
  return (
    <section className="panel em-card" id="eposta" aria-labelledby="em-card-title">
      <header className="em-card-head">
        <span className="em-card-icon">
          <Mail size={20} />
        </span>
        <div>
          <h3 id="em-card-title">E-posta</h3>
          <p>Kendi posta kutunuzu bağlayın: müşteri kartından e-posta gönderin, müşterinin yanıtı kartın geçmişine düşsün.</p>
        </div>
        {connected ? <Badge tone="green">{demo ? "Örnek bağlantı" : "Bağlı"}</Badge> : <Badge tone="gray">Bağlı değil</Badge>}
      </header>

      {loading && (
        <p className="em-muted">
          <LoaderCircle size={14} className="em-spin" /> Durum okunuyor…
        </p>
      )}
      {error && !connected && <div className="em-result bad">{error}</div>}

      {connected && account && !editing && (
        <div className="em-connected">
          <dl>
            <div>
              <dt>Adres</dt>
              <dd>{account.address}</dd>
            </div>
            <div>
              <dt>Sağlayıcı</dt>
              <dd>{providerLabel(account.provider)}</dd>
            </div>
            <div>
              <dt>Görünen ad</dt>
              <dd>{account.displayName || "—"}</dd>
            </div>
            <div>
              <dt>Son eşitleme</dt>
              <dd>{when(status?.sync?.lastSyncAt) || (demo ? "Demo" : "Henüz yapılmadı · birkaç dakika içinde")}</dd>
            </div>
          </dl>
          {status?.sync?.lastError && (
            <div className="em-result bad" role="status">
              <AlertCircle size={15} />
              <span>Gelen kutusu okunamadı: {status.sync.lastError}</span>
            </div>
          )}
          <div className="em-actions">
            <button type="button" className="btn secondary small" onClick={() => void syncNow()} disabled={Boolean(busy)}>
              <RefreshCw size={13} className={busy === "sync" ? "em-spin" : ""} />
              Şimdi eşitle
            </button>
            <button type="button" className="btn secondary small" onClick={startEdit} disabled={Boolean(busy)}>
              Ayarları değiştir
            </button>
            <button type="button" className="btn secondary small em-danger" onClick={() => void remove()} disabled={Boolean(busy)}>
              <Unplug size={13} />
              Bağlantıyı kaldır
            </button>
          </div>
        </div>
      )}

      {showForm && !loading && (
        <form className="em-form" onSubmit={(e) => void save(e)} autoComplete="off">
          <div className="em-providers" role="group" aria-label="E-posta sağlayıcısı">
            {EMAIL_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="em-provider"
                aria-pressed={provider === p.id}
                onClick={() => {
                  setProvider(p.id);
                  setResult(null);
                }}
              >
                <strong>{p.label}</strong>
                <small>{p.id === "other" ? "IMAP + SMTP ayarlarını siz girin" : `${p.smtpHost}`}</small>
              </button>
            ))}
          </div>

          {provider === "gmail" && (
            <details className="em-help" open>
              <summary>Gmail uygulama şifresi nasıl alınır? (2 dakika)</summary>
              <ol>
                <li>
                  Google Hesabınızda <b>Güvenlik</b> bölümünden <b>2 Adımlı Doğrulama</b>'yı açın (açık değilse uygulama şifresi verilmez).
                </li>
                <li>
                  <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer noopener">
                    myaccount.google.com/apppasswords
                  </a>{" "}
                  adresini açın.
                </li>
                <li>
                  Uygulama adına <b>XRE CRM</b> yazıp <b>Oluştur</b>'a basın.
                </li>
                <li>
                  Ekrana gelen <b>16 haneli şifreyi</b> aşağıdaki şifre alanına yapıştırın. Normal Gmail şifreniz burada çalışmaz.
                </li>
              </ol>
            </details>
          )}
          {provider === "outlook" && (
            <div className="em-help em-warn">
              <b>Önemli:</b> Microsoft, Outlook.com ve birçok Microsoft 365 hesabında şifreyle (uygulama şifresi dahil) IMAP/SMTP girişini kapatmıştır. Giriş reddedilirse kurumunuzun
              Microsoft 365 yöneticisinden hesabınız için <b>IMAP</b> ve <b>Kimliği doğrulanmış SMTP (SMTP AUTH)</b> iznini açmasını isteyin; 2 adımlı doğrulama açıksa{" "}
              <a href="https://mysignins.microsoft.com/security-info" target="_blank" rel="noreferrer noopener">
                güvenlik bilgileri
              </a>{" "}
              sayfasından uygulama şifresi oluşturun.
            </div>
          )}

          <div className="em-grid">
            <label>
              E-posta adresiniz
              <input type="email" required maxLength={254} value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="ad@firma.com" autoComplete="off" />
            </label>
            <label>
              Görünen ad
              <input maxLength={100} value={form.displayName} onChange={(e) => set("displayName", e.target.value)} placeholder={user?.name || "Müşterinin göreceği ad"} autoComplete="off" />
            </label>
            <label className="em-full">
              {provider === "other" ? "Şifre (varsa uygulama şifresi)" : "Uygulama şifresi"}
              <input type="password" required maxLength={256} value={form.password} onChange={(e) => set("password", e.target.value)} placeholder={provider === "gmail" ? "16 haneli uygulama şifresi" : "••••••••"} autoComplete="new-password" />
              <small>Şifreniz sunucuda şifreli saklanır; ekranda veya tarayıcıda bir daha gösterilmez.</small>
            </label>
            {provider === "other" && (
              <>
                <label>
                  Gönderim sunucusu (SMTP)
                  <input required maxLength={253} value={form.smtpHost} onChange={(e) => set("smtpHost", e.target.value)} placeholder="smtp.firma.com" autoComplete="off" spellCheck={false} />
                </label>
                <label>
                  SMTP portu
                  <select value={form.smtpPort} onChange={(e) => set("smtpPort", Number(e.target.value))}>
                    {SMTP_PORTS.map((p) => (
                      <option key={p} value={p}>
                        {PORT_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Gelen sunucusu (IMAP)
                  <input required maxLength={253} value={form.imapHost} onChange={(e) => set("imapHost", e.target.value)} placeholder="imap.firma.com" autoComplete="off" spellCheck={false} />
                </label>
                <label>
                  IMAP portu
                  <select value={form.imapPort} onChange={(e) => set("imapPort", Number(e.target.value))}>
                    {IMAP_PORTS.map((p) => (
                      <option key={p} value={p}>
                        {PORT_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="em-full">
                  Kullanıcı adı (adresinizden farklıysa)
                  <input maxLength={320} value={form.username} onChange={(e) => set("username", e.target.value)} placeholder="Boş bırakırsanız e-posta adresiniz kullanılır" autoComplete="off" spellCheck={false} />
                </label>
              </>
            )}
          </div>

          {result && !result.ok && (
            <div className="em-result bad" role="alert">
              <AlertCircle size={15} />
              <span>{result.text}</span>
            </div>
          )}
          <div className="em-actions">
            <button className="btn primary" disabled={Boolean(busy)}>
              {busy === "save" ? <LoaderCircle size={15} className="em-spin" /> : <CheckCircle2 size={15} />}
              {busy === "save" ? "Bağlantı test ediliyor…" : "Bağlantıyı test et ve kaydet"}
            </button>
            {editing && (
              <button type="button" className="btn secondary" onClick={() => setEditing(false)} disabled={Boolean(busy)}>
                Vazgeç
              </button>
            )}
          </div>
        </form>
      )}

      {result?.ok && (
        <div className="em-result good" role="status">
          <CheckCircle2 size={15} />
          <span>{result.text}</span>
        </div>
      )}
      <p className="em-privacy">
        <ShieldCheck size={14} />
        <span>
          Yalnız <b>müşteri ve kişi kayıtlarınızdaki adreslerden gelen</b> iletiler CRM'e alınır; diğer yazışmalarınız okunmaz ve saklanmaz. Ekler indirilmez, yalnız adları görünür.
          {demo && " Demo modunda hiçbir bilgi sunucuya gönderilmez."}
        </span>
      </p>
    </section>
  );
}

/** Entegrasyonlar sayfasındaki kısa yönlendirme: posta kutusu kişiseldir, Profilim'den bağlanır. */
export function EmailPointer() {
  const { status } = useEmailStatus();
  return (
    <div className="em-pointer">
      <span className="em-card-icon">
        <Mail size={18} />
      </span>
      <div>
        <strong>E-posta {status?.connected && status.account ? `· ${status.account.address}` : ""}</strong>
        <span>Her kullanıcı kendi posta kutusunu (Gmail, Outlook veya diğer) Profilim sayfasından bağlar.</span>
      </div>
      <button type="button" className="btn secondary small" onClick={openEmailSettings}>
        {status?.connected ? "Bağlantıyı yönet" : "Posta kutusunu bağla"}
      </button>
    </div>
  );
}
