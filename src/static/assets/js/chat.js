/* CMS Hafriyat – yapay zeka sohbet asistanı (istemci)
 * Sunucu: /api/chat.php (OpenAI anahtarı yalnızca sunucuda tutulur).
 * Anahtar yoksa / sunucuya ulaşılamazsa yerel bilgi tabanıyla yanıt verir. */
(() => {
  'use strict';
  const root = document.getElementById('chatbot');
  if (!root) return;
  const panel = document.getElementById('chat-panel');
  const log = document.getElementById('chat-log');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const quick = document.getElementById('chat-quick');
  const toggleBtn = document.getElementById('chat-toggle');
  const KEY = 'cms-chat-v1';
  const BASE = document.documentElement.dataset.base || '';
  const WA = 'https://wa.me/905335003779';
  const QUICK = ['Hangi hizmetleri veriyorsunuz?', 'Teklif almak istiyorum', 'Hafriyat süreci nasıl işler?', 'İletişim bilgileri'];
  const GREETING = 'Merhaba! 👋 Ben CMS Hafriyat\'ın yapay zeka asistanıyım. hafriyat, temel kazı, altyapı, yol kazı, dolgu, iş makineleri, inşaat ve nakliye hizmetlerimiz hakkında sorularınızı yanıtlayabilirim. Size nasıl yardımcı olabilirim?';

  let history = [];
  try { history = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) { history = []; }
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(history.slice(-20))); } catch (e) { /* yok say */ } };

  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const format = (s) => escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)(\/[a-z0-9\-/]+\/)(?=[\s.,!?]|$)/g, (m, s, p) => `${s}<a href="${BASE}${p}">${p}</a>`);

  const add = (role, text) => {
    const div = document.createElement('div');
    div.className = role === 'user' ? 'chat-msg chat-msg--user' : 'chat-msg chat-msg--bot';
    div.innerHTML = format(text);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  };

  const renderQuick = () => {
    quick.innerHTML = '';
    QUICK.forEach((q) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = q;
      b.addEventListener('click', () => send(q));
      quick.appendChild(b);
    });
  };

  const open = () => {
    panel.hidden = false;
    root.dataset.state = 'open';
    toggleBtn.setAttribute('aria-expanded', 'true');
    if (!log.children.length) {
      add('bot', GREETING);
      history.forEach((m) => add(m.role, m.content));
      renderQuick();
    }
    setTimeout(() => input.focus(), 200);
  };
  const close = () => {
    root.dataset.state = 'closed';
    toggleBtn.setAttribute('aria-expanded', 'false');
    panel.hidden = true;
    toggleBtn.focus();
  };
  toggleBtn.addEventListener('click', open);
  document.getElementById('chat-close').addEventListener('click', close);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.dataset.state === 'open') close(); });
  document.querySelectorAll('[data-open-chat]').forEach((b) => b.addEventListener('click', open));

  // ---------------------------------------------------------------- yerel yedek bilgi tabanı
  const KB = [
    [/fiyat|ücret|teklif|maliyet|kaç para|ne kadar/, 'Fiyatlar sahanın konumu, iş hacmi, zemin yapısı ve süreye göre değişir. En doğru teklif için ücretsiz keşif planlıyoruz. 📞 0533 500 37 79 numarasını arayabilir, WhatsApp\'tan yazabilir ya da /iletisim/ sayfasındaki formu doldurabilirsiniz.'],
    [/hafriyat|kazı|temel|bodrum|toprak/, 'Hafriyat hizmetimiz temel ve bodrum kazısı, saha düzenleme, toprak yükleme ve döküm sahasına nakliyeyi kapsar. Süreç keşif → planlama ve izinler → kazı ve yükleme → nakliye ve teslim adımlarıyla ilerler. Detaylar: /hizmetler/hafriyat/'],
    [/makine|ekskavatör|kepçe|loder|dozer|silindir|beko/, 'Projenin ihtiyacına göre ekskavatör, kazıcı yükleyici, loder, dozer ve silindir gibi iş makineleriyle operasyon planlıyoruz. Detaylar: /hizmetler/is-makineleri/ · Makine seçimi rehberi: /blog/is-makinesi-secimi-rehberi/'],
    [/inşaat|taahhüt|müteahhit|yapı|bina/, 'İnşaat ve taahhüt işlerinde planlama, iş disiplini ve kalite odaklı uygulama ile projelerinize değer katıyoruz. Detaylar: /hizmetler/insaat-taahhut/'],
    [/nakliye|taşıma|kamyon|damper|lojistik/, 'Hafriyat toprağı ve inşaat malzemeleri için planlı, güvenli ve zamanında nakliye hizmeti sunuyoruz. Detaylar: /hizmetler/nakliye/'],
    [/temel/, 'Temel kazı işlerinde zemin etüdü ve projeye uygun kot, şev ve iksa güvenliğiyle kontrollü kazı yapıyoruz. Detaylar: /hizmetler/temel-kazi-isleri/'],
    [/altyapı|altyapi|kanal|boru|kanalizasyon|içme suyu|yağmur suyu/, 'Altyapı işlerinde kanal (hendek) kazısı, boru yatağı hazırlığı ve geri dolgu yapıyoruz. Detaylar: /hizmetler/altyapi-isleri/'],
    [/yol|stabilize|tesviye|greyder/, 'Yol kazı işlerinde yol yatağı kazısı, tesviye, stabilize serimi ve sıkıştırma yapıyoruz. Detaylar: /hizmetler/yol-kazi-isleri/'],
    [/dolgu|sıkıştırma|silindir|düzleme/, 'Dolgu işlerinde uygun malzemeyi katmanlar halinde serip silindirle sıkıştırıyoruz. Detaylar: /hizmetler/dolgu-isleri/'],
    [/izin|ruhsat|belediye/, 'Hafriyat izin ve ruhsat süreçleri belediyeye ve projeye göre değişir. Genel bilgi için rehberimizi inceleyebilirsiniz: /blog/hafriyat-ruhsati-ve-izin-sureci/ — süreçte size yol gösterebiliriz.'],
    [/iletişim|telefon|numara|mail|e-posta|adres|ulaş/, 'Bize şu kanallardan ulaşabilirsiniz:\n📞 0533 500 37 79\n💬 WhatsApp: ' + WA + '\n✉️ cmshafriyat01@gmail.com\n📍 Toros Mah. 78090 Sk. Özcan Apt. Sit. No: 10 A, Çukurova/Adana\nveya /iletisim/ sayfasındaki formu kullanabilirsiniz.'],
    [/hizmet|ne yapıyorsunuz|neler|faaliyet/, 'CMS Hafriyat olarak 8 alanda hizmet veriyoruz:\n• Hafriyat\n• Temel kazı işleri\n• Altyapı işleri\n• Yol kazı işleri\n• Dolgu işleri\n• İş makineleri\n• İnşaat & taahhüt\n• Nakliye\nTümü: /hizmetler/'],
    [/hakkında|kimsiniz|firma|şirket/, 'CMS Hafriyat Nakliyat İnşaat Taahhüt Ticaret Ltd. Şti.; kaliteyi ve güvenilirliği temel değer olarak benimseyen, hafriyat, altyapı, yol, dolgu, inşaat ve nakliye alanlarında faaliyet gösteren bir firmadır. "Güvenle Başlar, Değerle Büyür." Daha fazlası: /hakkimizda/'],
    [/merhaba|selam|iyi günler|günaydın/, 'Merhaba! Size nasıl yardımcı olabilirim? Hizmetlerimiz, süreçlerimiz veya teklif hakkında soru sorabilirsiniz.'],
    [/teşekkür|sağ ol|eyvallah/, 'Rica ederim! Başka bir sorunuz olursa buradayım. Kesin teklif için WhatsApp üzerinden de yazabilirsiniz: ' + WA],
  ];
  const fallback = (q) => {
    const t = q.toLocaleLowerCase('tr');
    const hit = KB.find(([re]) => re.test(t));
    return hit ? hit[1] : 'Bu konuda size en doğru bilgiyi ekibimiz verebilir. 📞 0533 500 37 79 numarasından arayabilir veya WhatsApp\'tan yazabilirsiniz: ' + WA;
  };

  // ---------------------------------------------------------------- gönderim
  let busy = false;
  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    busy = true;
    quick.innerHTML = '';
    add('user', text);
    history.push({ role: 'user', content: text });
    const typing = add('bot', '');
    typing.innerHTML = '<span class="chat-typing"><span></span><span></span><span></span></span>';
    let reply;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(BASE + '/api/chat.php', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-10), page: location.pathname }), signal: ctrl.signal,
      });
      clearTimeout(to);
      const j = await r.json();
      if (!r.ok || !j.reply) throw new Error(j.error || 'yanıt yok');
      reply = j.reply;
    } catch (e) {
      await new Promise((res) => setTimeout(res, 500));
      reply = fallback(text);
    }
    typing.remove();
    add('bot', reply);
    history.push({ role: 'assistant', content: reply });
    save();
    busy = false;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = '';
    send(v);
  });
})();
