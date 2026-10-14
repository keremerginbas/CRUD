// WhatCRM tarzı gelen kutusu: sohbetler numaraya göre gruplanır; kayıtlı olmayan
// numaralarla yazışılabilir, istenirse sohbetten müşteri oluşturulur.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCheck,
  FileText,
  MessageCirclePlus,
  Paperclip,
  Phone,
  Search,
  Send,
  UserPlus,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { formatPhone, lines, type Lead } from "../data";
import { Avatar, Badge, Empty, Modal } from "./ui";
import { openCustomerCall, openOnlineMeeting } from "./LeadQuickActions";
import "../whatsapp-inbox.css";

export function normalizePhone(raw: unknown): string {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = `90${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("5")) digits = `90${digits}`;
  return digits;
}

interface Msg {
  id: string;
  leadId?: string | null;
  phone?: string;
  contactName?: string | null;
  lineId?: string | null;
  provider?: string;
  direction: "inbound" | "outbound";
  text: string;
  status: string;
  createdAt: string;
  mediaId?: string;
  mediaType?: string;
  fileName?: string;
  templateName?: string;
}

interface Conversation {
  key: string;
  lead: Lead | null;
  phone: string;
  name: string;
  messages: Msg[];
  last?: Msg;
  waiting: boolean;
}

interface WaLine {
  lineId: string;
  phone: string;
  provider: "evolution" | "meta";
}

interface Template {
  name: string;
  language: string;
  body: string;
  params: number;
}

const DAY = 86_400_000;
const time = (iso: string) => {
  const d = new Date(iso);
  return Date.now() - d.getTime() < DAY && d.getDate() === new Date().getDate()
    ? d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
};

export default function WhatsAppInbox({
  initialLead,
  initialDraft,
  onDraftConsumed,
  onLead,
}: {
  initialLead?: string;
  initialDraft?: string;
  onDraftConsumed?: () => void;
  onLead: (l: Lead) => void;
}) {
  const { data, demo, user, request, refresh, sendMessage } = useStore();
  const [selected, setSelected] = useState(initialLead ? `l:${initialLead}` : "");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "waiting" | "unsaved">("all");
  const [text, setText] = useState(initialDraft || "");
  const [waLines, setWaLines] = useState<WaLine[] | null>(null);
  const [lineId, setLineId] = useState("");
  const [sending, setSending] = useState(false);
  const [newChat, setNewChat] = useState<{ phone: string; text: string; check?: string } | null>(null);
  const [saveContact, setSaveContact] = useState<{ phone: string; name: string } | null>(null);
  const [templates, setTemplates] = useState<{ list: Template[]; pick?: Template; params: string[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const live = !demo && Boolean(user);

  useEffect(() => {
    if (initialDraft) onDraftConsumed?.();
  }, []);
  useEffect(() => {
    if (!live) {
      setWaLines(lines.slice(0, 6).map((l) => ({ lineId: l.id, phone: l.phone, provider: "evolution" as const })));
      return;
    }
    request("/api/whatsapp/lines")
      .then((r) => setWaLines(r.lines))
      .catch(() => setWaLines([]));
  }, [live]);

  const conversations = useMemo(() => {
    const leadById = new Map(data.leads.map((l) => [l.id, l]));
    const leadByPhone = new Map(data.leads.map((l) => [normalizePhone(l.phone), l]));
    const map = new Map<string, Conversation>();
    for (const m of data.messages as Msg[]) {
      const lead = (m.leadId && leadById.get(m.leadId)) || (m.phone ? leadByPhone.get(normalizePhone(m.phone)) : undefined) || null;
      const phone = normalizePhone(lead?.phone || m.phone || "");
      const key = lead ? `l:${lead.id}` : `p:${phone}`;
      if (!lead && !phone) continue;
      const conv = map.get(key) || { key, lead, phone, name: lead?.name || "", messages: [], waiting: false };
      conv.messages.push(m);
      if (!conv.name && m.contactName) conv.name = m.contactName;
      map.set(key, conv);
    }
    if (initialLead && !map.has(`l:${initialLead}`)) {
      const lead = leadById.get(initialLead);
      if (lead) map.set(`l:${lead.id}`, { key: `l:${lead.id}`, lead, phone: normalizePhone(lead.phone), name: lead.name, messages: [], waiting: false });
    }
    if (selected.startsWith("p:") && !map.has(selected)) {
      const phone = selected.slice(2);
      map.set(selected, { key: selected, lead: null, phone, name: "", messages: [], waiting: false });
    }
    const list = [...map.values()].map((c) => {
      c.messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      c.last = c.messages.at(-1);
      c.waiting = c.last?.direction === "inbound";
      if (!c.name) c.name = formatPhone(`+${c.phone}`);
      return c;
    });
    return list.sort((a, b) => (b.last?.createdAt || "").localeCompare(a.last?.createdAt || ""));
  }, [data.messages, data.leads, initialLead, selected]);

  const visible = conversations.filter(
    (c) =>
      (filter === "all" || (filter === "waiting" ? c.waiting : !c.lead)) &&
      (!query.trim() ||
        `${c.name} ${c.phone} ${c.last?.text || ""}`
          .toLocaleLowerCase("tr-TR")
          .includes(query.trim().toLocaleLowerCase("tr-TR")) ||
        (normalizePhone(query).length >= 4 && c.phone.includes(normalizePhone(query)))),
  );
  const conv = conversations.find((c) => c.key === selected) || (selected ? undefined : conversations[0]);

  useEffect(() => {
    if (!conv || !waLines?.length) return;
    const used = [...conv.messages].reverse().find((m) => m.lineId && waLines.some((l) => l.lineId === m.lineId))?.lineId;
    setLineId((current) => used || (waLines.some((l) => l.lineId === current) ? current : waLines[0].lineId));
  }, [conv?.key, waLines]);
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [conv?.key, conv?.messages.length]);

  const line = waLines?.find((l) => l.lineId === lineId);
  const lastInbound = conv?.messages.filter((m) => m.direction === "inbound").at(-1);
  const metaWindowClosed =
    line?.provider === "meta" && (!lastInbound || Date.now() - Date.parse(lastInbound.createdAt) > DAY);

  const target = (c: Conversation) => (c.lead ? { leadId: c.lead.id } : { to: c.phone });

  async function send() {
    if (!conv || !text.trim()) return;
    if (!live) {
      if (conv.lead) {
        await sendMessage(conv.lead.id, lineId, text.trim());
        setText("");
        toast.info("Demo: mesaj eklendi, gerçekte gönderilmedi.");
      } else toast.info("Demo modunda kayıtsız numaraya mesaj gönderilmez.");
      return;
    }
    if (!lineId) {
      toast.error("Gönderilecek WhatsApp hattını seçin.");
      return;
    }
    setSending(true);
    try {
      await request("/api/whatsapp/send", { ...target(conv), lineId, text: text.trim() });
      setText("");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function sendFile(file: File) {
    if (!conv) return;
    if (!live) return void toast.info("Demo modunda dosya gönderilmez.");
    if (file.size > 16 * 1024 * 1024) return void toast.error("Dosya 16 MB'den büyük olamaz.");
    setSending(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Dosya okunamadı."));
        reader.readAsDataURL(file);
      });
      await request("/api/messages/media", {
        ...target(conv),
        lineId,
        caption: text.trim(),
        fileName: file.name,
        mime: file.type || "application/octet-stream",
        data: dataUrl,
      });
      setText("");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function startChat() {
    if (!newChat) return;
    const phone = normalizePhone(newChat.phone);
    if (phone.length < 10) return void toast.error("Geçerli bir numara girin (ör. 0532 123 45 67).");
    const existing = conversations.find((c) => c.phone === phone);
    if (!newChat.text.trim()) {
      setSelected(existing?.key || `p:${phone}`);
      setNewChat(null);
      return;
    }
    if (!live) return void toast.info("Demo modunda yeni numaraya mesaj gönderilmez.");
    setSending(true);
    try {
      await request("/api/whatsapp/send", { to: phone, lineId, text: newChat.text.trim() });
      await refresh();
      setSelected(existing?.key || `p:${phone}`);
      setNewChat(null);
      toast.success("Mesaj gönderildi.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function checkNumber() {
    if (!newChat) return;
    if (!live) return void setNewChat({ ...newChat, check: "Demo modunda kontrol yapılmaz." });
    try {
      const r = await request("/api/whatsapp/check", { lineId, phone: newChat.phone });
      setNewChat({
        ...newChat,
        check: !r.checked
          ? "Kontrol için QR (Evolution) hattı gerekli."
          : r.exists
            ? `✓ Bu numara WhatsApp kullanıyor${r.name ? ` (${r.name})` : ""}.`
            : "✗ Bu numara WhatsApp'ta bulunamadı.",
      });
    } catch (e) {
      setNewChat({ ...newChat, check: (e as Error).message });
    }
  }

  async function doSaveContact() {
    if (!saveContact) return;
    try {
      const r = await request("/api/whatsapp/contacts", saveContact);
      await refresh();
      setSelected(`l:${r.lead.id}`);
      setSaveContact(null);
      toast.success(`${r.lead.name} müşteri olarak kaydedildi${r.linked ? `, ${r.linked} mesaj bağlandı` : ""}.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function openTemplates() {
    try {
      const r = await request("/api/whatsapp/templates");
      setTemplates({ list: r.templates, params: [] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function sendTemplate() {
    if (!templates?.pick || !conv) return;
    let preview = templates.pick.body;
    templates.params.forEach((p, i) => (preview = preview.replace(`{{${i + 1}}}`, p)));
    try {
      await request("/api/whatsapp/template", {
        ...target(conv),
        lineId,
        name: templates.pick.name,
        language: templates.pick.language,
        params: templates.params,
        preview,
      });
      setTemplates(null);
      await refresh();
      toast.success("Şablon gönderildi.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const lineLabel = (l: WaLine) => `${formatPhone(l.phone)} · ${l.provider === "evolution" ? "QR" : "Meta"}`;

  return (
    <section className="inbox-panel wa-inbox">
      <aside className="conversation-list">
        <div className="inbox-title">
          <h3>Sohbetler</h3>
          <button className="btn primary small" onClick={() => setNewChat({ phone: "", text: "" })}>
            <MessageCirclePlus size={15} /> Yeni sohbet
          </button>
        </div>
        <div className="search-field compact">
          <Search size={16} />
          <input id="wa-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="İsim, numara veya mesaj ara…" />
        </div>
        <div className="wa-filters" role="tablist">
          {([
            ["all", "Tümü", conversations.length],
            ["waiting", "Yanıt bekleyen", conversations.filter((c) => c.waiting).length],
            ["unsaved", "Kayıtsız", conversations.filter((c) => !c.lead).length],
          ] as const).map(([id, label, count]) => (
            <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>
              {label} <b>{count}</b>
            </button>
          ))}
        </div>
        <div className="conversations">
          {visible.map((c) => (
            <button key={c.key} className={`conversation ${conv?.key === c.key ? "selected" : ""}`} onClick={() => setSelected(c.key)}>
              <Avatar name={c.name} size={40} />
              <div>
                <div>
                  <strong>{c.name}</strong>
                  <time>{c.last ? time(c.last.createdAt) : ""}</time>
                </div>
                <p>
                  {c.last?.direction === "outbound" && <CheckCheck size={12} />} {c.last?.text || "Henüz mesaj yok"}
                </p>
                <span>
                  {c.lead ? <Badge tone="blue">Müşteri</Badge> : <Badge tone="gray">Kayıtsız</Badge>}
                  {c.waiting && <Badge tone="amber">Yanıt bekliyor</Badge>}
                </span>
              </div>
            </button>
          ))}
          {!visible.length && <Empty title="Sohbet yok" description="Yeni sohbet başlatın veya gelen mesajları bekleyin." />}
        </div>
      </aside>
      <div className="chat-main">
        {conv ? (
          <>
            <header className="chat-header">
              <Avatar name={conv.name} size={39} />
              <div>
                <strong>{conv.name}</strong>
                <p>
                  {formatPhone(`+${conv.phone}`)} <span>· {conv.lead ? "CRM müşterisi" : "Kayıtsız numara"}</span>
                </p>
              </div>
              {conv.lead ? (
                <button className="btn secondary small" onClick={() => onLead(conv.lead!)}>
                  CRM kaydı <ArrowUpRight size={14} />
                </button>
              ) : (
                <button className="btn primary small" onClick={() => setSaveContact({ phone: conv.phone, name: conv.name.startsWith("+") ? "" : conv.name })}>
                  <UserPlus size={14} /> Müşteri olarak kaydet
                </button>
              )}
              {conv.lead && (
                <>
                  <button className="btn secondary small" onClick={() => openCustomerCall(conv.lead!.id)}>
                    <Phone size={15} /> Ara
                  </button>
                  <button className="btn secondary small" onClick={() => openOnlineMeeting(conv.lead!.id)}>
                    <Video size={15} /> Toplantı
                  </button>
                </>
              )}
            </header>
            <div className="chat-messages">
              {conv.messages.map((m) => (
                <div className={`message-bubble ${m.direction}`} key={m.id}>
                  {m.mediaId && <MediaPreview m={m} />}
                  {m.templateName && <small className="wa-template-tag">Şablon · {m.templateName}</small>}
                  {m.mediaId && /^\[.+\]$/.test(m.text) ? null : m.text}
                  <span>
                    {new Date(m.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                    {m.direction === "outbound" && <CheckCheck size={13} />}
                  </span>
                </div>
              ))}
              {!conv.messages.length && <Empty title="İlk mesajı siz yazın" description="QR ile bağlı hattan şablon gerekmeden yazabilirsiniz." />}
              <div ref={bottom} />
            </div>
            <div className="composer">
              <div className="composer-line">
                <select id="wa-line" value={lineId} onChange={(e) => setLineId(e.target.value)} aria-label="Gönderen hat">
                  {(waLines || []).map((l) => (
                    <option key={l.lineId} value={l.lineId}>{lineLabel(l)}</option>
                  ))}
                  {waLines && !waLines.length && <option value="">Bağlı hat yok</option>}
                </select>
                {waLines && !waLines.length && <Badge tone="amber">Bağlantılar sekmesinden QR ile hat bağlayın</Badge>}
                {line?.provider === "evolution" && <Badge tone="green">QR · şablonsuz yazılabilir</Badge>}
              </div>
              {metaWindowClosed && (
                <div className="wa-window">
                  <AlertCircle size={16} />
                  <span>24 saat penceresi kapalı: bu Meta hattından yalnız onaylı şablon gönderilebilir. QR hattı seçerseniz serbest yazabilirsiniz.</span>
                  <button className="btn secondary small" onClick={() => void openTemplates()}>
                    <FileText size={14} /> Şablon gönder
                  </button>
                </div>
              )}
              <div className="composer-input">
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void sendFile(f);
                  }}
                />
                <button className="icon-button" aria-label="Dosya ekle" disabled={sending || metaWindowClosed} onClick={() => fileInput.current?.click()}>
                  <Paperclip size={17} />
                </button>
                <textarea
                  id="wa-text"
                  rows={2}
                  value={text}
                  disabled={metaWindowClosed}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={metaWindowClosed ? "Şablon gönderin veya QR hattı seçin" : "Mesajınızı yazın…"}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <button className="btn primary" onClick={() => void send()} disabled={sending || !text.trim() || metaWindowClosed} aria-label="Mesaj gönder">
                  <Send size={17} />
                </button>
              </div>
              <div className="composer-note">Enter ile gönder · Shift + Enter yeni satır</div>
            </div>
          </>
        ) : (
          <Empty title="Bir sohbet seçin" description="Veya “Yeni sohbet” ile kayıtlı olmayan bir numaraya yazın." />
        )}
      </div>

      {newChat && (
        <Modal title="Yeni sohbet" subtitle="Kayıtlı olmayan bir numaraya da yazabilirsiniz" onClose={() => setNewChat(null)}>
          <div className="modal-content form-grid">
            <label className="full">
              Telefon numarası
              <input id="wa-new-phone" autoFocus inputMode="tel" placeholder="0532 123 45 67" value={newChat.phone} onChange={(e) => setNewChat({ ...newChat, phone: e.target.value, check: undefined })} />
            </label>
            <label className="full">
              Gönderen hat
              <select id="wa-new-line" value={lineId} onChange={(e) => setLineId(e.target.value)}>
                {(waLines || []).map((l) => (
                  <option key={l.lineId} value={l.lineId}>{lineLabel(l)}</option>
                ))}
              </select>
            </label>
            <label className="full">
              İlk mesaj
              <textarea id="wa-new-text" rows={4} value={newChat.text} placeholder="Merhaba, XRE Gayrimenkul'den yazıyorum…" onChange={(e) => setNewChat({ ...newChat, text: e.target.value })} />
            </label>
            <div className="full wa-check">
              <button className="text-button" onClick={() => void checkNumber()}>Numara WhatsApp'ta var mı?</button>
              {newChat.check && <span>{newChat.check}</span>}
            </div>
            {line?.provider === "meta" && (
              <p className="full setup-footnote">Seçili hat Meta (resmî API). Size yazmamış bir kişiye ilk mesaj için şablon gerekir; QR hattı seçin.</p>
            )}
          </div>
          <footer className="modal-footer">
            <button className="btn secondary" onClick={() => setNewChat(null)}>Vazgeç</button>
            <button className="btn primary" disabled={sending || !newChat.phone} onClick={() => void startChat()}>
              <Send size={15} /> {newChat.text.trim() ? "Gönder" : "Sohbeti aç"}
            </button>
          </footer>
        </Modal>
      )}

      {saveContact && (
        <Modal title="Müşteri olarak kaydet" subtitle={formatPhone(`+${saveContact.phone}`)} onClose={() => setSaveContact(null)}>
          <div className="modal-content form-grid">
            <label className="full">
              Ad soyad
              <input id="wa-save-name" autoFocus value={saveContact.name} onChange={(e) => setSaveContact({ ...saveContact, name: e.target.value })} />
            </label>
            <p className="full setup-footnote">Müşteri “Yeni müşteri” aşamasında açılır; bu numaradaki tüm mesajlar müşteri kartına bağlanır.</p>
          </div>
          <footer className="modal-footer">
            <button className="btn secondary" onClick={() => setSaveContact(null)}>Vazgeç</button>
            <button className="btn primary" disabled={!live} onClick={() => void doSaveContact()}>
              <UserPlus size={15} /> Kaydet
            </button>
          </footer>
        </Modal>
      )}

      {templates && (
        <Modal title="Şablon gönder" subtitle="Meta tarafından onaylanmış şablonlar" onClose={() => setTemplates(null)} wide>
          <div className="modal-content">
            {!templates.list.length && <p className="setup-footnote">Onaylı şablon bulunamadı. Şablonları Meta WhatsApp Yöneticisi'nden oluşturun.</p>}
            <div className="wa-templates">
              {templates.list.map((t) => (
                <button key={`${t.name}-${t.language}`} className={templates.pick?.name === t.name ? "active" : ""} onClick={() => setTemplates({ ...templates, pick: t, params: Array(t.params).fill("") })}>
                  <strong>{t.name}</strong> <small>{t.language}</small>
                  <p>{t.body}</p>
                </button>
              ))}
            </div>
            {templates.pick && templates.pick.params > 0 && (
              <div className="form-grid">
                {templates.params.map((p, i) => (
                  <label key={i}>
                    {`{{${i + 1}}}`}
                    <input value={p} onChange={(e) => setTemplates({ ...templates, params: templates.params.map((x, j) => (j === i ? e.target.value : x)) })} />
                  </label>
                ))}
              </div>
            )}
          </div>
          <footer className="modal-footer">
            <button className="btn secondary" onClick={() => setTemplates(null)}>Vazgeç</button>
            <button className="btn primary" disabled={!templates.pick || templates.params.some((p) => !p.trim())} onClick={() => void sendTemplate()}>
              <Send size={15} /> Gönder
            </button>
          </footer>
        </Modal>
      )}
    </section>
  );
}

function MediaPreview({ m }: { m: Msg }) {
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
