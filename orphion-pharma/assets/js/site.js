/* ------------------------------------------------------------------
   Orphion Pharma / Rome Pharma - site.js (v3, bağımlılık yok)
   Menü, dil tercihi, iletişim/başvuru formu, harita onayı, çerez bildirimi
   ------------------------------------------------------------------ */
(function () {
    "use strict";

    var root = document.documentElement;
    var KEY = root.getAttribute("data-storage") || "site";
    var LANG_KEY = KEY + "_lang";
    var CONSENT_KEY = KEY + "_cookie_consent";
    var GA_MEASUREMENT_ID = "";
    var pageLang = root.lang === "en" ? "en" : "tr";

    var i18n = {
        tr: {
            sending: "Gönderiliyor...",
            success: "Teşekkürler! Mesajınız bize ulaştı, en kısa sürede dönüş yapacağız.",
            error: "Mesaj gönderilemedi. Lütfen tekrar deneyin veya bize e-posta gönderin.",
            invalid: "Lütfen zorunlu alanları doldurun ve KVKK onay kutusunu işaretleyin.",
            tooBig: "CV dosyası en fazla 5 MB olabilir."
        },
        en: {
            sending: "Sending...",
            success: "Thank you! Your message has been received. We will get back to you shortly.",
            error: "Your message could not be sent. Please try again or email us.",
            invalid: "Please fill in the required fields and tick the consent box.",
            tooBig: "The CV file can be at most 5 MB."
        }
    };
    var t = i18n[pageLang];

    function storageGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function storageSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* gizli mod */ } }
    function $(sel, ctx) { return (ctx || document).querySelector(sel); }
    function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

    /* Üst bar gölgesi */
    var header = $(".site-header");
    function onScroll() { if (header) header.classList.toggle("scrolled", window.scrollY > 8); }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    /* Mobil menü */
    var toggle = $(".menu-toggle");
    if (toggle) {
        toggle.addEventListener("click", function () {
            var open = document.body.classList.toggle("menu-open");
            toggle.setAttribute("aria-expanded", open ? "true" : "false");
        });
    }

    /* Alt menüler: tıklayınca aç/kapat (masaüstünde üzerine gelince de açılır) */
    $$(".nav-item > .nav-parent").forEach(function (btn) {
        btn.addEventListener("click", function () {
            var item = btn.parentElement;
            var open = !item.classList.contains("open");
            $$(".nav-item.open").forEach(function (o) {
                if (o !== item) { o.classList.remove("open"); o.firstElementChild.setAttribute("aria-expanded", "false"); }
            });
            item.classList.toggle("open", open);
            btn.setAttribute("aria-expanded", open ? "true" : "false");
        });
    });
    document.addEventListener("click", function (e) {
        if (!e.target.closest(".nav-item")) {
            $$(".nav-item.open").forEach(function (o) { o.classList.remove("open"); o.firstElementChild.setAttribute("aria-expanded", "false"); });
        }
    });
    document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        $$(".nav-item.open").forEach(function (o) { o.classList.remove("open"); o.firstElementChild.setAttribute("aria-expanded", "false"); });
        if (document.body.classList.contains("menu-open") && toggle) toggle.click();
    });

    /* Dil tercihini hatırla */
    $$(".lang-switch a").forEach(function (a) {
        a.addEventListener("click", function () { storageSet(LANG_KEY, a.getAttribute("hreflang")); });
    });

    /* Hizmetler sayfası: içindekiler listesinde bulunulan bölümü işaretle */
    var indexLinks = $$(".service-index a");
    if (indexLinks.length && "IntersectionObserver" in window) {
        var byId = {};
        indexLinks.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (en.isIntersecting && byId[en.target.id]) {
                    indexLinks.forEach(function (a) { a.classList.remove("active"); });
                    byId[en.target.id].classList.add("active");
                }
            });
        }, { rootMargin: "-30% 0px -60% 0px" });
        Object.keys(byId).forEach(function (id) { var s = document.getElementById(id); if (s) io.observe(s); });
    }

    /* İletişim ve başvuru formları */
    $$(".js-contact-form").forEach(function (form) {
        var status = $(".form-status", form);
        var button = $("button[type=submit]", form);
        var successText = form.getAttribute("data-success") || t.success;
        var openedAt = Date.now();

        function show(type, text) {
            status.className = "form-status show " + type;
            status.textContent = text;
        }

        var cv = $(".cv-input", form);
        if (cv) {
            cv.addEventListener("change", function () {
                var file = cv.files && cv.files[0];
                var tooBig = file && file.size > 5 * 1024 * 1024;
                cv.setCustomValidity(tooBig ? t.tooBig : "");
                $(".cv-name", form).textContent = file ? file.name : "";
                if (tooBig) show("error", t.tooBig);
            });
        }

        form.addEventListener("submit", function (ev) {
            if (!window.fetch || !window.FormData) return; // eski tarayıcı: normal gönderim
            ev.preventDefault();
            if (!form.checkValidity()) {
                show("error", t.invalid);
                if (form.reportValidity) form.reportValidity();
                return;
            }
            // Bot koruması: formun açık kaldığı süre (saniye)
            form.querySelector("input[name=ts]").value = Math.floor((Date.now() - openedAt) / 1000);
            var label = button.innerHTML;
            button.disabled = true;
            button.textContent = t.sending;
            fetch(form.getAttribute("action"), {
                method: "POST",
                body: new FormData(form),
                headers: { "Accept": "application/json" }
            }).then(function (res) {
                return res.json().catch(function () { return { ok: false }; });
            }).then(function (data) {
                if (data && data.ok) {
                    show("success", successText);
                    form.reset();
                    if (cv) $(".cv-name", form).textContent = "";
                    openedAt = Date.now();
                } else {
                    show("error", (data && data.message) || t.error);
                }
            }).catch(function () {
                show("error", t.error);
            }).then(function () {
                button.disabled = false;
                button.innerHTML = label;
            });
        });

        // JavaScript'siz gönderimden dönüş (?sent=1 / ?sent=0)
        var m = /[?&]sent=([01])/.exec(window.location.search);
        if (m) show(m[1] === "1" ? "success" : "error", m[1] === "1" ? successText : t.error);
    });

    /* Harita: yalnızca ziyaretçi isteyince Google Haritalar'ı yükle */
    $$(".js-load-map").forEach(function (btn) {
        btn.addEventListener("click", function () {
            var box = btn.closest(".map-consent");
            var iframe = document.createElement("iframe");
            iframe.src = box.getAttribute("data-map-src");
            iframe.title = box.getAttribute("data-map-title");
            iframe.loading = "lazy";
            iframe.referrerPolicy = "no-referrer-when-downgrade";
            iframe.allowFullscreen = true;
            box.innerHTML = "";
            box.classList.add("loaded");
            box.appendChild(iframe);
        });
    });

    /* Çerez bildirimi + (izin verilirse) Analytics */
    function loadAnalytics() {
        if (!GA_MEASUREMENT_ID || window.gtag) return;
        var s = document.createElement("script");
        s.async = true;
        s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_MEASUREMENT_ID);
        document.head.appendChild(s);
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { window.dataLayer.push(arguments); };
        window.gtag("js", new Date());
        window.gtag("config", GA_MEASUREMENT_ID, { anonymize_ip: true });
    }
    var banner = $(".cookie-banner");
    if (banner) {
        var consent = storageGet(CONSENT_KEY);
        if (consent === "accepted") loadAnalytics();
        else if (!consent) banner.classList.add("show");
        $(".accept", banner).addEventListener("click", function () {
            storageSet(CONSENT_KEY, "accepted"); banner.classList.remove("show"); loadAnalytics();
        });
        $(".reject", banner).addEventListener("click", function () {
            storageSet(CONSENT_KEY, "rejected"); banner.classList.remove("show");
        });
        $$(".js-cookie-settings").forEach(function (b) {
            b.addEventListener("click", function (e) { e.preventDefault(); banner.classList.add("show"); });
        });
    }

    /* Telif yılı */
    $$("[data-current-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
