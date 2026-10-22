// Bilet Radar sunucusuyla konuşan küçük istemci.
function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

export function createApi(baseUrl) {
  const root = String(baseUrl || '').replace(/\/+$/, '');

  async function request(path, { method = 'GET', body, timeoutMs = 20000 } = {}) {
    if (!root) throw new Error('Sunucu adresi ayarlanmadı (Ayarlar sekmesi).');
    const t = withTimeout(timeoutMs);
    try {
      const res = await fetch(`${root}/api${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: t.signal,
      });
      if (res.status === 204) return null;
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Sunucu hatası (${res.status})`);
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Sunucu yanıt vermedi (zaman aşımı).');
      if (err.message === 'Network request failed') {
        throw new Error(`Sunucuya ulaşılamadı: ${root}. Telefon ve bilgisayar aynı Wi-Fi'da mı?`);
      }
      throw err;
    } finally {
      t.done();
    }
  }

  const query = (params) =>
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : v)}`)
      .join('&');

  return {
    health: () => request('/health', { timeoutMs: 5000 }),
    providers: () => request('/providers'),
    // Gerçek sitelerde arama 30-60 sn sürebilir
    search: (params) => request(`/search?${query(params)}`, { timeoutMs: 120000 }),
    watches: () => request('/watches'),
    createWatch: (watch) => request('/watches', { method: 'POST', body: watch, timeoutMs: 120000 }),
    updateWatch: (id, patch) => request(`/watches/${id}`, { method: 'PATCH', body: patch }),
    deleteWatch: (id) => request(`/watches/${id}`, { method: 'DELETE' }),
    checkWatch: (id) => request(`/watches/${id}/check`, { method: 'POST', timeoutMs: 120000 }),
    events: (params = {}) => request(`/events?${query(params)}`),
    ask: (text) => request('/ai/ask', { method: 'POST', body: { text }, timeoutMs: 150000 }),
  };
}
