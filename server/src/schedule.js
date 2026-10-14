// Türkiye 2016'dan beri sabit UTC+3 kullanıyor (yaz saati yok).
const TZ_OFFSET = '+03:00';

function todayInTurkey(now = new Date()) {
  return new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Gün 0 = kayıt günü. "3. gün" = kayıttan 3 gün sonra, adımın saatinde.
function computeDueAt(startDate, dayOffset, sendTime) {
  return new Date(`${addDays(startDate, dayOffset)}T${sendTime}:00${TZ_OFFSET}`);
}

// 0532 123 45 67, +90 532..., 90532... -> 5321234567
function normalizePhone(input) {
  let digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('90')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^5\d{9}$/.test(digits)) return null;
  return digits;
}

function renderTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

function isValidTime(t) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

function isValidDate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime());
}

module.exports = { todayInTurkey, addDays, computeDueAt, normalizePhone, renderTemplate, isValidTime, isValidDate };
