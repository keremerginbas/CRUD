// Kişi kartındaki Kaynak / Proje listeleri. Ekip listeye kendi seçeneğini ekleyebilir;
// proje listesine Projeler sayfasındaki projeler kendiliğinden gelir.
import { useEffect, useState } from "react";
import { useStore } from "./store";

export interface CrmOptions {
  sources: string[];
  projects: string[];
}
export const DEFAULT_SOURCES = ["Reklam", "WhatsApp", "Telefon", "Web sitesi", "Referans", "manual"];
export const ADD_OPTION = "__yeni__";

export function useCrmOptions() {
  const { demo, user, request } = useStore();
  const [options, setOptions] = useState<CrmOptions>({ sources: DEFAULT_SOURCES, projects: [] });
  useEffect(() => {
    if (demo || !user) return;
    request("/api/crm-options").then(setOptions).catch(() => undefined);
  }, [demo, user?.openId]);
  /** Yeni seçeneği kaydeder; kaydedilen (temizlenmiş) adı döndürür. */
  const add = async (list: keyof CrmOptions, raw: string): Promise<string> => {
    const value = raw.replace(/\s+/g, " ").trim();
    if (value.length < 2) throw new Error("Seçenek adı en az 2 karakter olmalı.");
    if (demo) setOptions((o) => ({ ...o, [list]: [...new Set([...o[list], value])] }));
    else setOptions(await request("/api/crm-options", { list, value }, "POST"));
    return value;
  };
  return { options, add };
}
