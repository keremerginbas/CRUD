import type { VapiOptions } from "../components/VapiCallFields";
import AIIntegration from "../components/AIIntegration";
import WebhookHub from "../components/WebhookHub";
import BitrixImport from "../components/BitrixImport";
import { useState, useEffect } from "react";
import {
  MessageCircle,
  Phone,
  Sparkles,
  Webhook,
  Link2,
  ShieldCheck,
  ArrowUpRight,
  Copy,
  ExternalLink,
  RefreshCw,
  Settings2,
  Code2,
  Server,
  CheckCircle2,
  AlertCircle,
  Globe,
  Terminal,
  Radio,
  ChevronRight,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { PageTitle, Badge, Modal, Empty } from "../components/ui";
const providers = [
  {
    id: "meta",
    name: "WhatsApp Cloud API",
    caption: "Meta Business Platform",
    icon: MessageCircle,
    tone: "green",
    text: "Resmî WhatsApp mesajlaşması, gelen mesajlar ve teslimat bildirimleri.",
    keys: [
      "META_ACCESS_TOKEN",
      "META_LINE_MAP_JSON",
      "META_APP_SECRET",
      "META_VERIFY_TOKEN",
    ],
    path: "/api/webhooks/meta",
  },
  {
    id: "evolution",
    name: "WhatsApp QR",
    caption: "Evolution API · Oturum sağlayıcısı",
    icon: Radio,
    tone: "green",
    text: "Çoklu WhatsApp cihaz oturumları, QR ile hesap eşleştirme.",
    keys: [
      "EVOLUTION_API_URL",
      "EVOLUTION_API_KEY",
      "EVOLUTION_WEBHOOK_SECRET",
    ],
    path: "/api/webhooks/evolution",
  },
  {
    id: "netgsm",
    name: "Netgsm & SIP",
    caption: "OFİX PBX · Bulut PBX · FST",
    icon: Phone,
    tone: "blue",
    text: "SIP hatları ve FST cihazları için PBX ağ geçidi entegrasyonu.",
    keys: [
      "NETGSM_SIP_HOST",
      "NETGSM_SIP_USERNAME",
      "NETGSM_SIP_PASSWORD",
      "PBX_GATEWAY_URL",
      "PBX_GATEWAY_TOKEN",
    ],
    path: "/api/webhooks/inbound",
  },
  {
    id: "vapi",
    name: "Vapi AI",
    caption: "Yapay zekâ arama asistanı",
    icon: Sparkles,
    tone: "purple",
    text: "AI aramaları, transkript ve arama sonucunun CRM kaydına işlenmesi.",
    keys: [
      "VAPI_API_KEY",
      "VAPI_ASSISTANT_ID",
      "VAPI_LINE_MAP_JSON",
      "VAPI_WEBHOOK_SECRET",
    ],
    path: "/api/webhooks/vapi",
  },
  {
    id: "bitrix",
    name: "Bitrix24",
    caption: "Yerel uygulama & CRM",
    icon: Globe,
    tone: "blue",
    text: "Bitrix müşteri bağlamı ve mevcut WhatsApp uygulamasıyla birlikte çalışma.",
    keys: ["BITRIX_WEBHOOK", "BITRIX_DOMAIN"],
    path: "/api/bitrix/placement",
  },
  {
    id: "webhook",
    name: "Webhook & n8n",
    caption: "Gelen ve giden olaylar",
    icon: Webhook,
    tone: "amber",
    text: "Statü değişimleri ve uygulama olaylarını güvenli biçimde aktarın.",
    keys: ["INBOUND_WEBHOOK_SECRET", "OUTBOUND_WEBHOOK_SECRET"],
    path: "/api/webhooks/inbound",
  },
];
export default function Integrations({
  webhooks = false,
  local = false,
}: {
  webhooks?: boolean;
  local?: boolean;
}) {
  const { data, demo, user, request, refresh } = useStore();
  const [selected, setSelected] = useState<(typeof providers)[number] | null>(
    null,
  );
  const [status, setStatus] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState("");
  const [vapiCatalog, setVapiCatalog] = useState<VapiOptions | null>(null);
  const [vapiError, setVapiError] = useState("");
  const [vapiLoading, setVapiLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [context, setContext] = useState(data.leads[0]?.id || "");
  useEffect(() => {
    if (!demo && user)
      request("/api/integrations/status")
        .then(setStatus)
        .catch(() => {});
  }, [demo, user]);
  useEffect(() => {
    let active = true;
    setVapiCatalog(null);
    setVapiError("");
    setVapiLoading(false);
    if (selected?.id !== "vapi" || demo || !user) return;
    setVapiLoading(true);
    request("/api/integrations/vapi/catalog")
      .then((v: VapiOptions) => {
        if (active) setVapiCatalog(v);
      })
      .catch((e: Error) => {
        if (active) setVapiError(e.message);
      })
      .finally(() => {
        if (active) setVapiLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected?.id, demo, user?.openId]);
  const copy = (text: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Panoya kopyalandı."))
      .catch(() => toast.error("Panoya erişilemiyor."));
  async function test(id: string) {
    if (demo) {
      toast.info("Canlı bağlantı kontrolü için giriş yapıp canlı moda geçin.");
      return;
    }
    setBusy(id);
    try {
      const r = await request(`/api/integrations/${id}/test`, {});
      toast.success(r.message || "Bağlantı kontrolü tamamlandı.");
      setStatus((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          ...r,
          ...(id === "vapi"
            ? { connected: r.result?.accountVerified === true }
            : {}),
        },
      }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function retry(id: string) {
    if (demo) {
      toast.info("Demo olayları dış sistemlere gönderilemez.");
      return;
    }
    setBusy(id);
    try {
      await request(`/api/events/${id}/retry`, {});
      await refresh();
      toast.success("Olay yeniden denemeye alındı.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const downloadContext = () => {
    const lead = data.leads.find((l) => l.id === context);
    if (!lead) {
      toast.error("Müşteri seçin.");
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify({ source: "XRE CRM", demo, lead }, null, 2)], {
        type: "application/json",
      }),
    );
    a.download = "xre-musteri-baglami.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const base = window.location.origin;
  if (local)
    return (
      <>
        <PageTitle
          eyebrow="UYGULAMA EKOSİSTEMİ"
          title="Araçlarınız birlikte çalışsın."
          description="Bitrix24'ten verilerinizi taşıyın, CRM bağlamını yerel uygulamalara aktarın."
        />
        <BitrixImport />
        <div className="integration-grid">
          <article className="integration-card">
            <span className="provider-icon pbx">
              <Globe size={25} />
            </span>
            <h3>Bitrix24 yerel uygulama</h3>
            <p>
              Mevcut media.zip uygulamasının müşteri bağlamı ve doğrulanmış
              kullanıcı oturumlarıyla iletişim paneline erişin.
            </p>
            <Badge>Kurulum gerekli</Badge>
            <footer>
              <button
                className="btn secondary"
                onClick={() => setSelected(providers[4])}
              >
                Kurulum bilgileri
                <ArrowUpRight size={15} />
              </button>
            </footer>
          </article>
          <article className="integration-card">
            <span className="provider-icon vapi">
              <Terminal size={25} />
            </span>
            <h3>Müşteri bağlamı aktarımı</h3>
            <p>
              Seçili CRM müşterisinin bilgilerini JSON olarak alın ve yetkili
              yerel iş akışınızda kullanın.
            </p>
            <select
              value={context}
              onChange={(e) => setContext(e.target.value)}
              aria-label="Bağlam müşterisi"
            >
              {data.leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <footer>
              <button className="btn secondary" onClick={downloadContext}>
                <Download size={15} />
                JSON dışa aktar
              </button>
            </footer>
          </article>
          <article className="integration-card">
            <span className="provider-icon whatsapp">
              <Webhook size={25} />
            </span>
            <h3>n8n & HTTP uygulamaları</h3>
            <p>
              Kimliği doğrulanmış gelen webhook uç noktasıyla müşteri olaylarını
              CRM içine taşıyın.
            </p>
            <Badge tone="green">Olay kimliği ile tekrar koruması</Badge>
            <footer>
              <button
                className="btn secondary"
                onClick={() => setSelected(providers[5])}
              >
                Bağlantıyı yapılandır
                <ArrowUpRight size={15} />
              </button>
            </footer>
          </article>
        </div>
        {selected && renderModal()}
      </>
    );
  function renderModal() {
    if (!selected) return null;
    return (
      <Modal
        title={selected.name}
        subtitle={selected.caption}
        onClose={() => setSelected(null)}
      >
        <div className="modal-content">
          <div className="setup-notice">
            <ShieldCheck size={22} />
            <div>
              <strong>Gizli anahtarlar tarayıcıda saklanmaz.</strong>
              <p>
                Değerleri güvenli proje ortam değişkenlerinde yapılandırın. API
                anahtarı veya SIP parolasını mesaj olarak göndermeyin.
              </p>
            </div>
          </div>
          <h4 className="setup-heading">Gerekli sunucu değişkenleri</h4>
          <div className="env-list">
            {selected.keys.map((key) => (
              <div key={key}>
                <code>{key}</code>
                <Badge>
                  {selected.id === "vapi"
                    ? key === "VAPI_API_KEY" && status.vapi?.keyConfigured
                      ? "Güvenli kaydedildi"
                      : key === "VAPI_WEBHOOK_SECRET"
                        ? status.vapi?.webhookConfigured
                          ? "Yapılandırıldı"
                          : "Köprü gerekli"
                        : key === "VAPI_ASSISTANT_ID"
                          ? "Aramada seçilebilir"
                          : "Numarayla doğrulanır"
                    : status[selected.id]?.configured
                      ? "Yapılandırma mevcut"
                      : "Gerekli"}
                </Badge>
              </div>
            ))}
          </div>
          <h4 className="setup-heading">Webhook / uygulama uç noktası</h4>
          <div className="code-line">
            <code>
              {base}
              {selected.path}
            </code>
            <button
              className="icon-button"
              onClick={() => copy(base + selected.path)}
              aria-label="Uç noktayı kopyala"
            >
              <Copy size={16} />
            </button>
          </div>
          {selected.id === "evolution" && (
            <p className="setup-footnote">
              QR oturumları için sürekli çalışan bir Evolution API kurulumu
              gerekir. Bu CRM canlı oturum QR kodunu sağlayıcıdan alır; tek
              başına WhatsApp cihaz emülasyonu yapmaz.
            </p>
          )}
          {selected.id === "netgsm" && (
            <p className="setup-footnote">
              Netgsm SIP/FST sesi PBX ağ geçidinde çalışır. Ağ geçidinin URL ve
              erişim anahtarı eklenmeden canlı kayıt/arama durumu doğrulanamaz.
            </p>
          )}
          {selected.id === "vapi" && (
            <div className="vapi-account-status">
              {demo ? (
                <p className="setup-footnote">
                  Demo modunda gerçek Vapi hesabı sorgulanmaz.
                </p>
              ) : vapiLoading ? (
                <p role="status">Vapi hesabı doğrulanıyor…</p>
              ) : vapiError ? (
                <p role="alert">{vapiError}</p>
              ) : (
                vapiCatalog && (
                  <>
                    <strong>
                      API erişimi doğrulandı · {vapiCatalog.assistants.length}{" "}
                      asistan · {vapiCatalog.lines.length} eşleşmiş hat
                    </strong>
                    <div className="env-list">
                      {vapiCatalog.lines.map((l) => (
                        <div key={l.lineId}>
                          <span>
                            {l.phone} · {l.name}
                          </span>
                          <Badge tone="green">Numara eşleşti</Badge>
                        </div>
                      ))}
                    </div>
                    {!!vapiCatalog.unavailableLineIds.length && (
                      <p className="setup-footnote">
                        {vapiCatalog.unavailableLineIds.length} CRM hattı bu
                        Vapi hesabında eşleşmedi; bu hatlardan AI araması
                        başlatılmaz.
                      </p>
                    )}
                    <p className="setup-footnote">
                      Giden aramanın asistanını arama penceresinden seçin.
                      Mevcut Vapi→n8n bağlantıları değiştirilmez.{" "}
                      {vapiCatalog.webhookConfigured
                        ? "Webhook doğrulama sırrı mevcut; gerçek olay teslimi ayrıca doğrulanmalıdır."
                        : "CRM arama sonuçları için n8n aktarımı veya ayrı güvenli webhook kurulumu gereklidir."}
                    </p>
                  </>
                )
              )}
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <button className="btn secondary" onClick={() => setSelected(null)}>
            Kapat
          </button>
          <button
            className="btn primary"
            disabled={busy === selected.id}
            onClick={() => test(selected.id)}
          >
            <RefreshCw
              size={16}
              className={busy === selected.id ? "spin" : ""}
            />
            Bağlantıyı kontrol et
          </button>
        </footer>
      </Modal>
    );
  }
  return (
    <>
      <PageTitle
        eyebrow={webhooks ? "OLAY & VERİ AKIŞI" : "ENTEGRASYON MERKEZİ"}
        title={
          webhooks ? "Webhooklar ve olay akışı" : "Bağlantılarınızın merkezi."
        }
        description={
          webhooks
            ? "Gelen ve giden webhookları, işlem sonuçlarını ve yeniden denemeleri izleyin."
            : "WhatsApp, Netgsm, Vapi ve iş uygulamalarınızı CRM süreçlerinize bağlayın."
        }
        actions={
          <button
            className="btn secondary"
            onClick={() => {
              if (demo)
                toast.info("Demo modunda sağlayıcı durumu sorgulanmaz.");
              else
                request("/api/integrations/status")
                  .then((s) => {
                    setStatus(s);
                    toast.success("Durum güncellendi.");
                  })
                  .catch((e) => toast.error(e.message));
            }}
          >
            <RefreshCw size={16} />
            Durumu yenile
          </button>
        }
      />
      {webhooks ? (
        <>
          <WebhookHub />
          <div className="crm-toolbar">
            <h3>Olay günlüğü</h3>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Olay durumu filtresi"
            >
              <option value="all">Tüm durumlar</option>
              <option value="failed">Hatalı</option>
              <option value="success">Başarılı</option>
              <option value="pending">Planlandı / bekliyor</option>
              <option value="skipped">Koşul nedeniyle atlandı</option>
              <option value="needs_review">İnceleme gerekli</option>
              <option value="demo">Demo</option>
            </select>
          </div>
          <section className="panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>OLAY / AÇIKLAMA</th>
                    <th>TÜR</th>
                    <th>DURUM</th>
                    <th>ZAMAN</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.events
                    .filter((e) => filter === "all" || e.status === filter)
                    .map((e) => (
                      <tr key={e.id}>
                        <td>
                          <strong>{e.title}</strong>
                          <p className="table-detail">{e.detail}</p>
                          {(e as any).payload?.scheduledAt && (
                            <small>
                              Plan:{" "}
                              {new Date(
                                (e as any).payload.scheduledAt,
                              ).toLocaleString("tr-TR", {
                                timeZone: "Europe/Istanbul",
                              })}
                            </small>
                          )}
                        </td>
                        <td>
                          <Badge>{e.type}</Badge>
                        </td>
                        <td>
                          <Badge
                            tone={
                              e.status === "failed"
                                ? "red"
                                : [
                                      "demo",
                                      "pending",
                                      "needs_review",
                                      "skipped",
                                    ].includes(e.status)
                                  ? "amber"
                                  : "green"
                            }
                          >
                            {{
                              demo: "Demo",
                              pending: "Planlandı",
                              processing: "İşleniyor",
                              success: "Başarılı",
                              skipped: "Atlandı",
                              failed: "Hatalı",
                              needs_review: "İnceleme gerekli",
                            }[e.status] || e.status}
                          </Badge>
                        </td>
                        <td className="mono">
                          {new Date(e.createdAt).toLocaleString("tr-TR")}
                        </td>
                        <td>
                          {e.status === "failed" && (
                            <button
                              className="text-button"
                              disabled={busy === e.id}
                              onClick={() => retry(e.id)}
                            >
                              <RefreshCw size={14} />
                              Tekrar dene
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!data.events.length && (
                <Empty
                  title="Henüz webhook olayı yok"
                  description="Kimliği doğrulanmış olaylar bu günlüğe kaydedilir."
                />
              )}
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="integration-summary">
            <span className="integration-summary-icon">
              <Link2 size={23} />
            </span>
            <div>
              <strong>Birleşik iletişim, güvenli altyapı.</strong>
              <p>
                Gizli anahtarlar sunucuda saklanır. Canlı durumlar sağlayıcı
                yanıtıyla doğrulanır.
              </p>
            </div>
            <Badge tone="green">6 entegrasyon</Badge>
          </div>
          <div className="integration-grid">
            {providers.map((p) => (
              <article className="integration-card" key={p.id}>
                <div className="integration-card-top">
                  <span
                    className={`provider-icon ${p.tone === "green" ? "whatsapp" : p.tone === "purple" ? "vapi" : "pbx"}`}
                  >
                    <p.icon size={25} />
                  </span>
                  <Badge tone={status[p.id]?.connected ? "green" : "gray"}>
                    {status[p.id]?.connected
                      ? p.id === "vapi"
                        ? "API doğrulandı"
                        : "Bağlı"
                      : status[p.id]?.configured
                        ? p.id === "vapi"
                          ? "Anahtar kaydedildi"
                          : "Yapılandırıldı"
                        : "Kurulum gerekli"}
                  </Badge>
                </div>
                <h3>{p.name}</h3>
                <span className="integration-caption">{p.caption}</span>
                <p>{p.text}</p>
                <div className="integration-features">
                  <CheckCircle2 size={13} />
                  CRM ile ortak müşteri bağlamı
                </div>
                <footer>
                  <button
                    className="btn secondary"
                    onClick={() => setSelected(p)}
                  >
                    <Settings2 size={15} />
                    Yapılandır
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => test(p.id)}
                    aria-label={`${p.name} bağlantı kontrolü`}
                  >
                    <RefreshCw size={16} />
                  </button>
                </footer>
              </article>
            ))}
          </div>
        </>
      )}
      {!local && <AIIntegration />}
      <div className="info-banner slim">
        <ShieldCheck size={18} />
        <p>
          Mevcut CRM ve WhatsApp kaynakları korunmuştur. Eski arşivdeki gizli
          ayarlar ve özel medya bu arayüze aktarılmamıştır.
        </p>
      </div>
      {selected && renderModal()}
    </>
  );
}
