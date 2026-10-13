// Hat envanteri. Gerçek numaralar ve ICCID'ler kaynak koduna/Git'e yazılmaz:
// sunucu `config/lines.json` dosyasından (veya LINES_INVENTORY_JSON ortam
// değişkeninden) okur, tarayıcı ise oturum açıldıktan sonra /api/lines ile alır.
// Demo ve testler aşağıdaki yer tutucu (sahte) envanterle çalışır.
export interface Line {
  id: string;
  phone: string;
  group: "ai" | "office" | "cloud";
  iccid?: string;
  label?: string;
}

export const groupNames = {
  ai: "Yapay Zekâ",
  office: "OFİX PBX",
  cloud: "Bulut PBX",
};

const placeholderPhone = (group: Line["group"], n: number) =>
  group === "ai" && n === 6
    ? "+908500000006"
    : `+90${{ ai: "5551", office: "5552", cloud: "5553" }[group]}${String(n).padStart(6, "0")}`;

export const placeholderLines: Line[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `ai-${i + 1}`,
    phone: placeholderPhone("ai", i + 1),
    group: "ai" as const,
  })),
  ...Array.from({ length: 16 }, (_, i) => ({
    id: `office-${i + 1}`,
    phone: placeholderPhone("office", i + 1),
    group: "office" as const,
  })),
  ...Array.from({ length: 23 }, (_, i) => ({
    id: `cloud-${i + 1}`,
    phone: placeholderPhone("cloud", i + 1),
    group: "cloud" as const,
    ...(i < 13 ? { iccid: `899000000000000${String(i + 1).padStart(5, "0")}` } : {}),
  })),
];

/** Canlı envanterle yerinde güncellenen ortak liste (import edenler aynı diziyi görür). */
export const lines: Line[] = placeholderLines.map((line) => ({ ...line }));

export function parseLineInventory(raw: unknown): Line[] {
  if (!Array.isArray(raw)) throw new Error("Hat envanteri dizi olmalıdır.");
  const seen = new Set<string>();
  return raw.map((item, index) => {
    const value = item as Record<string, unknown>;
    const id = String(value?.id || "").trim();
    const phone = String(value?.phone || "").replace(/[^\d+]/g, "");
    const group = String(value?.group || "");
    if (!/^[a-z]+-\d{1,3}$/.test(id) || seen.has(id))
      throw new Error(`Hat ${index + 1}: geçersiz veya tekrarlanan id.`);
    if (!/^\+?\d{10,15}$/.test(phone))
      throw new Error(`Hat ${id}: geçersiz telefon.`);
    if (!["ai", "office", "cloud"].includes(group))
      throw new Error(`Hat ${id}: grup ai, office veya cloud olmalı.`);
    seen.add(id);
    const iccid = value.iccid ? String(value.iccid).replace(/\D/g, "") : "";
    return {
      id,
      phone: phone.startsWith("+") ? phone : `+${phone}`,
      group: group as Line["group"],
      ...(iccid ? { iccid } : {}),
      ...(value.label ? { label: String(value.label).slice(0, 120) } : {}),
    };
  });
}

export function setLineInventory(next: Line[]): void {
  lines.splice(0, lines.length, ...next.map((line) => ({ ...line })));
}

export function resetLineInventory(): void {
  setLineInventory(placeholderLines);
}
