// Tekliflerin arayüz durumu.
// Canlı modda /api/quotes üzerinden çalışır; tutarları sunucu hesaplar, arayüzdeki plan yalnız önizlemedir.
// Demo modunda hiçbir sunucu çağrısı yapılmaz: kayıtlar localStorage'da tutulur ve aynı saf
// işlevlerle (shared/quotes.ts) işlenir. Demo modunda PDF üretilmez.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Unit } from "../../../shared/real-estate";
import {
  QuoteError,
  QuoteSettingsSchema,
  alternativesFor,
  costCsv,
  costRows,
  createQuote,
  editQuote,
  formatQuoteNo,
  isExpired,
  isOwnQuote,
  isoDay,
  nextQuoteSeq,
  publicSettings,
  transitionQuote,
  unitEffects,
  visibleQuote,
  type CostFilters,
  type Quote,
  type QuoteAction,
  type QuoteActor,
  type QuoteDraft,
  type QuoteSettings,
  type QuoteSettingsInput,
  type QuoteSettingsPublic,
  type RejectReason,
  type VisibleQuote,
} from "../../../shared/quotes";
import { api, useStore } from "./store";
import type { InventoryStore } from "./projects";
import { DEMO_EMPLOYEE, DEMO_MANAGER, demoQuoteSettings, makeQuotesDemo } from "./quotes-demo";

const DEMO_KEY = "xre-demo-quotes-v1";
const CHANGED = "xre:quotes-changed";
type DemoRole = "manager" | "employee";
interface DemoState {
  quotes: Quote[];
  settings: QuoteSettings;
  role: DemoRole;
}

function readDemo(): DemoState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(DEMO_KEY) || "null");
    if (raw && Array.isArray(raw.quotes) && raw.settings) return { quotes: raw.quotes, settings: raw.settings, role: raw.role === "employee" ? "employee" : "manager" };
  } catch {
    /* depolama kapalı veya bozuk */
  }
  return null;
}
function writeDemo(state: DemoState) {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(state));
  } catch {
    /* kota doldu: demo verisi yalnız bellekte kalır */
  }
}
const announce = () => window.dispatchEvent(new Event(CHANGED));

export interface QuoteStore {
  quotes: VisibleQuote[];
  settings: QuoteSettingsPublic | null;
  /** Yönetici: onaylar, oranları belirler, NBD ve para maliyetini görür. */
  manager: boolean;
  canCreate: boolean;
  seeAll: boolean;
  actor: QuoteActor;
  today: string;
  loading: boolean;
  error: string;
  demo: boolean;
  /** Demo modunda bakış açısı (yönetici / satış danışmanı). */
  demoRole: DemoRole;
  setDemoRole: (role: DemoRole) => void;
  reload: () => Promise<void>;
  save: (draft: QuoteDraft, options?: { id?: string; submit?: boolean }) => Promise<VisibleQuote>;
  act: (id: string, action: QuoteAction, extra?: { note?: string; reason?: RejectReason }) => Promise<VisibleQuote>;
  alternatives: (id: string) => Promise<Unit[]>;
  saveSettings: (input: QuoteSettingsInput) => Promise<void>;
  /** Müşteri PDF'i (veya filigranlı iç önizleme) adresi; demo modunda null. */
  pdfUrl: (id: string, preview?: boolean) => string | null;
  downloadCostCsv: (filters: CostFilters) => void;
}

interface LiveState {
  quotes: VisibleQuote[];
  settings: QuoteSettingsPublic | null;
  manager: boolean;
  canCreate: boolean;
  seeAll: boolean;
  today: string;
}
const emptyLive: LiveState = { quotes: [], settings: null, manager: false, canCreate: false, seeAll: false, today: isoDay(new Date()) };

export function useQuotes(inventory: InventoryStore): QuoteStore {
  const { demo, user, data, loading: sessionLoading } = useStore();
  const [live, setLive] = useState<LiveState>(emptyLive);
  const [demoState, setDemoState] = useState<DemoState | null>(() => (demo ? readDemo() : null));
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const demoRef = useRef(demoState);
  demoRef.current = demoState;
  const inventoryRef = useRef(inventory);
  inventoryRef.current = inventory;
  const leadsRef = useRef(data.leads);
  leadsRef.current = data.leads;

  // Demo: ilk açılışta örnek teklifler, demo envanteri ve müşterilerinden üretilir.
  useEffect(() => {
    if (!demo || demoState || !inventory.units.length) return;
    const stored = readDemo();
    const next: DemoState = stored || { quotes: makeQuotesDemo(inventory, data.leads), settings: demoQuoteSettings(), role: "manager" };
    if (!stored) writeDemo(next);
    setDemoState(next);
    announce();
  }, [demo, demoState, inventory, data.leads]);

  const commitDemo = useCallback((next: DemoState) => {
    demoRef.current = next;
    setDemoState(next);
    writeDemo(next);
    announce();
  }, []);

  const reload = useCallback(async () => {
    if (demo) {
      const stored = readDemo();
      if (stored) setDemoState(stored);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await api("/api/quotes");
      setLive({ quotes: next.quotes || [], settings: next.settings || null, manager: Boolean(next.manager), canCreate: Boolean(next.canCreate), seeAll: Boolean(next.seeAll), today: next.today || isoDay(new Date()) });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [demo]);

  useEffect(() => {
    if (sessionLoading) return;
    void reload();
  }, [reload, sessionLoading]);

  const demoRole = demoState?.role || "manager";
  const actor: QuoteActor = useMemo(
    () => (demo ? (demoRole === "manager" ? DEMO_MANAGER : DEMO_EMPLOYEE) : { openId: String(user?.openId || ""), name: String(user?.name || ""), manager: live.manager }),
    [demo, demoRole, user, live.manager],
  );
  const actorRef = useRef(actor);
  actorRef.current = actor;

  /** Demo: bir teklif değişikliğini daire etkileriyle birlikte uygular. */
  const applyDemo = useCallback(
    async (before: Quote | null, after: Quote) => {
      const state = demoRef.current;
      if (!state) throw new Error("Demo verisi hazır değil.");
      const unit = inventoryRef.current.units.find((u) => u.id === after.unitId);
      if (!unit) throw new Error("Teklifin dairesi bulunamadı.");
      const effects = unitEffects(before, after, unit, state.quotes, state.settings, actorRef.current, after.updatedAt);
      const changed = new Map([effects.quote, ...effects.cancelled].map((q) => [q.id, q]));
      const quotes = state.quotes.some((q) => q.id === effects.quote.id) ? state.quotes.map((q) => changed.get(q.id) || q) : [effects.quote, ...state.quotes.map((q) => changed.get(q.id) || q)];
      if (effects.unitStatus && effects.unitStatus !== unit.status) await inventoryRef.current.saveUnit({ ...unit, status: effects.unitStatus });
      commitDemo({ ...state, quotes });
      return effects.quote;
    },
    [commitDemo],
  );

  // Demo: süresi dolan onaylı tekliflerin daire opsiyonunu kaldırır (sunucudaki süpürmenin karşılığı).
  useEffect(() => {
    if (!demo || !demoState || !inventory.units.length) return;
    const today = isoDay(new Date());
    const expired = demoState.quotes.find((q) => q.optionHeld && isExpired(q, today));
    if (expired) void applyDemo(expired, { ...expired, updatedAt: new Date().toISOString() }).catch(() => undefined);
  }, [demo, demoState, inventory.units.length, applyDemo]);

  const save = useCallback<QuoteStore["save"]>(
    async (draft, options = {}) => {
      if (!demo) {
        const result = options.id ? await api(`/api/quotes/${options.id}`, draft, "PATCH") : await api("/api/quotes", { ...draft, submit: Boolean(options.submit) });
        let quote: VisibleQuote = result.quote;
        if (options.id && options.submit && quote.status === "taslak") quote = (await api(`/api/quotes/${options.id}/submit`, {})).quote;
        await Promise.all([reload(), inventoryRef.current.reload()]);
        announce();
        return quote;
      }
      const state = demoRef.current;
      if (!state) throw new Error("Demo verisi hazır değil.");
      const who = actorRef.current;
      const unit = inventoryRef.current.units.find((u) => u.id === draft.unitId);
      if (!unit) throw new Error("Daire bulunamadı.");
      const found = leadsRef.current.find((l) => l.id === draft.leadId);
      if (!found) throw new Error("Müşteri seçin.");
      const now = new Date().toISOString();
      const ctx = { settings: state.settings, unit, project: inventoryRef.current.projects.find((p) => p.id === unit.projectId), lead: { id: found.id, name: found.name, phone: found.phone }, actor: who, now };
      const before = options.id ? state.quotes.find((q) => q.id === options.id) || null : null;
      if (options.id && !before) throw new Error("Teklif bulunamadı.");
      const year = Number(now.slice(0, 4));
      let quote = before
        ? editQuote(before, draft, ctx)
        : createQuote(draft, ctx, { id: `demo-quote-${crypto.randomUUID()}`, quoteNo: formatQuoteNo(year, nextQuoteSeq(state.quotes.map((q) => q.quoteNo), year)) });
      if (options.submit && quote.status === "taslak") quote = transitionQuote(quote, "submit", who, now);
      return visibleQuote(await applyDemo(before, quote), who);
    },
    [demo, reload, applyDemo],
  );

  const act = useCallback<QuoteStore["act"]>(
    async (id, action, extra = {}) => {
      if (!demo) {
        const result = await api(`/api/quotes/${id}/${action}`, extra);
        await Promise.all([reload(), inventoryRef.current.reload()]);
        announce();
        return result.quote;
      }
      const state = demoRef.current;
      const before = state?.quotes.find((q) => q.id === id);
      if (!state || !before) throw new Error("Teklif bulunamadı.");
      const unit = inventoryRef.current.units.find((u) => u.id === before.unitId);
      if ((action === "approve" || action === "sell") && unit?.status === "satıldı") throw new Error("Bu daire satılmış; teklif onaylanamaz veya satışa çevrilemez.");
      const moved = transitionQuote(before, action, actorRef.current, new Date().toISOString(), { ...extra, validDays: state.settings.quoteValidDays });
      return visibleQuote(await applyDemo(before, moved), actorRef.current);
    },
    [demo, reload, applyDemo],
  );

  const alternatives = useCallback<QuoteStore["alternatives"]>(
    async (id) => {
      if (!demo) return (await api(`/api/quotes/${id}/alternatives`)).units || [];
      const quote = demoRef.current?.quotes.find((q) => q.id === id);
      return quote ? alternativesFor(quote, inventoryRef.current.units, inventoryRef.current.projects) : [];
    },
    [demo],
  );

  const saveSettings = useCallback<QuoteStore["saveSettings"]>(
    async (input) => {
      if (!demo) {
        await api("/api/quotes/settings", input, "PUT");
        await reload();
        return;
      }
      const state = demoRef.current;
      if (!state) throw new Error("Demo verisi hazır değil.");
      if (!actorRef.current.manager) throw new QuoteError("Bu işlem yalnız yöneticiye açıktır.", 403);
      commitDemo({ ...state, settings: { ...QuoteSettingsSchema.parse(input), updatedAt: new Date().toISOString(), updatedBy: actorRef.current.name } });
    },
    [demo, reload, commitDemo],
  );

  const setDemoRole = useCallback(
    (role: DemoRole) => {
      const state = demoRef.current;
      if (state) commitDemo({ ...state, role });
    },
    [commitDemo],
  );

  const pdfUrl = useCallback((id: string, preview = false) => (demo ? null : `/api/quotes/${encodeURIComponent(id)}/pdf${preview ? "?preview=1" : ""}`), [demo]);

  const downloadCostCsv = useCallback(
    (filters: CostFilters) => {
      const link = document.createElement("a");
      link.download = `para-maliyeti-${isoDay(new Date())}.csv`;
      let revoke = "";
      if (demo) {
        revoke = URL.createObjectURL(new Blob([costCsv(costRows(demoRef.current?.quotes || [], filters))], { type: "text/csv;charset=utf-8" }));
        link.href = revoke;
      } else {
        const query = new URLSearchParams();
        if (filters.projectId) query.set("projectId", filters.projectId);
        if (filters.statuses?.length) query.set("status", filters.statuses.join(","));
        if (filters.from) query.set("from", filters.from);
        if (filters.to) query.set("to", filters.to);
        if (filters.employee) query.set("employee", filters.employee);
        link.href = `/api/quotes/cost-of-money.csv?${query}`;
      }
      document.body.appendChild(link);
      link.click();
      link.remove();
      if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 5_000);
    },
    [demo],
  );

  return useMemo<QuoteStore>(() => {
    const base = { actor, loading: demo ? !demoState && inventory.loading : loading, error, demo, demoRole, setDemoRole, reload, save, act, alternatives, saveSettings, pdfUrl, downloadCostCsv };
    if (!demo) return { ...base, ...live };
    const quotes = (demoState?.quotes || [])
      .filter((q) => actor.manager || isOwnQuote(q, actor))
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((q) => visibleQuote(q, actor));
    return { ...base, quotes, settings: demoState ? publicSettings(demoState.settings, actor.manager) : null, manager: actor.manager, canCreate: true, seeAll: actor.manager, today: isoDay(new Date()) };
  }, [actor, loading, error, demo, demoRole, demoState, inventory.loading, live, setDemoRole, reload, save, act, alternatives, saveSettings, pdfUrl, downloadCostCsv]);
}

/** Menüdeki sayaç: yöneticide onay bekleyen teklif sayısı (çalışanda kendi bekleyenleri). */
export function usePendingQuotes(): { pending: number; manager: boolean } {
  const { demo, user, loading } = useStore();
  const [state, setState] = useState({ pending: 0, manager: false });
  useEffect(() => {
    if (loading) return;
    let stopped = false;
    const read = async () => {
      if (demo) {
        const stored = readDemo();
        const who = stored?.role === "employee" ? DEMO_EMPLOYEE : DEMO_MANAGER;
        const pending = (stored?.quotes || []).filter((q) => q.status === "onay bekliyor" && (who.manager || isOwnQuote(q, who))).length;
        if (!stopped) setState({ pending, manager: who.manager });
        return;
      }
      if (!user || !(user.isOwner || user.permissions?.quotes?.read || user.permissions?.quotes?.write)) return void setState({ pending: 0, manager: false });
      try {
        const next = await api("/api/quotes/summary");
        if (!stopped) setState({ pending: Number(next.pending) || 0, manager: Boolean(next.manager) });
      } catch {
        /* sayaç kritik değil */
      }
    };
    void read();
    const timer = window.setInterval(read, 60_000);
    window.addEventListener(CHANGED, read);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener(CHANGED, read);
    };
  }, [demo, user, loading]);
  return state;
}

/** Uygulama içi gezinme (App.tsx popstate olayını dinler). */
export function goTo(path: string, base: (path: string) => string): void {
  history.pushState({}, "", base(path));
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}
