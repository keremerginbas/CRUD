// Bayi sisteminin arayüz durumu. Canlı modda /api/dealers; demo modunda aynı kurallar (shared/dealers.ts)
// tarayıcıda çalışır ve kayıtlar localStorage'da tutulur.
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_PROTECTION_DAYS,
  DealerSchema,
  mainDealerOf,
  phoneKey,
  registerCustomer,
  registrationId,
  settleRegistration,
  type Dealer,
  type DealerRegistration,
} from "../../../shared/dealers";
import { isoDay } from "../../../shared/quotes";
import { api, useStore } from "./store";

export interface DealerState {
  dealers: Dealer[];
  registrations: DealerRegistration[];
  myDealerId: string | null;
  manager: boolean;
  protectionDays: number;
  employees: { openId: string; name: string }[];
  today: string;
}
const EMPTY: DealerState = { dealers: [], registrations: [], myDealerId: null, manager: false, protectionDays: DEFAULT_PROTECTION_DAYS, employees: [], today: isoDay(new Date()) };

const DEMO_KEY = "xre-demo-dealers-v1";
const demoSeed = (): DealerState => ({
  ...EMPTY,
  manager: true,
  dealers: ["A Ana Bayi", "B Bayi", "C Bayi", "D Bayi"].map((name, i) => ({ id: `demo-dealer-${i}`, name, main: i === 0, active: true, members: [], phone: "", note: "" })),
});
const readDemo = (): DealerState => {
  try {
    const raw = JSON.parse(localStorage.getItem(DEMO_KEY) || "null");
    if (raw && Array.isArray(raw.dealers)) return { ...demoSeed(), ...raw, today: isoDay(new Date()) };
  } catch {
    /* bozuk kayıt */
  }
  return demoSeed();
};
const writeDemo = (state: DealerState) => {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(state));
  } catch {
    /* kota */
  }
};

export function useDealers() {
  const { demo, data } = useStore();
  const [state, setState] = useState<DealerState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (demo) {
      const current = readDemo();
      const main = mainDealerOf(current.dealers);
      const now = new Date().toISOString();
      const next = { ...current, registrations: current.registrations.map((r) => settleRegistration(r, current.today, main, false, now)) };
      writeDemo(next);
      setState(next);
      setLoading(false);
      return;
    }
    try {
      setState({ ...EMPTY, ...(await api("/api/dealers")) });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [demo]);
  useEffect(() => void reload(), [reload]);

  const saveDealer = useCallback(
    async (input: Dealer) => {
      if (!demo) await api("/api/dealers", input);
      else {
        const dealer = DealerSchema.parse(input);
        const current = readDemo();
        const others = current.dealers.filter((d) => d.id !== dealer.id).map((d) => ({ ...d, main: dealer.main ? false : d.main }));
        if (!dealer.main && !others.some((d) => d.main)) dealer.main = true;
        writeDemo({ ...current, dealers: [...others, dealer] });
      }
      await reload();
    },
    [demo, reload],
  );
  const removeDealer = useCallback(
    async (id: string) => {
      if (!demo) await api(`/api/dealers/${encodeURIComponent(id)}`, {}, "DELETE");
      else {
        const current = readDemo();
        const dealer = current.dealers.find((d) => d.id === id);
        if (dealer?.main) throw new Error("Ana bayi silinemez. Önce başka bir bayiyi ana bayi yapın.");
        if (current.registrations.some((r) => r.dealerId === id || r.originalDealerId === id)) throw new Error("Bu bayinin müşteri kayıtları var; silmek yerine pasife alın.");
        writeDemo({ ...current, dealers: current.dealers.filter((d) => d.id !== id) });
      }
      await reload();
    },
    [demo, reload],
  );
  const saveDays = useCallback(
    async (protectionDays: number) => {
      if (!demo) await api("/api/dealers/settings", { protectionDays }, "PUT");
      else writeDemo({ ...readDemo(), protectionDays });
      await reload();
    },
    [demo, reload],
  );
  const register = useCallback(
    async (leadId: string, project: { id: string; name: string }, dealerId?: string) => {
      if (!demo) await api("/api/dealers/registrations", { leadId, projectId: project.id, dealerId });
      else {
        const current = readDemo();
        const dealer = current.dealers.find((d) => d.id === dealerId);
        if (!dealer) throw new Error("Kaydın yapılacağı bayiyi seçin.");
        const lead = data.leads.find((l) => l.id === leadId);
        if (!lead) throw new Error("Müşteri bulunamadı.");
        const key = phoneKey(lead.phone || "");
        const existing = key ? current.registrations.find((r) => r.id === registrationId(key, project.id)) || null : null;
        const next = registerCustomer(existing, { lead: { id: lead.id, name: lead.name, phone: lead.phone }, project, dealer, byName: "Demo kullanıcı", today: current.today, now: new Date().toISOString(), protectionDays: current.protectionDays });
        writeDemo({ ...current, registrations: [next, ...current.registrations] });
      }
      await reload();
    },
    [demo, reload, data.leads],
  );
  const removeRegistration = useCallback(
    async (id: string) => {
      if (!demo) await api(`/api/dealers/registrations/${encodeURIComponent(id)}`, {}, "DELETE");
      else {
        const current = readDemo();
        writeDemo({ ...current, registrations: current.registrations.filter((r) => r.id !== id) });
      }
      await reload();
    },
    [demo, reload],
  );
  return { ...state, loading, error, demo, reload, saveDealer, removeDealer, saveDays, register, removeRegistration };
}
