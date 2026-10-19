/* CMS Hafriyat – site etkileşimleri (bağımlılıksız) */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pEls = $$('[data-parallax]');

  // ---------------------------------------------------------------- header + ilerleme çubuğu
  const header = $('#site-header');
  const toTop = $('#to-top');
  let lastY = 0;
  let ticking = false;
  const onScroll = () => {
    const y = scrollY;
    const max = document.documentElement.scrollHeight - innerHeight;
    document.documentElement.style.setProperty('--p', max > 0 ? (y / max).toFixed(4) : 0);
    header.classList.toggle('is-scrolled', y > 40);
    header.classList.toggle('is-hidden', y > 400 && y > lastY && !document.body.classList.contains('menu-open'));
    toTop.classList.toggle('is-visible', y > 800);
    lastY = y;
    parallax();
    ticking = false;
  };
  addEventListener('scroll', () => { if (!ticking) { requestAnimationFrame(onScroll); ticking = true; } }, { passive: true });
  onScroll();
  toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }));

  // ---------------------------------------------------------------- mobil menü
  const menu = $('#mobile-menu');
  const toggle = $('#menu-toggle');
  const setMenu = (open) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', open);
    document.body.classList.toggle('menu-open', open);
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) $('a', menu).focus();
  };
  toggle.addEventListener('click', () => setMenu(true));
  $('#menu-close').addEventListener('click', () => setMenu(false));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) setMenu(false); });

  // ---------------------------------------------------------------- başlık kelime animasyonu
  $$('[data-reveal="split"]').forEach((el) => {
    const words = el.textContent.trim().split(/\s+/);
    el.setAttribute('aria-label', el.textContent.trim());
    el.innerHTML = words.map((w, i) => `<span class="split-word" aria-hidden="true"><span style="--w:${i}">${w}</span></span>`).join(' ');
  });

  // ---------------------------------------------------------------- kaydırınca belirme
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  $$('[data-reveal]').forEach((el) => io.observe(el));

  // ---------------------------------------------------------------- tembel video (görününce yükle/oynat, çıkınca durdur)
  const loadVideo = (v) => {
    if (v.dataset.loaded) return;
    $$('source[data-src]', v).forEach((s) => { s.src = s.dataset.src; });
    v.dataset.loaded = '1';
    v.load();
  };
  const play = (v) => { if (reduce) return; const p = v.play(); if (p) p.catch(() => {}); };
  const vio = new IntersectionObserver((entries) => {
    entries.forEach(({ target: v, isIntersecting }) => {
      if (v.closest('.hero-slide') && !v.closest('.hero-slide.is-active')) return;
      if (isIntersecting) { loadVideo(v); play(v); } else if (!v.paused) v.pause();
    });
  }, { rootMargin: '200px 0px' });
  $$('video[data-lazy-video], .hero video').forEach((v) => vio.observe(v));

  // ---------------------------------------------------------------- hero slider (çapraz geçiş)
  const hero = $('[data-hero]');
  if (hero) {
    const slides = $$('.hero-slide', hero);
    const copies = $$('.hero-copy', hero);
    const dots = $$('.hero-dot', hero);
    let idx = 0;
    let timer;
    const go = (n) => {
      const prev = slides[idx];
      idx = (n + slides.length) % slides.length;
      slides.forEach((s, i) => s.classList.toggle('is-active', i === idx));
      copies.forEach((c, i) => { c.classList.toggle('is-active', i === idx); c.setAttribute('aria-hidden', i !== idx); });
      dots.forEach((d, i) => {
        d.classList.remove('is-active'); void d.offsetWidth; // animasyonu yeniden başlat
        d.classList.toggle('is-active', i === idx); d.setAttribute('aria-selected', i === idx);
      });
      const v = $('video', slides[idx]);
      if (v) { loadVideo(v); v.currentTime = 0; play(v); }
      setTimeout(() => { const pv = $('video', prev); if (pv && prev !== slides[idx]) pv.pause(); }, 1400);
      clearTimeout(timer);
      if (!reduce) timer = setTimeout(() => go(idx + 1), 7000);
    };
    dots.forEach((d) => d.addEventListener('click', () => go(+d.dataset.go)));
    // ikinci slaytı arka planda önceden yükle
    setTimeout(() => { const v1 = $('video', slides[1]); if (v1) loadVideo(v1); }, 2500);
    if (!reduce) timer = setTimeout(() => go(1), 7000);
    let sx = null;
    hero.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener('touchend', (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 50) go(idx + (dx < 0 ? 1 : -1));
      sx = null;
    });
  }

  // ---------------------------------------------------------------- sayaçlar
  const cio = new IntersectionObserver((entries) => {
    entries.forEach(({ target: el, isIntersecting }) => {
      if (!isIntersecting) return;
      cio.unobserve(el);
      const end = +el.dataset.count;
      if (reduce) { el.textContent = end; return; }
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 1600);
        el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, { threshold: 0.6 });
  $$('[data-count]').forEach((el) => cio.observe(el));

  // ---------------------------------------------------------------- paralaks
  function parallax() {
    if (reduce) return;
    pEls.forEach((el) => {
      const r = el.parentElement.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      const k = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
      el.style.transform = `translate3d(0, ${(k * -60).toFixed(1)}px, 0)`;
    });
  }

  // ---------------------------------------------------------------- filtre (yaptığımız işler)
  $$('[data-filter-group]').forEach((group) => {
    const target = $(`[data-filter-target="${group.dataset.filterGroup}"]`);
    $$('[data-filter]', group).forEach((btn) => btn.addEventListener('click', () => {
      $$('[data-filter]', group).forEach((b) => { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-pressed', b === btn); });
      const f = btn.dataset.filter;
      $$('[data-category]', target).forEach((card) => card.classList.toggle('is-filtered', f !== 'all' && card.dataset.category !== f));
    }));
  });

  // ---------------------------------------------------------------- içindekiler aktif bölüm
  const tocLinks = $$('.toc-link');
  if (tocLinks.length) {
    const map = new Map(tocLinks.map((a) => [a.getAttribute('href').slice(1), a]));
    const tio = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { tocLinks.forEach((a) => a.classList.remove('is-active')); map.get(e.target.id)?.classList.add('is-active'); }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    map.forEach((_, id) => { const h = document.getElementById(id); if (h) tio.observe(h); });
  }

  // ---------------------------------------------------------------- bağlantı kopyala
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = '✓'; setTimeout(() => { b.textContent = '🔗'; }, 1500); } catch (e) { /* yok say */ }
  }));

  // ---------------------------------------------------------------- iletişim formu
  const form = $('#contact-form');
  if (form) {
    const status = $('#form-status');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const data = Object.fromEntries(new FormData(form));
      status.textContent = 'Gönderiliyor…';
      status.className = 'text-sm font-semibold text-ink-600';
      try {
        const r = await fetch(form.action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || 'hata');
        status.textContent = 'Teşekkürler! Mesajınız alındı, en kısa sürede dönüş yapacağız.';
        status.className = 'text-sm font-semibold text-emerald-600';
        form.reset();
      } catch (err) {
        // Sunucu yoksa (statik barındırma) WhatsApp'a yönlendir
        const text = `Merhaba, web sitesinden teklif talebi:\nAd: ${data.name}\nTelefon: ${data.phone}\nHizmet: ${data.service || '-'}\nMesaj: ${data.message}`;
        status.innerHTML = `Form şu an gönderilemedi. <a class="link" target="_blank" rel="noopener" href="https://wa.me/905335003779?text=${encodeURIComponent(text)}">WhatsApp ile gönderin</a>.`;
        status.className = 'text-sm font-semibold text-red-600';
      }
    });
  }
})();
