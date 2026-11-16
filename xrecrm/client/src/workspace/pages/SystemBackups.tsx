import { useEffect, useState } from "react";
import { DatabaseBackup, Download, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { Badge, Empty, Modal, PageTitle } from "../components/ui";
import "../system.css";
import { setBranding, useBranding } from "../branding";

interface Backup {
  name: string;
  size: number;
  createdAt: string;
  reason: string;
}

const reasonLabel: Record<string, string> = { otomatik: "Otomatik", elle: "Elle", oncesi: "Geri yükleme öncesi" };
const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Firma adı ve logosu: yan menüde, giriş ekranında ve teklif PDF'inde görünür. */
function BrandingCard() {
  const branding = useBranding();
  const [name, setName] = useState(branding.name);
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(branding.name), [branding.name]);
  const save = async (logoBase64?: string) => {
    setBusy(true);
    try {
      const r = await fetch("/api/branding", { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, ...(logoBase64 === undefined ? {} : { logoBase64 }) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || "Kaydedilemedi.");
      setBranding({ name: d.name || "", logoUrl: d.logoUrl || null });
      toast.success("Firma kimliği kaydedildi.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) return void toast.error("Logo PNG veya JPG dosyası olmalı.");
    if (file.size > 400_000) return void toast.error("Logo en fazla 400 KB olabilir.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await save(btoa(binary));
  };
  return (
    <section className="sys-brand">
      <div className="sys-brand-preview">{branding.logoUrl ? <img src={branding.logoUrl} alt="Firma logosu" /> : <span>Logo yok</span>}</div>
      <div className="sys-brand-form">
        <strong>Firma logosu ve adı</strong>
        <small>Yan menüde, giriş ekranında ve teklif PDF’inde görünür. Logo: PNG veya JPG, en fazla 400 KB; kare logo en iyi sonucu verir.</small>
        <div className="sys-brand-row">
          <input value={name} maxLength={80} placeholder="Firma adı (ör. TR Invest)" onChange={(e) => setName(e.target.value)} aria-label="Firma adı" />
          <button className="btn secondary" disabled={busy} onClick={() => void save()}>
            Adı kaydet
          </button>
          <label className={`btn primary ${busy ? "disabled" : ""}`}>
            Logo yükle
            <input type="file" accept="image/png,image/jpeg" hidden disabled={busy} onChange={(e) => (void pick(e.target.files?.[0]), (e.target.value = ""))} />
          </label>
          {branding.logoUrl && (
            <button className="btn secondary" disabled={busy} onClick={() => void save("")}>
              Logoyu kaldır
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** Deneme verisi: kanbanı dolu görmek için örnek müşteri üretir; tek tuşla tamamı silinir. */
function TestDataCard({ total, onChanged }: { total: number; onChanged: () => void }) {
  const { refresh } = useStore();
  const [count, setCount] = useState("2000");
  const [busy, setBusy] = useState(false);
  const run = async (method: "POST" | "DELETE") => {
    const n = Number(count);
    if (method === "POST" && (!Number.isInteger(n) || n < 1 || n > 20000)) return void toast.error("Sayı 1 ile 20.000 arasında olmalı.");
    if (method === "DELETE" && !window.confirm("Bütün deneme müşterileri ve onlara bağlı görev/etkinlikler silinsin mi? Gerçek kayıtlara dokunulmaz.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/system/test-data", { method, credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(method === "POST" ? { count: n } : {}) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || "İşlem tamamlanamadı.");
      toast.success(method === "POST" ? `${d.created.toLocaleString("tr-TR")} deneme müşterisi eklendi.` : `${d.removed.toLocaleString("tr-TR")} deneme müşterisi silindi.`);
      await refresh();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="sys-brand">
      <div className="sys-brand-form">
        <strong>Deneme verisi</strong>
        <small>
          Kanbanı, raporları ve hızı dolu veriyle görmek için örnek müşteri üretir (rastgele ad, telefon, tutar, aşama; bir kısmına görev ve görüşme). Hepsi “test-veri” etiketi taşır ve tek tuşla silinir; gerçek
          kayıtlarınıza dokunulmaz. Şu an toplam {total.toLocaleString("tr-TR")} müşteri var.
        </small>
        <div className="sys-brand-row">
          <input value={count} inputMode="numeric" onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 5))} aria-label="Eklenecek müşteri sayısı" style={{ flex: "0 0 120px" }} />
          <button className="btn primary" disabled={busy} onClick={() => void run("POST")}>
            {busy ? "Çalışıyor…" : "Deneme müşterisi ekle"}
          </button>
          <button className="btn secondary" disabled={busy} onClick={() => void run("DELETE")}>
            Deneme verisini sil
          </button>
        </div>
      </div>
    </section>
  );
}

interface SystemStatus {
  checkedAt: string;
  startedAt: string;
  uptimeSeconds: number;
  memory: { appBytes: number; totalBytes: number; freeBytes: number };
  cpu: { cores: number; load1: number };
  disk: { totalBytes: number; freeBytes: number } | null;
  records: { leads: number; employees: number; quotes: number; units: number };
  lastBackup: { name: string; createdAt: string; size: number } | null;
  storage: string;
}
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} GB`;
const mb = (bytes: number) => `${Math.round(bytes / 1024 ** 2).toLocaleString("tr-TR")} MB`;
function uptimeText(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d} gün ${h} saat` : h ? `${h} saat ${m} dk` : `${m} dk`;
}

/** Sunucunun anlık durumu: çalışıyor mu, yer var mı, yedek güncel mi. */
function StatusCards({ status }: { status: SystemStatus }) {
  const diskUsed = status.disk ? 1 - status.disk.freeBytes / status.disk.totalBytes : 0;
  const memUsed = 1 - status.memory.freeBytes / status.memory.totalBytes;
  const backupAgeH = status.lastBackup ? (Date.now() - Date.parse(status.lastBackup.createdAt)) / 3600_000 : Infinity;
  const busy = status.cpu.load1 / Math.max(1, status.cpu.cores);
  const tone = (bad: boolean, warn: boolean) => (bad ? "bad" : warn ? "warn" : "ok");
  const cards: [string, string, string, string][] = [
    ["Sunucu", "Çalışıyor", `Kesintisiz çalışma süresi: ${uptimeText(status.uptimeSeconds)} · son başlangıç ${new Date(status.startedAt).toLocaleString("tr-TR")}`, "ok"],
    [
      "Disk",
      status.disk ? `${gb(status.disk.freeBytes)} boş` : "Bilinmiyor",
      status.disk ? `Toplam ${gb(status.disk.totalBytes)} · %${Math.round(diskUsed * 100)} dolu` : "Disk bilgisi okunamadı",
      tone(diskUsed > 0.92, diskUsed > 0.8),
    ],
    ["Bellek", `%${Math.round(memUsed * 100)} kullanımda`, `CRM ${mb(status.memory.appBytes)} · toplam ${gb(status.memory.totalBytes)}`, tone(memUsed > 0.95, memUsed > 0.85)],
    ["İşlemci yükü", busy < 0.7 ? "Rahat" : busy < 1.2 ? "Yoğun" : "Çok yoğun", `${status.cpu.cores} çekirdek · son 1 dk yük ${status.cpu.load1.toLocaleString("tr-TR")}`, tone(busy >= 1.2, busy >= 0.7)],
    [
      "Son yedek",
      status.lastBackup ? (backupAgeH < 1 ? "Az önce" : backupAgeH < 48 ? `${Math.round(backupAgeH)} saat önce` : `${Math.round(backupAgeH / 24)} gün önce`) : "Henüz yok",
      status.lastBackup ? new Date(status.lastBackup.createdAt).toLocaleString("tr-TR") : "İlk yedek sunucu açıldıktan kısa süre sonra alınır",
      tone(backupAgeH > 72, backupAgeH > 30),
    ],
    ["Kayıtlar", `${status.records.leads.toLocaleString("tr-TR")} müşteri`, `${status.records.units.toLocaleString("tr-TR")} daire · ${status.records.quotes.toLocaleString("tr-TR")} teklif · ${status.records.employees.toLocaleString("tr-TR")} çalışan`, "ok"],
  ];
  return (
    <section className="sys-status" aria-label="Sunucu durumu">
      {cards.map(([label, value, detail, t]) => (
        <div className={`sys-card sys-${t}`} key={label}>
          <span className="sys-label">
            <i aria-hidden /> {label}
          </span>
          <strong>{value}</strong>
          <small>{detail}</small>
        </div>
      ))}
    </section>
  );
}

export default function SystemBackups() {
  const { demo, user, request } = useStore();
  const [info, setInfo] = useState<{ backups: Backup[]; directory: string; keep: number; storage: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<{ backup: Backup; confirm: string } | null>(null);
  const owner = !demo && Boolean(user?.isOwner);

  const [status, setStatus] = useState<SystemStatus | null>(null);
  const load = () => {
    request("/api/system/status").then(setStatus).catch(() => setStatus(null));
    return request("/api/system/backups")
      .then(setInfo)
      .catch((e: Error) => toast.error(e.message));
  };
  useEffect(() => {
    if (owner) void load();
  }, [owner]);

  const backupNow = async () => {
    setBusy(true);
    try {
      const r = await request("/api/system/backups", {});
      toast.success(`Yedek alındı: ${r.backup.name}`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const doRestore = async () => {
    if (!restore) return;
    setBusy(true);
    try {
      const r = await request(`/api/system/backups/${encodeURIComponent(restore.backup.name)}/restore`, { confirm: restore.confirm });
      toast.success(`Geri yüklendi: ${r.records} kayıt. Sayfa yenileniyor…`);
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="system-page">
      <PageTitle
        eyebrow="SİSTEM"
        title="Sunucu durumu ve yedekler"
        description="Sunucunun anlık durumu burada görünür. CRM verileriniz her gün otomatik yedeklenir. İstediğiniz an yedek alın, indirin veya geri yükleyin."
        actions={
          owner && (
            <button className="btn primary" disabled={busy} onClick={() => void backupNow()}>
              <DatabaseBackup size={16} /> Şimdi yedekle
            </button>
          )
        }
      />
      {!owner ? (
        <Empty
          title={demo ? "Demo modunda yedek yok" : "Yalnız sahip erişebilir"}
          description="Yedekleri çalışma alanı sahibi yönetir."
        />
      ) : (
        <>
          {status && <StatusCards status={status} />}
          <BrandingCard />
          <TestDataCard total={status?.records.leads ?? 0} onChanged={() => void load()} />
          <div className="system-note">
            <ShieldCheck size={18} />
            <p>
              Veritabanı: <strong>{info?.storage === "postgresql" ? "PostgreSQL" : info?.storage === "mysql" ? "MySQL" : "yerel dosya"}</strong> · Son {info?.keep} otomatik yedek saklanır
              (elle alınanlar silinmez). Klasör: <code>{info?.directory}</code>. Yedekleri düzenli olarak başka bir diske veya
              buluta da indirin. WhatsApp medya dosyaları (<code>data/media</code>) bu yedeğe dahil değildir.
            </p>
          </div>
          <section className="panel system-list">
            {info?.backups.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>YEDEK</th><th>TÜR</th><th>BOYUT</th><th>TARİH</th><th /></tr>
                  </thead>
                  <tbody>
                    {info.backups.map((b) => (
                      <tr key={b.name}>
                        <td className="mono"><strong>{b.name}</strong></td>
                        <td><Badge tone={b.reason === "otomatik" ? "blue" : b.reason === "oncesi" ? "amber" : "green"}>{reasonLabel[b.reason] || b.reason}</Badge></td>
                        <td>{size(b.size)}</td>
                        <td className="mono">{new Date(b.createdAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</td>
                        <td className="system-actions">
                          <a className="icon-button" href={`/api/system/backups/${encodeURIComponent(b.name)}/download`} aria-label="Yedeği indir" title="İndir">
                            <Download size={16} />
                          </a>
                          <button className="text-button" onClick={() => setRestore({ backup: b, confirm: "" })}>
                            <RotateCcw size={14} /> Geri yükle
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="Henüz yedek yok" description="İlk otomatik yedek sunucu açıldıktan kısa süre sonra alınır; şimdi elle de alabilirsiniz." />
            )}
          </section>
        </>
      )}
      {restore && (
        <Modal title="Yedeği geri yükle" subtitle={restore.backup.name} onClose={() => setRestore(null)}>
          <div className="modal-content">
            <p className="setup-footnote">
              Şu anki tüm CRM verisi bu yedekteki haliyle <strong>değiştirilecek</strong>. Önce mevcut durumun otomatik bir yedeği
              alınır, yani geri dönebilirsiniz. Onaylamak için aşağıya <strong>GERİ YÜKLE</strong> yazın.
            </p>
            <div className="form-grid">
              <label className="full">
                Onay
                <input id="restore-confirm" value={restore.confirm} onChange={(e) => setRestore({ ...restore, confirm: e.target.value })} autoFocus />
              </label>
            </div>
          </div>
          <footer className="modal-footer">
            <button className="btn secondary" onClick={() => setRestore(null)}>Vazgeç</button>
            <button className="btn primary" disabled={busy || restore.confirm !== "GERİ YÜKLE"} onClick={() => void doRestore()}>
              <RotateCcw size={15} /> Geri yükle
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
