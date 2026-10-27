// Sunucu UTC "YYYY-MM-DD HH:MM:SS" döndürür
export function formatDate(sqlUtc: string) {
  const d = new Date(`${sqlUtc.replace(' ', 'T')}Z`);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatDuration(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
