import {
  openOnlineMeeting,
  openCustomerCall,
} from "../components/LeadQuickActions";
import { meetingShareText } from "../components/OnlineMeeting";
import { Video, CalendarClock } from "lucide-react";
import { dateTimeLabel } from "../suite";
import { useState, useEffect, useRef } from "react";
import WhatsAppInbox from "../components/WhatsAppInbox";
import "../pbx.css";
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
  const { data, demo, sendMessage, request, user, refresh } = useStore();
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
  const fileInput = useRef<HTMLInputElement>(null);
  async function sendFile(file: File) {
    if (!lead) return;
    if (demo) {
      toast.info("Demo modu: dosya gönderilmedi.");
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      toast.error("Dosya 16 MB'den büyük olamaz.");
      return;
    }
    setSending(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Dosya okunamadı."));
        reader.readAsDataURL(file);
      });
      await request("/api/messages/media", {
        leadId: lead.id,
        lineId: line,
        caption: message.trim(),
        fileName: file.name,
        mime: file.type || "application/octet-stream",
        data,
      });
      setMessage("");
      await refresh();
      toast.success("Dosya gönderildi.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
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
  // Bağlantılar sekmesinde Evolution'daki gerçek durum ve bağlı numara okunur.
  const syncConnections = async () => {
    if (demo || !user) return;
    try {
      await request("/api/whatsapp/connections/sync", {});
      await refresh();
    } catch {
      /* Evolution kapalıysa kartlar son bilinen durumu gösterir */
    }
  };
  useEffect(() => {
    if (tab === "connections") void syncConnections();
  }, [tab]);
  // QR açıkken eşleşme tamamlanınca pencereyi kendiliğinden kapat.
  useEffect(() => {
    if (!qrLine || !qr || demo) return;
    const timer = setInterval(async () => {
      await syncConnections();
    }, 4000);
    return () => clearInterval(timer);
  }, [qrLine, qr]);
  useEffect(() => {
    if (!qrLine || !qr) return;
    const c = data.connections.find((x) => x.id === qrLine);
    if (c?.status === "connected") {
      toast.success(`WhatsApp bağlandı${c.phone ? `: ${formatPhone(`+${c.phone}`)}` : ""}.`);
      setQrLine(null);
      setQr(null);
    }
  }, [data.connections, qrLine, qr]);
  const lineItem = lines.find((l) => l.id === qrLine);
  return (
    <>
      <PageTitle
        eyebrow="İLETİŞİM MERKEZİ"
        title="Sohbetten güçlü ilişkilere."
        description="Kayıtlı olsun olmasın herkese yazın. QR ile bağlı hatlarda ilk mesaj için şablon gerekmez."
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
        <WhatsAppInbox
          initialLead={initialLead}
          initialDraft={initialDraft}
          onDraftConsumed={onDraftConsumed}
          onLead={onLead}
        />
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
                      <p>
                        {connected && connection?.phone
                          ? formatPhone(`+${connection.phone}`)
                          : formatPhone(l.phone)}
                        {connected && connection?.profileName
                          ? ` · ${connection.profileName}`
                          : ""}
                      </p>
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
                    {connected &&
                      connection?.phone &&
                      normalizeDigits(connection.phone) !==
                        normalizeDigits(l.phone) && (
                        <div>
                          <dt>Envanterdeki numara</dt>
                          <dd title="Hat yönetiminden güncelleyebilirsiniz">
                            {formatPhone(l.phone)}
                          </dd>
                        </div>
                      )}
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
                      {connected ? "Yeniden bağla" : "QR ile bağla"}
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

function MessageMedia({ m }: { m: { mediaId?: string; mediaType?: string; fileName?: string; mime?: string } }) {
  if (!m.mediaId) return null;
  const url = `/api/media/${m.mediaId}`;
  if (m.mediaType === "image")
    return (
      <a href={url} target="_blank" rel="noreferrer" className="message-media">
        <img src={url} alt={m.fileName || "Fotoğraf"} loading="lazy" />
      </a>
    );
  if (m.mediaType === "audio") return <audio className="message-media" controls preload="none" src={url} />;
  if (m.mediaType === "video") return <video className="message-media" controls preload="metadata" src={url} />;
  return (
    <a className="message-file" href={`${url}?download`} target="_blank" rel="noreferrer">
      <Paperclip size={14} /> {m.fileName || "Belge"}
    </a>
  );
}

const normalizeDigits = (v: string) => {
  let d = String(v || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 11) d = `90${d.slice(1)}`;
  return d;
};
