import { Mail, Phone, Building2, Sparkles, ArrowUpRight } from "lucide-react";
import { useStore } from "../store";
import { Modal, Avatar, Badge } from "./ui";
import { Contact, dateTimeLabel } from "../suite";
import { Lead } from "../data";
export default function ContactCard({
  contact,
  onClose,
  onLead,
  onEdit,
}: {
  contact: Contact;
  onClose: () => void;
  onLead: (l: Lead) => void;
  onEdit: () => void;
}) {
  const { data } = useStore();
  const leads = data.leads.filter((l) => l.contactId === contact.id);
  const notes = data.feed
    .filter(
      (p) =>
        (p as any).contactId === contact.id ||
        leads.some((l) => l.id === p.leadId),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const company = data.companies.find((c) => c.id === contact.companyId);
  return (
    <Modal
      wide
      title="Kişi kartı"
      subtitle="Bağlı müşteri fırsatları ve görüşme yorumları"
      onClose={onClose}
    >
      <div className="cx-contact-card">
        <header>
          <Avatar name={contact.name} size={46} />
          <div>
            <h2>{contact.name}</h2>
            <small>{contact.owner || "Sorumlu atanmamış"}</small>
          </div>
          <button className="btn secondary" onClick={onEdit}>
            Bilgileri düzenle
          </button>
        </header>
        <div className="cx-contact-meta">
          <span>
            <Phone size={14} />
            {contact.phone || "Telefon yok"}
          </span>
          <span>
            <Mail size={14} />
            {contact.email || "E-posta yok"}
          </span>
          <span>
            <Building2 size={14} />
            {company?.name || "Şirket yok"}
          </span>
        </div>
        <h3>Bağlı CRM fırsatları</h3>
        {leads.map((l) => (
          <button
            className="cx-contact-opportunity"
            key={l.id}
            onClick={() => {
              onClose();
              onLead(l);
            }}
          >
            <span>{l.dealTitle || l.company || l.name}</span>
            <Badge>{l.stage}</Badge>
            <ArrowUpRight size={13} />
          </button>
        ))}
        {!leads.length && <p>Henüz fırsat bağlanmamış.</p>}
        <h3>Görüşme yorumları ve analizler</h3>
        {notes.map((n) => (
          <article key={n.id}>
            <header>
              <Sparkles size={14} />
              <strong>{n.author}</strong>
              <time>{dateTimeLabel(n.createdAt)}</time>
            </header>
            <p>{n.text}</p>
            {(n as any).sourceId && (
              <small>
                Kaynak:{" "}
                {(n as any).sourceKind === "call" ? "Telefon" : "WhatsApp"} ·{" "}
                {(n as any).sourceId}
              </small>
            )}
          </article>
        ))}
        {!notes.length && (
          <p>
            Analiz için bağlı müşterinin konuşma metni veya transkripti gerekir.
            Yeni analizler otomatik olarak burada da görünür.
          </p>
        )}
      </div>
    </Modal>
  );
}
