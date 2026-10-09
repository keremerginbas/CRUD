import { useState } from 'react';
import { Link } from 'react-router-dom';
import useReveal from '../hooks/useReveal';
import usePageTitle from '../hooks/usePageTitle';

const CONTACT_EMAIL = 'kurumsal@excadijital.com.tr';
const WHATSAPP = 'https://wa.me/905061288930';

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3600);
}

const INITIAL = { name: '', email: '', topic: 'Web Sitesi', message: '' };

export default function Contact() {
  usePageTitle('İletişim');
  useReveal();
  const [form, setForm] = useState(INITIAL);
  const [errors, setErrors] = useState({});

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const onSubmit = (e) => {
    e.preventDefault();
    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) nextErrors.email = true;
    if (form.message.trim().length < 10) nextErrors.message = true;
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length) {
      showToast('Lütfen işaretli alanları kontrol edin.');
      return;
    }

    const subject = encodeURIComponent(`[Web Teklif] ${form.topic} — ${form.name.trim()}`);
    const body = encodeURIComponent(
      `Ad: ${form.name.trim()}\nE-posta: ${form.email.trim()}\nKonu: ${form.topic}\n\n${form.message.trim()}`
    );
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
    showToast('E-posta uygulamanız açılıyor…');
    setForm(INITIAL);
  };

  return (
    <div className="wrap">
      <section className="page-hero">
        <div className="breadcrumb" data-reveal>
          <Link to="/" data-hover>Ana Sayfa</Link> / İletişim
        </div>
        <div className="sec-tag" data-reveal>İletişim</div>
        <h1 data-reveal style={{ '--rd': '.06s' }}>Projenizi<br /><b>konuşalım.</b></h1>
      </section>

      <section className="block" style={{ paddingTop: 0 }}>
        <div className="contact-grid">
          <div className="contact-info" data-reveal="left">
            <h3>Size en kolay gelen kanaldan ulaşın</h3>
            <p>
              Form doldurmak istemeyenler için: Instagram DM her zaman açık.
              Ortalama yanıt süremiz birkaç saati geçmez.
            </p>
            <ul className="ci-list">
              <li>
                <a href={`mailto:${CONTACT_EMAIL}`} data-hover>
                  <span className="ci-ico">✉️</span>
                  <span className="ci-txt">
                    <b>{CONTACT_EMAIL}</b>
                    <span>E-posta ile teklif isteyin</span>
                  </span>
                </a>
              </li>
              <li>
                <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" data-hover>
                  <span className="ci-ico">💬</span>
                  <span className="ci-txt">
                    <b>WhatsApp</b>
                    <span>Hızlı sorular için birebir hat</span>
                  </span>
                </a>
              </li>
              <li>
                <span className="ci-static">
                  <span className="ci-ico">📍</span>
                  <span className="ci-txt">
                    <b>Türkiye</b>
                    <span>Tüm şehirlerle remote çalışıyoruz</span>
                  </span>
                </span>
              </li>
            </ul>
            <a className="ig-card" href="https://www.instagram.com/excadijital/" target="_blank" rel="noopener noreferrer" data-hover>
              <div>
                <b>@excadijital</b>
                <span>Güncel işlerimiz ve kamera arkası Instagram&apos;da</span>
              </div>
              <div className="work-arrow">↗</div>
            </a>
          </div>

          <form className="form" data-reveal="right" noValidate onSubmit={onSubmit}>
            <div className="f-row">
              <div className={`f-group${errors.name ? ' err' : ''}`}>
                <label htmlFor="fName">Adınız</label>
                <input
                  type="text" id="fName" name="name" placeholder="Ad Soyad"
                  autoComplete="name" value={form.name} onChange={onChange}
                />
                <span className="f-err">Lütfen adınızı yazın.</span>
              </div>
              <div className={`f-group${errors.email ? ' err' : ''}`}>
                <label htmlFor="fMail">E-posta</label>
                <input
                  type="email" id="fMail" name="email" placeholder="ornek@mail.com"
                  autoComplete="email" value={form.email} onChange={onChange}
                />
                <span className="f-err">Geçerli bir e-posta girin.</span>
              </div>
            </div>
            <div className="f-group">
              <label htmlFor="fTopic">Konu</label>
              <select id="fTopic" name="topic" value={form.topic} onChange={onChange}>
                <option value="Web Sitesi">Web Sitesi</option>
                <option value="Sosyal Medya Yönetimi">Sosyal Medya Yönetimi</option>
                <option value="Reklam / Performans">Reklam / Performans</option>
                <option value="Marka Kimliği">Marka Kimliği</option>
                <option value="E-Ticaret">E-Ticaret</option>
                <option value="Diğer">Diğer</option>
              </select>
            </div>
            <div className={`f-group${errors.message ? ' err' : ''}`}>
              <label htmlFor="fMsg">Projeniz</label>
              <textarea
                id="fMsg" name="message" value={form.message} onChange={onChange}
                placeholder="Kısaca anlatın: ne yapıyorsunuz, neye ihtiyacınız var, hedefiniz ne?"
              />
              <span className="f-err">Birkaç cümleyle projenizden bahsedin.</span>
            </div>
            <button type="submit" className="btn primary" data-hover>
              Gönder <span className="arr">→</span>
            </button>
            <p className="form-note">
              Form, e-posta uygulamanız üzerinden iletilir — bilgileriniz üçüncü taraflarla paylaşılmaz.
            </p>
          </form>
        </div>
      </section>
    </div>
  );
}
