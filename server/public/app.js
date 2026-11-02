// XRE Santral web arayüzü: derleme gerektirmeyen tek sayfalık uygulama (hash yönlendirme)
const view = document.getElementById('view');
const MANAGERS = ['admin', 'broker', 'asistan'];
const TOKEN_KEY = 'santral-token';

let me = null;
let token = (() => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } })();

function setToken(value) {
  token = value;
  try { value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY); } catch { /* gizli sekme */ }
}

// ---- Yardımcılar ----
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  calls: '<path d="M8.6 3.5 6 3.2c-.9 0-1.9.7-2 1.8-.4 4.5 1.6 8.7 4.6 11.7s7.2 5 11.7 4.6c1.1-.1 1.8-1.1 1.8-2l-.3-2.6a1.2 1.2 0 0 0-.9-1l-3.2-.9a1.2 1.2 0 0 0-1.2.3l-1.5 1.5a14 14 0 0 1-5.9-5.9l1.5-1.5c.3-.3.4-.8.3-1.2l-.9-3.2a1.2 1.2 0 0 0-1-.9Z"/>',
  contacts: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 17c.8-1.8 2.2-2.6 4-2.6s3.2.8 4 2.6"/>',
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.8-3.2 3.1-4.8 6-4.8s5.2 1.6 6 4.8"/><path d="M16 4.8a3.2 3.2 0 0 1 0 6.4M18 14.6c1.5.7 2.5 2.1 3 4.4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
};

function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `i ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}

// fibimi'deki gibi "91 Gün Önce"
function daysAgo(sqlUtc) {
  const d = new Date(`${sqlUtc.replace(' ', 'T')}Z`);
  const today = new Date();
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate())
    - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  return days <= 0 ? 'Bugün' : days === 1 ? 'Dün' : `${days} gün önce`;
}

function render(...nodes) {
  view.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(message, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.className = `show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3500);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && token) {
    setToken(null);
    me = null;
    location.hash = '#/giris';
    throw new Error('Oturum süresi doldu, tekrar giriş yapın');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Beklenmeyen bir hata oluştu');
  return data;
}

const pad = (n) => String(n).padStart(2, '0');
// Sunucu UTC "YYYY-MM-DD HH:MM:SS" döndürür
function formatDate(sqlUtc) {
  const d = new Date(`${sqlUtc.replace(' ', 'T')}Z`);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const formatDuration = (sec) => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
const isManager = () => MANAGERS.includes(me?.role);
const isAdmin = () => me?.role === 'admin';

function field(label, input) {
  return el('label', { class: 'field' }, label, input);
}

function check(label, name, checked) {
  return el('label', { class: 'check' }, el('input', { type: 'checkbox', name, checked: !!checked }), label);
}

// Butonu iş bitene kadar kilitler
async function busy(button, fn) {
  button.disabled = true;
  try { await fn(); } catch (e) { toast(e.message, true); } finally { button.disabled = false; }
}

async function maskedCall({ contactId, phone, name }) {
  if (!confirm(`${name} santral üzerinden aransın mı?\n\nÖnce sizin telefonunuz çalar, açınca müşteriye bağlanırsınız. Müşteri sizin numaranızı görmez.`)) return;
  try {
    await api('/api/calls/click-to-call', { method: 'POST', body: { contactId, phone } });
    toast('Arama başlatıldı, telefonunuz birazdan çalacak');
  } catch (e) {
    toast(e.message, true);
  }
}

// ---- Ekranlar ----
function loginView() {
  const form = el('form', {},
    el('div', { class: 'brand' }, el('img', { src: 'icon.svg', alt: '' }), 'santral'),
    field('Kullanıcı adı', el('input', { type: 'text', name: 'email', required: true, autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', placeholder: 'ad.soyad' })),
    field('Şifre', el('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password' })),
    el('button', { class: 'btn', type: 'submit' }, 'Giriş yap'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    busy(form.querySelector('button'), async () => {
      const res = await api('/api/auth/login', { method: 'POST', body: data });
      setToken(res.token);
      await loadMe();
      location.hash = '#/aramalar';
    });
  });
  render(el('div', { class: 'login' }, form));
}

const CALL_FILTERS = [['all', 'Tüm aramalar'], ['inbound', 'Gelen'], ['outbound', 'Giden'], ['missed', 'Cevapsız']];
const callState = { filter: 'all', scopeAll: false };

function callColor(c) {
  if (c.status === 'missed' || c.status === 'failed') return 'c-miss';
  return c.direction === 'inbound' ? 'c-in' : 'c-out';
}

const matchesFilter = (c, key) => key === 'all' ? true : key === 'missed' ? c.status === 'missed' : c.direction === key;

async function callsView() {
  const tiles = el('div', { class: 'tiles', role: 'group', 'aria-label': 'Arama filtresi' });
  const tabs = el('div', { class: 'tabs' });
  const listBox = el('div', { class: 'rows' }, el('p', { class: 'empty' }, 'Yükleniyor…'));
  let calls = [];

  const drawTiles = () => tiles.replaceChildren(...CALL_FILTERS.map(([key, label]) => el('button', {
    class: `tile${callState.filter === key ? ' on' : ''}`, 'data-k': key, 'aria-pressed': String(callState.filter === key),
    onclick: () => { callState.filter = key; drawTiles(); drawList(); },
  }, el('span', { class: 'n' }, calls.filter((c) => matchesFilter(c, key)).length), el('span', { class: 'l' }, label))));

  // Yöneticiler kendi aramaları ile tüm ofis arasında geçiş yapar
  const drawTabs = () => tabs.replaceChildren(...[[false, 'Benim aramalarım'], [true, 'Tüm ofis']].map(([all, label]) => el('button', {
    class: callState.scopeAll === all ? 'on' : '', onclick: () => { callState.scopeAll = all; drawTabs(); load(); },
  }, label)));

  const drawList = () => {
    const shown = calls.filter((c) => matchesFilter(c, callState.filter));
    listBox.replaceChildren(...(shown.length ? shown.map((c) => {
      const color = callColor(c);
      const name = c.contact_name ?? c.customer_phone;
      return el('a', { class: 'r', href: `#/arama/${c.id}` },
        icon('chevron', `chev ${color}`),
        el('div', { class: `title ${color}` }, name),
        el('button', {
          class: `round${c.direction === 'outbound' ? ' blue' : ''} act`, 'aria-label': `${name} kişisini geri ara`,
          onclick: (e) => { e.preventDefault(); maskedCall({ contactId: c.contact_id ?? undefined, phone: c.customer_phone, name }); },
        }, icon('calls')),
        el('div', { class: 'meta' },
          el('span', {}, callState.scopeAll && c.user_name ? c.user_name : (c.dialed_label ?? c.dialed_number ?? '—')),
          el('span', {}, c.contact_name ? c.customer_phone : (STATUS[c.status] ?? '')),
          el('span', { class: 'm' }, formatDate(c.started_at)),
          el('span', { class: 'm' }, [c.direction === 'inbound' ? 'Gelen' : 'Giden', c.duration_sec ? formatDuration(c.duration_sec) : ''].filter(Boolean).join(', ')),
          el('span', { class: 'm' }, daysAgo(c.started_at)),
          c.recording_ref ? el('span', { class: 'rec' }, 'Ses kaydı') : el('span')));
    }) : [el('p', { class: 'empty' }, callState.filter === 'all' ? 'Henüz arama yok. Kişiler sayfasından ilk aramanızı başlatabilirsiniz.' : 'Bu filtrede arama yok.')]));
  };

  const load = async () => {
    try {
      calls = await api(`/api/calls${callState.scopeAll ? '?scope=all' : ''}`);
      drawTiles();
      drawList();
    } catch (e) {
      listBox.replaceChildren(el('p', { class: 'empty' }, e.message));
    }
  };
  drawTiles();
  if (isManager()) drawTabs();
  render(tiles, isManager() ? tabs : el('div', { style: 'height:12px' }), listBox,
    el('a', { class: 'fab', href: '#/kisiler', 'aria-label': 'Kişiler ve yeni arama' }, icon('plus')));
  await load();
}

const STATUS = { initiated: 'Başlatıldı', ringing: 'Çalıyor', answered: 'Görüşmede', completed: 'Tamamlandı', missed: 'Cevapsız', failed: 'Başarısız' };

async function callDetailView(id) {
  render(el('p', { class: 'empty' }, 'Yükleniyor…'));
  let c;
  try { c = await api(`/api/calls/${encodeURIComponent(id)}`); } catch (e) { return render(el('p', { class: 'empty' }, e.message)); }
  const name = c.contact_name ?? c.customer_phone;
  const rows = [
    ['Müşteri', c.contact_name ? `${c.contact_name} (${c.contact_type})` : 'Kayıtlı değil'],
    ['Telefon', c.customer_phone],
    ['Yön', c.direction === 'inbound' ? 'Gelen' : 'Giden'],
    [c.direction === 'inbound' ? 'Aranan numara' : 'Gösterilen numara', c.dialed_label ? `${c.dialed_label} · ${c.dialed_number}` : (c.dialed_number ?? '—')],
    ['Danışman', c.user_name ?? '—'],
    ['Tarih', formatDate(c.started_at)],
    ['Durum', STATUS[c.status] ?? c.status],
    ['Süre', formatDuration(c.duration_sec)],
  ];
  const recording = el('div');
  if (c.recording_ref) {
    const btn = el('button', { class: 'btn ghost small' }, 'Kaydı dinle');
    btn.addEventListener('click', () => busy(btn, async () => {
      // <audio> yetki başlığı gönderemediği için kaydı önce indirip yerelden çalıyoruz
      const res = await fetch(`/api/calls/${c.id}/recording`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Kayıt alınamadı');
      const audio = el('audio', { controls: true, autoplay: true, src: URL.createObjectURL(await res.blob()), style: 'width:100%' });
      recording.replaceChildren(audio);
    }));
    recording.append(el('h2', {}, 'Ses kaydı'), btn);
  }
  render(
    el('a', { href: '#/aramalar', class: 'back' }, icon('back'), 'Aramalar'),
    el('h1', { class: callColor(c) }, name),
    el('div', { class: 'panel' }, el('dl', { class: 'info' }, rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]))),
    recording,
    el('div', { class: 'actions', style: 'margin-top:24px;max-width:320px' },
      el('button', { class: 'btn', onclick: () => maskedCall({ contactId: c.contact_id ?? undefined, phone: c.customer_phone, name }) }, 'Geri ara')));
}

async function contactsView() {
  const listBox = el('div', { class: 'rows' });
  const search = el('input', { type: 'search', placeholder: 'ara', 'aria-label': 'İsim veya telefonla kişi ara' });
  const addForm = el('form', { class: 'panel', hidden: true, style: 'margin-bottom:18px' },
    el('div', { class: 'split' },
      field('ad soyad', el('input', { type: 'text', name: 'name', required: true })),
      field('telefon', el('input', { type: 'tel', name: 'phone', required: true, placeholder: '05XX XXX XX XX' }))),
    el('div', { class: 'checks' },
      el('label', { class: 'check' }, el('input', { type: 'radio', name: 'type', value: 'ALICI', checked: true }), 'Alıcı'),
      el('label', { class: 'check' }, el('input', { type: 'radio', name: 'type', value: 'SATICI' }), 'Satıcı')),
    el('div', { class: 'actions' },
      el('button', { class: 'btn ghost', type: 'button', onclick: () => { addForm.hidden = true; } }, 'İptal'),
      el('button', { class: 'btn', type: 'submit' }, 'Kişiyi kaydet')));
  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(addForm.querySelector('button[type=submit]'), async () => {
      await api('/api/contacts', { method: 'POST', body: Object.fromEntries(new FormData(addForm)) });
      addForm.reset();
      addForm.hidden = true;
      toast('Kişi kaydedildi');
      await load();
    });
  });

  const load = async () => {
    try {
      const contacts = await api(`/api/contacts?q=${encodeURIComponent(search.value.trim())}`);
      listBox.replaceChildren(...(contacts.length ? contacts.map((c) => el('div', { class: 'r' },
        icon('chevron', 'chev'),
        el('div', { class: 'title' }, c.name),
        el('button', { class: 'round act', 'aria-label': `${c.name} kişisini ara`, onclick: () => maskedCall({ contactId: c.id, name: c.name }) }, icon('calls')),
        el('div', { class: 'meta' },
          el('span', {}, c.phone),
          el('span', { class: 'm' }, c.type === 'SATICI' ? 'Satıcı' : 'Alıcı'),
          el('span', { class: 'm' }, formatDate(c.created_at)),
          el('span'))))
        : [el('p', { class: 'empty' }, search.value.trim() ? 'Bu aramayla eşleşen kişi yok.' : 'Henüz kişi yok. Sağ alttaki + ile ilk kişiyi ekleyin.')]));
    } catch (e) {
      listBox.replaceChildren(el('p', { class: 'empty' }, e.message));
    }
  };
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });

  render(
    el('div', { class: 'search' }, icon('search'), search),
    addForm,
    listBox,
    el('button', { class: 'fab', 'aria-label': 'Yeni kişi', onclick: () => { addForm.hidden = false; addForm.querySelector('input').focus(); window.scrollTo(0, 0); } }, icon('plus')));
  await load();
}

const NUMBER_TYPES = { personal: 'Danışman hattı', listing: 'İlan hattı', hunt: 'Karşılama hattı' };

function settingsView() {
  const u = me;
  const hours = (prefix) => el('div', { class: 'split' },
    field('başlangıç', el('input', { type: 'time', name: `${prefix}_start`, value: u[`${prefix}_start`], required: true })),
    field('bitiş', el('input', { type: 'time', name: `${prefix}_end`, value: u[`${prefix}_end`], required: true })));

  const digital = (u.numbers ?? []).find((n) => n.type === 'personal');
  const form = el('form', { style: 'display:grid;gap:16px' },
    el('div', { class: 'panel' },
      field('dijital telefon (müşterinin gördüğü numara)', el('input', { type: 'text', value: digital?.did ?? 'Henüz hat atanmadı', readonly: true })),
      field('yönlendirilen telefon (gelen aramalar burada çalar)', el('input', { type: 'tel', name: 'forward_phone', value: u.forward_phone ?? '', placeholder: '05XX XXX XX XX' })),
      el('div', { class: 'checks', style: 'justify-content:center' }, check('Sesli yönlendirme', 'voice_announcement', u.voice_announcement))),
    el('div', { class: 'panel' },
      el('div', {}, 'Ses kaydını dinlesin'),
      el('div', { class: 'checks', style: 'justify-content:center' }, check('Broker', 'recording_broker', u.recording_broker), check('Asistan', 'recording_assistant', u.recording_assistant))),
    el('div', { class: 'panel' },
      el('div', {}, 'Mesai saatleri'),
      hours('work'),
      check('Cumartesi çalışıyor mu?', 'saturday_enabled', u.saturday_enabled), hours('saturday'),
      check('Pazar çalışıyor mu?', 'sunday_enabled', u.sunday_enabled), hours('sunday'),
      el('p', { class: 'muted', style: 'margin:0' }, 'Mesai dışındaki aramalar asistana aktarılır.')),
    el('div', { class: 'actions' },
      el('button', { class: 'btn ghost', type: 'button', onclick: () => settingsView() }, 'İptal'),
      el('button', { class: 'btn', type: 'submit' }, 'Kaydet')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = { forward_phone: fd.get('forward_phone') };
    for (const k of ['voice_announcement', 'recording_broker', 'recording_assistant', 'saturday_enabled', 'sunday_enabled']) body[k] = fd.has(k);
    for (const k of ['work_start', 'work_end', 'saturday_start', 'saturday_end', 'sunday_start', 'sunday_end']) body[k] = fd.get(k);
    busy(form.querySelector('button[type=submit]'), async () => {
      await api('/api/me/santral', { method: 'PUT', body });
      await loadMe();
      toast('Ayarlar kaydedildi');
    });
  });

  const pw = el('form', { class: 'panel' },
    el('div', { class: 'split' },
      field('mevcut şifre', el('input', { type: 'password', name: 'current', required: true, autocomplete: 'current-password' })),
      field('yeni şifre (en az 8 karakter)', el('input', { type: 'password', name: 'next', required: true, minlength: '8', autocomplete: 'new-password' }))),
    el('div', { class: 'actions' }, el('button', { class: 'btn ghost', type: 'submit' }, 'Şifreyi değiştir')));
  pw.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(pw.querySelector('button'), async () => {
      await api('/api/me/password', { method: 'PUT', body: Object.fromEntries(new FormData(pw)) });
      pw.reset();
      toast('Şifre değiştirildi');
    });
  });

  render(
    el('h1', {}, u.name, el('div', { class: 'muted', style: 'font-size:14px;font-weight:400' }, u.department ?? u.title)),
    el('div', { class: 'panel' }, el('dl', { class: 'info' },
      el('dt', {}, 'Telefon'), el('dd', {}, u.phone),
      ...(u.numbers ?? []).flatMap((n) => [el('dt', {}, NUMBER_TYPES[n.type] ?? n.type), el('dd', {}, `${n.did} · ${n.label}`)]),
      u.extension && el('dt', {}, 'Dahili'), u.extension && el('dd', {}, u.extension))),
    el('h2', {}, 'Santral ayarları'), form,
    el('h2', {}, 'Şifre işlemleri'), pw);
}

const ROLE_LABELS = { admin: 'Yönetici', broker: 'Broker', asistan: 'Asistan', danisman: 'Danışman' };

async function teamView(secret = null) {
  render(el('p', { class: 'empty' }, 'Yükleniyor…'));
  let users, numbers;
  try { [users, numbers] = await Promise.all([api('/api/users'), api('/api/numbers')]); } catch (e) { return render(el('p', { class: 'empty' }, e.message)); }

  const secretBox = el('div');
  const showSecret = (who, password) => secretBox.replaceChildren(el('div', { class: 'notice' },
    el('div', {}, `${who} için geçici şifre (bir kez gösterilir, kişiye iletin):`),
    el('div', { class: 'secret' }, password)));

  const userRows = users.map((u) => el('tr', {},
    el('td', {}, u.name, el('div', { class: 'muted' }, u.email)),
    el('td', {}, ROLE_LABELS[u.role] ?? u.role, u.department && el('div', { class: 'muted' }, u.department)),
    el('td', { class: 'hide-sm' }, u.phone),
    el('td', {}, isAdmin() && el('button', {
      class: 'btn ghost small',
      onclick: (e) => {
        if (!confirm(`${u.name} için yeni şifre üretilsin mi? Eski şifre çalışmaz.`)) return;
        busy(e.currentTarget, async () => showSecret(u.name, (await api(`/api/users/${u.id}/reset-password`, { method: 'POST' })).password));
      },
    }, 'Şifre sıfırla'))));

  const addUser = el('form', { class: 'panel', hidden: true, style: 'margin-bottom:16px' },
    el('div', { class: 'split' },
      field('ad soyad', el('input', { type: 'text', name: 'name', required: true })),
      field('kullanıcı adı', el('input', { type: 'text', name: 'email', required: true, autocapitalize: 'none', placeholder: 'ad.soyad' }))),
    el('div', { class: 'split' },
      field('cep telefonu', el('input', { type: 'tel', name: 'phone', required: true })),
      field('rol', el('select', { name: 'role' },
        Object.entries(ROLE_LABELS).map(([v, l]) => el('option', { value: v, selected: v === 'danisman' }, l))))),
    el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'submit' }, 'Kullanıcıyı ekle')));
  addUser.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(addUser.querySelector('button'), async () => {
      const res = await api('/api/users', { method: 'POST', body: Object.fromEntries(new FormData(addUser)) });
      await teamView({ who: res.user.name, password: res.password });
    });
  });

  const userOptions = (selected) => [el('option', { value: '' }, '— Atanmamış —'),
    ...users.map((u) => el('option', { value: u.id, selected: u.id === selected }, u.name))];
  const numberRows = numbers.map((n) => {
    const select = el('select', { 'aria-label': `${n.did} sahibi`, disabled: !isAdmin() || n.type === 'hunt' }, userOptions(n.user_id));
    select.addEventListener('change', async () => {
      try {
        await api(`/api/numbers/${encodeURIComponent(n.did)}`, { method: 'PUT', body: { user_id: select.value ? Number(select.value) : null } });
        toast(`${n.did} güncellendi`);
      } catch (err) { toast(err.message, true); }
    });
    return el('tr', {},
      el('td', {}, n.did, el('div', { class: 'muted' }, n.label)),
      el('td', { class: 'hide-sm' }, NUMBER_TYPES[n.type] ?? n.type),
      el('td', {}, n.type === 'hunt' ? el('span', { class: 'muted' }, 'Kuyruk') : select));
  });

  render(
    el('h1', {}, 'Ekip ve hatlar'),
    secretBox, addUser,
    el('h2', {}, `Ekip (${users.length})`),
    el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'Ad'), el('th', {}, 'Rol'), el('th', { class: 'hide-sm' }, 'Telefon'), el('th', {}, ''))),
      el('tbody', {}, userRows))),
    el('h2', {}, `Hatlar (${numbers.length})`),
    el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'Numara'), el('th', { class: 'hide-sm' }, 'Tür'), el('th', {}, 'Kimin'))),
      el('tbody', {}, numberRows))),
    isAdmin() && el('button', { class: 'fab', 'aria-label': 'Yeni kullanıcı', onclick: () => { addUser.hidden = false; addUser.querySelector('input').focus(); window.scrollTo(0, 0); } }, icon('plus')));
  if (secret) showSecret(secret.who, secret.password);
}

// ---- Yönlendirme ----
const ROUTES = [
  ['aramalar', 'Aramalar', callsView, null, 'calls'],
  ['kisiler', 'Kişiler', contactsView, null, 'contacts'],
  ['ekip', 'Ekip', teamView, isManager, 'team'],
  ['ayarlar', 'Ayarlar', settingsView, null, 'settings'],
];

function drawNav(current) {
  document.getElementById('topbar').hidden = !me;
  document.getElementById('nav').replaceChildren(...ROUTES
    .filter(([, , , allowed]) => !allowed || allowed())
    .map(([path, label, , , ic]) => el('a', { href: `#/${path}`, class: current === path ? 'active' : '', 'aria-current': current === path ? 'page' : null }, icon(ic), label)));
}

async function loadMe() {
  me = await api('/api/me');
}

function clearToast() {
  clearTimeout(toastTimer);
  document.getElementById('toast').className = '';
}

async function route() {
  const [, page = '', id] = location.hash.split('/');
  clearToast();
  if (!me && token) {
    try { await loadMe(); } catch { /* api() oturumu temizler */ }
  }
  if (!me) {
    drawNav(null);
    return loginView();
  }
  if (page === 'giris' || page === '') return void (location.hash = '#/aramalar');
  drawNav(page === 'arama' ? 'aramalar' : page);
  if (page === 'arama') return callDetailView(id);
  const match = ROUTES.find(([path, , , allowed]) => path === page && (!allowed || allowed()));
  return match ? match[2]() : void (location.hash = '#/aramalar');
}

document.getElementById('logout').addEventListener('click', () => {
  setToken(null);
  me = null;
  location.hash = '#/giris';
});
window.addEventListener('hashchange', route);
route();
