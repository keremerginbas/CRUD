import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { Badge, Empty, PageTitle } from "../components/ui";
import "../login.css";

interface Row {
  slug: string;
  name: string;
  contactName: string;
  contactEmail: string;
  createdAt: string;
  trialEndsAt: string;
  state: "active" | "trial" | "expired" | "suspended";
  daysLeft: number | null;
  users: number;
  leads: number;
  lastLoginAt: string;
}
const stateLabel = { active: "Etkin", trial: "Deneme", expired: "Süresi doldu", suspended: "Askıda" };
const stateTone = { active: "green", trial: "blue", expired: "amber", suspended: "red" };
const day = (v: string) => (v ? new Date(v).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" }) : "—");

/** Sistem sahibi: kayıt olan firmaların listesi, deneme süresi ve durum yönetimi. */
export default function Workspaces() {
  const { request } = useStore();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [info, setInfo] = useState({ signup: false, trialDays: 5 });
  const [busy, setBusy] = useState("");
  const load = () =>
    request("/api/workspaces")
      .then((d: any) => {
        setRows(d.workspaces || []);
        setInfo({ signup: Boolean(d.signup), trialDays: Number(d.trialDays) || 5 });
      })
      .catch((e: Error) => {
        setRows([]);
        toast.error(e.message);
      });
  useEffect(() => {
    void load();
  }, []);
  const change = async (slug: string, body: Record<string, unknown>, done: string) => {
    setBusy(slug);
    try {
      await request(`/api/workspaces/${slug}`, body);
      toast.success(done);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="workspace-admin">
      <PageTitle
        eyebrow="SİSTEM YÖNETİMİ"
        title="Firmalar"
        description="Ücretsiz kayıtla açılan çalışma alanları. Deneme süresini uzatabilir, alanı etkinleştirebilir veya askıya alabilirsiniz."
        actions={
          <button className="btn secondary" onClick={() => void load()}>
            <RefreshCw size={15} /> Yenile
          </button>
        }
      />
      <p className="notice-line">
        <span className={info.signup ? "green-dot" : "amber-dot"} />
        {info.signup
          ? `Ücretsiz kayıt açık. Yeni firmalar ${info.trialDays} gün deneme alır.`
          : "Ücretsiz kayıt kapalı. Açmak için sunucu ayarlarına XRE_SIGNUP=1 ekleyin."}
      </p>
      {rows === null ? null : rows.length === 0 ? (
        <Empty title="Henüz kayıt olan firma yok" description="Kayıt açıldığında yeni firmalar burada listelenir." />
      ) : (
        <div className="card table-scroll">
          <table>
            <thead>
              <tr>
                <th>Firma</th>
                <th>Yetkili</th>
                <th>Durum</th>
                <th>Kullanım</th>
                <th>Kayıt</th>
                <th>Son giriş</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.slug}>
                  <td>
                    <strong>{w.name}</strong>
                    <small>
                      <a href={`/${w.slug}`} target="_blank" rel="noopener">
                        /{w.slug} <ExternalLink size={11} />
                      </a>
                    </small>
                  </td>
                  <td>
                    {w.contactName}
                    <small>{w.contactEmail}</small>
                  </td>
                  <td>
                    <Badge tone={stateTone[w.state] as any}>{stateLabel[w.state]}</Badge>
                    {w.state === "trial" && <small>{w.daysLeft} gün kaldı</small>}
                    {w.state === "expired" && <small>{day(w.trialEndsAt)} tarihinde doldu</small>}
                  </td>
                  <td>
                    {w.users} kullanıcı
                    <small>{w.leads} müşteri kaydı</small>
                  </td>
                  <td>{day(w.createdAt)}</td>
                  <td>{day(w.lastLoginAt)}</td>
                  <td>
                    <div className="row-actions">
                      {w.state !== "active" && (
                        <button className="btn secondary" disabled={busy === w.slug} onClick={() => void change(w.slug, { extendDays: 7 }, "Deneme 7 gün uzatıldı.")}>
                          +7 gün
                        </button>
                      )}
                      {w.state !== "active" && (
                        <button className="btn primary" disabled={busy === w.slug} onClick={() => void change(w.slug, { status: "active" }, "Çalışma alanı etkinleştirildi.")}>
                          Etkinleştir
                        </button>
                      )}
                      {w.state !== "suspended" ? (
                        <button className="btn secondary" disabled={busy === w.slug} onClick={() => void change(w.slug, { status: "suspended" }, "Çalışma alanı askıya alındı.")}>
                          Askıya al
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
