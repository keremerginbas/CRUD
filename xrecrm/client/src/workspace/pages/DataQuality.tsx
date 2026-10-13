import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Mail,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { useStore } from "../store";
import type { Lead } from "../data";
import {
  normalizeEmail,
  normalizeName,
  normalizePhone,
  type CrmImportKind,
} from "../../../../shared/crm-import";
import "../data-quality.css";

export interface DataQualityProps {
  onLead?: (lead: Lead) => void;
  navigate?: (path: string) => void;
}
interface CandidateCard {
  kind: CrmImportKind;
  field: "phone" | "email" | "name";
  value: string;
  ids: string[];
  labels: string[];
}

function candidates(kind: CrmImportKind, records: Array<any>): CandidateCard[] {
  const groups = new Map<
    string,
    { ids: string[]; labels: string[]; value: string }
  >();
  for (const record of records) {
    const fields: Array<["phone" | "email" | "name", string, string]> =
      kind === "companies"
        ? [["name", normalizeName(record.name), record.name]]
        : [
            ...(normalizePhone(record.phone)
              ? [
                  ["phone", normalizePhone(record.phone), record.phone] as [
                    "phone",
                    string,
                    string,
                  ],
                ]
              : []),
            ...(normalizeEmail(record.email)
              ? [
                  ["email", normalizeEmail(record.email), record.email] as [
                    "email",
                    string,
                    string,
                  ],
                ]
              : []),
          ];
    for (const [field, key, value] of fields) {
      const groupKey = `${field}:${key}`;
      const group = groups.get(groupKey) || { ids: [], labels: [], value };
      group.ids.push(record.id);
      group.labels.push(record.name || record.company || record.id);
      groups.set(groupKey, group);
    }
  }
  return [...groups.entries()]
    .filter(([, group]) => group.ids.length > 1)
    .map(([key, group]) => ({
      kind,
      field: key.split(":", 1)[0] as CandidateCard["field"],
      value: group.value,
      ids: group.ids,
      labels: group.labels,
    }));
}

export default function DataQuality({ onLead, navigate }: DataQualityProps) {
  const { data } = useStore();
  const summary = useMemo(() => {
    const groups = [
      { kind: "contacts" as const, label: "Kişiler", records: data.contacts },
      {
        kind: "companies" as const,
        label: "Şirketler",
        records: data.companies,
      },
      { kind: "leads" as const, label: "Leadler", records: data.leads },
    ];
    const missing = groups.map((group) => ({
      ...group,
      phone: group.records.filter((record) => !normalizePhone(record.phone))
        .length,
      email: group.records.filter((record) => !normalizeEmail(record.email))
        .length,
    }));
    return {
      missing,
      candidates: groups.flatMap((group) =>
        candidates(group.kind, group.records),
      ),
    };
  }, [data.contacts, data.companies, data.leads]);
  const missingTotal = summary.missing.reduce(
    (sum, group) => sum + group.phone + group.email,
    0,
  );

  return (
    <main className="dq-page">
      <header className="dq-page-header">
        <div>
          <span className="eyebrow">VERİ KALİTESİ</span>
          <h1>CRM verinizin fotoğrafı.</h1>
          <p>
            Eksik iletişim alanlarını ve aynı görünen kayıtları gözden geçirin.
            Bu ekran yalnızca yetkili olduğunuz çalışma alanı verisini gösterir.
          </p>
        </div>
        <div className="dq-health-badge">
          <ShieldCheck size={17} />{" "}
          {missingTotal || summary.candidates.length
            ? "İnceleme gerekli"
            : "Veriler temiz"}
        </div>
      </header>
      <section className="dq-metric-grid" aria-label="Eksik alan özeti">
        {summary.missing.map((group) => (
          <article className="panel dq-metric-card" key={group.kind}>
            <div>
              <span className="dq-metric-label">{group.label}</span>
              <strong>{group.phone + group.email}</strong>
              <span className="dq-metric-caption">eksik iletişim alanı</span>
            </div>
            <div className="dq-metric-breakdown">
              <span>
                <Phone size={14} /> {group.phone} telefon
              </span>
              <span>
                <Mail size={14} /> {group.email} e-posta
              </span>
            </div>
          </article>
        ))}
      </section>
      <section className="dq-section">
        <div className="dq-section-heading">
          <div>
            <span className="eyebrow">MÜKERRER ADAYLARI</span>
            <h2>Kontrol edilmesi gereken eşleşmeler</h2>
          </div>
          <span className="dq-count">{summary.candidates.length} aday</span>
        </div>
        {summary.candidates.length ? (
          <div className="dq-candidate-grid">
            {summary.candidates.map((candidate) => (
              <article
                className="panel dq-candidate-card"
                key={`${candidate.kind}:${candidate.field}:${candidate.value}`}
              >
                <div className="dq-candidate-top">
                  <AlertTriangle size={16} />
                  <span>
                    {candidate.field === "name"
                      ? "Aynı şirket adı"
                      : candidate.field === "phone"
                        ? "Aynı telefon"
                        : "Aynı e-posta"}
                  </span>
                </div>
                <strong>{candidate.value || "gizli değer"}</strong>
                <ul>
                  {candidate.ids.map((id, index) => (
                    <li key={id}>
                      {candidate.kind === "leads" && onLead ? (
                        <button
                          type="button"
                          className="dq-link"
                          onClick={() => {
                            const lead = data.leads.find(
                              (item) => item.id === id,
                            );
                            if (lead) onLead(lead);
                          }}
                        >
                          {candidate.labels[index]}
                        </button>
                      ) : (
                        <span>{candidate.labels[index]}</span>
                      )}
                      <small>{id}</small>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="dq-secondary-link"
                  onClick={() =>
                    navigate?.(
                      candidate.kind === "companies"
                        ? "/companies"
                        : candidate.kind === "contacts"
                          ? "/contacts"
                          : "/kanban",
                    )
                  }
                >
                  Kayıtlara git <ArrowRight size={14} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="panel dq-empty">
            <ShieldCheck size={20} />
            <div>
              <strong>Mükerrer aday yok</strong>
              <p>
                Yetkili olduğunuz kayıtlarda aynı telefon, e-posta veya şirket
                adıyla birden fazla kayıt bulunmadı.
              </p>
            </div>
          </div>
        )}
      </section>
      <section className="dq-section">
        <div className="dq-section-heading">
          <div>
            <span className="eyebrow">HIZLI DÜZELTME</span>
            <h2>Eksik alanlar</h2>
          </div>
        </div>
        <div className="panel dq-missing-list">
          {summary.missing.map((group) => (
            <div className="dq-missing-row" key={group.kind}>
              <div>
                <strong>{group.label}</strong>
                <span>
                  {group.phone
                    ? `${group.phone} telefonsuz`
                    : "Telefon alanları tamam"}{" "}
                  ·{" "}
                  {group.email
                    ? `${group.email} e-postasız`
                    : "E-posta alanları tamam"}
                </span>
              </div>
              <button
                type="button"
                className="dq-secondary-link"
                onClick={() =>
                  navigate?.(
                    group.kind === "companies"
                      ? "/companies"
                      : group.kind === "contacts"
                        ? "/contacts"
                        : "/kanban",
                  )
                }
              >
                İncele <ArrowRight size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
