const TOKEN_KEY = 'santral-token';

let token: string | null = (() => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } })();
let onUnauthorized = () => {};

export const getToken = () => token;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export function setToken(value: string | null) {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* gizli sekme */ }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 401 && token) {
    onUnauthorized();
    throw new Error('Oturum süresi doldu, tekrar giriş yapın');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Beklenmeyen bir hata oluştu');
  return data as T;
}

// <audio> yetki başlığı gönderemediği için kayıt indirilip yerel adresle çalınır
export async function fetchRecording(callId: number) {
  const res = await fetch(`/api/calls/${callId}/recording`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Kayıt alınamadı');
  return URL.createObjectURL(await res.blob());
}
