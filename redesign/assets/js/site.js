// Orphion / Rome — yeni tasarım: menü, yapışkan header gölgesi, ofis saatleri
(function () {
  "use strict";

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

  // Sayfa kayınca header altına ince çizgi
  function onScroll() { header.classList.toggle("is-scrolled", window.scrollY > 8); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Ofislerin yerel saati: uluslararası ziyaretçi aramadan önce mesai saatini görsün
  var lang = document.documentElement.lang === "en" ? "en-GB" : "tr-TR";
  var label = document.documentElement.lang === "en" ? "Local time" : "Yerel saat";
  var clocks = document.querySelectorAll("[data-tz]");
  function tick() {
    clocks.forEach(function (el) {
      try {
        var t = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit", timeZone: el.dataset.tz }).format(new Date());
        el.textContent = label + ": " + t;
      } catch (e) { el.textContent = ""; }
    });
  }
  if (clocks.length) { tick(); setInterval(tick, 30000); }

  document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
