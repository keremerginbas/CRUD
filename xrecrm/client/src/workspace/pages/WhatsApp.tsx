import {
  openOnlineMeeting,
  openCustomerCall,
} from "../components/LeadQuickActions";
import { meetingShareText } from "../components/OnlineMeeting";
import { Video, CalendarClock } from "lucide-react";
import { dateTimeLabel } from "../suite";
import { useState, useEffect } from "react";
import {
  MessageCircle,
  Search,
  Plus,
  ChevronDown,
  Send,
  Paperclip,
  Phone,
  MoreHorizontal,
  ArrowUpRight,
  CheckCheck,
  QrCode,
  RefreshCw,
  Smartphone,
  ShieldCheck,
  Copy,
  Link2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { lines, formatPhone, Lead } from "../data";
import { PageTitle, Badge, Avatar, Modal, Empty } from "../components/ui";
export default function WhatsApp({
  initialLead,
  onLead,
  initialDraft,
  onDraftConsumed,
}: {
  initialLead?: string;
  initialDraft?: string;
  onDraftConsumed?: () => void;
  onLead: (l: Lead) => void;
}) {
  const { data, demo, sendMessage, request, user } = useStore();
  const [tab, setTab] = useState("inbox");
  const [selected, setSelected] = useState(
    initialLead || data.leads[0]?.id || "",
  );
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [line, setLine] = useState("office-2");
  const [qrLine, setQrLine] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [qrError, setQrError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (initialLead) {
      setSelected(initialLead);
      setMessage(initialDraft || "");
    }
  }, [initialLead]);
  useEffect(() => {
    if (initialDraft) {
      setMessage(initialDraft);
      onDraftConsumed?.();
    }
  }, [initialDraft]);
  const can = (m: string) =>
    demo || user?.isOwner || !!user?.permissions?.[m]?.write;
  const lead = data.leads.find((l) => l.id === selected);
  const messages = data.messages.filter((m) => m.leadId === selected);
  const contacts = data.leads.filter((l) =>
    `${l.name} ${l.phone}`.toLowerCase().includes(query.toLowerCase()),
  );
  async function loadQr(id: string) {
    setQrLine(id);
    setQr(null);
    setQrError("");
    setBusy(true);
    try {
      if (demo)
        throw new Error(
          "Gerçek QR üretmek için giriş yapın, canlı moda geçin ve Evolution API oturum sağlayıcısını yapılandırın. Örnek QR kodu gösterilmez.",
        );
      const r = await request(`/api/connections/${id}/qr`, {});
      const image =
        typeof r === "string" ? r : r.base64 || r.qr || r.qrcode?.base64;
      if (!image) throw new Error(r.message || "Sağlayıcı henüz QR üretmedi.");
      setQr(
        image.startsWith("data:") ? image : `data:image/png;base64,${image}`,
      );
    } catch (e) {
      setQrError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!message.trim() || !lead) return;
    setSending(true);
    try {
      await sendMessage(lead.id, line, message.trim());
      setMessage("");
      toast.success(
        demo
          ? "Demo mesajı eklendi. Gerçek mesaj gönderilmedi."
          : "Mesaj sağlayıcıya iletildi.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  const lineItem = lines.find((l) => l.id === qrLine);
  return (
    <>
      <PageTitle
        eyebrow="İLETİŞİM MERKEZİ"
        title="Sohbetten güçlü ilişkilere."
        description="WhatsApp görüşmelerini müşterilerinizle eşleştirin, ekibinizle birlikte yanıtlayın."
        actions={
          <button
            className="btn primary"
            onClick={() => {
              setTab("connections");
              loadQr("office-2");
            }}
          >
            <Plus size={17} />
            Hesap bağla
          </button>
        }
      />
      <div className="page-tabs">
        <button
          className={tab === "inbox" ? "active" : ""}
          onClick={() => setTab("inbox")}
        >
          <MessageCircle size={16} />
          Gelen kutusu<Badge>{data.messages.length}</Badge>
        </button>
        <button
          className={tab === "connections" ? "active" : ""}
          onClick={() => setTab("connections")}
        >
          <Link2 size={16} />
          Bağlantılar<Badge>{lines.length}</Badge>
        </button>
        <span className="tabs-note">
          <ShieldCheck size={14} />
          QR oturumu & Meta Cloud API
        </span>
      </div>
      {tab === "inbox" ? (
        <section className="inbox-panel">
          <aside className="conversation-list">
            <div className="inbox-title">
              <h3>Tüm konuşmalar</h3>
              <Badge tone="green">{contacts.length}</Badge>
            </div>
            <div className="search-field compact">
              <Search size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Konuşma ara…"
              />
            </div>
            <div className="conversations">
              {contacts.map((l, i) => {
                const last = data.messages
                  .filter((m) => m.leadId === l.id)
                  .at(-1);
                return (
                  <button
                    key={l.id}
                    className={`conversation ${selected === l.id ? "selected" : ""}`}
                    onClick={() => {
                      setSelected(l.id);
                      setMessage("");
                    }}
                  >
                    <Avatar name={l.name} size={40} />
                    <div>
                      <div>
                        <strong>{l.name}</strong>
                        <time>
                          {new Date(
                            last?.createdAt || l.lastActivity,
                          ).toLocaleTimeString("tr-TR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      <p>{last?.text || l.company}</p>
                      <span>
                        <MessageCircle size={10} />
                        {l.source} · {l.owner}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="inbox-bottom">
              <span className="green-dot" />
              {demo ? "Örnek görüşmeler" : "CRM konuşmaları"}
            </div>
          </aside>
          <div className="chat-main">
            {lead ? (
              <>
                <header className="chat-header">
                  <Avatar name={lead.name} size={39} />
                  <div>
                    <strong>{lead.name}</strong>
                    <p>
                      {lead.phone}{" "}
                      <span>· {demo ? "Örnek müşteri" : "CRM müşterisi"}</span>
                    </p>
                  </div>
                  <button
                    className="btn secondary small"
                    onClick={() => onLead(lead)}
                  >
                    CRM kaydı
                    <ArrowUpRight size={14} />
                  </button>
                  <button
                    className="btn secondary small"
                    disabled={!can("calls") || !lead.phone}
                    onClick={() => openCustomerCall(lead.id)}
                  >
                    <Phone size={15} />
                    Ara
                  </button>
                  <button
                    className="btn primary small"
                    disabled={!can("calendar")}
                    onClick={() => openOnlineMeeting(lead.id)}
                  >
                    <Video size={15} />
                    Online toplantı
                  </button>
                </header>
                <div className="chat-messages">
                  <div className="date-divider">
                    Bugün{" "}
                    <span>{demo ? "Demo görüşmesi" : "Mesaj geçmişi"}</span>
                  </div>
                  {data.activities
                    .filter(
                      (a) =>
                        a.leadId === lead.id &&
                        !a.cancelled &&
                        (a.meetingUrl || a.conferenceStatus),
                    )
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                    .map((a) => (
                      <article key={a.id} className="v6-chat-meeting">
                        <header>
                          <Video size={17} />
                          {a.title}
                        </header>
                        <p>
                          <CalendarClock size={12} /> {dateTimeLabel(a.startAt)}{" "}
                          · {a.assignee}
                        </p>
                        {a.meetingUrl ? (
                          <div>
                            <a
                              href={a.meetingUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Toplantıya katıl <ExternalLink size={12} />
                            </a>
                            <button
                              className="text-button"
                              onClick={() =>
                                navigator.clipboard
                                  .writeText(a.meetingUrl!)
                                  .then(() =>
                                    toast.success("Bağlantı kopyalandı."),
                                  )
                                  .catch(() =>
                                    toast.error("Panoya erişilemedi."),
                                  )
                              }
                            >
                              <Copy size={12} />
                              Kopyala
                            </button>
                            <button
                              className="text-button"
                              onClick={() =>
                                setMessage(meetingShareText(a, lead.name))
                              }
                            >
                              <MessageCircle size={12} />
                              Mesaj taslağı
                            </button>
                          </div>
                        ) : (
                          <p>
                            {demo
                              ? "Demo planı · Meet bağlantısı oluşturulmadı"
                              : "Konferans bağlantısı henüz hazır değil"}
                          </p>
                        )}
                      </article>
                    ))}
                  {messages.map((m) => (
                    <div className={`message-bubble ${m.direction}`} key={m.id}>
                      {m.text}
                      <span>
                        {new Date(m.createdAt).toLocaleTimeString("tr-TR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {m.direction === "outbound" && <CheckCheck size={13} />}
                      </span>
                    </div>
                  ))}
                  {!messages.length && (
                    <Empty
                      title="İlk mesajı yazın"
                      description="Bu müşteriyle görüşmeniz burada görünecek."
                    />
                  )}
                </div>
                <div className="composer">
                  <div className="composer-line">
                    <MessageCircle size={13} />
                    <select
                      value={line}
                      onChange={(e) => setLine(e.target.value)}
                      aria-label="Gönderen hat"
                    >
                      {lines.map((l) => (
                        <option value={l.id} key={l.id}>
                          {formatPhone(l.phone)}
                        </option>
                      ))}
                    </select>
                    <Badge tone={demo ? "amber" : "gray"}>
                      {demo
                        ? "Demo · Gönderim yapılmaz"
                        : "Sağlayıcı doğrulaması gerekli"}
                    </Badge>
                  </div>
                  <div className="composer-input">
                    <textarea
                      rows={2}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Mesajınızı yazın…"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                    />
                    <button
                      className="btn primary"
                      onClick={send}
                      disabled={sending || !message.trim()}
                      aria-label="Mesaj gönder"
                    >
                      <Send size={17} />
                    </button>
                  </div>
                  <div className="composer-note">
                    Enter ile gönder · Shift + Enter ile yeni satır
                  </div>
                </div>
              </>
            ) : (
              <Empty
                title="Bir müşteri seçin"
                description="Görüşme başlatmak için önce CRM müşterisi ekleyin."
              />
            )}
          </div>
        </section>
      ) : (
        <>
          <div className="info-banner">
            <ShieldCheck size={19} />
            <div>
              <strong>Her hat için bağımsız bağlantı.</strong>
              <p>
                QR bağlantısı için Evolution API gerekir. Meta Cloud API
                hesapları erişim anahtarı ile bağlanır. Envanter, doğrulanmış
                WhatsApp hesabı anlamına gelmez.
              </p>
            </div>
          </div>
          <div className="connection-grid">
            {lines.map((l) => {
              const connection = data.connections.find((c) => c.id === l.id);
              const connected = connection?.status === "connected";
              return (
                <article className="connection-card" key={l.id}>
                  <div className="connection-card-title">
                    <span className="provider-icon whatsapp">
                      <MessageCircle size={19} />
                    </span>
                    <div>
                      <h3>
                        XRE{" "}
                        {l.group === "ai"
                          ? "AI"
                          : l.group === "office"
                            ? "Ofis"
                            : "Bulut"}{" "}
                        {l.id.split("-")[1]}
                      </h3>
                      <p>{formatPhone(l.phone)}</p>
                    </div>
                    <MoreHorizontal size={18} />
                  </div>
                  <Badge tone={connected ? "green" : "gray"}>
                    {connected ? "Bağlı" : "Bağlantı bekleniyor"}
                  </Badge>
                  <dl>
                    <div>
                      <dt>Bağlantı türü</dt>
                      <dd>QR / Cloud API</dd>
                    </div>
                    <div>
                      <dt>Hat kimliği</dt>
                      <dd>{l.id}</dd>
                    </div>
                    <div>
                      <dt>CRM eşleştirmesi</dt>
                      <dd>Telefon numarası</dd>
                    </div>
                  </dl>
                  <footer>
                    <button
                      className="btn secondary small"
                      onClick={() => loadQr(l.id)}
                    >
                      <QrCode size={15} />
                      QR ile bağla
                    </button>
                    <span className="muted">
                      {connected ? "Oturum açık" : "Henüz doğrulanmadı"}
                    </span>
                  </footer>
                </article>
              );
            })}
          </div>
        </>
      )}
      {qrLine && (
        <Modal
          title="WhatsApp hesabını bağlayın"
          subtitle={formatPhone(lineItem?.phone || "")}
          onClose={() => setQrLine(null)}
        >
          <div className="qr-modal">
            <div className="qr-instructions">
              <span>1</span>
              <p>
                Telefonunuzda <strong>WhatsApp’ı</strong> açın.
              </p>
              <span>2</span>
              <p>
                <strong>Ayarlar → Bağlı cihazlar</strong> bölümüne gidin.
              </p>
              <span>3</span>
              <p>“Cihaz bağla” seçeneğiyle QR kodu tarayın.</p>
            </div>
            <div className={`qr-space ${qr ? "ready" : ""}`}>
              {busy ? (
                <>
                  <RefreshCw size={30} className="spin" />
                  <p>Güvenli oturum oluşturuluyor…</p>
                </>
              ) : qr ? (
                <img src={qr} alt="WhatsApp gerçek oturum QR kodu" />
              ) : (
                <>
                  <QrCode size={65} strokeWidth={1} />
                  <h3>Oturum sağlayıcısı gerekli</h3>
                  <p>{qrError}</p>
                </>
              )}
            </div>
            <button
              className="btn secondary full-width"
              onClick={() => loadQr(qrLine)}
              disabled={busy}
            >
              <RefreshCw size={16} />
              QR kodunu yenile
            </button>
            <div className="qr-note">
              <ShieldCheck size={15} />
              QR kod yalnızca sağlayıcıdan alındığında gösterilir.
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
