const L = KitapTakipLib;
const $ = (id) => document.getElementById(id);
const STRIP_DAYS = 60;
const SIGNAL_DAYS = 30;
const FIELD_LABEL = { price: 'Fiyat', stockQty: 'Stok adedi', soldCount: 'Satın alma sayacı', edition: 'Baskı', reviewCount: 'Yorum sayısı', rank: 'Satış sıralaması', leadTime: 'Temin süresi', sellers: 'Satıcı sayısı' };

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
  const real = L.realQty(s);
  if (real != null) {
    parts.push(el('strong', {}, `${real} adet`), el('small', {}, `Kaynak: ${s.stockQtySource}`));
    if (s.status === 'on_order') parts.push(el('small', {}, 'Mağaza stok tutmuyor; sipariş gelince tedarik ediyor.'));
  } else if (s.stockQtyPlaceholder) {
    parts.push('Adet gizli', el('small', {}, `Sitedeki ${s.stockQty.toLocaleString('tr-TR')} değeri yer tutucu; gerçek stok değil.`));
  } else if (s.status === 'in_stock' || s.status === 'on_order') parts.push('Adet gizli');
  else parts.push('–');
  if (s.availabilityText) parts.push(el('small', {}, s.availabilityText));
  if (s.maxOrderQty != null && real == null && !s.stockQtyPlaceholder) parts.push(el('small', {}, `Tek siparişte en çok ${s.maxOrderQty}`));
  return parts;
}

function renderNow(state) {
  const latest = L.latestByTarget(state.snapshots);
  const head = el('tr', {}, ['Site', 'Durum', 'Stok adedi', 'Satın alma sayacı', 'Fiyat', 'Temin ve baskı', 'Puan ve ilgi', 'Son kontrol'].map((h) => el('th', { scope: 'col' }, h)));
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
    // Sitenin yazdığı ilgi cümleleri; satın alma sayacı kendi sütununda gösterildiği için burada yinelenmez.
    const extra = s && s.signals ? s.signals.filter((x) => !/satın alınmıştır/i.test(x)) : [];
    return el('tr', {},
      el('td', {}, el('a', { href: t.url, target: '_blank', rel: 'noreferrer' }, t.name)),
      el('td', {}, s ? pill(s.status) : el('span', { class: 'pill s-none' }, 'Henüz taranmadı'), s && s.note ? el('small', {}, s.note) : null),
      el('td', {}, stockCell(s)),
      el('td', { class: 'num' }, s && s.soldCount != null ? [el('strong', {}, `${s.soldCount.toLocaleString('tr-TR')} adet`), el('small', {}, 'Sitenin kendi sayacı')] : '–'),
      el('td', { class: 'num' }, s ? fmtMoney(s.price, s.currency) : '–', s && s.listPrice ? el('small', {}, `Liste: ${fmtMoney(s.listPrice, s.currency)}`) : null),
      el('td', {}, s && (s.leadTime || s.edition != null) ? [s.leadTime || null, s.edition != null ? el(s.leadTime ? 'small' : 'span', {}, `${s.edition}. baskı`) : null] : '–'),
      el('td', {}, interest.length ? interest.join(', ') : (extra.length ? null : '–'), extra.map((x) => el('small', {}, x))),
      el('td', { class: 'num' }, last ? fmtTime(last.ts) : 'Henüz yok', el('div', {}, el('button', { class: 'link', type: 'button', onclick: () => startScan(t.id) }, 'Yeniden tara'))));
  });
  $('now').replaceChildren(el('thead', {}, head), el('tbody', {}, rows));
  const waiting = state.targets.filter((t) => latest[t.id] && latest[t.id].status === 'blocked').map((t) => t.name);
  $('now-hint').textContent = waiting.length
    ? `${waiting.join(', ')} doğrulama istiyor. Açık kalan sekmede doğrulamayı tamamlayın, sonra "Yeniden tara"ya basın.`
    : 'Siteler çoğunlukla yalnızca "stokta var / yok" bilgisini verir. Adet, site paylaştığında gösterilir.';
}

function renderSignals(state) {
  const since = Date.now() - SIGNAL_DAYS * 86400000;
  const head = el('tr', {}, ['Site', 'Satın alma sayacı', 'Stoktan düşen', 'Stoka giren', 'Tükenme', 'Yenilenme', 'Sıralama sıçraması', 'Yeni yorum'].map((h) => el('th', { scope: 'col' }, h)));
  let totalSold = 0, totalDrop = 0, anySold = false, anyStock = false, readings = 0;
  const none = (text) => el('td', { class: 'none' }, text);
  const rows = state.targets.map((t) => {
    const g = L.salesSignals(state.snapshots, t.id, since);
    readings = Math.max(readings, g.readings);
    if (g.soldCount != null) { anySold = true; totalSold += g.soldGain || 0; }
    if (g.hasRealStock) { anyStock = true; totalDrop += g.stockDrop; }
    if (!state.snapshots.some((x) => x.targetId === t.id && !L.UNREADABLE.has(x.status))) {
      return el('tr', {}, el('td', {}, el('strong', {}, t.name)), el('td', { class: 'none', colspan: '7' }, 'Bu siteden henüz okunabilen bir kayıt yok.'));
    }
    return el('tr', {},
      el('td', {}, el('strong', {}, t.name)),
      g.soldCount != null ? el('td', { class: 'num' }, `${g.soldCount.toLocaleString('tr-TR')} adet`, el('small', {}, `Bu dönemde +${g.soldGain || 0}`)) : none('Site göstermiyor'),
      g.hasRealStock ? el('td', { class: 'num' }, `${g.stockDrop} adet`) : none('Adet gizli'),
      g.hasRealStock ? el('td', { class: 'num' }, `${g.stockRise} adet`) : none('–'),
      g.readings ? el('td', { class: 'num' }, String(g.soldOut)) : none('–'),
      g.readings ? el('td', { class: 'num' }, String(g.restocked)) : none('–'),
      g.hasRank ? el('td', { class: 'num' }, String(g.rankJumps)) : none('Sıralama yok'),
      g.reviewGain != null ? el('td', { class: 'num' }, `+${g.reviewGain}`) : none('–'));
  });
  $('signals').replaceChildren(el('thead', {}, head), el('tbody', {}, rows));
  const bits = [];
  if (anySold) bits.push(`satın alma sayaçlarında +${totalSold} adet`);
  if (anyStock) bits.push(`gerçek stok gösteren mağazalarda stoktan düşen ${totalDrop} adet`);
  $('signals-lede').textContent = readings < 2
    ? 'İşaretler ikinci taramadan sonra dolmaya başlar; değişim ölçmek için en az iki okuma gerekir.'
    : bits.length ? `Bu dönemde ${bits.join(', ')}.` : 'Bu dönemde ölçülebilen bir satış işareti yok.';
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
  $('legend').replaceChildren(...['in_stock', 'on_order', 'out_of_stock', 'no_buy_button', 'blocked'].map((s) => el('li', {}, pill(s))), el('li', {}, el('span', { class: 'pill s-none' }, 'Kayıt yok')));
}

function describeEvent(e) {
  if (e.field === 'status') {
    if (e.to === 'out_of_stock') return 'Stok tükendi';
    if (e.to === 'in_stock' && e.from !== 'in_stock') return `Yeniden stokta (önceki durum: ${L.STATUS_LABEL[e.from] || e.from})`;
    return `Durum değişti: ${L.STATUS_LABEL[e.from] || e.from} → ${L.STATUS_LABEL[e.to] || e.to}`;
  }
  if (e.field === 'stockQty') return e.to < e.from ? `Stoktan ${e.from - e.to} adet düştü (kalan: ${e.to})` : `Stoka ${e.to - e.from} adet girdi (toplam: ${e.to})`;
  if (e.field === 'rank') return `Satış sıralaması yükseldi: ${e.from.toLocaleString('tr-TR')}. sıradan ${e.to.toLocaleString('tr-TR')}. sıraya (arada satış olmuş olabilir)`;
  if (e.field === 'soldCount') return `Satın alma sayacı ${e.from} → ${e.to} (+${e.to - e.from})`;
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
  renderScanState(state); renderNow(state); renderSignals(state); renderStrips(state); renderEvents(state); renderTargets(state);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  el('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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
  download(new Blob([L.toCsv(state.snapshots, state.targets)], { type: 'text/csv;charset=utf-8' }), `kitap-takip-${L.dayKey(Date.now())}.csv`);
});
// Okuyucuyu bir siteye göre ayarlamak için: son taramanın sayfa parçaları (yalnızca ürün bilgisi).
$('diag').addEventListener('click', async () => {
  const state = await load();
  const { diag } = await chrome.storage.local.get('diag');
  const payload = { exportedAt: new Date().toISOString(), book: state.book, targets: state.targets, latest: L.latestByTarget(state.snapshots), diag: diag || {} };
  download(new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' }), `kitap-takip-tani-${L.dayKey(Date.now())}.json`);
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
