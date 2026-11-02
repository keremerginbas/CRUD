const pad = (n: number) => String(n).padStart(2, '0');
// Sunucu UTC "YYYY-MM-DD HH:MM:SS" döndürür
const parse = (sqlUtc: string) => new Date(`${sqlUtc.replace(' ', 'T')}Z`);

export function formatDate(sqlUtc: string) {
  const d = parse(sqlUtc);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const formatDuration = (sec: number) => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;

// fibimi'deki gibi "91 gün önce"
export function daysAgo(sqlUtc: string) {
  const d = parse(sqlUtc);
  const now = new Date();
  const days = Math.round((+new Date(now.getFullYear(), now.getMonth(), now.getDate()) - +new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  return days <= 0 ? 'Bugün' : days === 1 ? 'Dün' : `${days} gün önce`;
}
