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

const groupAliases: Record<string, Line["group"]> = {
  ai: "ai",
  "yapay zeka": "ai",
  "yapay zekâ": "ai",
  vapi: "ai",
  office: "office",
  ofix: "office",
  "ofi̇x": "office",
  "ofix pbx": "office",
  "ofi̇x pbx": "office",
  cloud: "cloud",
  bulut: "cloud",
  "bulut pbx": "cloud",
};

/**
 * Hat yönetimi ekranındaki toplu metni çözer. Her satır:
 *   telefon ; grup ; iccid ; etiket   (grup/iccid/etiket opsiyonel)
 * Kimlikler grup içindeki sıraya göre atanır (ai-1, office-1, cloud-1 …).
 */
export function parseLineText(text: string, defaultGroup: Line["group"] = "cloud"): Line[] {
  const counters: Record<Line["group"], number> = { ai: 0, office: 0, cloud: 0 };
  const result: Line[] = [];
  text.split(/\r?\n/).forEach((row, index) => {
    if (!row.trim() || row.trim().startsWith("#")) return;
    const [rawPhone, rawGroup = "", rawIccid = "", ...rest] = row.split(/[;\t,]/).map((c) => c.trim());
    let digits = rawPhone.replace(/\D/g, "");
    if (digits.startsWith("0")) digits = `90${digits.slice(1)}`;
    if (digits.length === 10) digits = `90${digits}`;
    if (digits.length < 10 || digits.length > 15)
      throw new Error(`${index + 1}. satır: "${rawPhone}" geçerli bir telefon değil.`);
    const group = rawGroup ? groupAliases[rawGroup.toLocaleLowerCase("tr-TR")] : defaultGroup;
    if (!group) throw new Error(`${index + 1}. satır: grup "${rawGroup}" tanınmadı (ai, office, cloud).`);
    counters[group] += 1;
    const iccid = rawIccid.replace(/\D/g, "");
    const label = rest.join(" ").trim();
    result.push({
      id: `${group}-${counters[group]}`,
      phone: `+${digits}`,
      group,
      ...(iccid ? { iccid } : {}),
      ...(label ? { label } : {}),
    });
  });
  const phones = new Set<string>();
  for (const line of result) {
    if (phones.has(line.phone)) throw new Error(`${line.phone} iki kez yazılmış.`);
    phones.add(line.phone);
  }
  return result;
}

export function formatLineText(list: Line[]): string {
  return list
    .map((l) => [l.phone, l.group, l.iccid || "", l.label || ""].join(";").replace(/;+$/, ""))
    .join("\n");
}
