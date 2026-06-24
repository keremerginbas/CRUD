import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import './Landing.css';

const features = [
  { icon: '⚡', title: 'Anlık Yanıtlar', desc: 'GPT-4o ile milisaniyeler içinde akıllı, bağlama duyarlı yanıtlar alın.' },
  { icon: '🔒', title: 'Güvenli & Özel', desc: 'Sohbetleriniz şifrelenir, verileriniz asla üçüncü taraflarla paylaşılmaz.' },
  { icon: '🌐', title: 'Her Konuda', desc: 'Kod, yazı, analiz, çeviri — yapay zeka her konuda yanınızda.' },
  { icon: '💾', title: 'Geçmiş Kaydı', desc: 'Tüm konuşmalarınız saklanır, istediğiniz zaman geri dönebilirsiniz.' },
  { icon: '📱', title: 'Tam Responsive', desc: 'Masaüstü, tablet ve telefonda kusursuz deneyim.' },
  { icon: '🎨', title: 'Özelleştirilebilir', desc: 'Tema, dil ve yanıt stili tercihlerinizi kolayca ayarlayın.' },
];

const stats = [
  { value: '10M+', label: 'Mesaj İşlendi' },
  { value: '99.9%', label: 'Uptime' },
  { value: '<1s', label: 'Ortalama Yanıt' },
  { value: '150+', label: 'Ülkede Kullanıcı' },
];

export default function Landing() {
  return (
    <div className="landing">
      <Navbar />

      {/* Hero */}
      <section className="hero">
        <div className="hero-glow"></div>
        <div className="hero-content">
          <div className="hero-badge">✦ Yapay Zeka Asistanı</div>
          <h1 className="hero-title">
            Geleceğin Zekasıyla<br />
            <span className="gradient-text">Bugün Tanışın</span>
          </h1>
          <p className="hero-desc">
            GPT-4o destekli yapay zeka asistanınız ile sohbet edin, sorularınızı yanıtlayın,
            projelerinizi geliştirin ve sınırları zorlayın.
          </p>
          <div className="hero-actions">
            <Link to="/chat" className="btn-primary">
              <span>AI ile Konuş</span>
              <span className="btn-arrow">→</span>
            </Link>
            <Link to="/admin" className="btn-secondary">Admin Paneli</Link>
          </div>
          <div className="hero-note">
            <span className="dot green"></span>
            Sistem aktif · Ücretsiz dene
          </div>
        </div>

        <div className="hero-visual">
          <div className="chat-preview">
            <div className="preview-header">
              <div className="preview-dots">
                <span></span><span></span><span></span>
              </div>
              <span className="preview-title">NexusAI Chat</span>
            </div>
            <div className="preview-messages">
              <div className="preview-msg user">Merhaba! React ile nasıl proje başlatırım?</div>
              <div className="preview-msg ai">
                <span className="ai-badge">AI</span>
                React projesi başlatmak için <code>npx create-react-app my-app</code> komutunu kullanabilirsin. Sonra <code>cd my-app && npm start</code> ile çalıştır! 🚀
              </div>
              <div className="preview-msg user">Teşekkürler! TypeScript ile de yapabilir miyim?</div>
              <div className="preview-typing">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="stats-section">
        <div className="container">
          <div className="stats-grid">
            {stats.map((s, i) => (
              <div key={i} className="stat-card">
                <div className="stat-value">{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="features-section">
        <div className="container">
          <div className="section-header">
            <div className="section-badge">Özellikler</div>
            <h2>Neden NexusAI?</h2>
            <p>En gelişmiş yapay zeka modeli ile desteklenen platformumuz, ihtiyacınız olan her şeyi sunar.</p>
          </div>
          <div className="features-grid">
            {features.map((f, i) => (
              <div key={i} className="feature-card">
                <div className="feature-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <div className="container">
          <div className="cta-box">
            <div className="cta-glow"></div>
            <h2>Yapay Zeka Gücünü Hemen Dene</h2>
            <p>Kayıt olmaya gerek yok. OpenAI API anahtarınızı girin ve sohbete başlayın.</p>
            <Link to="/chat" className="btn-primary large">
              <span>Şimdi Başla</span>
              <span className="btn-arrow">→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="container">
          <div className="footer-inner">
            <div className="footer-brand">
              <span className="logo-icon">✦</span>
              <span>NexusAI</span>
            </div>
            <p className="footer-copy">© 2026 NexusAI. OpenAI GPT-4o ile güçlendirilmiştir.</p>
            <div className="footer-links">
              <Link to="/chat">Chat</Link>
              <Link to="/admin">Admin</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
