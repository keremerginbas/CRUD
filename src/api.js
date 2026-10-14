async function request(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `İstek başarısız (${res.status})`);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body || {}),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
};

export const formatDate = (iso) =>
  new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short' });
