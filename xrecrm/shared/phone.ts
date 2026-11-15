// Telefon alanı kuralları: harf kabul edilmez. Arayüz yazarken ayıklar, sunucu kayıtta denetler.

/** Yazılırken telefon alanında yalnız rakam, +, boşluk, parantez ve tire bırakır. */
export const cleanPhoneInput = (value: string) => String(value ?? "").replace(/[^\d+\s()-]/g, "").slice(0, 30);

/** Boş değer geçerlidir; dolu ise yalnız telefon karakterleri ve 7–15 rakam içermelidir. */
export function phoneProblem(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/[^\d+\s().-]/.test(text)) return "Telefon numarası harf içeremez; yalnız rakam yazın.";
  const digits = text.replace(/\D/g, "").length;
  if (digits < 7 || digits > 15) return "Telefon numarası 7–15 rakam olmalı.";
  return null;
}
