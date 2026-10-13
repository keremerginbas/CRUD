import ImportWizard from "../components/ImportWizard";
import ContactCard from "../components/ContactCard";
import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Edit3,
  Mail,
  MapPin,
  Plus,
  Search,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, Badge, Empty, Modal, PageTitle } from "../components/ui";
import { useStore } from "../store";
import type { Lead } from "../data";
import type { Company, Contact, Member } from "../suite";
import "../suite-pages.css";

type DirectoryType = "contacts" | "companies" | "members";
type DirectoryRecord = Contact | Company | Member;

const stamp = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const normalize = (value: string) => value.toLocaleLowerCase("tr");

function blankRecord(type: DirectoryType, owner: string): DirectoryRecord {
  const now = stamp();
  if (type === "contacts") {
    return {
      id: newId(),
      name: "",
      phone: "",
      email: "",
      companyId: "",
      owner,
      tags: [],
      notes: "",
      createdAt: now,
      updatedAt: now,
    };
  }
  if (type === "companies") {
    return {
      id: newId(),
      name: "",
      industry: "",
      phone: "",
      email: "",
      website: "",
      address: "",
      owner,
      notes: "",
      createdAt: now,
      updatedAt: now,
    };
  }
  return {
    id: newId(),
    name: "",
    email: "",
    title: "",
    department: "",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

function linkedLeadFor(record: DirectoryRecord, leads: Lead[]) {
  if ("companyId" in record)
    return leads.filter((l) => l.contactId === record.id);
  if ("industry" in record)
    return leads.filter((l) => l.companyId === record.id);
  return [];
}
function LeadLink({
  lead: leads,
  onLead,
}: {
  lead: Lead[];
  onLead: (lead: Lead) => void;
}) {
  if (!leads.length) return <span className="sx-muted">Bağlı fırsat yok</span>;
  return (
    <div className="b24-multi-deal-links">
      <span>{leads.length} fırsat</span>
      {leads.map((lead) => (
        <button
          className="sx-link-button"
          key={lead.id}
          onClick={(e) => {
            e.stopPropagation();
            onLead(lead);
          }}
        >
          {lead.dealTitle || lead.company || lead.name}
          <span aria-hidden="true">↗</span>
        </button>
      ))}
    </div>
  );
}

function DirectoryEditor({
  type,
  record,
  companies,
  members,
  onClose,
  onSave,
  isNew,
}: {
  type: DirectoryType;
  record: DirectoryRecord;
  companies: Company[];
  members: Member[];
  onClose: () => void;
  onSave: (record: DirectoryRecord) => Promise<void>;
  isNew: boolean;
}) {
  const [draft, setDraft] = useState<DirectoryRecord>(record);
  const [saving, setSaving] = useState(false);
  const update = (key: string, value: string | string[]) =>
    setDraft((current) => ({ ...current, [key]: value }) as DirectoryRecord);
  const title = isNew ? "Yeni kayıt" : "Kaydı düzenle";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) {
      toast.error(
        type === "members" ? "Üye adı gerekli." : "Ad alanı gerekli.",
      );
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ...draft,
        name: draft.name.trim(),
        updatedAt: stamp(),
      } as DirectoryRecord);
      toast.success("Kayıt kaydedildi.");
      onClose();
    } catch (error) {
      toast.error((error as Error).message || "Kayıt kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      wide={type !== "members"}
      title={title}
      subtitle={
        type === "members"
          ? "Ekip dizinine yeni profil ekleyin."
          : "CRM kaydı oluşturun veya güncelleyin."
      }
      onClose={onClose}
    >
      <form className="sx-modal-form" onSubmit={submit}>
        <div className="sx-form-grid">
          <label className="sx-field sx-span-2">
            Ad / unvan
            <input
              autoFocus
              value={draft.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder={type === "companies" ? "Şirket adı" : "Ad soyad"}
            />
          </label>
          {type === "contacts" && (
            <>
              <label className="sx-field">
                Telefon
                <input
                  value={(draft as Contact).phone}
                  onChange={(event) => update("phone", event.target.value)}
                  placeholder="+90 555 000 00 00"
                  inputMode="tel"
                />
              </label>
              <label className="sx-field">
                E-posta
                <input
                  type="email"
                  value={(draft as Contact).email}
                  onChange={(event) => update("email", event.target.value)}
                  placeholder="ornek@firma.com"
                />
              </label>
              <label className="sx-field">
                Şirket bağlantısı
                <select
                  value={(draft as Contact).companyId}
                  onChange={(event) => update("companyId", event.target.value)}
                >
                  <option value="">Şirket seçin</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sx-field">
                Sorumlu
                <input
                  value={(draft as Contact).owner}
                  onChange={(event) => update("owner", event.target.value)}
                  placeholder="Danışman adı"
                />
              </label>
              <label className="sx-field sx-span-2">
                Etiketler
                <input
                  value={(draft as Contact).tags.join(", ")}
                  onChange={(event) =>
                    update(
                      "tags",
                      event.target.value
                        .split(",")
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    )
                  }
                  placeholder="VIP, yatırımcı"
                />
              </label>
              <label className="sx-field sx-span-2">
                Notlar
                <textarea
                  rows={4}
                  value={(draft as Contact).notes}
                  onChange={(event) => update("notes", event.target.value)}
                  placeholder="Kişi hakkında kısa not"
                />
              </label>
            </>
          )}
          {type === "companies" && (
            <>
              <label className="sx-field">
                Sektör
                <input
                  value={(draft as Company).industry}
                  onChange={(event) => update("industry", event.target.value)}
                  placeholder="Gayrimenkul"
                />
              </label>
              <label className="sx-field">
                Telefon
                <input
                  value={(draft as Company).phone}
                  onChange={(event) => update("phone", event.target.value)}
                  placeholder="+90 555 000 00 00"
                  inputMode="tel"
                />
              </label>
              <label className="sx-field">
                E-posta
                <input
                  type="email"
                  value={(draft as Company).email}
                  onChange={(event) => update("email", event.target.value)}
                  placeholder="info@firma.com"
                />
              </label>
              <label className="sx-field">
                Web sitesi
                <input
                  value={(draft as Company).website}
                  onChange={(event) => update("website", event.target.value)}
                  placeholder="https://"
                />
              </label>
              <label className="sx-field sx-span-2">
                Adres
                <input
                  value={(draft as Company).address}
                  onChange={(event) => update("address", event.target.value)}
                  placeholder="İlçe, şehir"
                />
              </label>
              <label className="sx-field">
                Sorumlu
                <input
                  value={(draft as Company).owner}
                  onChange={(event) => update("owner", event.target.value)}
                  placeholder="Danışman adı"
                />
              </label>
              <label className="sx-field sx-span-2">
                Notlar
                <textarea
                  rows={4}
                  value={(draft as Company).notes}
                  onChange={(event) => update("notes", event.target.value)}
                  placeholder="Şirket hakkında kısa not"
                />
              </label>
            </>
          )}
          {type === "members" && (
            <>
              <label className="sx-field">
                E-posta
                <input
                  type="email"
                  value={(draft as Member).email}
                  onChange={(event) => update("email", event.target.value)}
                  placeholder="uye@firma.com"
                />
              </label>
              <label className="sx-field">
                Görevi
                <input
                  value={(draft as Member).title}
                  onChange={(event) => update("title", event.target.value)}
                  placeholder="Gayrimenkul danışmanı"
                />
              </label>
              <label className="sx-field">
                Departman
                <input
                  value={(draft as Member).department}
                  onChange={(event) => update("department", event.target.value)}
                  placeholder="Satış"
                />
              </label>
              <label className="sx-field">
                Durum
                <select
                  value={(draft as Member).status}
                  onChange={(event) => update("status", event.target.value)}
                >
                  <option value="active">Aktif</option>
                  <option value="away">Uzakta</option>
                </select>
              </label>
            </>
          )}
        </div>
        <div className="sx-modal-footer">
          <span className="sx-muted">
            {type === "members"
              ? "Profil oluşturmak oturum veya izin tanımlamaz."
              : "Değişiklikler çalışma alanınıza kaydedilir."}
          </span>
          <div className="sx-actions">
            <button type="button" className="btn secondary" onClick={onClose}>
              Vazgeç
            </button>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default function Directory({
  type,
  onLead,
  navigate,
}: {
  type: DirectoryType;
  onLead: (lead: Lead) => void;
  navigate?: (path: string) => void;
}) {
  const { data, saveRecord, user } = useStore();
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [contactCard, setContactCard] = useState<Contact | null>(null);
  const [editor, setEditor] = useState<DirectoryRecord | null>(null);
  const defaultOwner = user?.name || data.members[0]?.name || "XRE Ekibi";
  useEffect(() => {
    setQuery("");
    setOwnerFilter("all");
    setStatusFilter("all");
    setEditor(null);
  }, [type]);

  const q = normalize(query.trim());
  const owners = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...data.contacts.map((item) => item.owner),
            ...data.companies.map((item) => item.owner),
            ...data.leads.map((item) => item.owner),
          ].filter(Boolean),
        ),
      ),
    [data.contacts, data.companies, data.leads],
  );
  const companiesById = useMemo(
    () => new Map(data.companies.map((company) => [company.id, company])),
    [data.companies],
  );
  const filteredContacts = data.contacts.filter((contact) => {
    const company = companiesById.get(contact.companyId)?.name || "";
    return (
      (!q ||
        normalize(
          `${contact.name} ${contact.phone} ${contact.email} ${company} ${contact.tags.join(" ")}`,
        ).includes(q)) &&
      (ownerFilter === "all" || contact.owner === ownerFilter)
    );
  });
  const filteredCompanies = data.companies.filter(
    (company) =>
      (!q ||
        normalize(
          `${company.name} ${company.industry} ${company.phone} ${company.email} ${company.address}`,
        ).includes(q)) &&
      (ownerFilter === "all" || company.owner === ownerFilter),
  );
  const filteredMembers = data.members.filter(
    (member) =>
      (!q ||
        normalize(
          `${member.name} ${member.email} ${member.title} ${member.department}`,
        ).includes(q)) &&
      (statusFilter === "all" || member.status === statusFilter),
  );
  const count =
    type === "contacts"
      ? filteredContacts.length
      : type === "companies"
        ? filteredCompanies.length
        : filteredMembers.length;
  const pageTitle =
    type === "contacts"
      ? "Kişiler"
      : type === "companies"
        ? "Şirketler"
        : "Ekip üyeleri";
  const pageDescription =
    type === "contacts"
      ? "Kişi kayıtlarını, şirket bağlarını ve sorumluları tek yerde yönetin."
      : type === "companies"
        ? "Şirket ve kurum ilişkilerini CRM fırsatlarıyla birlikte takip edin."
        : "Çalışma alanındaki ekip profillerini görüntüleyin; hesap izinleri bu dizinden yönetilmez.";
  const save = async (record: DirectoryRecord) => {
    if (type === "contacts") await saveRecord("contacts", record as Contact);
    else if (type === "companies")
      await saveRecord("companies", record as Company);
    else await saveRecord("members", record as Member);
  };
  const openNew = () => setEditor(blankRecord(type, defaultOwner));
  const tabs: Array<[DirectoryType, string]> = [
    ["contacts", "Kişiler"],
    ["companies", "Şirketler"],
    ["members", "Ekip"],
  ];
  const targetPath: Record<DirectoryType, string> = {
    contacts: "/contacts",
    companies: "/companies",
    members: "/team",
  };

  return (
    <>
      <PageTitle
        eyebrow="ÇALIŞMA ALANI DİZİNİ"
        title={pageTitle}
        description={pageDescription}
        actions={
          <>
            {type !== "members" && (
              <button
                className="btn secondary"
                onClick={() => setImporting(true)}
              >
                CSV içe aktar
              </button>
            )}
            <button className="btn primary" onClick={openNew}>
              <Plus size={16} /> Yeni{" "}
              {type === "members"
                ? "üye"
                : type === "contacts"
                  ? "kişi"
                  : "şirket"}
            </button>
          </>
        }
      />
      <div className="sx-tabs" role="tablist" aria-label="Dizin bölümleri">
        {tabs.map(([tab, label]) => (
          <button
            key={tab}
            role="tab"
            aria-selected={type === tab}
            className={type === tab ? "active" : ""}
            onClick={() => navigate?.(targetPath[tab])}
          >
            {label}
            <span>
              {tab === "contacts"
                ? data.contacts.length
                : tab === "companies"
                  ? data.companies.length
                  : data.members.length}
            </span>
          </button>
        ))}
      </div>
      <section className="sx-toolbar panel">
        <label className="sx-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`${pageTitle} içinde ara…`}
            aria-label={`${pageTitle} içinde ara`}
          />
        </label>
        {type !== "members" ? (
          <label className="sx-filter-label">
            Sorumlu
            <select
              value={ownerFilter}
              onChange={(event) => setOwnerFilter(event.target.value)}
            >
              <option value="all">Tümü</option>
              {owners.map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="sx-filter-label">
            Durum
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">Tümü</option>
              <option value="active">Aktif</option>
              <option value="away">Uzakta</option>
            </select>
          </label>
        )}
        <span className="sx-toolbar-count">{count} kayıt</span>
      </section>

      {type === "contacts" && (
        <section className="panel sx-table-panel">
          <div className="sx-table-scroll">
            <table className="sx-table">
              <thead>
                <tr>
                  <th>KİŞİ</th>
                  <th>ŞİRKET</th>
                  <th>İLETİŞİM</th>
                  <th>SORUMLU</th>
                  <th>BAĞLI FIRSAT</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredContacts.map((contact) => {
                  const lead = linkedLeadFor(contact, data.leads);
                  return (
                    <tr
                      key={contact.id}
                      onClick={() => setContactCard(contact)}
                    >
                      <td>
                        <div className="sx-person">
                          <Avatar name={contact.name} />
                          <span>
                            <strong>{contact.name}</strong>
                            <small>
                              {contact.tags.join(" · ") || "Etiket yok"}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td>
                        {companiesById.get(contact.companyId)?.name || (
                          <span className="sx-muted">Bağımsız</span>
                        )}
                      </td>
                      <td>
                        <span className="sx-contact-line">
                          <Mail size={13} />
                          {contact.email || "E-posta yok"}
                        </span>
                        <span className="sx-contact-line">
                          <UserRound size={13} />
                          {contact.phone || "Telefon yok"}
                        </span>
                      </td>
                      <td>
                        <span className="sx-owner">
                          <Avatar
                            name={contact.owner || "XRE Ekibi"}
                            size={23}
                          />
                          {contact.owner || "XRE Ekibi"}
                        </span>
                      </td>
                      <td>
                        <LeadLink lead={lead} onLead={onLead} />
                      </td>
                      <td>
                        <button
                          className="sx-icon-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditor(contact);
                          }}
                          aria-label={`${contact.name} kaydını düzenle`}
                        >
                          <Edit3 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredContacts.length === 0 && (
            <Empty
              title="Kişi bulunamadı"
              description="Arama veya sorumlu filtresini değiştirin ya da yeni kişi oluşturun."
            />
          )}
        </section>
      )}

      {type === "companies" && (
        <section className="panel sx-table-panel">
          <div className="sx-table-scroll">
            <table className="sx-table">
              <thead>
                <tr>
                  <th>ŞİRKET</th>
                  <th>SEKTÖR</th>
                  <th>İLETİŞİM</th>
                  <th>ADRES</th>
                  <th>BAĞLI FIRSAT</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredCompanies.map((company) => {
                  const lead = linkedLeadFor(company, data.leads);
                  return (
                    <tr key={company.id} onClick={() => setEditor(company)}>
                      <td>
                        <div className="sx-person">
                          <span className="sx-company-avatar">
                            <Building2 size={17} />
                          </span>
                          <span>
                            <strong>{company.name}</strong>
                            <small>{company.website || "Web sitesi yok"}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <Badge tone="blue">
                          {company.industry || "Belirtilmedi"}
                        </Badge>
                      </td>
                      <td>
                        <span className="sx-contact-line">
                          <Mail size={13} />
                          {company.email || "E-posta yok"}
                        </span>
                        <span className="sx-contact-line">
                          <UserRound size={13} />
                          {company.phone || "Telefon yok"}
                        </span>
                      </td>
                      <td>
                        <span className="sx-contact-line">
                          <MapPin size={13} />
                          {company.address || "Adres yok"}
                        </span>
                      </td>
                      <td>
                        <LeadLink lead={lead} onLead={onLead} />
                      </td>
                      <td>
                        <button
                          className="sx-icon-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditor(company);
                          }}
                          aria-label={`${company.name} kaydını düzenle`}
                        >
                          <Edit3 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredCompanies.length === 0 && (
            <Empty
              title="Şirket bulunamadı"
              description="Arama veya sorumlu filtresini değiştirin ya da yeni şirket oluşturun."
            />
          )}
        </section>
      )}

      {type === "members" && (
        <>
          <section className="sx-info-strip">
            <UsersRound size={16} />
            <span>
              Bu dizin ekip profillerini gösterir. Yeni profil oluşturmak{" "}
              <strong>oturum açma, rol veya hesap izni tanımlamaz.</strong>
            </span>
          </section>
          <section className="panel sx-table-panel">
            <div className="sx-table-scroll">
              <table className="sx-table">
                <thead>
                  <tr>
                    <th>ÜYE</th>
                    <th>GÖREV</th>
                    <th>DEPARTMAN</th>
                    <th>E-POSTA</th>
                    <th>DURUM</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map((member) => (
                    <tr key={member.id} onClick={() => setEditor(member)}>
                      <td>
                        <div className="sx-person">
                          <Avatar name={member.name} />
                          <span>
                            <strong>{member.name}</strong>
                            <small>Profil kaydı</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        {member.title || (
                          <span className="sx-muted">Belirtilmedi</span>
                        )}
                      </td>
                      <td>
                        {member.department || (
                          <span className="sx-muted">Belirtilmedi</span>
                        )}
                      </td>
                      <td>
                        <a
                          className="sx-link-button sx-email-link"
                          href={`mailto:${member.email}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {member.email || "E-posta yok"}
                        </a>
                      </td>
                      <td>
                        <Badge
                          tone={member.status === "active" ? "green" : "amber"}
                        >
                          {member.status === "active" ? "Aktif" : "Uzakta"}
                        </Badge>
                      </td>
                      <td>
                        <button
                          className="sx-icon-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditor(member);
                          }}
                          aria-label={`${member.name} profilini düzenle`}
                        >
                          <Edit3 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredMembers.length === 0 && (
              <Empty
                title="Üye bulunamadı"
                description="Arama veya durum filtresini değiştirin."
              />
            )}
          </section>
        </>
      )}
      {importing && type !== "members" && (
        <ImportWizard kind={type} onClose={() => setImporting(false)} />
      )}
      {contactCard && (
        <ContactCard
          contact={contactCard}
          onClose={() => setContactCard(null)}
          onLead={onLead}
          onEdit={() => {
            setEditor(contactCard);
            setContactCard(null);
          }}
        />
      )}
      {editor && (
        <DirectoryEditor
          type={type}
          record={editor}
          companies={data.companies}
          members={data.members}
          isNew={
            !(type === "contacts"
              ? data.contacts.some((item) => item.id === editor.id)
              : type === "companies"
                ? data.companies.some((item) => item.id === editor.id)
                : data.members.some((item) => item.id === editor.id))
          }
          onClose={() => setEditor(null)}
          onSave={save}
        />
      )}
    </>
  );
}
