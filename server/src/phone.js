// Türkiye numaralarını tek biçime (+90XXXXXXXXXX) getirir; eşleştirmeler bu biçim üzerinden yapılır.
export function normalizePhone(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('90') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+9${digits}`;
  if (digits.length === 10) return `+90${digits}`;
  // 444 xx xx gibi kısa numaralar ve yurt dışı numaralar olduğu gibi kalır
  return digits.length > 7 && !digits.startsWith('444') ? `+${digits}` : digits;
}

// Santral API'leri genelde 0 ile başlayan yerel biçim ister: 05XXXXXXXXX
export function toLocalFormat(phone) {
  const n = normalizePhone(phone);
  return n.startsWith('+90') ? `0${n.slice(3)}` : n;
}
