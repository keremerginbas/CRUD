import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import './Chat.css';

const STORAGE_KEY = 'nexusai_conversations';
const API_KEY_STORAGE = 'nexusai_api_key';
const MODEL_KEY = 'nexusai_model';

const MODELS = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
];

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function createConversation() {
  return { id: generateId(), title: 'Yeni Sohbet', messages: [], createdAt: Date.now() };
}

export default function Chat() {
  const [conversations, setConversations] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      return parsed.length ? parsed : [createConversation()];
    } catch {
      return [createConversation()];
    }
  });

  const [activeId, setActiveId] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return parsed.length ? parsed[0].id : conversations[0]?.id;
  });

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) || '');
  const [model, setModel] = useState(() => localStorage.getItem(MODEL_KEY) || 'gpt-4o');
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [error, setError] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState(() => localStorage.getItem(API_KEY_STORAGE) || '');

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const activeConv = conversations.find(c => c.id === activeId);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConv?.messages, loading]);

  const updateConversation = useCallback((id, updater) => {
    setConversations(prev => prev.map(c => c.id === id ? updater(c) : c));
  }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    if (!apiKey) { setError('Lütfen önce API anahtarınızı ayarlara girin.'); setShowSettings(true); return; }

    setError('');
    const userMsg = { id: generateId(), role: 'user', content: text, ts: Date.now() };

    updateConversation(activeId, conv => ({
      ...conv,
      title: conv.messages.length === 0 ? text.slice(0, 40) : conv.title,
      messages: [...conv.messages, userMsg],
    }));

    setInput('');
    setLoading(true);
    textareaRef.current?.focus();

    try {
      const currentMessages = [...(activeConv?.messages || []), userMsg];
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: currentMessages.map(m => ({ role: m.role, content: m.content })),
          temperature: 0.7,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `API Hatası: ${res.status}`);
      }

      const data = await res.json();
      const aiMsg = {
        id: generateId(),
        role: 'assistant',
        content: data.choices[0].message.content,
        ts: Date.now(),
        tokens: data.usage?.total_tokens,
      };

      updateConversation(activeId, conv => ({ ...conv, messages: [...conv.messages, aiMsg] }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const newConversation = () => {
    const conv = createConversation();
    setConversations(prev => [conv, ...prev]);
    setActiveId(conv.id);
    setShowSidebar(false);
  };

  const deleteConversation = (id, e) => {
    e.stopPropagation();
    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== id);
      if (filtered.length === 0) {
        const fresh = createConversation();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(filtered[0].id);
      return filtered;
    });
  };

  const saveSettings = () => {
    localStorage.setItem(API_KEY_STORAGE, apiKeyInput);
    localStorage.setItem(MODEL_KEY, model);
    setApiKey(apiKeyInput);
    setShowSettings(false);
  };

  const formatTime = (ts) => new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  const renderContent = (text) => {
    // Simple code block rendering
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith('```')) {
        const lines = part.split('\n');
        const lang = lines[0].replace('```', '').trim();
        const code = lines.slice(1, -1).join('\n');
        return (
          <div key={i} className="code-block">
            {lang && <div className="code-lang">{lang}</div>}
            <pre><code>{code}</code></pre>
          </div>
        );
      }
      return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>;
    });
  };

  return (
    <div className="chat-layout">
      {/* Sidebar */}
      <aside className={`chat-sidebar ${showSidebar ? 'open' : ''}`}>
        <div className="sidebar-header">
          <Link to="/" className="sidebar-logo">
            <span>✦</span> NexusAI
          </Link>
          <button className="new-chat-btn" onClick={newConversation}>+ Yeni</button>
        </div>

        <div className="sidebar-nav">
          <p className="sidebar-label">Sohbetler</p>
          <div className="conv-list">
            {conversations.map(conv => (
              <div
                key={conv.id}
                className={`conv-item ${conv.id === activeId ? 'active' : ''}`}
                onClick={() => { setActiveId(conv.id); setShowSidebar(false); }}
              >
                <span className="conv-icon">💬</span>
                <span className="conv-title">{conv.title}</span>
                <button className="conv-delete" onClick={(e) => deleteConversation(conv.id, e)}>×</button>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-footer">
          <button className="settings-btn" onClick={() => { setShowSettings(true); setShowSidebar(false); }}>
            ⚙ Ayarlar
          </button>
          <Link to="/admin" className="admin-link-btn">📊 Admin</Link>
        </div>
      </aside>

      {/* Overlay */}
      {showSidebar && <div className="sidebar-overlay" onClick={() => setShowSidebar(false)} />}

      {/* Main */}
      <main className="chat-main">
        {/* Top Bar */}
        <div className="chat-topbar">
          <button className="menu-btn" onClick={() => setShowSidebar(!showSidebar)}>☰</button>
          <div className="topbar-center">
            <span className="topbar-model">{MODELS.find(m => m.id === model)?.label || model}</span>
          </div>
          <button className="topbar-settings" onClick={() => setShowSettings(true)}>⚙</button>
        </div>

        {/* Messages */}
        <div className="messages-area">
          {(!activeConv?.messages || activeConv.messages.length === 0) ? (
            <div className="empty-state">
              <div className="empty-icon">✦</div>
              <h2>NexusAI'ya Hoş Geldiniz</h2>
              <p>GPT-4o ile sohbet etmeye başlayın. Kod yazma, analiz, çeviri ve daha fazlası.</p>
              <div className="empty-suggestions">
                {['React projesinde nasıl başlarım?', 'Bir Python scripti yaz', 'Türk tarihi hakkında bilgi ver'].map(s => (
                  <button key={s} className="suggestion-btn" onClick={() => setInput(s)}>{s}</button>
                ))}
              </div>
            </div>
          ) : (
            activeConv.messages.map(msg => (
              <div key={msg.id} className={`message-row ${msg.role}`}>
                <div className={`message-avatar ${msg.role}`}>
                  {msg.role === 'user' ? '👤' : '✦'}
                </div>
                <div className="message-content">
                  <div className={`message-bubble ${msg.role}`}>
                    {renderContent(msg.content)}
                  </div>
                  <div className="message-meta">
                    {formatTime(msg.ts)}
                    {msg.tokens && <span className="token-count">{msg.tokens} token</span>}
                  </div>
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="message-row assistant">
              <div className="message-avatar assistant">✦</div>
              <div className="message-content">
                <div className="message-bubble assistant typing-bubble">
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="error-banner">
              <span>⚠ {error}</span>
              <button onClick={() => setError('')}>×</button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="chat-input-area">
          <div className="input-wrapper">
            <textarea
              ref={textareaRef}
              className="chat-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Mesajınızı yazın... (Enter ile gönder, Shift+Enter yeni satır)"
              rows={1}
              style={{ height: 'auto' }}
              onInput={e => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
              }}
              disabled={loading}
            />
            <button
              className={`send-btn ${loading ? 'loading' : ''}`}
              onClick={sendMessage}
              disabled={loading || !input.trim()}
            >
              {loading ? '⏳' : '↑'}
            </button>
          </div>
          <p className="input-hint">NexusAI hata yapabilir. Önemli bilgileri doğrulayın.</p>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowSettings(false)}>
          <div className="modal">
            <div className="modal-header">
              <h3>⚙ Ayarlar</h3>
              <button onClick={() => setShowSettings(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="setting-group">
                <label>OpenAI API Anahtarı</label>
                <input
                  type="password"
                  className="setting-input"
                  value={apiKeyInput}
                  onChange={e => setApiKeyInput(e.target.value)}
                  placeholder="sk-..."
                />
                <p className="setting-hint">
                  API anahtarınızı <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com</a>'dan alabilirsiniz.
                </p>
              </div>
              <div className="setting-group">
                <label>Model</label>
                <select
                  className="setting-input"
                  value={model}
                  onChange={e => setModel(e.target.value)}
                >
                  {MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setShowSettings(false)}>İptal</button>
              <button className="btn-save" onClick={saveSettings}>Kaydet</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
