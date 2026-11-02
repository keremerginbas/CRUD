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
  const form = el('form', { class: 'card stack' },
    el('h1', {}, 'Santral girişi'),
    field('E-posta', el('input', { type: 'email', name: 'email', required: true, autocomplete: 'username' })),
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

const CALL_FILTERS = [['all', 'Tümü'], ['inbound', 'Gelen'], ['outbound', 'Giden'], ['missed', 'Cevapsız']];
const callState = { filter: 'all', scopeAll: false };

function callKind(c) {
  if (c.status === 'missed' || c.status === 'failed') return ['miss', '✕'];
  return c.direction === 'inbound' ? ['in', '↙'] : ['out', '↗'];
}

async function callsView() {
  const listBox = el('div', { class: 'list' }, el('p', { class: 'empty' }, 'Yükleniyor…'));
  const chips = el('div', { class: 'chips' });
  const drawChips = () => chips.replaceChildren(...[
    ...CALL_FILTERS.map(([key, label]) => el('button', {
      class: `chip${callState.filter === key ? ' on' : ''}`,
      onclick: () => { callState.filter = key; drawChips(); drawList(); },
    }, label)),
    isManager() && el('button', {
      class: `chip${callState.scopeAll ? ' on' : ''}`,
      onclick: () => { callState.scopeAll = !callState.scopeAll; drawChips(); load(); },
    }, 'Tüm ofis'),
  ].filter(Boolean));

  let calls = [];
  const drawList = () => {
    const shown = calls.filter((c) => callState.filter === 'all' ? true
      : callState.filter === 'missed' ? c.status === 'missed' : c.direction === callState.filter);
    listBox.replaceChildren(...(shown.length ? shown.map((c) => {
      const [cls, icon] = callKind(c);
      return el('a', { class: 'item', href: `#/arama/${c.id}` },
        el('span', { class: `dot ${cls}` }, icon),
        el('div', { class: 'grow' },
          el('div', {}, c.contact_name ?? c.customer_phone),
          el('div', { class: 'muted' }, [c.dialed_label ?? c.dialed_number ?? '—', callState.scopeAll && c.user_name].filter(Boolean).join(' · '))),
        el('div', { class: 'muted', style: 'text-align:right' },
          el('div', {}, formatDate(c.started_at)),
          el('div', {}, [c.duration_sec ? formatDuration(c.duration_sec) : '', c.recording_ref ? '● kayıt' : ''].filter(Boolean).join('  '))));
    }) : [el('p', { class: 'empty' }, 'Henüz çağrı yok')]));
  };
  const load = async () => {
    try {
      calls = await api(`/api/calls${callState.scopeAll ? '?scope=all' : ''}`);
      drawList();
    } catch (e) {
      listBox.replaceChildren(el('p', { class: 'empty' }, e.message));
    }
  };
  drawChips();
  render(el('h1', {}, 'Aramalar'), chips, listBox);
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
    const btn = el('button', { class: 'btn outline small' }, 'Kaydı yükle');
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
    el('a', { href: '#/aramalar', class: 'muted' }, '← Aramalar'),
    el('h1', {}, name),
    el('div', { class: 'card' }, el('dl', { class: 'info' }, rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]))),
    recording,
    el('div', { class: 'row', style: 'margin-top:20px' },
      el('button', { class: 'btn call', onclick: () => maskedCall({ contactId: c.contact_id ?? undefined, phone: c.customer_phone, name }) }, 'Geri ara')));
}

async function contactsView() {
  const listBox = el('div', { class: 'list' });
  const search = el('input', { type: 'search', placeholder: 'İsim veya telefon ara', 'aria-label': 'Kişi ara' });
  const addForm = el('form', { class: 'card stack', hidden: true },
    el('div', { class: 'row' },
      el('div', { class: 'grow' }, field('Ad soyad', el('input', { type: 'text', name: 'name', required: true }))),
      el('div', { class: 'grow' }, field('Telefon', el('input', { type: 'tel', name: 'phone', required: true, placeholder: '05XX XXX XX XX' })))),
    el('div', { class: 'row' },
      el('label', { class: 'check' }, el('input', { type: 'radio', name: 'type', value: 'ALICI', checked: true }), 'Alıcı'),
      el('label', { class: 'check' }, el('input', { type: 'radio', name: 'type', value: 'SATICI' }), 'Satıcı'),
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', type: 'submit' }, 'Kaydet')));
  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(addForm.querySelector('button'), async () => {
      await api('/api/contacts', { method: 'POST', body: Object.fromEntries(new FormData(addForm)) });
      addForm.reset();
      addForm.hidden = true;
      toast('Kişi eklendi');
      await load();
    });
  });

  const load = async () => {
    try {
      const contacts = await api(`/api/contacts?q=${encodeURIComponent(search.value.trim())}`);
      listBox.replaceChildren(...(contacts.length ? contacts.map((c) => el('div', { class: 'item' },
        el('span', { class: 'dot out' }, c.name[0] ?? '?'),
        el('div', { class: 'grow' },
          el('div', {}, c.name),
          el('div', { class: 'muted' }, c.phone)),
        el('span', { class: 'tag hide-sm' }, c.type),
        el('button', { class: 'btn call small', onclick: () => maskedCall({ contactId: c.id, name: c.name }) }, 'Ara')))
        : [el('p', { class: 'empty' }, 'Kişi bulunamadı')]));
    } catch (e) {
      listBox.replaceChildren(el('p', { class: 'empty' }, e.message));
    }
  };
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });

  render(
    el('div', { class: 'row', style: 'margin-bottom:14px' },
      el('h1', { class: 'grow', style: 'margin:0' }, 'Kişiler'),
      el('button', { class: 'btn small', onclick: () => { addForm.hidden = !addForm.hidden; } }, '+ Yeni kişi')),
    addForm,
    el('div', { style: 'margin:14px 0' }, search),
    listBox);
  await load();
}

const NUMBER_TYPES = { personal: 'Danışman hattı', listing: 'İlan hattı', hunt: 'Karşılama hattı' };

function settingsView() {
  const u = me;
  const hours = (prefix, label) => el('div', { class: 'row' },
    el('div', { class: 'grow' }, field(`${label} başlangıç`, el('input', { type: 'time', name: `${prefix}_start`, value: u[`${prefix}_start`], required: true }))),
    el('div', { class: 'grow' }, field(`${label} bitiş`, el('input', { type: 'time', name: `${prefix}_end`, value: u[`${prefix}_end`], required: true }))));

  const form = el('form', { class: 'stack' },
    el('div', { class: 'card stack' },
      field('Yönlendirilen telefon (gelen aramalar bu numarada çalar)', el('input', { type: 'tel', name: 'forward_phone', value: u.forward_phone ?? '' })),
      check('Sesli yönlendirme (açmadan önce kimin aradığı söylenir)', 'voice_announcement', u.voice_announcement)),
    el('div', { class: 'card stack' },
      el('strong', {}, 'Ses kayıtlarımı dinleyebilsin'),
      el('div', { class: 'row' }, check('Broker', 'recording_broker', u.recording_broker), check('Asistan', 'recording_assistant', u.recording_assistant))),
    el('div', { class: 'card stack' },
      el('strong', {}, 'Mesai saatleri'),
      hours('work', 'Hafta içi'),
      check('Cumartesi çalışıyorum', 'saturday_enabled', u.saturday_enabled), hours('saturday', 'Cumartesi'),
      check('Pazar çalışıyorum', 'sunday_enabled', u.sunday_enabled), hours('sunday', 'Pazar'),
      el('p', { class: 'muted', style: 'margin:0' }, 'Mesai dışında gelen aramalar asistana aktarılır.')),
    el('div', { class: 'row' }, el('button', { class: 'btn', type: 'submit' }, 'Kaydet')));
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

  const pw = el('form', { class: 'card stack' },
    field('Mevcut şifre', el('input', { type: 'password', name: 'current', required: true, autocomplete: 'current-password' })),
    field('Yeni şifre (en az 8 karakter)', el('input', { type: 'password', name: 'next', required: true, minlength: '8', autocomplete: 'new-password' })),
    el('div', { class: 'row' }, el('button', { class: 'btn outline', type: 'submit' }, 'Şifreyi değiştir')));
  pw.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(pw.querySelector('button'), async () => {
      await api('/api/me/password', { method: 'PUT', body: Object.fromEntries(new FormData(pw)) });
      pw.reset();
      toast('Şifre değiştirildi');
    });
  });

  render(
    el('h1', {}, 'Ayarlar'),
    el('div', { class: 'card' }, el('dl', { class: 'info' },
      el('dt', {}, 'Ad'), el('dd', {}, `${u.name} · ${u.title}`),
      el('dt', {}, 'Telefon'), el('dd', {}, u.phone),
      ...(u.numbers ?? []).flatMap((n) => [el('dt', {}, NUMBER_TYPES[n.type] ?? n.type), el('dd', {}, `${n.did} · ${n.label}`)]),
      u.extension && el('dt', {}, 'Dahili'), u.extension && el('dd', {}, u.extension))),
    el('h2', {}, 'Santral ayarları'), form,
    el('h2', {}, 'Şifre'), pw);
}

const ROLE_LABELS = { admin: 'Yönetici', broker: 'Broker', asistan: 'Asistan', danisman: 'Danışman' };

async function teamView(secret = null) {
  render(el('p', { class: 'empty' }, 'Yükleniyor…'));
  let users, numbers;
  try { [users, numbers] = await Promise.all([api('/api/users'), api('/api/numbers')]); } catch (e) { return render(el('p', { class: 'empty' }, e.message)); }

  const secretBox = el('div');
  const showSecret = (who, password) => secretBox.replaceChildren(el('div', { class: 'notice stack' },
    el('div', {}, `${who} için geçici şifre (bir kez gösterilir, kişiye iletin):`),
    el('div', { class: 'secret' }, password)));

  const userRows = users.map((u) => el('tr', {},
    el('td', {}, u.name, el('div', { class: 'muted' }, u.email)),
    el('td', {}, ROLE_LABELS[u.role] ?? u.role),
    el('td', { class: 'hide-sm' }, u.phone),
    el('td', {}, isAdmin() && el('button', {
      class: 'btn outline small',
      onclick: (e) => {
        if (!confirm(`${u.name} için yeni şifre üretilsin mi? Eski şifre çalışmaz.`)) return;
        busy(e.currentTarget, async () => showSecret(u.name, (await api(`/api/users/${u.id}/reset-password`, { method: 'POST' })).password));
      },
    }, 'Şifre sıfırla'))));

  const addUser = el('form', { class: 'card stack', hidden: true },
    el('div', { class: 'row' },
      el('div', { class: 'grow' }, field('Ad soyad', el('input', { type: 'text', name: 'name', required: true }))),
      el('div', { class: 'grow' }, field('E-posta', el('input', { type: 'email', name: 'email', required: true })))),
    el('div', { class: 'row' },
      el('div', { class: 'grow' }, field('Cep telefonu', el('input', { type: 'tel', name: 'phone', required: true }))),
      el('div', { class: 'grow' }, field('Rol', el('select', { name: 'role' },
        Object.entries(ROLE_LABELS).map(([v, l]) => el('option', { value: v, selected: v === 'danisman' }, l)))))),
    el('div', { class: 'row' }, el('button', { class: 'btn', type: 'submit' }, 'Kullanıcı ekle')));
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
    el('div', { class: 'row', style: 'margin-bottom:14px' },
      el('h1', { class: 'grow', style: 'margin:0' }, 'Ekip ve hatlar'),
      isAdmin() && el('button', { class: 'btn small', onclick: () => { addUser.hidden = !addUser.hidden; } }, '+ Yeni kullanıcı')),
    secretBox, addUser,
    el('h2', {}, `Ekip (${users.length})`),
    el('div', { class: 'card table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'Ad'), el('th', {}, 'Rol'), el('th', { class: 'hide-sm' }, 'Telefon'), el('th', {}, ''))),
      el('tbody', {}, userRows))),
    el('h2', {}, `Hatlar (${numbers.length})`),
    el('div', { class: 'card table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'Numara'), el('th', { class: 'hide-sm' }, 'Tür'), el('th', {}, 'Kimin'))),
      el('tbody', {}, numberRows))));
  if (secret) showSecret(secret.who, secret.password);
}

// ---- Yönlendirme ----
const ROUTES = [
  ['aramalar', 'Aramalar', callsView],
  ['kisiler', 'Kişiler', contactsView],
  ['ekip', 'Ekip', teamView, isManager],
  ['ayarlar', 'Ayarlar', settingsView],
];

function drawNav(current) {
  document.getElementById('topbar').hidden = !me;
  document.getElementById('nav').replaceChildren(...ROUTES
    .filter(([, , , allowed]) => !allowed || allowed())
    .map(([path, label]) => el('a', { href: `#/${path}`, class: current === path ? 'active' : '' }, label)));
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
