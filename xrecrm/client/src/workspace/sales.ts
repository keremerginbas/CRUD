// Satış belgelerinin arayüz durumu: alıcı bilgileri, senetler, sözleşme.
// Canlı modda /api/quotes/:id/sale üzerinden çalışır. Demo modunda sunucu çağrısı yapılmaz:
// kayıtlar localStorage'da tutulur, Word sözleşmesi tarayıcıda üretilir (senet PDF'i demoda yoktur).
import { useCallback, useEffect, useState } from "react";
import { isoDay, unitLabelOf, type Quote, type VisibleQuote } from "../../../shared/quotes";
import { CONTRACT_FIELDS, CONTRACT_TABLES, SalePartiesSchema, buildSenets, contractData, validTckn, type Sale, type SaleParties, type Senet } from "../../../shared/senet";
import { DOCX_MIME, fillDocx } from "../../../shared/docx-fill";
import { buildDefaultContractTemplate } from "../../../shared/contract-template";
import { api } from "./store";
import type { QuoteStore } from "./quotes";

const DEMO_KEY = "xre-demo-sales-v1";
const readDemo = (): Record<string, Sale> => {
  try {
    const raw = JSON.parse(localStorage.getItem(DEMO_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
};
const writeDemo = (sales: Record<string, Sale>) => {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(sales));
  } catch {
    /* kota doldu */
  }
};

export function downloadBytes(bytes: Uint8Array, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export interface SaleStore {
  sale: Sale | null;
  today: string;
  loading: boolean;
  save: (parties: SaleParties) => Promise<void>;
  pay: (no: number, paid: boolean, paidAt?: string) => Promise<void>;
  /** Doldurulmuş Word sözleşmesi adresi; demo modunda null (downloadContract kullanılır). */
  contractUrl: string | null;
  senetPdfUrl: string | null;
  downloadContract: () => void;
}

export function useSale(quote: VisibleQuote, store: QuoteStore): SaleStore {
  const demo = store.demo;
  const [sale, setSale] = useState<Sale | null>(null);
  const [today, setToday] = useState(isoDay(new Date()));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    if (demo) {
      setSale(readDemo()[quote.id] || null);
      setLoading(false);
      return;
    }
    api(`/api/quotes/${encodeURIComponent(quote.id)}/sale`)
      .then((d) => {
        if (!alive) return;
        setSale(d.sale || null);
        if (d.today) setToday(d.today);
      })
      .catch(() => alive && setSale(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [demo, quote.id]);

  const commitDemo = useCallback((next: Sale) => {
    writeDemo({ ...readDemo(), [next.quoteId]: next });
    setSale(next);
  }, []);

  const save = useCallback(
    async (input: SaleParties) => {
      if (!demo) {
        const d = await api(`/api/quotes/${encodeURIComponent(quote.id)}/sale`, input, "PUT");
        setSale(d.sale);
        return;
      }
      const parties = SalePartiesSchema.parse(input);
      if (!validTckn(parties.buyerTckn)) throw new Error("Alıcının TC kimlik numarası geçersiz.");
      if (!validTckn(parties.guarantorTckn)) throw new Error("Kefilin TC kimlik numarası geçersiz.");
      commitDemo({ quoteId: quote.id, quoteNo: quote.quoteNo, parties, senets: buildSenets(quote, readDemo()[quote.id]?.senets), updatedAt: new Date().toISOString(), updatedBy: store.actor.name });
    },
    [demo, quote, store.actor.name, commitDemo],
  );

  const pay = useCallback(
    async (no: number, paid: boolean, paidAt?: string) => {
      if (!demo) {
        const d = await api(`/api/quotes/${encodeURIComponent(quote.id)}/sale/senets/${no}`, { paid, paidAt });
        setSale(d.sale);
        return;
      }
      const current = readDemo()[quote.id];
      if (!current) return;
      commitDemo({ ...current, senets: current.senets.map((s) => (s.no === no ? { ...s, status: paid ? "ödendi" : "bekliyor", paidAt: paid ? paidAt || isoDay(new Date()) : null } : s)) });
    },
    [demo, quote.id, commitDemo],
  );

  const downloadContract = useCallback(() => {
    if (!sale) return;
    const data = contractData(quote as unknown as Quote, sale, store.settings);
    downloadBytes(fillDocx(buildDefaultContractTemplate(), data.fields, data.tables).bytes, `Sozlesme-${quote.quoteNo}.docx`, DOCX_MIME);
  }, [quote, sale, store.settings]);

  const base = `/api/quotes/${encodeURIComponent(quote.id)}`;
  return { sale, today, loading, save, pay, downloadContract, contractUrl: demo ? null : `${base}/contract.docx`, senetPdfUrl: demo ? null : `${base}/senets.pdf` };
}

export interface SenetBookRow {
  quoteId: string;
  quoteNo: string;
  status: string;
  customer: string;
  phone: string;
  projectName: string;
  unitLabel: string;
  employee: string;
  lateInterestMonthlyPct: number;
  senets: Senet[];
}

/** Tüm satışların senetleri (senet takip ekranı). */
export function useSenetBook(store: QuoteStore) {
  const { demo, quotes } = store;
  const [rows, setRows] = useState<SenetBookRow[]>([]);
  const [today, setToday] = useState(isoDay(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    if (demo) {
      const sales = readDemo();
      setRows(
        quotes
          .filter((q) => sales[q.id] && q.status !== "iptal")
          .map((q) => ({
            quoteId: q.id,
            quoteNo: q.quoteNo,
            status: q.status,
            customer: sales[q.id].parties.buyerName || q.customer.name,
            phone: sales[q.id].parties.buyerPhone || q.customer.phone,
            projectName: q.unit.projectName,
            unitLabel: unitLabelOf(q.unit),
            employee: q.employee.name,
            lateInterestMonthlyPct: sales[q.id].parties.lateInterestMonthlyPct,
            senets: sales[q.id].senets,
          })),
      );
      setLoading(false);
      return;
    }
    setLoading(true);
    api("/api/quotes/senets")
      .then((d) => {
        if (!alive) return;
        setRows(d.sales || []);
        if (d.today) setToday(d.today);
        setError("");
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [demo, quotes, tick]);

  const pay = useCallback(
    async (quoteId: string, no: number, paid: boolean) => {
      if (demo) {
        const sales = readDemo();
        const current = sales[quoteId];
        if (current) writeDemo({ ...sales, [quoteId]: { ...current, senets: current.senets.map((s) => (s.no === no ? { ...s, status: paid ? "ödendi" : "bekliyor", paidAt: paid ? isoDay(new Date()) : null } : s)) } });
      } else await api(`/api/quotes/${encodeURIComponent(quoteId)}/sale/senets/${no}`, { paid });
      reload();
    },
    [demo, reload],
  );
  return { rows, today, loading, error, reload, pay };
}

export interface ContractTemplateInfo {
  custom: boolean;
  name: string;
  size: number;
  uploadedAt: string | null;
  unknown: string[];
  fields: [string, string][];
  tables: [string, string][];
}
const DEMO_TEMPLATE: ContractTemplateInfo = { custom: false, name: "Hazır şablon", size: 0, uploadedAt: null, unknown: [], fields: CONTRACT_FIELDS, tables: CONTRACT_TABLES };

export function useContractTemplate(demo: boolean) {
  const [template, setTemplate] = useState<ContractTemplateInfo>(DEMO_TEMPLATE);
  useEffect(() => {
    if (demo) return;
    api("/api/quotes/contract-template")
      .then((d) => d.template && setTemplate(d.template))
      .catch(() => undefined);
  }, [demo]);
  const upload = useCallback(
    async (file: File) => {
      if (demo) throw new Error("Demo modunda şablon yüklenmez; hazır şablon kullanılır.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const d = await api("/api/quotes/contract-template", { name: file.name, dataBase64: btoa(binary) }, "PUT");
      setTemplate(d.template);
      return d.template as ContractTemplateInfo;
    },
    [demo],
  );
  const remove = useCallback(async () => {
    if (demo) return;
    const d = await api("/api/quotes/contract-template", {}, "DELETE");
    setTemplate(d.template);
  }, [demo]);
  const downloadDefault = useCallback(() => {
    if (demo) downloadBytes(buildDefaultContractTemplate(), "sozlesme-sablonu.docx", DOCX_MIME);
    else window.location.assign("/api/quotes/contract-template/file?default=1");
  }, [demo]);
  return { template, upload, remove, downloadDefault, currentUrl: demo ? null : "/api/quotes/contract-template/file" };
}
