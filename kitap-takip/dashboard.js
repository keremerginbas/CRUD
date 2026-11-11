const L = KitapTakipLib;
const $ = (id) => document.getElementById(id);
const STRIP_DAYS = 60;
const FIELD_LABEL = { price: 'Fiyat', stockQty: 'Stok adedi', edition: 'Baskı', reviewCount: 'Yorum sayısı', rank: 'Satış sıralaması', leadTime: 'Temin süresi', sellers: 'Satıcı sayısı' };

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid);
  return n;
};
const fmtTime = (ts) => new Date(ts).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtMoney = (v, cur) => (v == null ? '–' : `${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur === 'EUR' ? '€' : cur === 'TRY' || !cur ? '₺' : cur}`);
const pill = (status) => el('span', { class: `pill s-${status}` }, L.STATUS_LABEL[status] || status);

async function load() {
  const s = await chrome.storage.local.get(['targets', 'snapshots', 'settings', 'book', 'scanState']);
  return {
    targets: s.targets || DEFAULT_TARGETS,
    snapshots: s.snapshots || [],
    settings: { intervalHours: 12, ...(s.settings || {}) },
    book: s.book || DEFAULT_BOOK,
    scanState: s.scanState || { running: false },
  };
}

function stockCell(s) {
  if (!s) return '–';
  const parts = [];
  if (s.stockQty != null && !s.stockQtyPlaceholder) parts.push(el('strong', {}, `${s.stockQty} adet`), el('small', {}, `Kaynak: ${s.stockQtySource}`));
  else if (s.stockQty != null) parts.push('Adet gizli', el('small', {}, `Sitedeki ${s.stockQty} değeri tüm kitaplarda aynı; gerçek stok değil.`));
  else if (s.status === 'in_stock') parts.push('Adet gizli');
  else parts.push('–');
  if (s.availabilityText) parts.push(el('small', {}, s.availabilityText));
  if (s.maxOrderQty != null && !s.stockQtyPlaceholder) parts.push(el('small', {}, `Tek siparişte en çok ${s.maxOrderQty}`));
  return parts;
}

function renderNow(state) {
  const latest = L.latestByTarget(state.snapshots);
  const head = el('tr', {}, ['Site', 'Durum', 'Stok adedi', 'Fiyat', 'Temin', 'Baskı', 'Puan ve ilgi', 'Son kontrol', ''].map((h) => el('th', { scope: 'col' }, h)));
  const rows = state.targets.map((t) => {
    // Son tarama okunamadıysa, en son okunabilen kaydın verisini göster.
    const last = latest[t.id];
    const good = last && L.UNREADABLE.has(last.status)
      ? state.snapshots.filter((x) => x.targetId === t.id && !L.UNREADABLE.has(x.status)).sort((a, b) => b.ts - a.ts)[0]
      : null;
    const s = good ? { ...good, note: `Son tarama okunamadı (${L.STATUS_LABEL[last.status]}); veriler ${fmtTime(good.ts)} tarihli.` } : last;
    const interest = [];
    if (s && s.rating != null) interest.push(`${s.rating} puan`);
    if (s && s.reviewCount != null) interest.push(`${s.reviewCount} yorum`);
    if (s && s.rank != null) interest.push(`${s.rank.toLocaleString('tr-TR')}. sıra`);
    if (s && s.sellers != null) interest.push(`${s.sellers} satıcı`);
    if (s && s.counts) for (const [k, v] of Object.entries(s.counts)) interest.push(`${v} ${k}`);
    return el('tr', {},
      el('td', {}, el('a', { href: t.url, target: '_blank', rel: 'noreferrer' }, t.name)),
      el('td', {}, s ? pill(s.status) : el('span', { class: 'pill s-none' }, 'Henüz taranmadı'), s && s.note ? el('small', {}, s.note) : null),
      el('td', {}, stockCell(s)),
      el('td', { class: 'num' }, s ? fmtMoney(s.price, s.currency) : '–', s && s.listPrice ? el('small', {}, `Liste: ${fmtMoney(s.listPrice, s.currency)}`) : null),
      el('td', {}, (s && s.leadTime) || '–'),
      el('td', { class: 'num' }, s && s.edition != null ? `${s.edition}. baskı` : '–'),
      el('td', {}, interest.length ? interest.join(', ') : '–'),
      el('td', { class: 'num' }, last ? fmtTime(last.ts) : '–'),
      el('td', {}, el('button', { class: 'link', type: 'button', onclick: () => startScan(t.id) }, 'Yeniden tara')));
  });
  $('now').replaceChildren(el('thead', {}, head), el('tbody', {}, rows));
  const waiting = state.targets.filter((t) => latest[t.id] && latest[t.id].status === 'blocked').map((t) => t.name);
  $('now-hint').textContent = waiting.length
    ? `${waiting.join(', ')} doğrulama istiyor. Açık kalan sekmede doğrulamayı tamamlayın, sonra "Yeniden tara"ya basın.`
    : 'Siteler çoğunlukla yalnızca "stokta var / yok" bilgisini verir. Adet, site paylaştığında gösterilir.';
}

function renderStrips(state) {
  const now = Date.now();
  const rows = state.targets.map((t) => {
    const days = L.dayStrip(state.snapshots, t.id, STRIP_DAYS, now);
    return el('div', { class: 'strip-row' },
      el('div', { class: 'name' }, t.name),
      el('div', { class: 'strip', role: 'img', 'aria-label': `${t.name} için son ${STRIP_DAYS} günün stok durumu` },
        days.map((d) => el('i', { class: `s-${d.snapshot ? d.snapshot.status : 'none'}`, title: `${d.day}: ${d.snapshot ? L.STATUS_LABEL[d.snapshot.status] : 'kayıt yok'}` }))));
  });
  const first = new Date(now - (STRIP_DAYS - 1) * 86400000).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  $('strips').replaceChildren(...rows, el('div', { class: 'strip-axis' }, el('span', {}, first), el('span', {}, 'Bugün')));
  $('legend').replaceChildren(...['in_stock', 'out_of_stock', 'no_buy_button', 'blocked'].map((s) => el('li', {}, pill(s))), el('li', {}, el('span', { class: 'pill s-none' }, 'Kayıt yok')));
}

function describeEvent(e) {
  if (e.field === 'status') {
    if (e.to === 'out_of_stock') return 'Stok tükendi';
    if (e.to === 'in_stock' && e.from !== 'in_stock') return `Yeniden stokta (önceki durum: ${L.STATUS_LABEL[e.from] || e.from})`;
    return `Durum değişti: ${L.STATUS_LABEL[e.from] || e.from} → ${L.STATUS_LABEL[e.to] || e.to}`;
  }
  const show = (v) => (typeof v === 'number' ? v.toLocaleString('tr-TR') : v);
  return `${FIELD_LABEL[e.field] || e.field}: ${show(e.from)} → ${show(e.to)}`;
}

function renderEvents(state) {
  const name = Object.fromEntries(state.targets.map((t) => [t.id, t.name]));
  const events = L.deriveEvents(state.snapshots).slice(0, 100);
  $('events').replaceChildren(...(events.length
    ? events.map((e) => el('li', {}, el('time', {}, fmtTime(e.ts)), el('strong', {}, name[e.targetId] || e.targetId), el('span', {}, describeEvent(e))))
    : [el('li', { class: 'empty' }, 'Henüz değişiklik yok. İkinci taramadan sonra stok, fiyat ve baskı değişiklikleri burada listelenir.')]));
}

function renderTargets(state) {
  $('targets').replaceChildren(...state.targets.map((t) => el('li', {},
    el('strong', {}, t.name), el('span', { class: 'url' }, t.url),
    el('button', { class: 'link', type: 'button', onclick: () => removeTarget(t.id) }, 'Kaldır'))));
}

function renderScanState(state) {
  const st = state.scanState;
  $('scan').disabled = !!st.running;
  $('scan').textContent = st.running ? 'Taranıyor…' : 'Şimdi tara';
  const last = state.snapshots.length ? Math.max(...state.snapshots.map((s) => s.ts)) : null;
  $('scan-state').textContent = st.running ? `${st.current} taranıyor. Sayfalar arka plan sekmesinde açılıp kapanır.`
    : last ? `Son tarama: ${fmtTime(last)}` : 'Henüz tarama yapılmadı. Başlamak için "Şimdi tara"ya basın.';
}

async function render() {
  const state = await load();
  $('book-title').textContent = state.book.title;
  $('book-sub').textContent = `ISBN ${state.book.isbn}, ${state.targets.length} sayfa takipte`;
  document.title = `${state.book.title} – Kitap Takip`;
  $('interval').value = String(state.settings.intervalHours);
  renderScanState(state); renderNow(state); renderStrips(state); renderEvents(state); renderTargets(state);
}

function startScan(targetId) { chrome.runtime.sendMessage({ type: 'scan', targetId }); }

async function removeTarget(id) {
  const state = await load();
  await chrome.storage.local.set({ targets: state.targets.filter((t) => t.id !== id) });
}

$('scan').addEventListener('click', () => startScan());
$('interval').addEventListener('change', async (e) => {
  const state = await load();
  await chrome.storage.local.set({ settings: { ...state.settings, intervalHours: Number(e.target.value) } });
  chrome.runtime.sendMessage({ type: 'reschedule' });
});
$('csv').addEventListener('click', async () => {
  const state = await load();
  const url = URL.createObjectURL(new Blob([L.toCsv(state.snapshots, state.targets)], { type: 'text/csv;charset=utf-8' }));
  el('a', { href: url, download: `kitap-takip-${L.dayKey(Date.now())}.csv` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});
$('add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const name = form.name.value.trim();
  let url;
  try { url = new URL(form.url.value.trim()); } catch (err) { $('add-msg').textContent = 'Adres geçerli değil. https:// ile başlayan tam adresi yapıştırın.'; return; }
  // Yeni site için izin, düğmeye basıldığı anda tarayıcıdan istenir.
  const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] }).catch(() => false);
  if (!granted) { $('add-msg').textContent = `${url.hostname} için izin verilmedi; sayfa eklenmedi.`; return; }
  const state = await load();
  const id = `${url.hostname.replace(/^www\./, '')}-${Date.now().toString(36)}`;
  await chrome.storage.local.set({ targets: [...state.targets, { id, name, url: url.href }] });
  form.reset();
  $('add-msg').textContent = `${name} eklendi. İlk okuma için "Yeniden tara"ya basın.`;
});

chrome.storage.onChanged.addListener(render);
render();
