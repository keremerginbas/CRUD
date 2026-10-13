import VapiCallFields, {
  useVapiOptions,
  canUseVapiSelection,
} from "../components/VapiCallFields";
import { useState, useRef } from "react";
import {
  Search,
  Phone,
  Sparkles,
  Server,
  Cloud,
  ArrowUpRight,
  Copy,
  SlidersHorizontal,
  ShieldCheck,
  Download,
  Radio,
  Play,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { lines, groupNames, formatPhone } from "../data";
import { useStore } from "../store";
import { PageTitle, Badge, Modal, Empty } from "../components/ui";
export default function Lines({
  calls = false,
  navigate,
}: {
  calls?: boolean;
  navigate: (p: string) => void;
}) {
  const { data, demo, request, refresh } = useStore();
  const [group, setGroup] = useState("all");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [leadId, setLeadId] = useState(data.leads[0]?.id || "");
  const [lineId, setLineId] = useState("");
  const [assistant, setAssistant] = useState("");
  const [busy, setBusy] = useState(false);
  const callLock = useRef(false);
  const options = useVapiOptions(callOpen);
  const filtered = lines.filter(
    (l) =>
      (group === "all" || l.group === group) &&
      `${l.phone} ${l.iccid || ""}`.includes(query.replace(/\s/g, "")),
  );
  const selected = lines.find((l) => l.id === detail);
  const copy = (x: string) =>
    navigator.clipboard
      .writeText(x)
      .then(() => toast.success("Panoya kopyalandı."))
      .catch(() => toast.error("Panoya erişilemedi."));
  const exportData = () => {
    const csv =
      "\uFEFFHat;Grup;ICCID\n" +
      lines
        .map((l) => `${l.phone};${groupNames[l.group]};${l.iccid || ""}`)
        .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    a.download = "xre-hat-envanteri.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  async function call() {
    if (demo) {
      toast.info(
        "Demo modu: gerçek arama başlatılmadı. Vapi kurulumu ve canlı CRM gerekir.",
      );
      return;
    }
    if (!leadId) {
      toast.error("Müşteri seçin.");
      return;
    }
    if (busy || callLock.current) return;
    if (!canUseVapiSelection(options.catalog, lineId, assistant)) {
      toast.error("Doğrulanmış Vapi hattı ve asistanı seçin.");
      return;
    }
    callLock.current = true;
    setBusy(true);
    try {
      await request("/api/calls", {
        leadId,
        lineId,
        assistantId: assistant || undefined,
      });
      toast.success("Arama Vapi sağlayıcısına iletildi.");
      setCallOpen(false);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      callLock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="TELEFON ALTYAPISI"
        title={
          calls
            ? "Her arama, daha akıllı."
            : "Tüm hatlarınız. Tek kontrol noktası."
        }
        description={
          calls
            ? "Vapi yapay zekâ aramalarını CRM müşterileriyle başlatın ve sonuçlarını izleyin."
            : "Netgsm, FST ve SIP bağlantılarını eksiksiz hat envanterinizle yönetin."
        }
        actions={
          calls ? (
            <button className="btn primary" onClick={() => setCallOpen(true)}>
              <Phone size={17} />
              Yeni AI araması
            </button>
          ) : (
            <>
              <button className="btn secondary" onClick={exportData}>
                <Download size={16} />
                Envanteri indir
              </button>
              <button
                className="btn primary"
                onClick={() => navigate("/integrations")}
              >
                <Settings2 size={16} />
                Bağlantı ayarları
              </button>
            </>
          )
        }
      />
      <div className="line-group-cards">
        {(["ai", "office", "cloud"] as const).map((g) => {
          const Icon = g === "ai" ? Sparkles : g === "office" ? Server : Cloud;
          return (
            <button
              key={g}
              className={`line-group-card ${group === g ? "active" : ""}`}
              onClick={() => setGroup(group === g ? "all" : g)}
            >
              <span
                className={`stat-icon ${g === "ai" ? "purple" : g === "office" ? "blue" : "green"}`}
              >
                <Icon size={23} />
              </span>
              <div>
                <p>{groupNames[g]}</p>
                <strong>
                  {lines.filter((l) => l.group === g).length}
                  <small>kayıtlı hat</small>
                </strong>
              </div>
              <ArrowUpRight size={19} />
            </button>
          );
        })}
      </div>
      {calls ? (
        <>
          <div className="info-banner">
            <Sparkles size={22} />
            <div>
              <strong>Yapay zekâ destekli müşteri takibi</strong>
              <p>
                Gerçek Vapi hesabınıza bağlı hatları ve aramayı yapacak asistanı
                seçin. Hat numaraları CRM envanterinizle doğrulanır; Bulut PBX
                grubundaki Vapi hatları da kullanılabilir.
              </p>
            </div>
            <button
              className="btn secondary small"
              onClick={() => navigate("/integrations")}
            >
              Vapi ayarları
              <ArrowUpRight size={14} />
            </button>
          </div>
          <section className="panel">
            <div className="section-title">
              <h3>Arama geçmişi</h3>
              <Badge>{data.calls.length} arama</Badge>
            </div>
            {data.calls.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>MÜŞTERİ</th>
                      <th>HAT</th>
                      <th>DURUM</th>
                      <th>SONUÇ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.calls.map((c: any) => (
                      <tr key={c.id}>
                        <td>
                          {data.leads.find((l) => l.id === c.leadId)?.name ||
                            c.leadId}
                        </td>
                        <td>{c.lineId}</td>
                        <td>
                          <Badge>{c.status}</Badge>
                        </td>
                        <td>{c.summary || "Sonuç bekleniyor"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="Henüz arama yapılmadı"
                description="Yeni AI araması ile CRM müşterisine Vapi üzerinden ulaşın. Demo modunda arama gönderilmez."
              />
            )}
          </section>
        </>
      ) : (
        <>
          <div className="crm-toolbar">
            <div className="search-field">
              <Search size={17} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Telefon numarası veya ICCID ara…"
              />
            </div>
            <div className="toolbar-right">
              <span className="muted">{filtered.length} hat</span>
              <select
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                aria-label="Hat grubu"
              >
                <option value="all">Tüm hizmet grupları</option>
                {Object.entries(groupNames).map(([g, n]) => (
                  <option key={g} value={g}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <section className="panel">
            <div className="table-wrap">
              <table className="lines-table">
                <thead>
                  <tr>
                    <th>TELEFON NUMARASI</th>
                    <th>HİZMET GRUBU</th>
                    <th>SİM KART NUMARASI (ICCID)</th>
                    <th>BAĞLANTI TÜRÜ</th>
                    <th>DURUM</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr key={l.id} onClick={() => setDetail(l.id)}>
                      <td>
                        <span className="line-phone">
                          <span className="line-icon">
                            <Phone size={14} />
                          </span>
                          {formatPhone(l.phone)}
                        </span>
                      </td>
                      <td>
                        <Badge
                          tone={
                            l.group === "ai"
                              ? "purple"
                              : l.group === "office"
                                ? "blue"
                                : "green"
                          }
                        >
                          {groupNames[l.group]}
                        </Badge>
                      </td>
                      <td className="mono iccid">{l.iccid || "—"}</td>
                      <td>
                        {l.group === "ai"
                          ? "Vapi · SIP"
                          : l.group === "office"
                            ? "FST · SIP"
                            : "Netgsm · Bulut SIP"}
                      </td>
                      <td>
                        <Badge tone="gray">Doğrulanmadı</Badge>
                      </td>
                      <td>
                        <ArrowUpRight size={15} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              47 hat · 13 ICCID eşleşmesi
              <span>Sağlanan envanter · Canlı SIP durumu henüz alınmadı</span>
            </div>
          </section>
        </>
      )}
      <div className="info-banner slim">
        <ShieldCheck size={18} />
        <p>
          SIP ses trafiği tarayıcıdan doğrudan sonlandırılmaz. Netgsm/FST için
          PBX ağ geçidi; Vapi için ayrı sağlayıcı hat eşleştirmesi gerekir.
        </p>
      </div>
      {selected && (
        <Modal
          title="Hat bağlantı bilgileri"
          subtitle={formatPhone(selected.phone)}
          onClose={() => setDetail(null)}
        >
          <div className="modal-content">
            <dl className="detail-dl">
              <div>
                <dt>Hizmet grubu</dt>
                <dd>{groupNames[selected.group]}</dd>
              </div>
              <div>
                <dt>Telefon</dt>
                <dd>
                  {selected.phone}
                  <button
                    className="icon-button"
                    onClick={() => copy(selected.phone)}
                    aria-label="Telefon kopyala"
                  >
                    <Copy size={14} />
                  </button>
                </dd>
              </div>
              <div>
                <dt>ICCID</dt>
                <dd className="mono">{selected.iccid || "Belirtilmedi"}</dd>
              </div>
              <div>
                <dt>CRM hat kimliği</dt>
                <dd>{selected.id}</dd>
              </div>
              <div>
                <dt>Bağlantı durumu</dt>
                <dd>
                  <Badge>Doğrulanmadı</Badge>
                </dd>
              </div>
            </dl>
            <p className="muted">
              Entegrasyon ayarları güvenli sunucu ortam değişkenleriyle yapılır.
              Hat sahipliği envanterden çıkarılamaz.
            </p>
          </div>
          <footer className="modal-footer">
            <button
              className="btn primary"
              onClick={() => {
                setDetail(null);
                navigate("/integrations");
              }}
            >
              Entegrasyonları aç
              <ArrowUpRight size={15} />
            </button>
          </footer>
        </Modal>
      )}
      {callOpen && (
        <Modal
          title="Yeni yapay zekâ araması"
          subtitle={
            demo
              ? "Demo: gerçek arama gönderilmez"
              : "Seçilen müşteriye gerçek Vapi araması gönderilecek"
          }
          onClose={() => setCallOpen(false)}
        >
          <div className="modal-content form-grid">
            <label className="full">
              Aranacak müşteri
              <select
                value={leadId}
                onChange={(e) => setLeadId(e.target.value)}
              >
                <option value="">Müşteri seçin</option>
                {data.leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {l.phone}
                  </option>
                ))}
              </select>
            </label>
            <div className="full">
              <VapiCallFields
                {...options}
                lineId={lineId}
                assistantId={assistant}
                onLine={setLineId}
                onAssistant={setAssistant}
                onReload={options.reload}
              />
            </div>
            <div className="full info-banner slim">
              <ShieldCheck size={16} />
              <p>
                {demo
                  ? "Bu işlem yalnızca demo açıklaması gösterir."
                  : "Arama, Vapi sağlayıcısına iletilir ve sağlayıcı maliyetleri doğabilir. Aranan kişiye AI asistan olduğu bildirilmelidir."}
              </p>
            </div>
          </div>
          <footer className="modal-footer">
            <button
              className="btn secondary"
              onClick={() => setCallOpen(false)}
            >
              Vazgeç
            </button>
            <button
              className="btn primary"
              onClick={call}
              disabled={
                busy ||
                (!demo &&
                  (options.loading ||
                    !canUseVapiSelection(options.catalog, lineId, assistant)))
              }
            >
              <Phone size={16} />
              {busy
                ? "İletiliyor…"
                : demo
                  ? "Demo aramasını dene"
                  : "Aramayı başlat"}
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}
