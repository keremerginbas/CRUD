// Müşteri kartındaki e-posta parçaları: yazma kutusu ve zaman akışı girdisi.
// İleti gövdesi her zaman düz metin olarak gösterilir; uzaktan HTML işlenmez.
import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CornerUpLeft, LoaderCircle, Mail, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";
import type { Lead } from "../data";
import { dateTimeLabel } from "../suite";
import { openEmailSettings, type LeadEmails } from "../email";
import { emailSnippet, replySubject, type EmailMessage } from "../../../../shared/email";
import "../email.css";

/** Müşteri kartının herhangi bir yerinden e-posta yazma kutusunu açar. */
export const EMAIL_COMPOSE_EVENT = "xre:email-compose";
export const openEmailComposer = (leadId: string) => window.dispatchEvent(new CustomEvent(EMAIL_COMPOSE_EVENT, { detail: { leadId } }));

export function EmailComposer({ lead, mail, replyTo, onClearReply }: { lead: Lead; mail: LeadEmails; replyTo: EmailMessage | null; onClearReply: () => void }) {
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (replyTo) setSubject(replySubject(replyTo.subject));
  }, [replyTo]);

  if (!lead.email)
    return (
      <div className="em-hint">
        <Mail size={16} />
        <span>Bu müşterinin e-posta adresi yok. Soldaki müşteri bilgilerine e-posta adresini ekleyip kaydedin.</span>
      </div>
    );
  if (mail.status && !mail.connected)
    return (
      <div className="em-hint">
        <Mail size={16} />
        <span>
          E-posta göndermek için önce posta kutunuzu bağlayın (Gmail, Outlook veya diğer).{" "}
          <button type="button" className="em-inline-link" onClick={openEmailSettings}>
            Posta kutusunu bağla
          </button>
        </span>
      </div>
    );

  async function send() {
    if (busy) return;
    if (/[\r\n]/.test(subject)) return void toast.error("Konu tek satır olmalı.");
    setBusy(true);
    try {
      await mail.send({ subject: subject.trim(), text: text.trim(), ...(replyTo ? { replyToId: replyTo.id } : {}) });
      setSubject("");
      setText("");
      onClearReply();
      toast.success(`E-posta gönderildi: ${lead.email}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="em-composer">
      <div className="em-route">
        <span>
          <b>Kimden</b> {mail.status?.account?.address || "…"}
        </span>
        <span>
          <b>Kime</b> {lead.email}
        </span>
      </div>
      {replyTo && (
        <div className="em-replying">
          <CornerUpLeft size={13} />
          <span>Yanıtlanan: {replyTo.subject}</span>
          <button
            type="button"
            aria-label="Yanıtı iptal et"
            onClick={() => {
              onClearReply();
              setSubject("");
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}
      <input className="em-subject-input" aria-label="E-posta konusu" maxLength={300} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Konu" />
      <textarea aria-label="E-posta metni" rows={5} maxLength={50000} value={text} onChange={(e) => setText(e.target.value)} placeholder={`${lead.name} için iletinizi yazın…`} />
      <footer>
        <button type="button" className="btn primary small" disabled={busy || !subject.trim() || !text.trim()} onClick={() => void send()}>
          {busy ? <LoaderCircle size={13} className="em-spin" /> : <Send size={13} />}
          {busy ? "Gönderiliyor…" : "E-posta gönder"}
        </button>
        <span>Müşteriye gönderilir · kendi posta kutunuzdan</span>
      </footer>
    </div>
  );
}

export function EmailEntry({ message, lead, userName, onReply }: { message: EmailMessage; lead: Lead; userName: string; onReply: (m: EmailMessage) => void }) {
  const [open, setOpen] = useState(false);
  const inbound = message.direction === "inbound";
  const snippet = emailSnippet(message.text, 180);
  const long = message.text.trim().length > snippet.length || message.text.includes("\n");
  return (
    <article className={`em-entry ${inbound ? "inbound" : "outbound"}`}>
      <span className="cx-event-dot email">
        <Mail size={15} />
      </span>
      <div>
        <header>
          <strong>{inbound ? `${message.fromName || lead.name} · gelen e-posta` : `${message.fromName || userName} → ${lead.name}`}</strong>
          <time>{dateTimeLabel(message.createdAt)}</time>
        </header>
        <div className="em-subject">
          <span className={`em-dir ${inbound ? "in" : "out"}`}>
            {inbound ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}
            {inbound ? "Gelen" : "Giden"}
          </span>
          <b>{message.subject}</b>
        </div>
        <p className={open ? "em-body open" : "em-body"}>{open ? message.text : snippet}</p>
        {open && message.truncated && <small className="em-muted">İleti çok uzun olduğu için kısaltıldı; tamamı posta kutunuzda.</small>}
        {message.attachments.length > 0 && (
          <ul className="em-attachments" aria-label="Ekler (yalnız adları)">
            {message.attachments.map((name, i) => (
              <li key={`${name}-${i}`}>
                <Paperclip size={12} />
                {name}
              </li>
            ))}
            <li className="em-muted">Ekler posta kutunuzda</li>
          </ul>
        )}
        <div className="em-entry-actions">
          {long && (
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? "Kısalt" : "Tümünü göster"}
            </button>
          )}
          <button type="button" onClick={() => onReply(message)}>
            <CornerUpLeft size={12} />
            Yanıtla
          </button>
        </div>
      </div>
    </article>
  );
}
