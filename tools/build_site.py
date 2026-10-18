#!/usr/bin/env python3
"""
Orphion Pharma statik site üreticisi.

Tüm sayfalar (TR + EN) ortak header / footer / form bileşenlerinden
üretilir; böylece menü linkleri, iletişim bilgileri ve dil eşleşmeleri
her sayfada aynı kalır.

Kullanım:
    python3 tools/build_site.py

Çıktı: orphion-pharma/*.html, sitemap.xml, robots.txt
İçerik değişikliği için bu dosyadaki metinleri düzenleyip betiği
tekrar çalıştırın; HTML dosyalarını elle düzenlemeyin.
"""

import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "orphion-pharma"

SITE_URL = "https://orphionpharma.com/"
LAST_UPDATED = "2026-10-18"

COMPANY = {
    "name": "Orphion Pharma",
    "group": "Orphion Group",
    "email": "info@orphionpharma.com",
    "phone_display": "+90 (532) 569 11 11",
    "phone_tel": "+905325691111",
    "whatsapp": "https://wa.me/905325691111",
    "address": "Meydan Grandstand, 6th floor, Meydan Road, Nad Al Sheba, Dubai, U.A.E",
    "maps_link": "https://www.google.com/maps/search/?api=1&query=Meydan+Grandstand+Meydan+Road+Nad+Al+Sheba+Dubai",
    "maps_embed": "https://maps.google.com/maps?q=Meydan%20Grandstand%2C%20Meydan%20Road%2C%20Nad%20Al%20Sheba%2C%20Dubai&z=15&output=embed",
}

# Sayfa anahtarı -> dil -> dosya adı
PAGES = {
    "home": {"tr": "index.html", "en": "index-en.html"},
    "about": {"tr": "about.html", "en": "about-en.html"},
    "contact": {"tr": "contact.html", "en": "contact-en.html"},
    "privacy": {"tr": "kvkk.html", "en": "privacy-en.html"},
}

T = {
    "tr": {
        "locale": "tr_TR",
        "home": "Ana Sayfa",
        "about": "Hakkımızda",
        "contact": "İletişim",
        "contact_us": "Bize Ulaşın",
        "quote": "Teklif Alın",
        "hours": "Pzt - Cum, 09.00 - 18.00",
        "tagline": "Türkiye’nin ilaç kapısını dünyaya açıyoruz.",
        "rights": "Tüm hakları saklıdır.",
        "privacy_link": "KVKK Aydınlatma Metni",
        "cookie_settings": "Çerez Ayarları",
        "menu_open": "Menüyü aç",
        "menu_close": "Menüyü kapat",
        "back_top": "Sayfanın başına dön",
        "lang_label": "Dil seçimi",
        "logo_alt": "Orphion Pharma logosu",
        "address": "Adres",
        "email": "E-posta",
        "phone": "Telefon",
        "working_hours": "Çalışma Saatleri",
        "whatsapp": "WhatsApp ile yazın",
        "cookie_text": (
            "Bu sitede yalnızca dil ve çerez tercihinizi hatırlamak için tarayıcınızda zorunlu "
            "kayıtlar tutulur. İzin verirseniz ziyaret istatistikleri için analitik çerezler de "
            "kullanılır. Ayrıntılar için <a href=\"kvkk.html#cerezler\">KVKK ve Çerez Politikası</a>."
        ),
        "cookie_accept": "Kabul et",
        "cookie_reject": "Yalnızca zorunlu",
        "suggest_text": "This website is also available in English.",
        "suggest_btn": "English",
        "suggest_close": "Kapat",
    },
    "en": {
        "locale": "en_US",
        "home": "Home",
        "about": "About Us",
        "contact": "Contact",
        "contact_us": "Contact Us",
        "quote": "Get a Quote",
        "hours": "Mon - Fri, 09:00 - 18:00",
        "tagline": "We open Türkiye’s pharmaceutical doors to the world.",
        "rights": "All rights reserved.",
        "privacy_link": "Privacy Notice",
        "cookie_settings": "Cookie Settings",
        "menu_open": "Open menu",
        "menu_close": "Close menu",
        "back_top": "Back to top",
        "lang_label": "Language",
        "logo_alt": "Orphion Pharma logo",
        "address": "Address",
        "email": "Email",
        "phone": "Phone",
        "working_hours": "Working Hours",
        "whatsapp": "Chat on WhatsApp",
        "cookie_text": (
            "This site only stores your language and cookie preferences in your browser. "
            "With your permission we also use analytics cookies to measure visits. "
            "See our <a href=\"privacy-en.html#cookies\">Privacy &amp; Cookie Policy</a>."
        ),
        "cookie_accept": "Accept",
        "cookie_reject": "Essential only",
    },
}


def esc(s):
    return html.escape(s, quote=True)


def url_of(page, lang):
    name = PAGES[page][lang]
    return SITE_URL if name == "index.html" else SITE_URL + name


# ---------------------------------------------------------------------------
# Ortak bileşenler
# ---------------------------------------------------------------------------

def head(page, lang, title, description, extra=""):
    other = "en" if lang == "tr" else "tr"
    og_image = SITE_URL + "assets/images/og-image.jpg"
    return f"""<!DOCTYPE html>
<html lang="{lang}">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="author" content="{COMPANY['name']}">
    <meta name="description" content="{esc(description)}">
    <meta name="robots" content="index, follow">
    <meta name="theme-color" content="#da9502">
    <!-- Google Search Console doğrulaması: Search Console'un verdiği kodu aşağıya ekleyin
         (veya alan adını DNS TXT kaydıyla doğrulayın).
    <meta name="google-site-verification" content="BURAYA_KOD">
    -->
    <title>{esc(title)}</title>
    <link rel="canonical" href="{url_of(page, lang)}">
    <link rel="alternate" hreflang="{lang}" href="{url_of(page, lang)}">
    <link rel="alternate" hreflang="{other}" href="{url_of(page, other)}">
    <link rel="alternate" hreflang="x-default" href="{url_of(page, 'en')}">
    <!-- Open Graph / sosyal medya önizlemesi -->
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="{COMPANY['name']}">
    <meta property="og:title" content="{esc(title)}">
    <meta property="og:description" content="{esc(description)}">
    <meta property="og:url" content="{url_of(page, lang)}">
    <meta property="og:image" content="{og_image}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="{T[lang]['logo_alt']}">
    <meta property="og:locale" content="{T[lang]['locale']}">
    <meta property="og:locale:alternate" content="{T[other]['locale']}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="{esc(title)}">
    <meta name="twitter:description" content="{esc(description)}">
    <meta name="twitter:image" content="{og_image}">
    <!-- Favicon -->
    <link rel="icon" type="image/png" sizes="32x32" href="assets/images/favicon-32.png">
    <link rel="icon" type="image/png" sizes="192x192" href="assets/images/fav-icon.png">
    <link rel="apple-touch-icon" href="assets/images/apple-touch-icon.png">
    <!-- Stiller -->
    <link rel="preload" href="assets/fonts/roboto-latin.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="stylesheet" href="assets/css/bootstrap.min.css">
    <link rel="stylesheet" href="assets/css/animate.css">
    <link rel="stylesheet" href="assets/css/meanmenu.css">
    <link rel="stylesheet" href="assets/css/main.css">
    <link rel="stylesheet" href="assets/css/custom.css">{extra}
</head>
"""


def preloader():
    letters = "".join(
        f"""
                <span data-text-preloader="{c}" class="letters-loading">{c}</span>"""
        for c in "ORPHION"
    )
    return f"""
    <!-- Preloader -->
    <div id="preloader" class="preloader" aria-hidden="true">
        <div class="animation-preloader">
            <div class="spinner"></div>
            <div class="txt-loading">{letters}
            </div>
            <p class="text-center">PHARMA</p>
        </div>
        <div class="loader">
            <div class="row">
                <div class="col-3 loader-section section-left"><div class="bg"></div></div>
                <div class="col-3 loader-section section-left"><div class="bg"></div></div>
                <div class="col-3 loader-section section-right"><div class="bg"></div></div>
                <div class="col-3 loader-section section-right"><div class="bg"></div></div>
            </div>
        </div>
    </div>
"""


def lang_switch(page, lang):
    t = T[lang]
    links = []
    for code in ("tr", "en"):
        active = code == lang
        attrs = ' class="active" aria-current="true"' if active else ""
        label = "Türkçe" if code == "tr" else "English"
        links.append(
            f'<a href="{PAGES[page][code]}" hreflang="{code}" lang="{code}" '
            f'title="{label}"{attrs}>{code.upper()}</a>'
        )
    return f'<nav class="lang-switch" aria-label="{t["lang_label"]}">{"".join(links)}</nav>'


def contact_list_offcanvas(lang):
    t = T[lang]
    c = COMPANY
    return f"""
                        <ul>
                            <li class="d-flex align-items-center">
                                <div class="offcanvas__contact-icon">
                                    <i class="fa-solid fa-location-dot" aria-hidden="true"></i>
                                </div>
                                <div class="offcanvas__contact-text">
                                    <a target="_blank" rel="noopener" href="{c['maps_link']}">{c['address']}</a>
                                </div>
                            </li>
                            <li class="d-flex align-items-center">
                                <div class="offcanvas__contact-icon mr-15">
                                    <i class="fa-solid fa-envelope" aria-hidden="true"></i>
                                </div>
                                <div class="offcanvas__contact-text">
                                    <a href="mailto:{c['email']}">{c['email']}</a>
                                </div>
                            </li>
                            <li class="d-flex align-items-center">
                                <div class="offcanvas__contact-icon mr-15">
                                    <i class="fa-solid fa-clock" aria-hidden="true"></i>
                                </div>
                                <div class="offcanvas__contact-text">
                                    <span>{t['hours']}</span>
                                </div>
                            </li>
                            <li class="d-flex align-items-center">
                                <div class="offcanvas__contact-icon mr-15">
                                    <i class="fa-solid fa-phone" aria-hidden="true"></i>
                                </div>
                                <div class="offcanvas__contact-text">
                                    <a href="tel:{c['phone_tel']}">{c['phone_display']}</a>
                                </div>
                            </li>
                        </ul>"""


def header(page, lang):
    t = T[lang]
    c = COMPANY
    home = PAGES["home"][lang]

    def item(key):
        current = ' aria-current="page"' if key == page else ""
        return f"""
                                            <li>
                                                <a href="{PAGES[key][lang]}"{current}>{t[key]}</a>
                                            </li>"""

    menu = "".join(item(k) for k in ("home", "about", "contact"))
    return f"""
    <!-- Mouse Cursor -->
    <div class="mouse-cursor cursor-outer"></div>
    <div class="mouse-cursor cursor-inner"></div>

    <!-- Back To Top -->
    <button id="back-top" class="back-to-top" aria-label="{t['back_top']}">
        <i class="fa-solid fa-chevron-up" aria-hidden="true"></i>
    </button>

    <!-- Offcanvas Area -->
    <div class="fix-area">
        <div class="offcanvas__info">
            <div class="offcanvas__wrapper">
                <div class="offcanvas__content">
                    <div class="offcanvas__top mb-5 d-flex justify-content-between align-items-center">
                        <div class="offcanvas__logo">
                            <a href="{home}">
                                <img src="assets/images/orphion-logo.webp" width="200" height="87" alt="{t['logo_alt']}">
                            </a>
                        </div>
                        <div class="offcanvas__close">
                            <button aria-label="{t['menu_close']}">
                                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>
                    {lang_switch(page, lang)}
                    <div class="mobile-menu fix mb-3"></div>
                    <div class="offcanvas__contact">
                        <h4>{t['contact']}</h4>{contact_list_offcanvas(lang)}
                        <div class="header-button mt-4">
                            <a href="{PAGES['contact'][lang]}#contact-form" class="theme-btn text-center">
                                <span>{t['quote']} <i class="fa-solid fa-arrow-right-long" aria-hidden="true"></i></span>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <div class="offcanvas__overlay"></div>

    <!-- Header -->
    <header class="header-section-3">
        <div id="header-sticky" class="header-3">
            <div class="container">
                <div class="mega-menu-wrapper">
                    <div class="header-main">
                        <div class="header-left">
                            <div class="logo">
                                <a href="{home}" class="header-logo">
                                    <img src="assets/images/orphion-logo.webp" width="289" height="125" alt="{t['logo_alt']}">
                                </a>
                            </div>
                        </div>
                        <div class="header-middle">
                            <div class="mean__menu-wrapper">
                                <div class="main-menu">
                                    <nav id="mobile-menu">
                                        <ul>{menu}
                                        </ul>
                                    </nav>
                                </div>
                            </div>
                        </div>
                        <div class="header-right d-flex justify-content-end align-items-center">
                            {lang_switch(page, lang)}
                            <div class="header-phone d-none d-lg-flex align-items-center">
                                <div class="img">
                                    <img src="assets/images/icon/icon-phone.svg" width="24" height="24" alt="" aria-hidden="true">
                                </div>
                                <a href="tel:{c['phone_tel']}">{c['phone_display']}</a>
                            </div>
                            <div class="d-none d-lg-block ms-3">
                                <a class="whatsapp-button" href="{c['whatsapp']}" target="_blank" rel="noopener" aria-label="{t['whatsapp']}">
                                    <i class="fa-brands fa-whatsapp" aria-hidden="true"></i> WhatsApp
                                </a>
                            </div>
                            <div class="header__hamburger d-block d-xl-none my-auto">
                                <div class="sidebar__toggle" role="button" tabindex="0" aria-label="{t['menu_open']}">
                                    <i class="fa-solid fa-bars" aria-hidden="true"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </header>
"""


def lang_suggest(page, lang):
    if lang != "tr":
        return ""
    t = T["tr"]
    return f"""
    <div class="lang-suggest" lang="en" role="region" aria-label="Language suggestion">
        <span>{t['suggest_text']}</span>
        <a href="{PAGES[page]['en']}" hreflang="en">{t['suggest_btn']}</a>
        <button type="button" aria-label="{t['suggest_close']}">&times;</button>
    </div>
"""


def breadcrumb(lang, title):
    t = T[lang]
    return f"""
    <!-- Breadcrumb -->
    <section class="breadcrumb-section">
        <div class="breadcrumb-bg" data-bg-src="assets/images/bg/breadcrumb-bg.webp">
            <div class="breadcrumb-text text-center">
                <h1 class="breadcrumb-title text-uppercase">{title}</h1>
                <ul class="list-unstyled">
                    <li class="text-uppercase"><a href="{PAGES['home'][lang]}">{t['home']} / </a></li>
                    <li class="text-uppercase">{title}</li>
                </ul>
            </div>
        </div>
    </section>
"""


def marquee(lang, rows=2, extra_class=""):
    words = (
        ["Uluslararası Ağ", "Etik İş Yaklaşımı", "Sürekli İyileştirme"]
        if lang == "tr"
        else ["International Network", "Ethical Business Approach", "Continuous Improvement"]
    )
    seq = ""
    for _ in range(2):
        for w_i, w in enumerate(words):
            seq += f"""
                    <div class="cmn-textslide style{w_i + 1}">{w}</div>
                    <div class="dot">-</div>"""

    def block(style):
        cls = "comm" + (" style2" if style else "")
        return f"""
                <div class="{cls}">{seq}
                </div>
                <div class="{cls}" aria-hidden="true">{seq}
                </div>"""

    out = ""
    for r in range(rows):
        out += f"""
    <div class="marquee-section{extra_class}" aria-hidden="{'true' if r else 'false'}">
        <div class="mycustom-marque">
            <div class="scrolling-wrap">{block(r == 1)}
            </div>
        </div>
    </div>
"""
    return out


def contact_form(lang, field_class=""):
    """İletişim formu. KVKK onayı zorunlu; contact.php'ye POST eder."""
    t = T[lang]
    privacy = PAGES["privacy"][lang]
    if lang == "tr":
        lbl = {
            "name": "Ad Soyad", "email": "E-posta", "phone": "Telefon (isteğe bağlı)",
            "company": "Firma (isteğe bağlı)", "message": "Mesajınız",
            "consent": (f'<a href="{privacy}" target="_blank" rel="noopener">KVKK Aydınlatma Metni</a>’ni '
                        "okudum. Talebimin yanıtlanması amacıyla kişisel verilerimin işlenmesine ve "
                        "yurt dışındaki veri sorumlusuna aktarılmasına açık rıza veriyorum."),
            "send": "GÖNDER", "hp": "Bu alanı boş bırakın",
        }
    else:
        lbl = {
            "name": "Full Name", "email": "Email", "phone": "Phone (optional)",
            "company": "Company (optional)", "message": "Your Message",
            "consent": (f'I have read the <a href="{privacy}" target="_blank" rel="noopener">Privacy Notice</a> '
                        "and consent to my personal data being processed and transferred abroad "
                        "in order to respond to my enquiry."),
            "send": "SEND", "hp": "Leave this field empty",
        }
    return f"""
                                <form class="row gy-3 js-contact-form" action="contact.php" method="post" novalidate>
                                    <input type="hidden" name="lang" value="{lang}">
                                    <input type="hidden" name="ts" value="">
                                    <div class="hp-field" aria-hidden="true">
                                        <label for="website-{lang}">{lbl['hp']}</label>
                                        <input type="text" id="website-{lang}" name="website" tabindex="-1" autocomplete="off">
                                    </div>
                                    <div class="col-md-6">
                                        <label class="sr-only" for="cf-name">{lbl['name']}</label>
                                        <input type="text" id="cf-name" name="name" placeholder="{lbl['name']} *" autocomplete="name" minlength="2" maxlength="100" required>
                                    </div>
                                    <div class="col-md-6">
                                        <label class="sr-only" for="cf-email">{lbl['email']}</label>
                                        <input type="email" id="cf-email" name="email" placeholder="{lbl['email']} *" autocomplete="email" maxlength="200" required>
                                    </div>
                                    <div class="col-md-6">
                                        <label class="sr-only" for="cf-phone">{lbl['phone']}</label>
                                        <input type="tel" id="cf-phone" name="phone" placeholder="{lbl['phone']}" autocomplete="tel" maxlength="40">
                                    </div>
                                    <div class="col-md-6">
                                        <label class="sr-only" for="cf-company">{lbl['company']}</label>
                                        <input type="text" id="cf-company" name="company" placeholder="{lbl['company']}" autocomplete="organization" maxlength="150">
                                    </div>
                                    <div class="col-12">
                                        <label class="sr-only" for="cf-message">{lbl['message']}</label>
                                        <textarea id="cf-message" name="message" class="form-control{field_class}" placeholder="{lbl['message']}... *" rows="5" minlength="5" maxlength="5000" required></textarea>
                                    </div>
                                    <div class="col-12">
                                        <label class="consent">
                                            <input type="checkbox" name="kvkk_consent" value="1" required>
                                            <span>{lbl['consent']}</span>
                                        </label>
                                    </div>
                                    <div class="col-12 form-group mb-0">
                                        <button type="submit" class="theme-btn style5">{lbl['send']} <i class="fa-solid fa-arrow-right-long bg-transparent text-white" aria-hidden="true"></i></button>
                                        <div class="form-status" role="status" aria-live="polite"></div>
                                    </div>
                                </form>"""


def footer(lang):
    t = T[lang]
    c = COMPANY
    return f"""
    <!-- Footer -->
    <footer class="footer-section-two" data-bg-src="assets/images/bg/footer-two-bg.webp">
        <div class="container">
            <div class="footer-top-area">
                <div class="row g-12">
                    <div class="col-lg-12 center">
                        <div class="logo">
                            <img src="assets/images/orphion-logo.webp" width="400" height="174" alt="{t['logo_alt']}" loading="lazy">
                            <p>{t['tagline']}</p>
                        </div>
                    </div>
                </div>
            </div>
            <div class="row g-4">
                <div class="col-lg-12 col-md-6">
                    <div class="footer-widget">
                        <h4 class="widget-title">{t['contact']}</h4>
                        <ul class="list-unstyled contact-info">
                            <li class="d-flex align-items-start">
                                <img src="assets/images/icon/location-white.svg" width="20" height="20" alt="" aria-hidden="true">
                                <p><a href="{c['maps_link']}" target="_blank" rel="noopener">{c['address']}</a></p>
                            </li>
                            <li class="d-flex align-items-start">
                                <img src="assets/images/icon/phone-white.svg" width="20" height="20" alt="" aria-hidden="true">
                                <p><a href="tel:{c['phone_tel']}">{c['phone_display']}</a></p>
                            </li>
                            <li class="d-flex align-items-start">
                                <img src="assets/images/icon/mail-white.svg" width="20" height="20" alt="" aria-hidden="true">
                                <p><a href="mailto:{c['email']}">{c['email']}</a></p>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
            <div class="copyright text-center">
                <p>Copyright © <span data-current-year>2026</span> {c['name']}. {t['rights']} Designed by <a href="https://peakweb.net" target="_blank" rel="noopener">Peakweb</a></p>
                <div class="footer-legal-links">
                    <a href="{PAGES['privacy'][lang]}">{t['privacy_link']}</a>
                    <button type="button" class="js-cookie-settings">{t['cookie_settings']}</button>
                </div>
            </div>
        </div>
    </footer>

    <!-- Çerez bildirimi -->
    <div class="cookie-banner" role="dialog" aria-live="polite" aria-label="{t['cookie_settings']}">
        <p>{t['cookie_text']}</p>
        <div class="cookie-actions">
            <button type="button" class="accept">{t['cookie_accept']}</button>
            <button type="button" class="reject">{t['cookie_reject']}</button>
        </div>
    </div>

    <!-- JS -->
    <script src="assets/js/jquery-3.7.1.min.js"></script>
    <script src="assets/js/jquery.meanmenu.min.js"></script>
    <script src="assets/js/wow.min.js"></script>
    <script src="assets/js/main.js"></script>
</body>

</html>
"""


def organization_schema(lang):
    c = COMPANY
    data = {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": c["name"],
        "url": SITE_URL,
        "logo": SITE_URL + "assets/images/orphion-logo.png",
        "image": SITE_URL + "assets/images/og-image.jpg",
        "email": c["email"],
        "telephone": c["phone_tel"],
        "description": DESCRIPTIONS["home"][lang],
        "parentOrganization": {"@type": "Organization", "name": c["group"]},
        "address": {
            "@type": "PostalAddress",
            "streetAddress": "Meydan Grandstand, 6th floor, Meydan Road",
            "addressLocality": "Nad Al Sheba, Dubai",
            "addressCountry": "AE",
        },
        "contactPoint": {
            "@type": "ContactPoint",
            "contactType": "customer service",
            "email": c["email"],
            "telephone": c["phone_tel"],
            "availableLanguage": ["Turkish", "English"],
        },
    }
    return (
        '\n    <script type="application/ld+json">\n    '
        + json.dumps(data, ensure_ascii=False, indent=2).replace("\n", "\n    ")
        + "\n    </script>"
    )


def page(page_key, lang, title, body):
    return (
        head(page_key, lang, title, DESCRIPTIONS[page_key][lang],
             organization_schema(lang) if page_key == "home" else "")
        + "\n<body>\n"
        + '    <a class="visually-hidden-focusable" href="#main">'
        + ("İçeriğe geç" if lang == "tr" else "Skip to content") + "</a>\n"
        + preloader()
        + header(page_key, lang)
        + lang_suggest(page_key, lang)
        + '\n    <main id="main">\n'
        + body
        + "\n    </main>\n"
        + footer(lang)
    )


# ---------------------------------------------------------------------------
# Metinler
# ---------------------------------------------------------------------------

DESCRIPTIONS = {
    "home": {
        "tr": ("Orphion Pharma; uluslararası ilaç firmalarının Türkiye pazarına erişimi için ilaç tedariki, "
               "devlet ihaleleri, Yurt Dışı İlaç Programı ve pazara giriş danışmanlığı sunan bir tedarik ve "
               "danışmanlık şirketidir."),
        "en": ("Orphion Pharma is a pharmaceutical supply and consulting company helping international "
               "pharmaceutical companies access the Turkish market through direct supply, government tenders, "
               "named patient programs and market entry consulting."),
    },
    "about": {
        "tr": ("Orphion Pharma hakkında: Orphion Group çatısı altında ilaç tedariki ve Türkiye ilaç pazarına "
               "giriş danışmanlığı. Vizyonumuz, misyonumuz ve sayılarla biz."),
        "en": ("About Orphion Pharma: pharmaceutical supply and Turkish market entry consulting under "
               "Orphion Group. Our vision, mission and key figures."),
    },
    "contact": {
        "tr": ("Orphion Pharma ile iletişime geçin: ilaç tedariki ve Türkiye pazarına giriş danışmanlığı "
               "talepleriniz için formu doldurun, e-posta gönderin veya arayın."),
        "en": ("Contact Orphion Pharma about pharmaceutical supply and Turkish market entry consulting: "
               "use the form, email us or give us a call."),
    },
    "privacy": {
        "tr": "Orphion Pharma KVKK aydınlatma metni ve çerez politikası.",
        "en": "Orphion Pharma privacy notice and cookie policy.",
    },
}

CHECK_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">'
    '<path d="M13.8454 26.587C13.7658 26.587 13.6871 26.5705 13.6142 26.5386C13.5413 26.5067 13.4758 26.4601 13.4218 '
    '26.4017L1.99947 14.046C1.92332 13.9636 1.87284 13.8608 1.85421 13.7502C1.83557 13.6396 1.84959 13.5259 1.89454 '
    '13.4232C1.93949 13.3204 2.01343 13.233 2.10731 13.1716C2.20119 13.1101 2.31093 13.0774 2.4231 13.0774H7.92118C8.00373 '
    '13.0775 8.08532 13.0952 8.16044 13.1294C8.23556 13.1636 8.30246 13.2136 8.35664 13.2758L12.174 17.6676C12.5866 '
    '16.7857 13.3852 15.3173 14.7867 13.5281C16.8585 10.8829 20.7123 6.99263 27.3056 3.48079C27.433 3.41293 27.5813 '
    '3.39531 27.721 3.43143C27.8608 3.46754 27.982 3.55476 28.0606 3.67585C28.1392 3.79695 28.1696 3.94312 28.1457 '
    '4.08551C28.1218 4.2279 28.0454 4.35615 27.9315 4.44494C27.9064 4.46461 25.3642 6.46654 22.4385 10.1334C19.7459 '
    '13.5078 16.1666 19.0255 14.4053 26.1488C14.3743 26.2739 14.3024 26.3851 14.2009 26.4646C14.0994 26.5441 13.9742 '
    '26.5872 13.8453 26.5872L13.8454 26.587Z" fill="#2DCE98"/></svg>'
)

BUSINESS_LINES = {
    "tr": [
        "Doğrudan tedarik programları, devlet ihaleleri ve reçeteye dayalı programlar (Yurt Dışı İlaç Programı) için farmasötik ürünlerin tedarik edilmesi",
        "Türkiye ilaç pazarına girmeyi planlayan uluslararası firmalara danışmanlık verilmesi ve yerel temsilcilik yapılması",
    ],
    "en": [
        "Supplying pharmaceutical products for direct supply programs, government tenders and prescription-based programs (Named Patient Program)",
        "Consultancy and local representation for international companies planning to enter the Turkish pharmaceutical market",
    ],
}

def home_body(lang):
    tr = lang == "tr"
    intro = (
        "Orphion Pharma, Orphion Group çatısı altında faaliyet gösteren, uluslararası ilaç firmalarının "
        "Türkiye pazarına erişimini kolaylaştırmayı misyon edinen, yenilikçi ve dinamik bir ilaç tedarik ve "
        "danışmanlık şirketidir. Global farmasötik çözümleri Türkiye'nin sağlık sektörüne entegre eden "
        "Orphion Pharma, hem devlet kurumlarına hem de özel sektöre yönelik çözümleri ile güvenilir bir iş ortağıdır."
        if tr else
        "Orphion Pharma, operating under Orphion Group, is an innovative and dynamic pharmaceutical supply and "
        "consulting company whose mission is to facilitate international pharmaceutical companies' access to the "
        "Turkish market. Integrating global pharmaceutical solutions into Türkiye's healthcare sector, Orphion Pharma "
        "is a reliable business partner for both government institutions and the private sector."
    )
    about_p = (
        "Orphion Pharma, Orphion Group'un bir parçası olarak, uluslararası markaların Türkiye ilaç pazarına "
        "erişimini kolaylaştırmaya odaklanmış genç ve dinamik bir şirkettir."
        if tr else
        "Orphion Pharma, as part of Orphion Group, is a young and dynamic company focused on facilitating "
        "international brands' access to the Turkish pharmaceutical market."
    )
    lines = "".join(
        f"""
                                        <li><i class="fa-solid fa-check" aria-hidden="true"></i>{l}</li>"""
        for l in BUSINESS_LINES[lang]
    )


    return f"""
    <!-- Intro -->
    <section class="intro-section fix mbn-1-9em">
        <div class="intro-container-wrapper style3">
            <div class="container">
                <div class="intro-wrapper style3">
                    <div class="intro-up">
                        <div class="row">
                            <div class="col-xl-6">
                                <h1 class="intro-title wow fadeInUp" data-wow-delay=".3s" lang="en">Orphion
                                    <span>PHARMA</span>
                                </h1>
                            </div>
                            <div class="col-xl-6">
                                <div class="intro-content mxw-720">
                                    <p class="desc wow fadeInUp" data-wow-delay=".6s">{intro}</p>
                                    <a class="theme-btn wow fadeInUp" data-wow-delay=".3s" href="{PAGES['about'][lang]}">{T[lang]['about']}</a>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="intro-down-wrapper">
                        <div class="intro-down" data-bg-src="assets/images/bg/introBg3_1.webp" role="img" aria-label="{'İlaç tedariki ve laboratuvar' if tr else 'Pharmaceutical supply and laboratory'}"></div>
                    </div>
                </div>
            </div>
        </div>
    </section>
{marquee(lang)}
    <!-- About -->
    <section class="about-section section-padding fix">
        <div class="about-container-wrapper style3">
            <div class="shape" aria-hidden="true">
                <img src="assets/images/shape/aboutShape3_1.webp" width="476" height="617" alt="" loading="lazy">
            </div>
            <div class="container">
                <div class="about-wrapper style3">
                    <div class="row gy-5 gx-30 d-flex align-items-center">
                        <div class="col-xl-6">
                            <div class="about-content">
                                <div class="section-title mxw-705">
                                    <h2 class="subtitle h6 wow fadeInUp" data-wow-delay=".3s">{T[lang]['about']}</h2>
                                    <p class="title h2 wow fadeInUp" data-wow-delay=".6s">Orphion <span class="color-text">Pharma</span></p>
                                    <p class="desc mxw-690 wow fadeInUp" data-wow-delay=".3s">{about_p}</p>
                                    <div class="business-lines wow fadeInUp" data-wow-delay=".3s">
                                        <h3>{'İki Ana İş Kolumuz' if tr else 'Our Two Main Business Lines'}</h3>
                                        <ul class="list-unstyled">{lines}
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-6 d-flex justify-content-center">
                            <div class="about-thumb">
                                <div class="main-thumb img-custom-anim-left wow fadeInUp" data-wow-delay=".3s">
                                    <img src="assets/images/about/aboutThumb3_1.webp" width="775" height="634" loading="lazy" alt="{'Orphion Pharma ilaç tedarik ve danışmanlık hizmetleri' if tr else 'Orphion Pharma pharmaceutical supply and consulting services'}">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- Contact -->
    <section class="contact-section section-padding fix" id="contact-form">
        <div class="contact-container-wrapper style2">
            <div class="container">
                <div class="contact-wrapper style2" data-bg-src="assets/images/bg/contactBg2_1.webp">
                    <div class="row">
                        <div class="col-xl-8">
                            <div class="contact-form style2">
                                <div class="section-title mxw-720 wow fadeInUp" data-wow-delay=".3s">
                                    <h2 class="title">{T[lang]['contact_us']} / <span class="color-text">Orphion Pharma</span></h2>
                                </div>{contact_form(lang)}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="icon-box" aria-hidden="true">
                    <img src="assets/images/icon/contactIcon1_1.svg" alt="">
                </div>
            </div>
        </div>
    </section>
"""


def about_body(lang):
    tr = lang == "tr"
    items = "".join(
        f"""
                                    <li>
                                        {CHECK_SVG} {l}
                                    </li>"""
        for l in BUSINESS_LINES[lang]
    )


    if tr:
        h2 = 'Yenilikçi ilaçlara erişimi kolaylaştırarak <span class="color-text">hastaların umudu oluyoruz.</span>'
        p1 = ("Orphion Pharma, Orphion Group'un bir parçası olarak, uluslararası markaların Türkiye ilaç pazarına "
              "erişimini kolaylaştırmaya odaklanmış genç ve dinamik bir şirkettir.")
        p2 = "Orphion Pharma iki ana iş koluna sahiptir:"
        patients = ("Toplam Ulaşılan Hasta", "1.1 Milyon")
        vision_t, vision = "Vizyonumuz", (
            "Vizyonumuz, Türkiye ilaç pazarında iş birliği arayışında olan uluslararası firmaların ilk adresi olmak "
            "ve hastaların yeni orijinal ilaçlara ve daha iyi jenerik ilaçlara erişimini artırmaktır.")
        mission_t, mission = "Misyonumuz", (
            "Misyonumuz, Türkiye'de ilaç tedarik eden uluslararası firmalar ile Türk bürokrasisi ve ilaç tedarikçisi "
            "kurumlar arasında sürdürülebilir ilişkiler kurarak sinerji yaratmaktır.")
        quote = "“Türkiye’nin ilaç tedarikinde güvenilir markası.”"
        fact_sub, fact_title = "Sayılarla Biz", 'Verdiğimiz Hizmet <span class="color-text">Detayları</span>'
        fact_desc = ("Orphion Pharma, dünyanın önde gelen ilaç firmaları ile iş birliği yapmaktadır. Güvenilirliğimiz "
                     "ve profesyonelliğimiz sayesinde, uluslararası firmaların Türkiye pazarına sorunsuz bir şekilde "
                     "giriş yapmasını sağlıyoruz.")
        img_alt = "Orphion Pharma ekibi ve ilaç tedarik süreçleri"
    else:
        h2 = 'We become the hope of patients by <span class="color-text">facilitating access to innovative medicines.</span>'
        p1 = ("Orphion Pharma, as part of Orphion Group, is a young and dynamic company focused on facilitating "
              "international brands' access to the Turkish pharmaceutical market.")
        p2 = "Orphion Pharma has two main business lines:"
        patients = ("Total Patients Reached", "1.1 Million")
        vision_t, vision = "Our Vision", (
            "Our vision is to become the first address for international companies seeking cooperation in the Turkish "
            "pharmaceutical market and to increase patients' access to new original medicines and better generics.")
        mission_t, mission = "Our Mission", (
            "Our mission is to create synergy by building sustainable relationships between international companies "
            "supplying pharmaceuticals in Türkiye and Turkish public authorities and pharmaceutical procurement institutions.")
        quote = "“The trusted brand in Türkiye’s pharmaceutical supply.”"
        fact_sub, fact_title = "In Numbers", 'Our Service <span class="color-text">at a Glance</span>'
        fact_desc = ("Orphion Pharma collaborates with leading pharmaceutical companies worldwide. Thanks to our "
                     "reliability and professionalism, we help international companies enter the Turkish market smoothly.")
        img_alt = "Orphion Pharma team and pharmaceutical supply processes"

    return f"""{breadcrumb(lang, T[lang]['about'])}
    <!-- About -->
    <section class="about-section section-padding fix">
        <div class="about-container-wrapper style2">
            <div class="container">
                <div class="about-wrapper style2">
                    <div class="row gy-5 gx-30 d-flex align-items-center">
                        <div class="col-xl-6 order-2 order-xl-1">
                            <div class="about-content">
                                <div class="section-title mxw-705">
                                    <p class="subtitle h6 wow fadeInUp" data-wow-delay=".3s">{T[lang]['about']}</p>
                                    <h2 class="title wow fadeInUp" data-wow-delay=".6s">{h2}</h2>
                                    <p class="desc mxw-564 wow fadeInUp" data-wow-delay=".8s">{p1}</p>
                                    <p class="desc mxw-564 wow fadeInUp" data-wow-delay=".8s">{p2}</p>
                                </div>
                                <ul class="checklist style2 wow fadeInUp" data-wow-delay=".3s">{items}
                                </ul>
                            </div>
                        </div>
                        <div class="col-xl-6 order-1 order-xl-2 d-flex justify-content-center">
                            <div class="about-thumb">
                                <div class="main-thumb img-custom-anim-left wow fadeInUp" data-wow-delay=".3s">
                                    <img src="assets/images/about/aboutThumb1_2.webp" width="570" height="502" alt="{img_alt}">
                                </div>
                                <div class="shape" aria-hidden="true">
                                    <img src="assets/images/shape/aboutShape2_1.webp" width="845" height="347" alt="">
                                </div>
                                <div class="about-thumb-box wow fadeInUp" data-wow-delay=".3s">
                                    <ul class="profile-img" aria-hidden="true">
                                        <li><img src="assets/images/about/aboutProfileThumb1_1.webp" width="90" height="40" alt=""></li>
                                    </ul>
                                    <h3 class="h6">{patients[0]}</h3>
                                    <p class="h4">{patients[1]}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- Vision & Mission -->
    <section class="blog-details-section">
        <div class="container">
            <div class="row g-4">
                <div class="col-lg-12">
                    <div class="blog-details">
                        <div class="content">
                            <h2 class="title h4 wow fadeInUp" data-wow-delay=".3s">{vision_t}</h2>
                            <p class="wow fadeInUp mb-5" data-wow-delay=".3s">{vision}</p>
                            <h2 class="title h4 wow fadeInUp" data-wow-delay=".3s">{mission_t}</h2>
                            <p class="wow fadeInUp" data-wow-delay=".3s">{mission}</p>
                            <blockquote>
                                <p class="h5">{quote} ~Orphion Pharma</p>
                            </blockquote>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- Facts -->
    <section class="fact-section section-padding fix">
        <div class="container">
            <div class="fact-wrapper style1">
                <div class="row">
                    <div class="col-xl-8">
                        <div class="fact-content style1">
                            <div class="section-title mxw-720">
                                <p class="subtitle h6">{fact_sub}</p>
                                <h2 class="title">{fact_title}</h2>
                            </div>
                            <p class="desc">{fact_desc}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
{marquee(lang, rows=1, extra_class=" section-padding1 pt-0")}"""


def contact_body(lang):
    t = T[lang]
    c = COMPANY
    tr = lang == "tr"
    form_title = "Mesaj Gönderin" if tr else "Send Us a Message"
    form_intro = (
        "İlaç tedariki, ihale süreçleri veya Türkiye pazarına giriş danışmanlığı ile ilgili talebinizi iletin; "
        "en kısa sürede size dönüş yapalım."
        if tr else
        "Tell us about your pharmaceutical supply, tender or Turkish market entry needs and we will get back to you shortly."
    )
    map_text = (
        "Haritayı görüntülemek için Google Haritalar yüklenecektir. Bu işlem Google'a IP adresiniz gibi bazı "
        "verilerin iletilmesine neden olur."
        if tr else
        "Viewing the map loads Google Maps, which sends some data such as your IP address to Google."
    )
    map_btn = "Haritayı göster" if tr else "Show map"
    map_link = "Google Haritalar'da aç" if tr else "Open in Google Maps"
    map_title = "Orphion Pharma konum haritası" if tr else "Orphion Pharma location map"

    def info(icon, title, value):
        return f"""
                                <li class="d-flex">
                                    <div class="icon flex-shrink-0 d-flex justify-content-center align-items-center rounded-pill">
                                        <img src="assets/images/icon/{icon}.svg" width="24" height="24" alt="" aria-hidden="true">
                                    </div>
                                    <div class="text">
                                        <h3 class="contact-title h4">{title}:</h3>
                                        <p>{value}</p>
                                    </div>
                                </li>"""

    infos = (
        info("location", t["address"], f'<a href="{c["maps_link"]}" target="_blank" rel="noopener">{c["address"]}</a>')
        + info("mail", t["email"], f'<a href="mailto:{c["email"]}">{c["email"]}</a>')
        + info("phone", t["phone"], f'<a href="tel:{c["phone_tel"]}">{c["phone_display"]}</a><br>'
               f'<a href="{c["whatsapp"]}" target="_blank" rel="noopener">{t["whatsapp"]}</a>')
    )

    return f"""{breadcrumb(lang, t['contact_us'])}
    <!-- Contact -->
    <section class="service-details-section section-padding">
        <div class="container">
            <div class="row g-4">
                <div class="col-lg-5">
                    <aside class="service-sidebar">
                        <div class="sidebar-widget overflow-hidden position-relative wow fadeInUp" data-wow-delay=".3s">
                            <h2 class="title h4">{t['contact']}</h2>
                            <ul class="list-unstyled contact-info">{infos}
                            </ul>
                            <p class="mt-4 mb-0"><strong>{t['working_hours']}:</strong> {t['hours']}</p>
                        </div>
                    </aside>
                </div>
                <div class="col-lg-7" id="contact-form">
                    <div class="contact-form contact-page-form wow fadeInUp" data-wow-delay=".3s">
                        <h2 class="h3 mb-2">{form_title}</h2>
                        <p class="mb-4">{form_intro}</p>{contact_form(lang)}
                    </div>
                </div>
                <div class="col-12">
                    <div class="map-consent" data-map-src="{esc(c['maps_embed'])}" data-map-title="{map_title}">
                        <div>
                            <p>{map_text}</p>
                            <button type="button" class="theme-btn js-load-map">{map_btn}</button>
                            <p class="mt-3 mb-0"><a href="{c['maps_link']}" target="_blank" rel="noopener">{map_link}</a></p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
"""


def privacy_body(lang):
    c = COMPANY
    if lang == "tr":
        title = "KVKK Aydınlatma Metni"
        content = f"""
                <p class="updated">Son güncelleme: 18 Ekim 2026</p>
                <p>6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) uyarınca, web sitemizi ziyaret eden ve
                iletişim formu, e-posta, telefon veya WhatsApp üzerinden bizimle iletişime geçen kişilere ait kişisel
                verilerin işlenmesine ilişkin olarak sizi bilgilendirmek isteriz.</p>

                <h2>1. Veri Sorumlusu</h2>
                <p>{c['name']} ({c['group']} bünyesinde)<br>
                Adres: {c['address']}<br>
                E-posta: <a href="mailto:{c['email']}">{c['email']}</a><br>
                Telefon: <a href="tel:{c['phone_tel']}">{c['phone_display']}</a></p>

                <h2>2. İşlenen Kişisel Veriler</h2>
                <table>
                    <thead><tr><th>Veri kategorisi</th><th>Örnek</th></tr></thead>
                    <tbody>
                        <tr><td>Kimlik</td><td>Ad, soyad</td></tr>
                        <tr><td>İletişim</td><td>E-posta adresi, telefon numarası (isteğe bağlı)</td></tr>
                        <tr><td>Mesleki bilgi</td><td>Firma adı (isteğe bağlı)</td></tr>
                        <tr><td>Talep / şikâyet bilgisi</td><td>Mesaj içeriğiniz</td></tr>
                        <tr><td>İşlem güvenliği</td><td>IP adresi, gönderim zamanı (kötüye kullanımı önlemek için)</td></tr>
                    </tbody>
                </table>

                <h2>3. İşleme Amaçları</h2>
                <ul>
                    <li>Talep, soru ve teklif isteklerinizin alınması, değerlendirilmesi ve yanıtlanması,</li>
                    <li>Olası iş birliği ve sözleşme süreçlerinin yürütülmesi,</li>
                    <li>Web sitesi ve form güvenliğinin sağlanması, spam ve kötüye kullanımın önlenmesi,</li>
                    <li>Hukuki yükümlülüklerin yerine getirilmesi ve yetkili mercilere bilgi verilmesi.</li>
                </ul>

                <h2>4. Hukuki Sebepler ve Toplama Yöntemi</h2>
                <p>Kişisel verileriniz; web sitesindeki iletişim formu, e-posta, telefon ve WhatsApp kanalları aracılığıyla
                elektronik ortamda toplanır ve KVKK’nın 5. maddesinde yer alan şu hukuki sebeplere dayanılarak işlenir:</p>
                <ul>
                    <li>Bir sözleşmenin kurulması veya ifasıyla doğrudan ilgili olması (m. 5/2-c),</li>
                    <li>Veri sorumlusunun hukuki yükümlülüğünü yerine getirebilmesi (m. 5/2-ç),</li>
                    <li>İlgili kişinin temel hak ve özgürlüklerine zarar vermemek kaydıyla meşru menfaat (m. 5/2-f),</li>
                    <li>Yukarıdaki sebeplerin bulunmadığı hâllerde açık rızanız (m. 5/1).</li>
                </ul>

                <h2>5. Kişisel Verilerin Aktarılması</h2>
                <p>Kişisel verileriniz, yukarıdaki amaçlarla sınırlı olarak; {c['group']} şirketlerine, e-posta ve
                barındırma (hosting) hizmeti aldığımız tedarikçilere, iş ortaklarımıza ve talep hâlinde yetkili kamu
                kurum ve kuruluşlarına aktarılabilir.</p>
                <p>Veri sorumlusunun merkezi Birleşik Arap Emirlikleri’nde bulunduğundan ve kullanılan e-posta /
                barındırma hizmetlerinin sunucuları yurt dışında olabileceğinden, kişisel verileriniz KVKK’nın 9. maddesi
                kapsamında yurt dışına aktarılabilir. İletişim formunda bu aktarım için açık rızanız alınmaktadır.</p>

                <h2>6. Saklama Süresi</h2>
                <p>Kişisel verileriniz, talebinizin sonuçlandırılması için gerekli süre ve ilgili mevzuatta öngörülen
                zamanaşımı süreleri boyunca saklanır; bu sürelerin sonunda silinir, yok edilir veya anonim hâle getirilir.
                Kötüye kullanımı önlemek için tutulan IP kayıtları en fazla 1 saat saklanır.</p>

                <h2>7. KVKK Madde 11 Kapsamındaki Haklarınız</h2>
                <ul>
                    <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme ve işlenmişse bilgi talep etme,</li>
                    <li>İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,</li>
                    <li>Yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme,</li>
                    <li>Eksik veya yanlış işlenmişse düzeltilmesini isteme,</li>
                    <li>KVKK’nın 7. maddesindeki şartlar çerçevesinde silinmesini veya yok edilmesini isteme,</li>
                    <li>Düzeltme, silme ve yok etme işlemlerinin aktarıldığı üçüncü kişilere bildirilmesini isteme,</li>
                    <li>Münhasıran otomatik sistemlerle analiz edilmesi sonucu aleyhinize bir sonucun ortaya çıkmasına itiraz etme,</li>
                    <li>Kanuna aykırı işleme nedeniyle zarara uğramanız hâlinde zararın giderilmesini talep etme.</li>
                </ul>
                <p>Açık rızanızı dilediğiniz zaman geri alabilirsiniz. Başvurularınızı, Veri Sorumlusuna Başvuru Usul ve
                Esasları Hakkında Tebliğ’e uygun olarak <a href="mailto:{c['email']}">{c['email']}</a> adresine
                iletebilirsiniz. Başvurunuz en geç 30 gün içinde ücretsiz olarak sonuçlandırılır.</p>

                <h2 id="cerezler">8. Çerez Politikası</h2>
                <p>Web sitemiz aşağıdaki çerez ve tarayıcı depolama teknolojilerini kullanır:</p>
                <table>
                    <thead><tr><th>Tür</th><th>Amaç</th><th>Süre</th></tr></thead>
                    <tbody>
                        <tr><td>Zorunlu (yerel depolama)</td><td>Dil tercihinizi (TR/EN) ve çerez tercihinizi hatırlamak</td><td>Siz silene kadar</td></tr>
                        <tr><td>Analitik (Google Analytics)</td><td>Ziyaret istatistiklerini anonim olarak ölçmek. <strong>Yalnızca “Kabul et” seçeneğini işaretlerseniz</strong> yüklenir.</td><td>En fazla 2 yıl</td></tr>
                        <tr><td>Üçüncü taraf (Google Haritalar)</td><td>İletişim sayfasındaki harita, yalnızca “Haritayı göster” butonuna bastığınızda yüklenir.</td><td>Google politikalarına tabidir</td></tr>
                    </tbody>
                </table>
                <p>Tercihinizi istediğiniz zaman sayfanın altındaki <button type="button" class="js-cookie-settings btn btn-link p-0 align-baseline">Çerez Ayarları</button>
                bağlantısından değiştirebilir veya tarayıcı ayarlarınızdan çerezleri silebilirsiniz.</p>"""
    else:
        title = "Privacy Notice"
        content = f"""
                <p class="updated">Last updated: 18 October 2026</p>
                <p>This notice explains how we process the personal data of visitors to our website and of people who
                contact us via the contact form, email, phone or WhatsApp, in line with the Turkish Personal Data
                Protection Law No. 6698 (“KVKK”) and other applicable data protection laws.</p>

                <h2>1. Data Controller</h2>
                <p>{c['name']} (part of {c['group']})<br>
                Address: {c['address']}<br>
                Email: <a href="mailto:{c['email']}">{c['email']}</a><br>
                Phone: <a href="tel:{c['phone_tel']}">{c['phone_display']}</a></p>

                <h2>2. Personal Data We Process</h2>
                <table>
                    <thead><tr><th>Category</th><th>Examples</th></tr></thead>
                    <tbody>
                        <tr><td>Identity</td><td>Name and surname</td></tr>
                        <tr><td>Contact</td><td>Email address, phone number (optional)</td></tr>
                        <tr><td>Professional</td><td>Company name (optional)</td></tr>
                        <tr><td>Enquiry</td><td>The content of your message</td></tr>
                        <tr><td>Security</td><td>IP address and time of submission (to prevent abuse)</td></tr>
                    </tbody>
                </table>

                <h2>3. Purposes</h2>
                <ul>
                    <li>Receiving, assessing and responding to your enquiries and quote requests,</li>
                    <li>Carrying out potential business cooperation and contract processes,</li>
                    <li>Keeping the website and form secure and preventing spam and abuse,</li>
                    <li>Complying with legal obligations and requests from competent authorities.</li>
                </ul>

                <h2>4. Legal Bases and Collection Method</h2>
                <p>Your data is collected electronically through the contact form, email, phone and WhatsApp, and is
                processed on the following legal bases: performance or conclusion of a contract, compliance with legal
                obligations, our legitimate interests, and — where none of these apply — your explicit consent.</p>

                <h2>5. Transfers</h2>
                <p>Your data may be shared, only for the purposes above, with {c['group']} companies, our email and
                hosting providers, business partners and, on request, competent public authorities. As the data
                controller is based in the United Arab Emirates and our service providers' servers may be located
                abroad, your data may be transferred outside Türkiye. Your explicit consent for this transfer is
                obtained on the contact form.</p>

                <h2>6. Retention</h2>
                <p>We keep your data for as long as necessary to handle your enquiry and for the statutory limitation
                periods, after which it is deleted, destroyed or anonymised. IP records kept to prevent abuse are stored
                for no longer than 1 hour.</p>

                <h2>7. Your Rights</h2>
                <p>You may request information about whether and how your data is processed, learn the third parties it
                is transferred to, ask for it to be corrected or erased, object to decisions made solely by automated
                means, and claim compensation for damage arising from unlawful processing. You may withdraw your
                consent at any time. Please send requests to <a href="mailto:{c['email']}">{c['email']}</a>; we respond
                within 30 days free of charge.</p>

                <h2 id="cookies">8. Cookie Policy</h2>
                <table>
                    <thead><tr><th>Type</th><th>Purpose</th><th>Duration</th></tr></thead>
                    <tbody>
                        <tr><td>Essential (local storage)</td><td>Remembering your language (TR/EN) and cookie preference</td><td>Until you clear it</td></tr>
                        <tr><td>Analytics (Google Analytics)</td><td>Measuring visits anonymously. Loaded <strong>only if you click “Accept”</strong>.</td><td>Up to 2 years</td></tr>
                        <tr><td>Third party (Google Maps)</td><td>The map on the contact page is loaded only when you click “Show map”.</td><td>Subject to Google's policies</td></tr>
                    </tbody>
                </table>
                <p>You can change your choice at any time via <button type="button" class="js-cookie-settings btn btn-link p-0 align-baseline">Cookie Settings</button>
                in the footer, or delete cookies in your browser settings.</p>"""

    return f"""{breadcrumb(lang, title)}
    <section class="section-padding">
        <div class="container">
            <div class="legal-content">{content}
            </div>
        </div>
    </section>
"""


# ---------------------------------------------------------------------------

TITLES = {
    "home": {
        "tr": "Orphion Pharma | Türkiye İlaç Tedariki ve Pazar Danışmanlığı",
        "en": "Orphion Pharma | Pharmaceutical Supply & Turkish Market Consulting",
    },
    "about": {"tr": "Hakkımızda | Orphion Pharma", "en": "About Us | Orphion Pharma"},
    "contact": {"tr": "İletişim | Orphion Pharma", "en": "Contact | Orphion Pharma"},
    "privacy": {"tr": "KVKK Aydınlatma Metni ve Çerez Politikası | Orphion Pharma",
                "en": "Privacy Notice & Cookie Policy | Orphion Pharma"},
}

BODIES = {"home": home_body, "about": about_body, "contact": contact_body, "privacy": privacy_body}


def sitemap():
    urls = []
    for key, langs in PAGES.items():
        for lang in langs:
            alts = "".join(
                f'\n    <xhtml:link rel="alternate" hreflang="{l}" href="{url_of(key, l)}"/>' for l in ("tr", "en")
            ) + f'\n    <xhtml:link rel="alternate" hreflang="x-default" href="{url_of(key, "en")}"/>'
            prio = "1.0" if key == "home" else ("0.3" if key == "privacy" else "0.8")
            urls.append(
                f"""  <url>
    <loc>{url_of(key, lang)}</loc>
    <lastmod>{LAST_UPDATED}</lastmod>
    <priority>{prio}</priority>{alts}
  </url>"""
            )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + "\n".join(urls) + "\n</urlset>\n"
    )


def main():
    for key, langs in PAGES.items():
        for lang, filename in langs.items():
            out = page(key, lang, TITLES[key][lang], BODIES[key](lang))
            (ROOT / filename).write_text(out, encoding="utf-8")
            print("yazıldı:", filename)
    (ROOT / "sitemap.xml").write_text(sitemap(), encoding="utf-8")
    (ROOT / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\nDisallow: /contact.php\n\nSitemap: {SITE_URL}sitemap.xml\n", encoding="utf-8"
    )
    print("yazıldı: sitemap.xml, robots.txt")


if __name__ == "__main__":
    main()
