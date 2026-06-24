import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './Admin.css';

const STORAGE_KEY = 'nexusai_conversations';
const API_KEY_STORAGE = 'nexusai_api_key';
const MODEL_KEY = 'nexusai_model';

const ADMIN_PASS = 'admin123';

export default function Admin() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem('admin_auth') === '1');
  const [passInput, setPassInput] = useState('');
  const [passError, setPassError] = useState('');
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!authed) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      setConversations(stored ? JSON.parse(stored) : []);
    } catch { setConversations([]); }
    setApiKey(localStorage.getItem(API_KEY_STORAGE) || '');
    setModel(localStorage.getItem(MODEL_KEY) || 'gpt-4o');
  }, [authed]);

  const login = () => {
    if (passInput === ADMIN_PASS) {
      sessionStorage.setItem('admin_auth', '1');
      setAuthed(true);
    } else {
      setPassError('Hatalı şifre. (Varsayılan: admin123)');
    }
  };

  const logout = () => {
    sessionStorage.removeItem('admin_auth');
    setAuthed(false);
  };

  const saveSettings = () => {
    localStorage.setItem(API_KEY_STORAGE, apiKey);
    localStorage.setItem(MODEL_KEY, model);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const deleteConv = (id) => {
    const updated = conversations.filter(c => c.id !== id);
    setConversations(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    if (selectedConv?.id === id) setSelectedConv(null);
  };

  const clearAll = () => {
    if (!window.confirm('Tüm sohbetler silinsin mi?')) return;
    setConversations([]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    setSelectedConv(null);
  };

  // Stats
  const totalMessages = conversations.reduce((a, c) => a + c.messages.length, 0);
  const userMessages = conversations.reduce((a, c) => a + c.messages.filter(m => m.role === 'user').length, 0);
  const aiMessages = conversations.reduce((a, c) => a + c.messages.filter(m => m.role === 'assistant').length, 0);
  const totalTokens = conversations.reduce((a, c) => a + c.messages.reduce((b, m) => b + (m.tokens || 0), 0), 0);

  const stats = [
    { label: 'Toplam Sohbet', value: conversations.length, icon: '💬', color: '#6c63ff' },
    { label: 'Toplam Mesaj', value: totalMessages, icon: '📩', color: '#22d3a5' },
    { label: 'Kullanıcı Mesajı', value: userMessages, icon: '👤', color: '#60a5fa' },
    { label: 'AI Yanıtı', value: aiMessages, icon: '✦', color: '#a78bfa' },
    { label: 'Toplam Token', value: totalTokens.toLocaleString(), icon: '🔢', color: '#fb923c' },
    { label: 'Ort. Mesaj/Sohbet', value: conversations.length ? Math.round(totalMessages / conversations.length) : 0, icon: '📊', color: '#f472b6' },
  ];

  if (!authed) {
    return (
      <div className="admin-login">
        <div className="login-card">
          <div className="login-logo">
            <span className="login-icon">✦</span>
            <span>NexusAI</span>
          </div>
          <h2>Admin Paneli</h2>
          <p>Devam etmek için şifreyi girin.</p>
          <div className="login-form">
            <input
              type="password"
              className="login-input"
              value={passInput}
              onChange={e => { setPassInput(e.target.value); setPassError(''); }}
              onKeyDown={e => e.key === 'Enter' && login()}
              placeholder="Şifre..."
              autoFocus
            />
            {passError && <p className="login-error">{passError}</p>}
            <button className="login-btn" onClick={login}>Giriş Yap</button>
          </div>
          <Link to="/" className="back-link">← Ana sayfaya dön</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-layout">
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <Link to="/" className="sidebar-logo">
            <span>✦</span> NexusAI
          </Link>
          <span className="admin-badge">Admin</span>
        </div>

        <nav className="admin-nav">
          {[
            { id: 'dashboard', icon: '📊', label: 'Dashboard' },
            { id: 'conversations', icon: '💬', label: 'Sohbetler' },
            { id: 'settings', icon: '⚙', label: 'Ayarlar' },
          ].map(tab => (
            <button
              key={tab.id}
              className={`admin-nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => { setActiveTab(tab.id); setSelectedConv(null); }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <Link to="/chat" className="admin-nav-item">
            <span>💬</span><span>Chat'e Git</span>
          </Link>
          <button className="admin-nav-item logout" onClick={logout}>
            <span>🚪</span><span>Çıkış</span>
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="admin-main">
        {/* Dashboard */}
        {activeTab === 'dashboard' && (
          <div className="admin-content">
            <div className="admin-page-header">
              <h1>Dashboard</h1>
              <p>Genel istatistikler ve kullanım özeti</p>
            </div>
            <div className="stats-grid-admin">
              {stats.map((s, i) => (
                <div key={i} className="stat-card-admin" style={{ '--accent-color': s.color }}>
                  <div className="stat-icon-admin">{s.icon}</div>
                  <div>
                    <div className="stat-val-admin">{s.value}</div>
                    <div className="stat-lbl-admin">{s.label}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="recent-section">
              <h2>Son Sohbetler</h2>
              {conversations.length === 0 ? (
                <div className="empty-admin">
                  <p>Henüz sohbet yok.</p>
                  <Link to="/chat" className="btn-accent">Chat'e Git</Link>
                </div>
              ) : (
                <div className="conv-table">
                  <div className="table-header">
                    <span>Başlık</span>
                    <span>Mesaj</span>
                    <span>Tarih</span>
                    <span>İşlem</span>
                  </div>
                  {conversations.slice(0, 5).map(conv => (
                    <div key={conv.id} className="table-row">
                      <span className="table-title" onClick={() => { setSelectedConv(conv); setActiveTab('conversations'); }}>
                        {conv.title}
                      </span>
                      <span className="table-badge">{conv.messages.length} mesaj</span>
                      <span className="table-date">{new Date(conv.createdAt).toLocaleDateString('tr-TR')}</span>
                      <button className="table-delete" onClick={() => deleteConv(conv.id)}>Sil</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Conversations */}
        {activeTab === 'conversations' && (
          <div className="admin-content">
            {selectedConv ? (
              <>
                <div className="admin-page-header">
                  <div>
                    <button className="back-btn" onClick={() => setSelectedConv(null)}>← Geri</button>
                    <h1>{selectedConv.title}</h1>
                    <p>{selectedConv.messages.length} mesaj · {new Date(selectedConv.createdAt).toLocaleString('tr-TR')}</p>
                  </div>
                  <button className="btn-danger" onClick={() => deleteConv(selectedConv.id)}>Sohbeti Sil</button>
                </div>
                <div className="conv-detail">
                  {selectedConv.messages.map(msg => (
                    <div key={msg.id} className={`admin-msg ${msg.role}`}>
                      <div className="admin-msg-role">{msg.role === 'user' ? '👤 Kullanıcı' : '✦ AI'}</div>
                      <div className="admin-msg-content">{msg.content}</div>
                      <div className="admin-msg-meta">
                        {new Date(msg.ts).toLocaleString('tr-TR')}
                        {msg.tokens && <span> · {msg.tokens} token</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="admin-page-header">
                  <div>
                    <h1>Sohbetler</h1>
                    <p>Toplam {conversations.length} sohbet</p>
                  </div>
                  {conversations.length > 0 && (
                    <button className="btn-danger" onClick={clearAll}>Tümünü Sil</button>
                  )}
                </div>
                {conversations.length === 0 ? (
                  <div className="empty-admin">
                    <p>Henüz sohbet yok.</p>
                    <Link to="/chat" className="btn-accent">Chat'e Git</Link>
                  </div>
                ) : (
                  <div className="conv-table">
                    <div className="table-header">
                      <span>Başlık</span>
                      <span>Mesaj</span>
                      <span>Tarih</span>
                      <span>İşlem</span>
                    </div>
                    {conversations.map(conv => (
                      <div key={conv.id} className="table-row">
                        <span className="table-title" onClick={() => setSelectedConv(conv)}>
                          {conv.title}
                        </span>
                        <span className="table-badge">{conv.messages.length} mesaj</span>
                        <span className="table-date">{new Date(conv.createdAt).toLocaleDateString('tr-TR')}</span>
                        <button className="table-delete" onClick={() => deleteConv(conv.id)}>Sil</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Settings */}
        {activeTab === 'settings' && (
          <div className="admin-content">
            <div className="admin-page-header">
              <h1>Ayarlar</h1>
              <p>API ve model konfigürasyonu</p>
            </div>
            <div className="settings-card">
              <div className="setting-row">
                <div className="setting-info">
                  <label>OpenAI API Anahtarı</label>
                  <p>platform.openai.com'dan alınan gizli anahtar</p>
                </div>
                <input
                  type="password"
                  className="admin-input"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-..."
                />
              </div>
              <div className="setting-row">
                <div className="setting-info">
                  <label>Varsayılan Model</label>
                  <p>Tüm yeni sohbetler için kullanılacak model</p>
                </div>
                <select
                  className="admin-input"
                  value={model}
                  onChange={e => setModel(e.target.value)}
                >
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                </select>
              </div>
              <div className="setting-save">
                <button className="btn-accent" onClick={saveSettings}>
                  {saved ? '✓ Kaydedildi!' : 'Kaydet'}
                </button>
              </div>
            </div>

            <div className="settings-card danger-zone">
              <h3>Tehlikeli Bölge</h3>
              <div className="setting-row">
                <div className="setting-info">
                  <label>Tüm Verileri Sil</label>
                  <p>Tüm sohbet geçmişi kalıcı olarak silinir</p>
                </div>
                <button className="btn-danger" onClick={clearAll}>Tümünü Sil</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
