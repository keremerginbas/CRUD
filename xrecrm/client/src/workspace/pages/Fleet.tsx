// Yönetim paneli: satılan CRM kurulumlarının teknik durumu. Müşteri verisi gösterilmez.
import { useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { PageTitle, Badge, Empty, Modal } from "../components/ui";
import "../fleet.css";

interface Status {
  version?: string;
  commitDate?: string | null;
  startedAt?: string | null;
  origin?: string;
  storage?: string;
  users?: number;
  activeUsers7d?: number;
  lastLoginAt?: string | null;
  leads?: number;
  quotes?: number;
  lastBackupAt?: string | null;
  disk?: { totalBytes: number; freeBytes: number } | null;
  memory?: { totalBytes: number; freeBytes: number };
  whatsappLines?: { total: number; connected: number };
}
interface Install {
  id: string;
  name: string;
  domain: string;
  notes: string;
  licenseStart: string | null;
  licenseEnd: string | null;
  lastSeenAt: string | null;
  status: Status | null;
  problems: string[];
}
const PROBLEMS: Record<string, string> = {
  never: "Henüz bağlanmadı",
  offline: "Yanıt vermiyor",
  backup: "Yedek eski",
  disk: "Disk doluyor",
  "license-soon": "Lisans bitiyor",
  "license-expired": "Lisans doldu",
};
const ago = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes)) return "—";
  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dk önce`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} sa önce`;
  return `${Math.round(minutes / 1440)} gün önce`;
};
const dayText = (day: string | null) => (day ? new Date(`${day}T12:00:00+03:00`).toLocaleDateString("tr-TR") : "—");
const daysLeft = (day: string | null) => (day ? Math.ceil((Date.parse(`${day}T23:59:59+03:00`) - Date.now()) / 86_400_000) : null);
const percentUsed = (part?: { totalBytes: number; freeBytes: number } | null) => (part && part.totalBytes > 0 ? Math.round((1 - part.freeBytes / part.totalBytes) * 100) : null);
const EMPTY = { name: "", domain: "", notes: "", licenseStart: "", licenseEnd: "" };

export default function Fleet() {
  const { request } = useStore();
  const [installs, setInstalls] = useState<Install[] | null>(null);
  const [panel, setPanel] = useState<{ version: string; commitDate: string | null; heartbeatUrl: string } | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<(typeof EMPTY & { id?: string }) | null>(null);
  const [issued, setIssued] = useState<{ name: string; key: string; panelUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const r = await request("/api/fleet/installs");
      setInstalls(r.installs);
      setPanel(r.panel);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, []);
  // En yeni sürüm tarihi: kurulumlar ve panelin kendisi arasında en güncel olan.
  const newest = useMemo(() => {
    const dates = [panel?.commitDate, ...(installs || []).map((i) => i.status?.commitDate)].map((d) => Date.parse(d || "")).filter(Number.isFinite);
    return dates.length ? Math.max(...dates) : null;
  }, [installs, panel]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    try {
      const body = { name: editing.name, domain: editing.domain, notes: editing.notes, licenseStart: editing.licenseStart || null, licenseEnd: editing.licenseEnd || null };
      if (editing.id) await request(`/api/fleet/installs/${editing.id}`, body, "PUT");
      else {
        const r = await request("/api/fleet/installs", body);
        setIssued({ name: r.install.name, key: r.key, panelUrl: r.panelUrl });
      }
      setEditing(null);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const rotate = async (install: Install) => {
    if (!window.confirm(`${install.name} için yeni anahtar üretilsin mi? Eski anahtar hemen geçersiz olur; yenisini o kurulumun Entegrasyonlar ekranına girmeniz gerekir.`)) return;
    try {
      const r = await request(`/api/fleet/installs/${install.id}/key`, {});
      setIssued({ name: install.name, key: r.key, panelUrl: r.panelUrl });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const remove = async (install: Install) => {
    if (!window.confirm(`${install.name} panelden silinsin mi? Müşterinin CRM'i etkilenmez; yalnız bu listeden kalkar.`)) return;
    try {
      await request(`/api/fleet/installs/${install.id}`, {}, "DELETE");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast.success("Kopyalandı."), () => toast.error("Kopyalanamadı; elle seçip kopyalayın."));
  const healthy = (installs || []).filter((i) => !i.problems.length).length;
  return (
    <div className="fleet-page">
      <PageTitle
        eyebrow="YÖNETİM PANELİ"
        title="Müşteri kurulumları"
        description="Sattığınız CRM kurulumlarının teknik durumu. Müşterilerin kendi verileri (isimler, mesajlar, satışlar) burada gösterilmez."
        actions={
          <>
            <button type="button" className="btn secondary" onClick={() => void load()}>
              <RefreshCw size={15} /> Yenile
            </button>
            <button type="button" className="btn primary" onClick={() => setEditing({ ...EMPTY })}>
              <Plus size={15} /> Kurulum ekle
            </button>
          </>
        }
      />
      {error && <p className="fleet-error">{error}</p>}
      {installs && installs.length > 0 && (
        <div className="fleet-summary">
          <div className="panel"><span>Kurulum</span><strong>{installs.length}</strong></div>
          <div className="panel"><span>Sorunsuz</span><strong>{healthy}</strong></div>
          <div className={`panel ${installs.length - healthy ? "warn" : ""}`}><span>Dikkat isteyen</span><strong>{installs.length - healthy}</strong></div>
        </div>
      )}
      {installs && installs.length === 0 && (
        <Empty title="Henüz kurulum eklenmedi" description="“Kurulum ekle” ile bir müşteri kaydı açın; verilen anahtarı o müşterinin CRM'inde Entegrasyonlar → Yönetim paneli bölümüne girin." />
      )}
      <div className="fleet-grid">
        {(installs || []).map((install) => {
          const s = install.status;
          const disk = percentUsed(s?.disk);
          const left = daysLeft(install.licenseEnd);
          const old = Boolean(newest && s?.commitDate && Date.parse(s.commitDate) < newest - 60_000);
          return (
            <article key={install.id} className={`panel fleet-card ${install.problems.length ? "has-problem" : ""}`}>
              <header>
                <div>
                  <strong>{install.name}</strong>
                  {install.domain && (
                    <a href={/^https?:\/\//.test(install.domain) ? install.domain : `https://${install.domain}`} target="_blank" rel="noreferrer">
                      {install.domain.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                </div>
                {install.problems.length ? (
                  <div className="fleet-badges">{install.problems.map((p) => <Badge key={p} tone={p === "license-soon" || p === "never" ? "amber" : "red"}>{PROBLEMS[p] || p}</Badge>)}</div>
                ) : (
                  <Badge tone="green">Çalışıyor</Badge>
                )}
              </header>
              <dl>
                <div><dt>Son haber</dt><dd>{ago(install.lastSeenAt)}</dd></div>
                <div><dt>Sürüm</dt><dd>{s?.version || "—"}{old ? <em> · güncel değil</em> : ""}</dd></div>
                <div><dt>Son yedek</dt><dd>{ago(s?.lastBackupAt)}</dd></div>
                <div><dt>Disk</dt><dd>{disk === null ? "—" : `%${disk} dolu`}</dd></div>
                <div><dt>Kullanıcı</dt><dd>{s?.users ?? "—"}{s?.activeUsers7d !== undefined ? ` · ${s.activeUsers7d} etkin (7 gün)` : ""}</dd></div>
                <div><dt>Son giriş</dt><dd>{ago(s?.lastLoginAt)}</dd></div>
                <div><dt>Müşteri kaydı</dt><dd>{s?.leads?.toLocaleString("tr-TR") ?? "—"}</dd></div>
                <div><dt>WhatsApp hattı</dt><dd>{s?.whatsappLines ? `${s.whatsappLines.connected} / ${s.whatsappLines.total} bağlı` : "—"}</dd></div>
                <div><dt>Lisans bitişi</dt><dd>{dayText(install.licenseEnd)}{left !== null ? ` · ${left > 0 ? `${left} gün kaldı` : "doldu"}` : ""}</dd></div>
                <div><dt>Veritabanı</dt><dd>{s?.storage || "—"}</dd></div>
              </dl>
              {install.notes && <p className="fleet-notes">{install.notes}</p>}
              <footer>
                <button type="button" className="btn secondary" onClick={() => setEditing({ id: install.id, name: install.name, domain: install.domain, notes: install.notes, licenseStart: install.licenseStart || "", licenseEnd: install.licenseEnd || "" })}>
                  <Pencil size={14} /> Düzenle
                </button>
                <button type="button" className="btn secondary" onClick={() => void rotate(install)}>
                  <KeyRound size={14} /> Yeni anahtar
                </button>
                <button type="button" className="icon-button" aria-label={`${install.name} kurulumunu sil`} onClick={() => void remove(install)}>
                  <Trash2 size={15} />
                </button>
              </footer>
            </article>
          );
        })}
      </div>
      {editing && (
        <Modal title={editing.id ? "Kurulumu düzenle" : "Kurulum ekle"} subtitle="Müşteri adı, adresi ve lisans tarihleri" onClose={() => !busy && setEditing(null)}>
          <form className="modal-content fleet-form" onSubmit={save}>
            <label>Müşteri adı<input required minLength={2} maxLength={120} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Örnek Gayrimenkul" /></label>
            <label>CRM adresi<input maxLength={200} value={editing.domain} onChange={(e) => setEditing({ ...editing, domain: e.target.value })} placeholder="ornek.firmaniz.com.tr" /></label>
            <div className="fleet-form-row">
              <label>Lisans başlangıcı<input type="date" value={editing.licenseStart} onChange={(e) => setEditing({ ...editing, licenseStart: e.target.value })} /></label>
              <label>Lisans bitişi<input type="date" value={editing.licenseEnd} onChange={(e) => setEditing({ ...editing, licenseEnd: e.target.value })} /></label>
            </div>
            <label>Not<textarea rows={3} maxLength={2000} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} placeholder="Sözleşme, yetkili kişi, özel durumlar…" /></label>
            <div className="fleet-form-actions">
              <button type="button" className="btn secondary" onClick={() => setEditing(null)} disabled={busy}>Vazgeç</button>
              <button className="btn primary" disabled={busy}>{busy ? "Kaydediliyor…" : "Kaydet"}</button>
            </div>
          </form>
        </Modal>
      )}
      {issued && (
        <Modal title={`${issued.name} · kurulum anahtarı`} subtitle="Bu anahtar yalnız şimdi gösterilir" onClose={() => setIssued(null)}>
          <div className="modal-content fleet-key">
            <p>Müşterinin CRM'ine sahip hesabıyla girin: <b>Entegrasyonlar → Tüm gelişmiş ayarlar → Yönetim paneli</b>. Aşağıdaki iki değeri yapıştırıp kaydedin, sonra “Bağlantıyı test et”e basın.</p>
            <label>Panel adresi<span className="fleet-copy"><code>{issued.panelUrl || "(bu panelin internet adresi)"}</code><button type="button" className="icon-button" aria-label="Panel adresini kopyala" onClick={() => copy(issued.panelUrl)}><Copy size={14} /></button></span></label>
            <label>Kurulum anahtarı<span className="fleet-copy"><code>{issued.key}</code><button type="button" className="icon-button" aria-label="Anahtarı kopyala" onClick={() => copy(issued.key)}><Copy size={14} /></button></span></label>
            <small>Pencereyi kapatınca anahtar bir daha gösterilmez. Kaybederseniz karttaki “Yeni anahtar” ile yenisini üretirsiniz.</small>
            <div className="fleet-form-actions"><button type="button" className="btn primary" onClick={() => setIssued(null)}>Tamam</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
