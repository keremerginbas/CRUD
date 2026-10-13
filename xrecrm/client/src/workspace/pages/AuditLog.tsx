import { useEffect, useState } from "react";
import { History, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { Badge, Empty, PageTitle } from "../components/ui";
import "../system.css";

interface Entry {
  id: string;
  at: string;
  actor: string;
  via: string;
  action: "create" | "update" | "delete";
  kind: string;
  kindLabel: string;
  entityId: string;
  title: string;
  changes: { field: string; from: unknown; to: unknown }[];
}

const actionLabel = { create: "oluşturdu", update: "güncelledi", delete: "sildi" };
const actionTone = { create: "green", update: "blue", delete: "red" };
const fieldLabels: Record<string, string> = {
  name: "Ad",
  phone: "Telefon",
  email: "E-posta",
  stage: "Aşama",
  owner: "Sorumlu",
  value: "Değer",
  notes: "Notlar",
  source: "Kaynak",
  city: "Şehir",
  appointmentAt: "Randevu",
  status: "Durum",
  assignee: "Atanan",
  dueAt: "Son tarih",
  title: "Başlık",
  active: "Aktif",
  roleId: "Rol",
  enabled: "Etkin",
  pipelineId: "Huni",
  completed: "Tamamlandı",
};
const stageNames: Record<string, string> = {
  new: "Yeni müşteri",
  contacted: "İletişime geçildi",
  qualified: "Randevu",
  proposal: "Teklif gönderildi",
  won: "Satış tamamlandı",
  lost: "Kaybedildi",
};
const show = (v: unknown, field = "") => {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "stage" && typeof v === "string") return stageNames[v] || v;
  if (field === "value" && typeof v === "number")
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(v);
  if (typeof v === "boolean") return v ? "Evet" : "Hayır";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v))
    return new Date(v).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
  return typeof v === "string" ? v : JSON.stringify(v);
};

export default function AuditLog({ onLead }: { onLead: (id: string) => void }) {
  const { demo, user, request } = useStore();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [kinds, setKinds] = useState<Record<string, string>>({});
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = async () => {
    if (demo || !user) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "300", ...(kind ? { kind } : {}), ...(q ? { q } : {}) });
      const r = await request(`/api/audit?${params}`);
      setEntries(r.entries);
      setKinds(r.kinds);
      setTotal(r.total);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [demo, user?.openId, kind]);

  return (
    <div className="system-page">
      <PageTitle
        eyebrow="GÜVENLİK"
        title="Denetim günlüğü"
        description="Müşteri, görev, ayar ve yetki değişikliklerini kimin ne zaman yaptığını görün."
        actions={
          <button className="btn secondary" onClick={() => void load()}>
            <RefreshCw size={16} className={loading ? "spin" : ""} /> Yenile
          </button>
        }
      />
      {demo ? (
        <Empty title="Demo modunda kayıt tutulmaz" description="Canlı CRM'de tüm değişiklikler burada listelenir." />
      ) : (
        <>
          <div className="system-toolbar">
            <label className="system-search">
              <Search size={15} />
              <input
                id="audit-search"
                value={q}
                placeholder="Kişi, kayıt adı veya tür ara"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void load()}
              />
            </label>
            <select id="audit-kind" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kayıt türü">
              <option value="">Tüm kayıt türleri</option>
              {Object.entries(kinds).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            <span className="system-count">{total} kayıt</span>
          </div>
          <section className="panel system-list">
            {entries.length ? (
              entries.map((e) => (
                <article key={e.id} className="audit-row">
                  <button className="audit-head" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                    <History size={15} />
                    <span className="audit-text">
                      <strong>{e.actor}</strong> {e.kindLabel.toLocaleLowerCase("tr-TR")} kaydını{" "}
                      <Badge tone={actionTone[e.action]}>{actionLabel[e.action]}</Badge>{" "}
                      <em>{e.title}</em>
                      {e.action === "update" && e.changes.length > 0 && (
                        <small> · {e.changes.map((c) => fieldLabels[c.field] || c.field).slice(0, 4).join(", ")}</small>
                      )}
                    </span>
                    <time>{new Date(e.at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</time>
                  </button>
                  {open === e.id && (
                    <div className="audit-detail">
                      {e.changes.length ? (
                        <table>
                          <thead>
                            <tr><th>ALAN</th><th>ÖNCE</th><th>SONRA</th></tr>
                          </thead>
                          <tbody>
                            {e.changes.map((c) => (
                              <tr key={c.field}>
                                <td>{fieldLabels[c.field] || c.field}</td>
                                <td>{show(c.from, c.field)}</td>
                                <td>{show(c.to, c.field)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p>Kayıt {actionLabel[e.action]}. Kaynak: {e.via}.</p>
                      )}
                      {e.kind === "lead" && e.action !== "delete" && (
                        <button className="text-button" onClick={() => onLead(e.entityId)}>Müşteri kartını aç</button>
                      )}
                    </div>
                  )}
                </article>
              ))
            ) : (
              <Empty title="Kayıt yok" description="Seçili filtrelerle eşleşen değişiklik bulunmadı." />
            )}
          </section>
        </>
      )}
    </div>
  );
}
