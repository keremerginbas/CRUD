// Bayiler: ana bayi + alt bayiler, müşteri kaydı (telefon + proje) ve koruma süresi takibi.
import { useMemo, useState, type FormEvent } from "react";
import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { REG_STATUS_LABEL, daysBetween, phoneKey, type Dealer, type DealerRegistration } from "../../../../shared/dealers";
import { formatDay } from "../../../../shared/quotes";
import { Modal, PageTitle } from "../components/ui";
import { useDealers } from "../dealers";
import { useInventory } from "../projects";
import { useStore } from "../store";
import "../suite-pages.css";
import "../projects.css";
import "../quotes.css";
import { DEALER_GUIDE, Guide } from "../components/quotes/Guide";
import { cleanPhoneInput } from "../../../../shared/phone";

const fold = (value: string) => value.toLocaleLowerCase("tr-TR");
const tone: Record<DealerRegistration["status"], string> = { aktif: "ok", satıldı: "info", "ana bayiye devredildi": "hold" };
const PAGE = 100;

function DealerEditor({ dealer, employees, onSave, onClose }: { dealer: Dealer; employees: { openId: string; name: string }[]; onSave: (dealer: Dealer) => Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState(dealer);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(draft);
      onClose();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (openId: string) => setDraft((d) => ({ ...d, members: d.members.includes(openId) ? d.members.filter((m) => m !== openId) : [...d.members, openId] }));
  return (
    <Modal title={dealer.name ? "Bayiyi düzenle" : "Yeni bayi"} onClose={onClose}>
      <form className="pj-form sn-form" onSubmit={submit}>
        <label className="sx-field">
          <span>Bayi adı *</span>
          <input className="pj-input" required maxLength={200} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
        </label>
        <label className="sx-field">
          <span>Telefon</span>
          <input className="pj-input" maxLength={60} value={draft.phone} inputMode="tel" onChange={(e) => setDraft({ ...draft, phone: cleanPhoneInput(e.target.value) })} />
        </label>
        <label className="qt-check">
          <input type="checkbox" checked={draft.main} onChange={(e) => setDraft({ ...draft, main: e.target.checked })} />
          <span>Ana bayi (koruma süresi dolan müşteriler bu bayiye devredilir)</span>
        </label>
        <label className="qt-check">
          <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
          <span>Aktif (pasif bayi yeni müşteri kaydedemez)</span>
        </label>
        {employees.length > 0 && (
          <div className="sx-field">
            <span>Bu bayinin çalışanları</span>
            <div className="dl-members">
              {employees.map((emp) => (
                <label className="qt-check" key={emp.openId}>
                  <input type="checkbox" checked={draft.members.includes(emp.openId)} onChange={() => toggle(emp.openId)} />
                  <span>{emp.name}</span>
                </label>
              ))}
            </div>
            <small className="pj-muted">Bir çalışan yalnız bir bayide yer alır; burada seçilen çalışan diğer bayiden çıkarılır.</small>
          </div>
        )}
        <div className="sn-actions">
          <button type="submit" className="btn primary pj-touch" disabled={busy}>
            Kaydet
          </button>
          <button type="button" className="btn secondary pj-touch" onClick={onClose}>
            Vazgeç
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Dealers() {
  const store = useDealers();
  const { data } = useStore();
  const inventory = useInventory();
  const { dealers, registrations, manager, today } = store;
  const [editor, setEditor] = useState<Dealer | null>(null);
  const [leadQuery, setLeadQuery] = useState("");
  const [leadId, setLeadId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [dealerId, setDealerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [days, setDays] = useState("");

  const dealerName = useMemo(() => new Map(dealers.map((d) => [d.id, d.name])), [dealers]);
  const projects = useMemo(() => inventory.projects.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name, "tr")), [inventory.projects]);
  const myDealer = dealers.find((d) => d.id === store.myDealerId) || null;
  const lead = data.leads.find((l) => l.id === leadId) || null;
  // Binlerce müşteride açılır liste yerine arama: en çok 8 eşleşme gösterilir.
  const matches = useMemo(() => {
    const q = fold(leadQuery.trim());
    if (q.length < 2 || lead) return [];
    const digits = q.replace(/\D/g, "");
    const out = [];
    for (const l of data.leads) {
      if (fold(l.name).includes(q) || (digits.length >= 3 && String(l.phone || "").replace(/\D/g, "").includes(digits))) out.push(l);
      if (out.length >= 8) break;
    }
    return out;
  }, [leadQuery, data.leads, lead]);
  const counts = useMemo(() => {
    const map = new Map<string, { aktif: number; sold: number; all: number }>();
    for (const r of registrations) {
      const c = map.get(r.dealerId) || { aktif: 0, sold: 0, all: 0 };
      c.all++;
      if (r.status === "aktif") c.aktif++;
      if (r.status === "satıldı") c.sold++;
      map.set(r.dealerId, c);
    }
    return map;
  }, [registrations]);
  const shown = useMemo(() => {
    const words = fold(search).split(/\s+/).filter(Boolean);
    if (!words.length) return registrations;
    return registrations.filter((r) => {
      const hay = fold(`${r.customerName} ${r.customerPhone} ${r.projectName} ${dealerName.get(r.dealerId) || ""} ${r.registeredBy} ${REG_STATUS_LABEL[r.status]}`);
      return words.every((w) => hay.includes(w));
    });
  }, [registrations, search, dealerName]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const project = projects.find((p) => p.id === projectId);
    if (!lead) return void toast.error("Müşteri seçin.");
    if (!project) return void toast.error("Proje seçin.");
    if (manager && !dealerId && !myDealer) return void toast.error("Kaydın yapılacağı bayiyi seçin.");
    setBusy(true);
    try {
      await store.register(lead.id, { id: project.id, name: project.name }, manager ? dealerId || myDealer?.id : undefined);
      toast.success(`${lead.name}, “${project.name}” için kaydedildi. Koruma ${store.protectionDays} gün.`);
      setLeadId("");
      setLeadQuery("");
    } catch (error) {
      toast.error((error as Error).message, { duration: 9000 });
    } finally {
      setBusy(false);
    }
  };
  const run = async (task: () => Promise<void>) => {
    try {
      await task();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const canRegister = manager || Boolean(myDealer);

  return (
    <div className="pj-page qt-page">
      <PageTitle
        eyebrow="GAYRİMENKUL SATIŞ"
        title="Bayiler"
        description={`Bir bayi bir müşteriyi bir proje için kaydettiğinde, ${store.protectionDays} gün boyunca başka bayi aynı müşteriyi aynı proje için kaydedemez. Süre sonunda satış yoksa kayıt ana bayiye devredilir.`}
        actions={
          manager && (
            <button type="button" className="btn primary pj-touch" onClick={() => setEditor({ id: `dealer-${crypto.randomUUID()}`, name: "", main: dealers.length === 0, active: true, members: [], phone: "", note: "" })}>
              <Plus size={16} /> Yeni bayi
            </button>
          )
        }
      />
      <Guide id="dealers" title="Bayi koruması nasıl çalışır?" steps={DEALER_GUIDE} />
      {store.error && <p className="pj-note">{store.error}</p>}
      {!store.loading && dealers.length === 0 && <p className="pj-note">{manager ? "Henüz bayi tanımlanmadı. “Yeni bayi” ile önce ana bayiyi, sonra alt bayileri ekleyin." : "Henüz bayi tanımlanmadı. Yöneticinizden bayileri tanımlamasını isteyin."}</p>}

      <div className="dl-cards">
        {dealers.map((d) => {
          const c = counts.get(d.id) || { aktif: 0, sold: 0, all: 0 };
          return (
            <div className={`pj-panel dl-card ${d.main ? "dl-main" : ""} ${d.active ? "" : "dl-off"}`} key={d.id}>
              <div className="dl-card-top">
                <strong>{d.name}</strong>
                {d.main && <span className="pj-status pj-tone-info qt-status">Ana bayi</span>}
                {!d.active && <span className="pj-status pj-tone-sold qt-status">Pasif</span>}
                {d.id === store.myDealerId && <span className="pj-status pj-tone-ok qt-status">Bayiniz</span>}
              </div>
              <span className="pj-muted">
                {c.aktif} korumada · {c.sold} satış · {c.all} kayıt{manager ? ` · ${d.members.length} çalışan` : ""}
              </span>
              {manager && (
                <div className="sn-actions">
                  <button type="button" className="btn secondary small" onClick={() => setEditor(d)}>
                    <Pencil size={13} /> Düzenle
                  </button>
                  {!d.main && (
                    <button type="button" className="btn secondary small qt-danger" onClick={() => window.confirm(`${d.name} silinsin mi?`) && void run(() => store.removeDealer(d.id))}>
                      <Trash2 size={13} /> Sil
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {dealers.length > 0 && (
        <section className="pj-panel qt-section">
          <h2 className="qt-section-title">Müşteri kaydet</h2>
          {!canRegister ? (
            <p className="pj-muted">Bir bayiye bağlı değilsiniz. Yöneticinizden sizi bir bayiye eklemesini isteyin.</p>
          ) : (
            <form className="pj-form dl-register" onSubmit={submit}>
              <div className="sx-field dl-lead">
                <span>Müşteri (ad veya telefon ile arayın) *</span>
                {lead ? (
                  <div className="dl-picked">
                    <strong>{lead.name}</strong>
                    <span className="pj-muted">{lead.phone || "telefon yok"}</span>
                    <button type="button" className="btn secondary small" onClick={() => setLeadId("")}>
                      Değiştir
                    </button>
                  </div>
                ) : (
                  <>
                    <input className="pj-input" type="search" placeholder="ör. Ahmet veya 0555…" value={leadQuery} onChange={(e) => setLeadQuery(e.target.value)} />
                    {matches.length > 0 && (
                      <ul className="dl-matches">
                        {matches.map((l) => (
                          <li key={l.id}>
                            <button type="button" onClick={() => setLeadId(l.id)}>
                              <strong>{l.name}</strong> <span className="pj-muted">{l.phone}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {leadQuery.trim().length >= 2 && matches.length === 0 && <small className="pj-muted">Eşleşen müşteri yok. Önce CRM’de müşteriyi oluşturun.</small>}
                  </>
                )}
                {lead && !phoneKey(lead.phone || "") && <small className="sn-bad">Bu müşterinin geçerli telefonu yok; kayıt için telefon gerekli.</small>}
              </div>
              <label className="sx-field">
                <span>Proje *</span>
                <select className="pj-input" required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">Seçin…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {manager ? (
                <label className="sx-field">
                  <span>Bayi *</span>
                  <select className="pj-input" value={dealerId || myDealer?.id || ""} onChange={(e) => setDealerId(e.target.value)}>
                    <option value="">Seçin…</option>
                    {dealers
                      .filter((d) => d.active)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </label>
              ) : (
                <div className="sx-field">
                  <span>Bayi</span>
                  <strong>{myDealer?.name}</strong>
                </div>
              )}
              <button type="submit" className="btn primary pj-touch" disabled={busy}>
                <ShieldCheck size={16} /> Kaydet ve korumaya al
              </button>
            </form>
          )}
        </section>
      )}

      <section className="pj-panel qt-section">
        <div className="sn-head">
          <h2 className="qt-section-title">Müşteri kayıtları ({registrations.length})</h2>
          <input className="pj-input sn-search" type="search" placeholder="Müşteri, telefon, proje, bayi ara…" value={search} onChange={(e) => (setSearch(e.target.value), setLimit(PAGE))} />
        </div>
        {shown.length === 0 ? (
          <p className="pj-muted sn-empty">{store.loading ? "Yükleniyor…" : "Kayıt yok."}</p>
        ) : (
          <div className="pj-table-wrap">
            <table className="pj-table qt-table qt-static">
              <thead>
                <tr>
                  <th>Müşteri</th>
                  <th>Proje</th>
                  <th>Bayi</th>
                  <th>Kayıt</th>
                  <th>Koruma</th>
                  <th>Durum</th>
                  {manager && <th />}
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, limit).map((r) => {
                  const left = daysBetween(today, r.protectedUntil);
                  return (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.customerName}</strong>
                        <div className="qt-cell-sub">{r.customerPhone}</div>
                      </td>
                      <td>{r.projectName}</td>
                      <td>
                        {dealerName.get(r.dealerId) || "—"}
                        {r.originalDealerId !== r.dealerId && <div className="qt-cell-sub">ilk kayıt: {dealerName.get(r.originalDealerId) || "—"}</div>}
                      </td>
                      <td>
                        {formatDay(r.registeredAt.slice(0, 10))}
                        <div className="qt-cell-sub">{r.registeredBy}</div>
                      </td>
                      <td>
                        {formatDay(r.protectedUntil)}
                        {r.status === "aktif" && <div className={`qt-cell-sub ${left <= 7 ? "sn-bad" : ""}`}>{left >= 0 ? `${left} gün kaldı` : "süre doldu"}</div>}
                      </td>
                      <td>
                        <span className={`pj-status pj-tone-${tone[r.status]} qt-status`}>{REG_STATUS_LABEL[r.status]}</span>
                      </td>
                      {manager && (
                        <td className="pj-num">
                          <button
                            type="button"
                            className="icon-button"
                            title="Kaydı sil (yanlış kayıt düzeltmesi)"
                            aria-label="Kaydı sil"
                            onClick={() => window.confirm(`${r.customerName} – ${r.projectName} kaydı silinsin mi? Silinirse müşteri bu proje için yeniden kaydedilebilir.`) && void run(() => store.removeRegistration(r.id))}
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {shown.length > limit && (
          <button type="button" className="add-card column-more" onClick={() => setLimit((n) => n + PAGE * 2)}>
            {(shown.length - limit).toLocaleString("tr-TR")} kayıt daha · göster
          </button>
        )}
      </section>

      {manager && (
        <section className="pj-panel qt-section">
          <h2 className="qt-section-title">Koruma süresi</h2>
          <form
            className="sn-actions"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(days);
              if (!Number.isInteger(n) || n < 1 || n > 730) return void toast.error("Süre 1–730 gün arasında tam sayı olmalı.");
              void run(async () => {
                await store.saveDays(n);
                setDays("");
                toast.success(`Koruma süresi ${n} gün. Yeni kayıtlarda geçerlidir.`);
              });
            }}
          >
            <span>
              Şu an <strong>{store.protectionDays} gün</strong>. Yeni süre:
            </span>
            <input className="pj-input dl-days" inputMode="numeric" placeholder={String(store.protectionDays)} value={days} onChange={(e) => setDays(e.target.value)} />
            <button type="submit" className="btn secondary pj-touch">
              Kaydet
            </button>
          </form>
          <p className="pj-muted">Değişiklik yalnız bundan sonra yapılan kayıtları etkiler; mevcut kayıtların bitiş tarihi değişmez.</p>
        </section>
      )}

      {editor && <DealerEditor dealer={editor} employees={store.employees} onSave={store.saveDealer} onClose={() => setEditor(null)} />}
    </div>
  );
}
