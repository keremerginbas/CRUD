// Şifre kuralı: giriş hesabı, davet ve firma kaydında aynı kural uygulanır.

const COMMON = new Set(
  `password1 password12 password123 passw0rd parola123 parola1234 sifre123 sifre1234 sifre12345 qwerty123 qwerty1234 asdfgh123
   abc12345 abcd1234 a1234567 a12345678 12345678a 1234567a 123456789a 1q2w3e4r 1q2w3e4r5t q1w2e3r4 admin123 admin1234 test1234
   deneme123 deneme1234 galatasaray1905 fenerbahce1907 besiktas1903 istanbul34 ankara06 iloveyou1 welcome1 merhaba123`.split(/\s+/),
);

/** Şifre uygun değilse nedenini, uygunsa null döndürür. */
export function passwordProblem(value: string): string | null {
  const v = String(value ?? "");
  if (v.length < 8) return "Şifre en az 8 karakter olmalı.";
  if (v.length > 200) return "Şifre çok uzun.";
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(v) || !/\d/.test(v)) return "Şifre harf ve rakam içermeli.";
  // "aaaaaaa1" gibi tek harfin tekrarı kolay tahmin edilir.
  if (new Set(v.toLocaleLowerCase("tr-TR")).size < 5) return "Şifre çok basit: en az 5 farklı karakter kullanın.";
  if (COMMON.has(v.toLowerCase())) return "Bu şifre çok yaygın; başka bir şifre seçin.";
  return null;
}
