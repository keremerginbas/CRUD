import { useCallback, useEffect, useState } from 'react';
import { api, formatDate } from './api';

const STATUS_LABELS = {
  pending: 'Bekliyor',
  sent: 'Gönderildi',
  failed: 'Hata',
  skipped: 'Atlandı',
  active: 'Aktif',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
};

function Badge({ status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status] || status}</span>;
}

function useLoader(loader) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    loader().then(setData, (e) => setError(e.message));
  }, [loader]);
  useEffect(reload, [reload]);
  return [data, reload, error];
}

// SMS boyu: Türkçe karakter içeren mesajlar daha kısa bölümlere ayrılır.
function smsInfo(text) {
  const turkish = /[çğıöşüÇĞİÖŞÜ]/.test(text);
  const per = turkish ? 155 : 160;
  return `${text.length} karakter · ~${Math.max(1, Math.ceil(text.length / per))} SMS`;
}

// ---------------- Kampanyalar ----------------

// Yeni kampanyada hazır gelen teşvik serisi; köşeli parantezli yerler doldurulmalı.
const SAMPLE_STEPS = [
  [0, '00:00', 'Merhaba {ad}, {proje} projemizle ilgilendiğiniz için teşekkürler. Projemiz hakkında ne düşünüyorsunuz?'],
  [3, '10:30', 'Merhaba {ad}, {proje} projemizi hâlâ değerlendiriyor musunuz? Size özel bir sunum için randevu planlayabiliriz.'],
  [5, '10:30', '{ad}, {proje} güncel fiyat ve ödeme seçenekleri: [FİYAT / ÖDEME PLANI]. Detaylı bilgi için bize ulaşın.'],
  [10, '10:30', '{ad}, {proje} projemizde sınırlı sayıda daire kaldı. Projeyi yerinde görmek ister misiniz? [LİNK]'],
  [14, '10:30', '{ad}, {proje} için bu aya özel fırsat: [KAMPANYA DETAYI]. Fiyatlar değişmeden bilgi almak için bize yazın.'],
  [30, '10:30', 'Merhaba {ad}, {proje} ile ilgili kararınızı verdiniz mi? Yardımcı olabileceğimiz bir konu varsa bize ulaşın.'],
];

const emptyCampaign = () => ({
  name: '',
  type: 'proje',
  project: '',
  description: '',
  active: true,
  bitrix_entity: '',
  bitrix_stage: '',
  bitrix_project: '',
  steps: SAMPLE_STEPS.map(([day_offset, send_time, message]) => ({ day_offset, send_time, message })),
});

// Kampanyanın hangi Bitrix aşamasında otomatik başlayacağı.
function BitrixTrigger({ form, set }) {
  const [status, setStatus] = useState(null);
  const [stages, setStages] = useState([]);
  const [projects, setProjects] = useState([]);
  useEffect(() => { api.get('/bitrix/status').then(setStatus, () => setStatus({ configured: false })); }, []);
  useEffect(() => {
    if (!status?.configured || !form.bitrix_entity) return;
    api.get(`/bitrix/stages?type=${form.bitrix_entity}`).then(setStages, () => setStages([]));
    api.get(`/bitrix/project-options?type=${form.bitrix_entity}`).then(setProjects, () => setProjects([]));
  }, [status, form.bitrix_entity]);

  return (
    <>
      <h4>Bitrix tetikleyicisi</h4>
      <p className="hint">
        Müşteri Bitrix'te seçilen aşamaya girdiği anda bu seri başlar; başka aşamaya geçince durur.
        {status && !status.configured && ' (Sunucuda Bitrix bağlantısı tanımlı değil; değerleri elle girebilirsiniz.)'}
      </p>
      <div className="row">
        <label>Kayıt türü
          <select value={form.bitrix_entity || ''} onChange={(e) => set({ bitrix_entity: e.target.value, bitrix_stage: '', bitrix_project: '' })}>
            <option value="">Bağlı değil (elle eklenir)</option>
            <option value="deal">Anlaşma (Deal)</option>
            <option value="lead">Potansiyel müşteri (Lead)</option>
          </select>
        </label>
        {form.bitrix_entity && (
          <label>Aşama / statü
            {stages.length ? (
              <select value={form.bitrix_stage || ''} onChange={(e) => set({ bitrix_stage: e.target.value })} required>
                <option value="">Seçin…</option>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : (
              <input value={form.bitrix_stage || ''} placeholder="ör. C3:NEW" onChange={(e) => set({ bitrix_stage: e.target.value })} required />
            )}
          </label>
        )}
        {form.bitrix_entity && (
          <label>Proje alanı değeri (opsiyonel)
            {projects.length ? (
              <select value={form.bitrix_project || ''} onChange={(e) => set({ bitrix_project: e.target.value })}>
                <option value="">Tüm projeler</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : (
              <input value={form.bitrix_project || ''} onChange={(e) => set({ bitrix_project: e.target.value })} />
            )}
          </label>
        )}
      </div>
    </>
  );
}

function CampaignForm({ initial, onSaved, onCancel }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setStep = (i, patch) => set({ steps: form.steps.map((s, j) => (i === j ? { ...s, ...patch } : s)) });

  const addStep = () => {
    const last = form.steps[form.steps.length - 1];
    set({ steps: [...form.steps, { day_offset: last ? last.day_offset + 1 : 0, send_time: '10:00', message: '' }] });
  };

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        ...form,
        bitrix_entity: form.bitrix_entity || null,
        steps: form.steps.map((s) => ({ ...s, day_offset: Number(s.day_offset) })),
      };
      if (form.id) await api.put(`/campaigns/${form.id}`, payload);
      else await api.post('/campaigns', payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="card" onSubmit={save}>
      <h3>{form.id ? 'Kampanyayı düzenle' : 'Yeni kampanya'}</h3>
      <div className="row">
        <label>Ad<input value={form.name} onChange={(e) => set({ name: e.target.value })} required /></label>
        <label>Tür
          <select value={form.type} onChange={(e) => set({ type: e.target.value })}>
            <option value="proje">Proje</option>
            <option value="reklam">Reklam</option>
          </select>
        </label>
        <label>Proje adı (mesajda {'{proje}'})<input value={form.project || ''} placeholder="ör. Ankaport Saray" onChange={(e) => set({ project: e.target.value })} /></label>
        <label className="check">
          <input type="checkbox" checked={!!form.active} onChange={(e) => set({ active: e.target.checked })} /> Aktif
        </label>
      </div>
      <label>Açıklama<input value={form.description || ''} onChange={(e) => set({ description: e.target.value })} /></label>
      <BitrixTrigger form={form} set={set} />

      <h4>SMS adımları</h4>
      <p className="hint">
        Gün, müşterinin akışa eklendiği (Bitrix'te aşamaya girdiği) günden itibaren sayılır. 0. gün 00:00 = hemen gönder.
        Mesajda <code>{'{ad}'}</code>, <code>{'{adsoyad}'}</code>, <code>{'{proje}'}</code>, <code>{'{kampanya}'}</code> kullanabilirsiniz.
        Köşeli parantezli yerleri (fiyat, link…) kendi bilgilerinizle değiştirin.
      </p>
      {form.steps.map((s, i) => (
        <div className="step" key={i}>
          <label className="small">Gün
            <input type="number" min="0" value={s.day_offset} onChange={(e) => setStep(i, { day_offset: e.target.value })} />
          </label>
          <label className="small">Saat
            <input type="time" value={s.send_time} onChange={(e) => setStep(i, { send_time: e.target.value })} />
          </label>
          <label className="grow">Mesaj <span className="hint">{smsInfo(s.message)}</span>
            <textarea rows="2" value={s.message} onChange={(e) => setStep(i, { message: e.target.value })} required />
          </label>
          <button type="button" className="link danger" onClick={() => set({ steps: form.steps.filter((_, j) => j !== i) })}>Sil</button>
        </div>
      ))}
      <button type="button" onClick={addStep}>+ Adım ekle</button>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" className="primary">Kaydet</button>
        <button type="button" onClick={onCancel}>Vazgeç</button>
      </div>
    </form>
  );
}

function Campaigns() {
  const [campaigns, reload] = useLoader(useCallback(() => api.get('/campaigns'), []));
  const [editing, setEditing] = useState(null);

  if (editing) {
    return <CampaignForm initial={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />;
  }
  return (
    <>
      <div className="toolbar"><button className="primary" onClick={() => setEditing(emptyCampaign())}>+ Yeni kampanya</button></div>
      <table>
        <thead><tr><th>Ad</th><th>Bitrix tetikleyici</th><th>Gönderim günleri</th><th>Aktif akış</th><th>Durum</th><th /></tr></thead>
        <tbody>
          {(campaigns || []).map((c) => (
            <tr key={c.id}>
              <td>{c.name}<div className="hint">{c.project || (c.type === 'proje' ? 'Proje' : 'Reklam')} · ID: {c.id}</div></td>
              <td>
                {c.bitrix_entity ? `${c.bitrix_entity === 'deal' ? 'Deal' : 'Lead'} · ${c.bitrix_stage}` : <span className="hint">Elle</span>}
                {c.bitrix_project && <div className="hint">proje değeri: {c.bitrix_project}</div>}
              </td>
              <td>{c.steps.map((s) => `${s.day_offset}.`).join(' · ')} gün</td>
              <td>{c.active_count}</td>
              <td>{c.active ? <Badge status="active" /> : <Badge status="cancelled" />}</td>
              <td className="right">
                <button className="link" onClick={() => setEditing(c)}>Düzenle</button>
                <button className="link danger" onClick={async () => {
                  if (window.confirm(`"${c.name}" ve tüm akışları silinsin mi?`)) { await api.del(`/campaigns/${c.id}`); reload(); }
                }}>Sil</button>
              </td>
            </tr>
          ))}
          {campaigns && !campaigns.length && <tr><td colSpan="6" className="empty">Henüz kampanya yok.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

// ---------------- Müşteriler ----------------

function Customers() {
  const [q, setQ] = useState('');
  const [customers, reload] = useLoader(useCallback(() => api.get(`/customers?q=${encodeURIComponent(q)}`), [q]));
  const [campaigns] = useLoader(useCallback(() => api.get('/campaigns'), []));
  const blank = { name: '', phone: '', consent: false, campaign_id: '', start_date: '' };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/customers', { ...form, campaign_id: form.campaign_id || undefined, start_date: form.start_date || undefined });
      setForm(blank);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const enroll = async (customer) => {
    const id = window.prompt(
      `Kampanya ID girin:\n${(campaigns || []).map((c) => `${c.id} - ${c.name}`).join('\n')}`
    );
    if (!id) return;
    try { await api.post('/enrollments', { customer_id: customer.id, campaign_id: Number(id) }); reload(); }
    catch (err) { window.alert(err.message); }
  };

  return (
    <>
      <form className="card" onSubmit={add}>
        <h3>Müşteri ekle</h3>
        <div className="row">
          <label>Ad soyad<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label>Cep telefonu<input value={form.phone} placeholder="05xx xxx xx xx" onChange={(e) => setForm({ ...form, phone: e.target.value })} required /></label>
          <label>Kampanya (opsiyonel)
            <select value={form.campaign_id} onChange={(e) => setForm({ ...form, campaign_id: e.target.value })}>
              <option value="">—</option>
              {(campaigns || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Başlangıç<input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
          Müşteri ticari elektronik ileti (SMS) almaya onay verdi
        </label>
        {error && <p className="error">{error}</p>}
        <div className="actions"><button type="submit" className="primary">Ekle</button></div>
      </form>

      <div className="toolbar"><input placeholder="Ad veya telefon ara…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <table>
        <thead><tr><th>Ad</th><th>Telefon</th><th>İzin</th><th>Aktif akış</th><th /></tr></thead>
        <tbody>
          {(customers || []).map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.phone}</td>
              <td>
                {c.opted_out ? <Badge status="cancelled" /> : (
                  <label className="check">
                    <input type="checkbox" checked={!!c.consent} onChange={async (e) => { await api.put(`/customers/${c.id}`, { consent: e.target.checked }); reload(); }} />
                    {c.consent ? 'Var' : 'Yok'}
                  </label>
                )}
                {!!c.opted_out && <span className="hint"> RET</span>}
              </td>
              <td>{c.active_count}</td>
              <td className="right">
                <button className="link" onClick={() => enroll(c)}>Kampanyaya ekle</button>
                {!c.opted_out && (
                  <button className="link danger" onClick={async () => {
                    if (window.confirm(`${c.name} için tüm SMS gönderimleri durdurulsun mu (RET)?`)) { await api.post('/opt-out', { phone: c.phone }); reload(); }
                  }}>RET</button>
                )}
                <button className="link danger" onClick={async () => {
                  if (window.confirm(`${c.name} silinsin mi?`)) { await api.del(`/customers/${c.id}`); reload(); }
                }}>Sil</button>
              </td>
            </tr>
          ))}
          {customers && !customers.length && <tr><td colSpan="5" className="empty">Müşteri bulunamadı.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

// ---------------- Akışlar ----------------

function Enrollments() {
  const [status, setStatus] = useState('active');
  const [rows, reload] = useLoader(useCallback(() => api.get(`/enrollments${status ? `?status=${status}` : ''}`), [status]));
  return (
    <>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Aktif</option>
          <option value="completed">Tamamlanan</option>
          <option value="cancelled">İptal</option>
          <option value="">Tümü</option>
        </select>
      </div>
      <table>
        <thead><tr><th>Müşteri</th><th>Kampanya</th><th>Başlangıç</th><th>Plan</th><th>Durum</th><th /></tr></thead>
        <tbody>
          {(rows || []).map((r) => (
            <tr key={r.id}>
              <td>{r.customer_name}<div className="hint">{r.phone}{!r.consent && ' · izin yok'}</div></td>
              <td>{r.campaign_name}{!r.campaign_active && <div className="hint">kampanya durdurulmuş</div>}</td>
              <td>{r.start_date}</td>
              <td>
                <div className="plan">
                  {r.plan.map((p) => (
                    <span key={p.day_offset} className={`dot dot-${p.status}`} title={`${p.day_offset}. gün · ${formatDate(p.due_at)} · ${STATUS_LABELS[p.status]}${p.error ? ` · ${p.error}` : ''}`}>
                      {p.day_offset}
                    </span>
                  ))}
                </div>
              </td>
              <td><Badge status={r.status} /></td>
              <td className="right">
                {r.status === 'active' && (
                  <button className="link danger" onClick={async () => { await api.post(`/enrollments/${r.id}/cancel`); reload(); }}>Durdur</button>
                )}
              </td>
            </tr>
          ))}
          {rows && !rows.length && <tr><td colSpan="6" className="empty">Kayıt yok.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

// ---------------- SMS geçmişi ----------------

function Messages() {
  const [rows] = useLoader(useCallback(() => api.get('/messages'), []));
  return (
    <table>
      <thead><tr><th>Tarih</th><th>Müşteri</th><th>Kampanya</th><th>Gün</th><th>Mesaj</th><th>Durum</th></tr></thead>
      <tbody>
        {(rows || []).map((m) => (
          <tr key={m.id}>
            <td>{formatDate(m.updated_at)}</td>
            <td>{m.customer_name}<div className="hint">{m.phone}</div></td>
            <td>{m.campaign_name}</td>
            <td>{m.day_offset}.</td>
            <td className="msg">{m.body}{m.error && <div className="error">{m.error}</div>}</td>
            <td><Badge status={m.status} />{m.attempts > 1 && <div className="hint">{m.attempts} deneme</div>}</td>
          </tr>
        ))}
        {rows && !rows.length && <tr><td colSpan="6" className="empty">Henüz gönderim yok.</td></tr>}
      </tbody>
    </table>
  );
}

// ---------------- Uygulama ----------------

const TABS = { campaigns: ['Kampanyalar', Campaigns], customers: ['Müşteriler', Customers], enrollments: ['Akışlar', Enrollments], messages: ['SMS geçmişi', Messages] };

export default function App() {
  const [tab, setTab] = useState('campaigns');
  const [refresh, setRefresh] = useState(0);
  const [stats, reloadStats, statsError] = useLoader(useCallback(() => api.get('/stats'), []));
  const Tab = TABS[tab][1];

  const runNow = async () => {
    const r = await api.post('/scheduler/run');
    window.alert(r.skipped ? 'Zamanlayıcı zaten çalışıyor.' : `Gönderilen: ${r.sent} · Hata: ${r.failed} · Atlanan: ${r.skipped}`);
    reloadStats();
    setRefresh((n) => n + 1);
  };

  return (
    <div className="app">
      <header>
        <h1>SMS Otomasyonu</h1>
        <button onClick={runNow}>Zamanlayıcıyı şimdi çalıştır</button>
      </header>
      {statsError && <p className="error">Sunucuya ulaşılamadı: {statsError}</p>}
      {stats && (
        <div className="stats">
          <div><b>{stats.campaigns}</b>aktif kampanya</div>
          <div><b>{stats.customers}</b>müşteri</div>
          <div><b>{stats.active_enrollments}</b>aktif akış</div>
          <div><b>{stats.sent}</b>gönderilen SMS</div>
          <div><b>{stats.failed}</b>hatalı</div>
        </div>
      )}
      <nav>
        {Object.entries(TABS).map(([key, [label]]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => { setTab(key); reloadStats(); }}>{label}</button>
        ))}
      </nav>
      <main><Tab key={`${tab}-${refresh}`} /></main>
    </div>
  );
}
