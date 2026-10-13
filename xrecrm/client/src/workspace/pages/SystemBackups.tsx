import { useEffect, useState } from "react";
import { DatabaseBackup, Download, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { Badge, Empty, Modal, PageTitle } from "../components/ui";
import "../system.css";

interface Backup {
  name: string;
  size: number;
  createdAt: string;
  reason: string;
}

const reasonLabel: Record<string, string> = { otomatik: "Otomatik", elle: "Elle", oncesi: "Geri yükleme öncesi" };
const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function SystemBackups() {
  const { demo, user, request } = useStore();
  const [info, setInfo] = useState<{ backups: Backup[]; directory: string; keep: number; storage: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<{ backup: Backup; confirm: string } | null>(null);
  const owner = !demo && Boolean(user?.isOwner);

  const load = () =>
    request("/api/system/backups")
      .then(setInfo)
      .catch((e: Error) => toast.error(e.message));
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
        title="Yedekler"
        description="CRM verileriniz her gün otomatik yedeklenir. İstediğiniz an yedek alın, indirin veya geri yükleyin."
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
          <div className="system-note">
            <ShieldCheck size={18} />
            <p>
              Veritabanı: <strong>{info?.storage === "mysql" ? "MySQL" : "yerel dosya"}</strong> · Son {info?.keep} otomatik yedek saklanır
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
