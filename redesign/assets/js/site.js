// Orphion / Rome — yeni tasarım: menü, header, bölüm geçişleri, molekül ağı, ofis saatleri
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var header = document.querySelector(".site-header");
  var toggle = document.querySelector(".menu-toggle");

  // Mobil menü
  if (toggle) {
    toggle.addEventListener("click", function () {
      var open = header.classList.toggle("menu-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Menüyü kapat" : "Menüyü aç");
    });
    header.querySelectorAll(".nav a").forEach(function (a) {
      a.addEventListener("click", function () {
        header.classList.remove("menu-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // Header: giriş bölümünden çıkınca beyaz zemine geçer
  function onScroll() { header.classList.toggle("is-scrolled", window.scrollY > 40); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Kaydırınca beliren bölümler
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  }

  // Giriş: hareketli molekül ağı (marka rengiyle birkaç vurgulu düğüm)
  var canvas = document.getElementById("network");
  if (canvas && canvas.getContext) {
    var ctx = canvas.getContext("2d");
    var accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#f8914c";
    var nodes = [], w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2), running = true;

    function resize() {
      var r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var count = Math.round(Math.min(90, (w * h) / 14000));
      nodes = [];
      for (var i = 0; i < count; i++) {
        nodes.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
          r: Math.random() * 1.6 + 1, hot: Math.random() < 0.12
        });
      }
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < nodes.length; i++) {
        var a = nodes[i];
        for (var j = i + 1; j < nodes.length; j++) {
          var b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < 17000) {
            ctx.strokeStyle = "rgba(255,255,255," + (0.16 * (1 - d2 / 17000)).toFixed(3) + ")";
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      nodes.forEach(function (n) {
        ctx.beginPath(); ctx.arc(n.x, n.y, n.hot ? n.r + 1.4 : n.r, 0, Math.PI * 2);
        ctx.fillStyle = n.hot ? accent : "rgba(255,255,255,.55)";
        ctx.fill();
      });
    }

    function step() {
      if (!running) return;
      nodes.forEach(function (n) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      });
      draw();
      requestAnimationFrame(step);
    }

    resize();
    window.addEventListener("resize", resize);
    if (reduceMotion) { draw(); }
    else {
      // Giriş görünmüyorsa animasyonu durdur (pil ve işlemci için)
      new IntersectionObserver(function (e) {
        var vis = e[0].isIntersecting;
        if (vis && !running) { running = true; requestAnimationFrame(step); }
        running = vis;
      }).observe(canvas);
      requestAnimationFrame(step);
    }
  }

  // Ofislerin yerel saati
  var clocks = document.querySelectorAll("[data-tz]");
  function tick() {
    clocks.forEach(function (el) {
      try {
        el.textContent = "Yerel saat " + new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: el.dataset.tz }).format(new Date());
      } catch (e) { el.textContent = ""; }
    });
  }
  if (clocks.length) { tick(); setInterval(tick, 30000); }

  document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
