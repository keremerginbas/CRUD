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
LAST_UPDATED = "2026-10-21"

# Marka ayarları: logolar, açılış animasyonu, tema rengi.
# Rome Pharma için tools/build_rome.py bu değerleri değiştirir.
BRAND = {
    "word": "Orphion",                 # ana sayfa başlığı ve açılış animasyonu
    "theme_color": "#da9502",
    "logo_header": ("assets/images/orphion-logo.webp", 289, 125),   # açık zemin
    "logo_dark_bg": ("assets/images/orphion-logo.webp", 400, 174),  # koyu zemin (footer, mobil menü)
    "logo_png": "assets/images/orphion-logo.png",                    # Google / schema
}

COMPANY = {
    "name": "Orphion Pharma",
    "group": "Orphion Group",
    "email": "info@orphionpharma.com",
    # Sitede görünen ana telefon: Türkiye irtibat ofisi (Dubai merkezin ayrı telefonu yok)
    "phone_display": "+90 (312) 215 50 10",
    "phone_tel": "+903122155010",
    # Cep numarası sitede yazılmaz; yalnızca WhatsApp butonunda kullanılır.
    "whatsapp": "https://wa.me/905325691111",
}

# Ofisler: iletişim sayfası, footer, mobil menü ve KVKK metni buradan beslenir.
OFFICES = [
    {
        "key": "dubai",
        "title": {"tr": "Merkez – Dubai", "en": "Headquarters – Dubai"},
        "lines": ["Meydan Grandstand, 6th Floor", "Meydan Road, Nad Al Sheba", "Dubai, U.A.E."],
        "phones": [],
        "maps_query": "Meydan Grandstand, Meydan Road, Nad Al Sheba, Dubai",
    },
    {
        "key": "tr",
        "title": {"tr": "Türkiye İrtibat Ofisi", "en": "Türkiye Liaison Office"},
        "lines": [
            "Kızılırmak Mahallesi Dumlupınar Bulvarı",
            "NEXT LEVEL İş Merkezi A Blok No:3/108 Kat:23",
            "Çankaya / Ankara, Türkiye",
        ],
        "phones": [("+90 (312) 215 50 10", "+903122155010"), ("+90 (312) 222 54 58", "+903122225458")],
        "maps_query": "NEXT LEVEL İş Merkezi, Kızılırmak Mahallesi Dumlupınar Bulvarı, Çankaya, Ankara",
    },
    {
        "key": "us",
        "title": {"tr": "ABD İrtibat Ofisi", "en": "US Outreach Office"},
        "lines": ["3324 Sunbeam Place", "Batavia, OH 45103", "United States"],
        "phones": [("+1 (513) 388-1634", "+15133881634")],
        "maps_query": "3324 Sunbeam Place, Batavia, OH 45103",
    },
]
MAIN_OFFICE = OFFICES[0]  # Merkez (Dubai)
CHAIRMAN_PHOTO_H = 994


def maps_link(office):
    from urllib.parse import quote_plus
    return "https://www.google.com/maps/search/?api=1&query=" + quote_plus(office["maps_query"])


def maps_embed(office):
    from urllib.parse import quote
    return "https://maps.google.com/maps?q=" + quote(office["maps_query"]) + "&z=15&output=embed"


# Partner logoları: assets/images/partners/ klasörüne koyup buraya ekleyin.
# Örnek: {"name": "Firma Adı", "logo": "assets/images/partners/firma.webp", "url": "https://..."}
PARTNERS = []

# YK Başkanı mesajı (Orphion_Chairmans_Message_TR_EN.docx). None yapılırsa sayfa üretilmez ve menüde görünmez.
# Fotoğraf gelince assets/images/ altına koyup "photo" alanına yolunu yazın.
CHAIRMAN = {'name': 'Fevzi Aydın',
 'role': 'Chairman & Managing Partner',
 'photo': 'assets/images/chairman-fevzi-aydin.webp',
 'tr': ['Sağlık alanında çalışmanın diğer birçok sektörden farklı olduğuna inanıyorum.',
        'Çünkü aldığımız kararların, kurduğumuz ortaklıkların ve dünyanın farklı noktalarından erişilebilir '
        'hale getirdiğimiz tedavilerin nihai karşılığı bir bilanço kalemi değil, bir insan hayatıdır.',
        'Bugün bilim ve tıp, daha önce tedavi seçeneği bulunmayan birçok hastalık için yeni umutlar '
        'üretiyor. Ancak bir tedavinin geliştirilmiş veya dünyanın bir ülkesinde kullanıma sunulmuş olması, '
        'ne yazık ki her hastanın ona ulaşabildiği anlamına gelmiyor.',
        'Ülkeler arasındaki ruhsatlandırma süreçleri, geri ödeme sistemleri, tedarik zincirleri ve ticari '
        'öncelikler nedeniyle; bilimsel olarak mevcut olan bir tedavi, ona ihtiyaç duyan bir hasta için hâlâ '
        'binlerce kilometre uzakta olabilir.',
        'Orphion Pharma’yı kurarken bizi harekete geçiren temel düşünce tam olarak buydu: Mesafeyi '
        'kısaltmak.',
        'Bizim için bir ilacın değeri, yalnızca geliştirildiği laboratuvarda veya aldığı ruhsatta değil, '
        'ihtiyaç duyan hastaya gerçekten ulaştığı anda ortaya çıkar.',
        'Bu nedenle özellikle ciddi, nadir ve karşılanmamış tıbbi ihtiyacın yüksek olduğu hastalıklarda; '
        'yenilikçi tedavileri geliştiren şirketlerle, hekimlerle, sağlık otoriteleriyle ve erişim '
        'ekosisteminin tüm paydaşlarıyla birlikte çalışıyoruz.',
        'Amacımız yalnızca ürün tedarik etmek değildir.',
        'Amacımız; dünyanın herhangi bir yerinde geliştirilen değerli bir tedavi ile ona ihtiyaç duyan hasta '
        'arasında güvenilir, sürdürülebilir ve sorumlu bir köprü kurmaktır.',
        'Bu yaklaşım aynı zamanda iş ortaklarımıza verdiğimiz sözün temelidir. Bir şirket bize bir '
        'tedavisini emanet ettiğinde, onu yalnızca ticari bir ürün olarak görmeyiz. Arkasında yıllarca süren '
        'bilimsel araştırmayı, emeği, yatırımı ve en önemlisi o tedaviyi bekleyen hastaları görürüz.',
        'Bu nedenle yaptığımız her işte uzun vadeli ortaklığa, şeffaflığa, bilimsel doğruluğa ve etik '
        'sorumluluğa inanıyoruz.',
        "Türkiye'den başlayan yolculuğumuz bugün farklı coğrafyalara uzanıyor. Ancak nerede çalışırsak "
        'çalışalım pusulamız değişmeyecek:',
        'İhtiyacın olduğu yerde olmak.\n'
        'Bilimin sunduğu imkân ile hastanın erişimi arasındaki mesafeyi azaltmak.\n'
        'Ve yaptığımız her işin sonunda bir insan olduğunu asla unutmamak.',
        'Önümüzde uzun bir yol olduğunun farkındayız.',
        'Fakat Orphion’u yalnızca büyüyen bir ilaç şirketi olarak değil; güvenilen, sorumluluk alan ve '
        'ihtiyaç duyulan yerde harekete geçen bir sağlık şirketi olarak inşa etmek istiyoruz.',
        'Çünkü bizim için başarı yalnızca ne kadar büyüdüğümüzle değil, kaç hayatın daha iyi bir tedaviye '
        'ulaşmasına katkıda bulunabildiğimizle ölçülür.'],
 'en': ['I believe working in healthcare carries a responsibility unlike that of almost any other industry.',
        'Because ultimately, the decisions we make, the partnerships we build, and the treatments we help '
        'make accessible across borders are not reflected merely in numbers on a balance sheet.',
        'They can affect a human life.',
        'Science and medicine are advancing at an extraordinary pace. Treatments are being developed today '
        'for diseases that, not long ago, had few or sometimes no meaningful therapeutic options.',
        'Yet the existence of a treatment somewhere in the world does not necessarily mean that every '
        'patient who needs it can access it.',
        'Regulatory pathways, reimbursement systems, supply chains and commercial priorities can leave an '
        'effective treatment thousands of miles away from the patient waiting for it.',
        'This is the idea that inspired Orphion Pharma: to shorten that distance.',
        'We believe the true value of a medicine is realized not simply when it is discovered, developed or '
        'approved, but when it reaches the patient who needs it.',
        'That is why we focus particularly on serious and rare diseases and areas of significant unmet '
        'medical need, working alongside innovative pharmaceutical and biotechnology companies, physicians, '
        'healthcare authorities and other stakeholders across the patient-access ecosystem.',
        'Our ambition goes beyond supplying medicines.',
        'We aim to build a trusted, sustainable and responsible bridge between medical innovation, wherever '
        'it originates, and patients who need access to it.',
        'This philosophy also defines the responsibility we assume toward our partners.',
        'When a company entrusts us with one of its therapies, we do not see merely a commercial product. We '
        'recognize the years of scientific research behind it, the people who dedicated themselves to '
        'developing it, the investment required to bring it forward and, most importantly, the patients who '
        'may be waiting for it.',
        'For that reason, we believe in long-term partnerships built on transparency, scientific integrity, '
        'trust and ethical responsibility.',
        'Our journey began in Türkiye and is increasingly reaching beyond its borders. Wherever that journey '
        'takes us, however, our compass will remain the same:',
        'To be present where the need exists.\n'
        'To shorten the distance between scientific innovation and patient access.\n'
        'And never to forget that behind everything we do, there is a human life.',
        'We know that our journey is only beginning.',
        'Our ambition is not simply to build a growing pharmaceutical company, but to build a healthcare '
        'company that is trusted, takes responsibility and acts when and where patients need it.',
        'Because ultimately, we believe success should not be measured solely by how much a company grows, '
        'but by how many lives it helps bring closer to better treatment.']}

# Sayfa anahtarı -> dil -> dosya adı
PAGES = {
    "home": {"tr": "index.html", "en": "index-en.html"},
    "about": {"tr": "about.html", "en": "about-en.html"},
    "chairman": {"tr": "yk-baskani-mesaji.html", "en": "chairman-message-en.html"},
    "mission": {"tr": "misyon-vizyon.html", "en": "mission-vision-en.html"},
    "hr": {"tr": "insan-kaynaklari.html", "en": "human-resources-en.html"},
    "partners": {"tr": "partnerler.html", "en": "partners-en.html"},
    "contact": {"tr": "contact.html", "en": "contact-en.html"},
    "privacy": {"tr": "kvkk.html", "en": "privacy-en.html"},
}
if CHAIRMAN is None:
    del PAGES["chairman"]

# Üst menü: (etiket anahtarı, sayfa anahtarı, alt menü [(etiket, sayfa, #çapa)])
MENU = [
    ("home", "home", []),
    ("corporate", "about", [("about", "about", ""), ("chairman", "chairman", ""),
                            ("mission", "mission", ""), ("hr", "hr", "")]),
    ("partners", "partners", [("partners", "partners", ""), ("portfolio", "partners", "#portfolio")]),
    ("contact", "contact", []),
]

T = {
    "tr": {
        "locale": "tr_TR",
        "home": "Ana Sayfa",
        "corporate": "Kurumsal",
        "about": "Hakkımızda",
        "chairman": "YK Başkanının Mesajı",
        "mission": "Misyon ve Vizyon",
        "hr": "İnsan Kaynakları",
        "partners": "Partnerlerimiz",
        "portfolio": "Ürün Portföyümüz",
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
        "logo_alt": "{name} logosu",
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
        "corporate": "Corporate",
        "about": "About Us",
        "chairman": "Message from the Chairman",
        "mission": "Mission & Vision",
        "hr": "Human Resources",
        "partners": "Our Partners",
        "portfolio": "Our Product Portfolio",
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
        "logo_alt": "{name} logo",
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


def asset(path):
    """Dosya içeriğinden kısa bir sürüm ekler (ör. main.css?v=1a2b3c4d).
    Dosya değişince adres de değişir; tarayıcı eski önbelleği kullanmaz."""
    import hashlib
    digest = hashlib.md5((ROOT / path).read_bytes()).hexdigest()[:8]
    return f"{path}?v={digest}"


def logo_alt(lang):
    return T[lang]["logo_alt"].format(name=COMPANY["name"])


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
    <meta name="theme-color" content="{BRAND['theme_color']}">
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
    <meta property="og:image:alt" content="{logo_alt(lang)}">
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
    <link rel="stylesheet" href="{asset('assets/css/bootstrap.min.css')}">
    <link rel="stylesheet" href="{asset('assets/css/animate.css')}">
    <link rel="stylesheet" href="{asset('assets/css/meanmenu.css')}">
    <link rel="stylesheet" href="{asset('assets/css/main.css')}">
    <link rel="stylesheet" href="{asset('assets/css/custom.css')}">{extra}
</head>
"""


def preloader():
    letters = "".join(
        f"""
                <span data-text-preloader="{c}" class="letters-loading">{c}</span>"""
        for c in BRAND["word"].upper()
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
                                    <a target="_blank" rel="noopener" href="{maps_link(MAIN_OFFICE)}">{', '.join(MAIN_OFFICE['lines'])}</a>
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

    def item(label, key, children):
        children = [ch for ch in children if ch[1] in PAGES]
        current = ' aria-current="page"' if key == page and not children else ""
        if not children:
            return f"""
                                            <li>
                                                <a href="{PAGES[key][lang]}"{current}>{t[label]}</a>
                                            </li>"""
        active = " active" if any(ch[1] == page for ch in children) else ""
        subs = "".join(
            f"""
                                                    <li><a href="{PAGES[ck][lang]}{anchor}"{' aria-current="page"' if ck == page and not anchor else ''}>{t[cl]}</a></li>"""
            for cl, ck, anchor in children
        )
        return f"""
                                            <li class="has-dropdown">
                                                <a href="{PAGES[key][lang]}" class="{active.strip()}">{t[label]} <i class="fa-solid fa-chevron-down" aria-hidden="true"></i></a>
                                                <ul class="submenu">{subs}
                                                </ul>
                                            </li>"""

    menu = "".join(item(*m) for m in MENU)
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
                                <img src="{BRAND['logo_dark_bg'][0]}" width="200" height="{round(200 * BRAND['logo_dark_bg'][2] / BRAND['logo_dark_bg'][1])}" alt="{logo_alt(lang)}">
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
                                    <img src="{BRAND['logo_header'][0]}" width="{BRAND['logo_header'][1]}" height="{BRAND['logo_header'][2]}" alt="{logo_alt(lang)}">
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
                        "yurt dışına aktarılmasına açık rıza veriyorum."),
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


def phones_html(office):
    return "<br>".join(f'<a href="tel:{tel}">{disp}</a>' for disp, tel in office["phones"])


def footer_offices(lang):
    out = ""
    for o in OFFICES:
        phones = (f"""
                            <li class="d-flex align-items-start">
                                <img src="assets/images/icon/phone-white.svg" width="20" height="20" alt="" aria-hidden="true">
                                <p>{phones_html(o)}</p>
                            </li>""" if o["phones"] else "")
        out += f"""
                <div class="col-lg-4 col-md-6">
                    <div class="footer-widget">
                        <h4 class="widget-title">{o['title'][lang]}</h4>
                        <ul class="list-unstyled contact-info">
                            <li class="d-flex align-items-start">
                                <img src="assets/images/icon/location-white.svg" width="20" height="20" alt="" aria-hidden="true">
                                <p><a href="{maps_link(o)}" target="_blank" rel="noopener">{'<br>'.join(o['lines'])}</a></p>
                            </li>{phones}
                        </ul>
                    </div>
                </div>"""
    return out


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
                            <img src="{BRAND['logo_dark_bg'][0]}" width="{BRAND['logo_dark_bg'][1]}" height="{BRAND['logo_dark_bg'][2]}" alt="{logo_alt(lang)}" loading="lazy">
                            <p>{t['tagline']}</p>
                        </div>
                    </div>
                </div>
            </div>
            <div class="row g-4">{footer_offices(lang)}
                <div class="col-12">
                    <div class="footer-widget footer-email">
                        <ul class="list-unstyled contact-info">
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
    <script src="{asset('assets/js/jquery-3.7.1.min.js')}"></script>
    <script src="{asset('assets/js/jquery.meanmenu.min.js')}"></script>
    <script src="{asset('assets/js/wow.min.js')}"></script>
    <script src="{asset('assets/js/main.js')}"></script>
</body>

</html>
"""


# Schema.org merkez adresi (build_rome.py Ankara ile değiştirir)
ORG_ADDRESS = {
    "@type": "PostalAddress",
    "streetAddress": "Meydan Grandstand, 6th Floor, Meydan Road, Nad Al Sheba",
    "addressLocality": "Dubai",
    "addressCountry": "AE",
}


def organization_schema(lang):
    c = COMPANY
    data = {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": c["name"],
        "url": SITE_URL,
        "logo": SITE_URL + BRAND["logo_png"],
        "image": SITE_URL + "assets/images/og-image.jpg",
        "email": c["email"],
        "telephone": c["phone_tel"],
        "description": DESCRIPTIONS["home"][lang],
        "parentOrganization": {"@type": "Organization", "name": c["group"]},
        "address": ORG_ADDRESS,
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
        "tr": ("Dubai merkezli Orphion Pharma; isimli hasta erişimi, kamu tedariki, pazar erişimi, regülasyon desteği "
               "ve yerel temsil ile yenilikçi ve nadir hastalık ilaçlarını Türkiye'deki hastalarla buluşturur."),
        "en": ("Dubai-headquartered Orphion Pharma connects innovative and rare disease medicines with patients in "
               "Türkiye through named patient access, institutional supply, market access, regulatory support and "
               "local representation."),
    },
    "about": {
        "tr": ("Orphion Pharma, ciddi ve nadir hastalıklarda yenilikçi tedavilere hasta erişimini hızlandıran "
               "uluslararası bir ilaç ve hasta erişim şirketidir. Bridging Innovation and Life."),
        "en": ("Orphion Pharma is an international pharmaceutical and patient-access company accelerating access "
               "to innovative therapies for serious and rare diseases. Bridging Innovation and Life."),
    },
    "contact": {
        "tr": ("Orphion Pharma ile iletişime geçin: Dubai merkez, Türkiye irtibat ofisi ve ABD ofisi. "
               "Hasta erişimi, tedarik ve Türkiye pazarına giriş talepleriniz için formu doldurun."),
        "en": ("Contact Orphion Pharma: Dubai headquarters, Türkiye liaison office and US outreach office. "
               "Reach us about patient access, supply and Turkish market entry."),
    },
    "privacy": {
        "tr": "Orphion Pharma KVKK aydınlatma metni ve çerez politikası.",
        "en": "Orphion Pharma privacy notice and cookie policy.",
    },
    "chairman": {
        "tr": "Orphion Pharma Yönetim Kurulu Başkanının mesajı.",
        "en": "A message from the Chairman of the Board of Orphion Pharma.",
    },
    "mission": {
        "tr": "Orphion Pharma'nın misyonu ve vizyonu: Türkiye ilaç pazarında uluslararası firmaların ilk adresi olmak.",
        "en": "Orphion Pharma's mission and vision: to be the first address for international companies in the Turkish pharmaceutical market.",
    },
    "hr": {
        "tr": "Orphion Pharma'da kariyer: özgeçmişinizi yükleyin, ekibimize katılın.",
        "en": "Careers at Orphion Pharma: upload your CV and join our team.",
    },
    "partners": {
        "tr": "Orphion Pharma partnerleri ve ürün portföyü. Ürünlerimiz hakkında bilgi almak için bize e-posta gönderin.",
        "en": "Orphion Pharma partners and product portfolio. Email us to learn more about our products.",
    },
}

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

HOME_INTRO = {
    "tr": ("Orphion Pharma, Orphion Group çatısı altında faaliyet gösteren, uluslararası ilaç firmalarının "
           "Türkiye pazarına erişimini kolaylaştırmayı misyon edinen, yenilikçi ve dinamik bir ilaç tedarik ve "
           "danışmanlık şirketidir. Global farmasötik çözümleri Türkiye'nin sağlık sektörüne entegre eden "
           "Orphion Pharma, hem devlet kurumlarına hem de özel sektöre yönelik çözümleri ile güvenilir bir iş ortağıdır."),
    "en": ("Orphion Pharma, operating under Orphion Group, is an innovative and dynamic pharmaceutical supply and "
           "consulting company whose mission is to facilitate international pharmaceutical companies' access to the "
           "Turkish market. Integrating global pharmaceutical solutions into Türkiye's healthcare sector, Orphion Pharma "
           "is a reliable business partner for both government institutions and the private sector."),
}


def home_about_text(lang):
    """Ana sayfadaki Hakkımızda özeti (Hakkımızda sayfasının giriş paragrafları)."""
    return ABOUT[lang]["intro"][0] + " " + ABOUT[lang]["intro"][1]


def legacy_home_body(lang):
    """Eski ana sayfa düzeni (iki iş kolu). Rome Pharma bunu kullanır."""
    tr = lang == "tr"
    intro = HOME_INTRO[lang]
    about_p = home_about_text(lang)
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
                                <h1 class="intro-title wow fadeInUp" data-wow-delay=".3s" lang="en">{BRAND['word']}
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
                                    <p class="title h2 wow fadeInUp" data-wow-delay=".6s">{BRAND['word']} <span class="color-text">Pharma</span></p>
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
                                    <img src="assets/images/about/aboutThumb3_1.webp" width="775" height="634" loading="lazy" alt="{COMPANY['name'] + ' ilaç tedarik ve danışmanlık hizmetleri' if tr else COMPANY['name'] + ' pharmaceutical supply and consulting services'}">
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
                                    <h2 class="title">{T[lang]['contact_us']} / <span class="color-text">{COMPANY['name']}</span></h2>
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


# Ana sayfa (Orphion): konumlandırma, kabiliyetler ve erişim akışı
HERO = {
    "tr": {
        "lead": ("Yenilikçi ilaçları; güvenilir hasta erişimi, regülasyon ve tedarik yollarıyla "
                 "Türkiye'deki hastalarla buluşturuyoruz."),
        "cta_partner": "Bizimle Çalışın",
        "cta_caps": "Hizmetlerimizi Keşfedin",
    },
    "en": {
        "lead": ("Connecting innovative medicines with patients through trusted access, "
                 "regulatory and supply pathways."),
        "cta_partner": "Partner With Us",
        "cta_caps": "Explore Our Capabilities",
    },
}

CAPABILITIES = [
    ("fa-user-doctor",
     {"tr": "İsimli Hasta Erişimi", "en": "Named Patient Access"},
     {"tr": "Türkiye'de ruhsatı bulunmayan yenilikçi ilaçların, isimli hasta (Yurt Dışı İlaç) programı üzerinden hastaya ulaştırılması.",
      "en": "Bringing innovative medicines not yet licensed in Türkiye to individual patients through the named patient pathway."}),
    ("fa-building-columns",
     {"tr": "Kamu ve Kurum Tedariki", "en": "Government & Institutional Supply"},
     {"tr": "Kamu kurumları, hastaneler ve ihaleler için mevzuata ve lojistik gerekliliklere uygun tedarik.",
      "en": "Compliant supply to public institutions, hospitals and tenders, backed by reliable logistics."}),
    ("fa-chart-line",
     {"tr": "Pazar Erişimi ve Geri Ödeme", "en": "Market Access & Reimbursement"},
     {"tr": "Fiyatlandırma, geri ödeme ve sürdürülebilir hasta erişimi için Türkiye'ye özel strateji.",
      "en": "Türkiye-specific strategy for pricing, reimbursement and sustainable patient access."}),
    ("fa-clipboard-check",
     {"tr": "Ruhsat ve Regülasyon Desteği", "en": "Regulatory Pathway Support"},
     {"tr": "Türk sağlık otoriteleri nezdinde, dokümantasyondan onaya kadar regülasyon sürecinde rehberlik.",
      "en": "Guidance through the Turkish regulatory pathway, from documentation to approval."}),
    ("fa-handshake",
     {"tr": "Münhasır Distribütörlük ve Yerel Temsil", "en": "Exclusive Distribution & Local Representation"},
     {"tr": "Üreticinin Türkiye'deki güvenilir yerel ortağı ve temsilcisi olarak hareket etmek.",
      "en": "Acting as the manufacturer's committed local partner and representative in Türkiye."}),
    ("fa-dna",
     {"tr": "Özel ve Nadir Hastalık İlaçları", "en": "Specialty & Rare Disease Medicines"},
     {"tr": "Erişimin en kritik olduğu özel ve nadir hastalık (orphan) tedavilerine odaklanma.",
      "en": "A focus on specialty and orphan therapies, where access matters most."}),
    ("fa-truck-medical",
     {"tr": "Üreticiden Hastaya Doğrudan Erişim", "en": "Direct Manufacturer-to-Patient Access"},
     {"tr": "Üreticiyi mevzuata uygun kanallarla doğrudan hastayla buluşturan erişim çözümleri.",
      "en": "Access solutions connecting manufacturers directly with patients through compliant channels."}),
]

ACCESS_FLOW = [
    ({"tr": "Hasta Erişimi", "en": "Patient Access"},
     {"tr": "İhtiyacı olan hastayı yenilikçi tedaviyle buluşturmak.", "en": "Connecting patients in need with innovative therapies."}),
    ({"tr": "Pazar Erişimi", "en": "Market Access"},
     {"tr": "Regülasyon, fiyatlandırma ve geri ödeme yolunu açmak.", "en": "Opening the regulatory, pricing and reimbursement pathway."}),
    ({"tr": "Tedarik", "en": "Supply"},
     {"tr": "Kurumlara ve hastalara güvenilir, kesintisiz tedarik.", "en": "Reliable, uninterrupted supply to institutions and patients."}),
    ({"tr": "Yerel Ortaklık", "en": "Local Partnership"},
     {"tr": "Uzun vadeli yerel temsil ve münhasır distribütörlük.", "en": "Long-term local representation and exclusive distribution."}),
]


# Katıldığımız uluslararası etkinlikler (fotoğraflar Orphion Pharma LinkedIn gönderilerinden)
EVENTS = [
    ("nacfc-2026-atlanta", "NACFC 2026", {"tr": "Atlanta, ABD", "en": "Atlanta, USA"},
     {"tr": "Kuzey Amerika Kistik Fibrozis Konferansı", "en": "North American Cystic Fibrosis Conference"}, "center"),
    ("cphi-milan-2026", "CPHI Milan 2026", {"tr": "Milano, İtalya", "en": "Milan, Italy"},
     {"tr": "Küresel ilaç endüstrisinin buluşma noktası", "en": "The global pharma industry's meeting point"}, "center bottom"),
    ("wodc-2026-boston", "World Orphan Drug Congress USA 2026", {"tr": "Boston, ABD", "en": "Boston, USA"},
     {"tr": "Nadir hastalıklar ve yetim ilaçlar kongresi", "en": "Rare diseases and orphan medicines congress"}, "center"),
    ("cphi-frankfurt-2025", "CPHI Frankfurt 2025", {"tr": "Frankfurt, Almanya", "en": "Frankfurt, Germany"},
     {"tr": "Yeni ortaklıklar ve yenilikçi tedaviler", "en": "New partnerships and innovative therapies"}, "center 40%"),
    ("nacfc-2025-seattle", "NACFC 2025", {"tr": "Seattle, ABD", "en": "Seattle, USA"},
     {"tr": "Kistik fibrozis ve nadir hastalık iş birlikleri", "en": "Cystic fibrosis and rare disease collaborations"}, "center 75%"),
]


def events_section(lang):
    tr = lang == "tr"
    cards = "".join(
        f"""
                <div class="event-card wow fadeInUp" data-wow-delay=".{3 + i % 3}s">
                    <img src="assets/images/events/{slug}.webp" alt="{COMPANY['name']} – {name}" loading="lazy" style="object-position: {pos}">
                    <div class="event-info">
                        <span class="event-place"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> {place[lang]}</span>
                        <h3 lang="en">{name}</h3>
                        <p>{desc[lang]}</p>
                    </div>
                </div>"""
        for i, (slug, name, place, desc, pos) in enumerate(EVENTS)
    )
    return f"""
    <!-- Events -->
    <section class="events-section section-padding fix">
        <div class="container">
            <div class="section-title text-center mxw-720 mx-auto">
                <p class="subtitle h6 wow fadeInUp" data-wow-delay=".3s">{'Küresel Varlığımız' if tr else 'Global Presence'}</p>
                <h2 class="title wow fadeInUp" data-wow-delay=".4s">{'Uluslararası <span class="color-text">etkinliklerimiz</span>' if tr else 'Where we <span class="color-text">meet the industry</span>'}</h2>
                <p class="desc wow fadeInUp" data-wow-delay=".5s">{'Bilimi, üreticileri ve hastaları buluşturan dünyanın önde gelen ilaç ve nadir hastalık etkinliklerinde yer alıyoruz.' if tr else 'We take part in the world’s leading pharmaceutical and rare disease events, where science, manufacturers and patient needs meet.'}</p>
            </div>
            <div class="events-grid">{cards}
            </div>
        </div>
    </section>
"""


def capabilities_section(lang):
    tr = lang == "tr"
    cards = "".join(
        f"""
                <div class="col-xl-3 col-lg-4 col-md-6">
                    <div class="capability-card wow fadeInUp" data-wow-delay=".{2 + i % 4}s">
                        <span class="capability-icon"><i class="fa-solid {icon}" aria-hidden="true"></i></span>
                        <h3>{title[lang]}</h3>
                        <p>{desc[lang]}</p>
                    </div>
                </div>"""
        for i, (icon, title, desc) in enumerate(CAPABILITIES)
    )
    steps = "".join(
        f"""
                <li class="access-step wow fadeInUp" data-wow-delay=".{3 + i}s">
                    <span class="step-no">{i + 1:02d}</span>
                    <h3>{title[lang]}</h3>
                    <p>{desc[lang]}</p>
                </li>"""
        for i, (title, desc) in enumerate(ACCESS_FLOW)
    )
    return f"""
    <!-- Capabilities -->
    <section class="capabilities-section section-padding fix" id="capabilities">
        <div class="container">
            <div class="section-title text-center mxw-720 mx-auto">
                <p class="subtitle h6 wow fadeInUp" data-wow-delay=".3s">{'Hizmetlerimiz' if tr else 'Our Capabilities'}</p>
                <h2 class="title wow fadeInUp" data-wow-delay=".4s">{'Türkiye’ye giriş ve <span class="color-text">hasta erişim platformu</span>' if tr else 'A Türkiye entry and <span class="color-text">patient access platform</span>'}</h2>
                <p class="desc wow fadeInUp" data-wow-delay=".5s">{'Yabancı bir ilaç firmasının ürününü Türkiye’de hastaya ulaştırması için gereken ticari, regülatuvar ve kurumsal köprüyü kuruyoruz.' if tr else 'We build the commercial, regulatory and institutional bridge an international manufacturer needs to bring its product to patients in Türkiye.'}</p>
            </div>
            <div class="row g-4 justify-content-center">{cards}
            </div>
            <ol class="access-flow list-unstyled" aria-label="{'Erişim akışı' if tr else 'Access pathway'}">{steps}
            </ol>
        </div>
    </section>
"""


def home_body(lang):
    tr = lang == "tr"
    h = HERO[lang]
    about_p = home_about_text(lang)
    return f"""
    <!-- Intro -->
    <section class="intro-section fix mbn-1-9em">
        <div class="intro-container-wrapper style3">
            <div class="container">
                <div class="intro-wrapper style3">
                    <div class="intro-up">
                        <div class="row">
                            <div class="col-xl-6">
                                <h1 class="intro-title wow fadeInUp" data-wow-delay=".3s" lang="en">{BRAND['word']}
                                    <span>PHARMA</span>
                                </h1>
                            </div>
                            <div class="col-xl-6">
                                <div class="intro-content mxw-720">
                                    <p class="hero-tagline wow fadeInUp" data-wow-delay=".4s" lang="en">{TAGLINE}</p>
                                    <p class="desc wow fadeInUp" data-wow-delay=".6s">{h['lead']}</p>
                                    <div class="hero-ctas wow fadeInUp" data-wow-delay=".7s">
                                        <a class="theme-btn" href="{PAGES['contact'][lang]}#contact-form">{h['cta_partner']}</a>
                                        <a class="theme-btn style-outline" href="#capabilities">{h['cta_caps']}</a>
                                    </div>
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
{marquee(lang)}{capabilities_section(lang)}{events_section(lang)}
    <!-- About -->
    <section class="about-section section-padding pt-0 fix">
        <div class="about-container-wrapper style3">
            <div class="container">
                <div class="about-wrapper style3">
                    <div class="row gy-5 gx-30 d-flex align-items-center">
                        <div class="col-xl-6">
                            <div class="about-content">
                                <div class="section-title mxw-705">
                                    <h2 class="subtitle h6 wow fadeInUp" data-wow-delay=".3s">{T[lang]['about']}</h2>
                                    <p class="title h2 wow fadeInUp" data-wow-delay=".6s">{BRAND['word']} <span class="color-text">Pharma</span></p>
                                    <p class="desc mxw-690 wow fadeInUp" data-wow-delay=".3s">{about_p}</p>
                                    <a class="theme-btn wow fadeInUp" data-wow-delay=".3s" href="{PAGES['about'][lang]}">{T[lang]['about']}</a>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-6 d-flex justify-content-center">
                            <div class="about-thumb">
                                <div class="main-thumb img-custom-anim-left wow fadeInUp" data-wow-delay=".3s">
                                    <img src="assets/images/about/aboutThumb3_1.webp" width="775" height="634" loading="lazy" alt="{COMPANY['name'] + ' hasta erişimi ve ilaç tedariki' if tr else COMPANY['name'] + ' patient access and pharmaceutical supply'}">
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
                                    <h2 class="title">{T[lang]['contact_us']} / <span class="color-text">{COMPANY['name']}</span></h2>
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


# Hakkımızda metni: Orphion_Hakkimizda_About_Us.docx
TAGLINE = "Bridging Innovation and Life."

ABOUT = {
    "tr": {
        "intro": [
            "Orphion Pharma, yenilikçi ve ihtiyaç duyulan tedavilerin hastalara erişimini hızlandırmak amacıyla çalışan uluslararası bir ilaç ve hasta erişim şirketidir.",
            "Özellikle karşılanmamış tıbbi ihtiyacın yüksek olduğu ciddi ve nadir hastalıklara odaklanıyor; dünyanın farklı noktalarında geliştirilen veya kullanıma sunulmuş tedaviler ile bu tedavilere ihtiyaç duyan hastalar arasındaki mesafeyi ortadan kaldırmak için çalışıyoruz.",
        ],
        "access_title": "Bizim için hasta erişimi yalnızca bir ilacın tedarik edilmesi değildir.",
        "access_text": "Bir tedavinin hastaya ulaşması; regülasyon, pazar erişimi, geri ödeme, fiyatlandırma, tedarik zinciri, lojistik ve yerel paydaş yönetiminin birlikte ve doğru şekilde yürütülmesini gerektirir.",
        "pillars": ["Regülasyon", "Pazar erişimi", "Geri ödeme", "Fiyatlandırma", "Tedarik zinciri", "Lojistik", "Yerel paydaş yönetimi"],
        "partner": [
            "Orphion, global ilaç ve biyoteknoloji şirketlerine bu yolculukta stratejik yerel ortak olarak eşlik eder.",
            "Pazar fırsatlarını ve karşılanmamış klinik ihtiyaçları değerlendiriyor; düzenleyici ve ticari erişim yollarını oluşturuyor; sağlık otoriteleri, geri ödeme kurumları, hekimler ve diğer paydaşlarla gerekli süreçleri yönetiyoruz. Uygun olduğunda Named Patient ve erken erişim programlarından kamu tedariklerine ve uzun vadeli pazara giriş stratejilerine kadar süreci uçtan uca destekliyoruz.",
        ],
        "more_title": "Tedarikten fazlası. Temsilcilikten fazlası.",
        "more": [
            "Her tedaviyi kendi klinik ihtiyacı, hasta popülasyonu, düzenleyici yolu ve pazar dinamikleri içerisinde değerlendiriyoruz.",
            "İş ortaklarımızın bilimsel ve ticari hedeflerini yerel sağlık sistemlerinin gerçekleriyle buluşturarak sürdürülebilir hasta erişimi oluşturmayı amaçlıyoruz.",
            "Türkiye'deki güçlü yerel yapılanmamızı Dubai'deki uluslararası operasyonlarımız ve Amerika Birleşik Devletleri'ndeki erişim ağımızla birleştirerek, dünyanın farklı noktalarındaki ilaç ve biyoteknoloji şirketleri ile yerel sağlık sistemleri arasında güvenilir bir köprü kuruyoruz.",
        ],
        "closing": "Çünkü bizim için inovasyonun gerçek değeri, yalnızca keşfedildiğinde veya geliştirildiğinde değil, ona ihtiyaç duyan insanın hayatına ulaştığında ortaya çıkar.",
        "why": "İşte Orphion'un varlık nedeni budur:",
        "img_alt": "Orphion Pharma: yenilikçi tedavilere hasta erişimi",
    },
    "en": {
        "intro": [
            "Orphion Pharma is an international pharmaceutical and patient-access company dedicated to accelerating access to innovative and needed therapies.",
            "We focus particularly on serious and rare diseases with significant unmet medical need, working to bridge the distance between treatments developed or made available around the world and the patients who need them.",
        ],
        "access_title": "For us, patient access goes far beyond the supply of a medicine.",
        "access_text": "Bringing a therapy to patients requires the successful integration of regulatory strategy, market access, reimbursement, pricing, supply chain, logistics and local stakeholder engagement.",
        "pillars": ["Regulatory strategy", "Market access", "Reimbursement", "Pricing", "Supply chain", "Logistics", "Local stakeholder engagement"],
        "partner": [
            "Orphion works alongside global pharmaceutical and biotechnology companies as a strategic local partner throughout this journey.",
            "We identify market opportunities and unmet clinical needs, establish regulatory and commercial access pathways, and engage with healthcare authorities, reimbursement bodies, physicians and other relevant stakeholders. Where appropriate, we support the entire pathway — from Named Patient and early-access programs to public procurement and long-term market-entry strategies.",
        ],
        "more_title": "More than supply. More than representation.",
        "more": [
            "We evaluate each therapy within the context of its clinical need, patient population, regulatory pathway and individual market dynamics.",
            "By connecting our partners' scientific and commercial objectives with the realities of local healthcare systems, we work to create sustainable patient access.",
            "Combining our strong local capabilities in Türkiye with our international operations in Dubai and our outreach network in the United States, we build trusted bridges between pharmaceutical and biotechnology innovators around the world and the healthcare systems where their therapies are needed.",
        ],
        "closing": "Because we believe the true value of innovation is realized not simply when it is discovered or developed, but when it reaches and makes a difference in the life of the person who needs it.",
        "why": "That is why Orphion exists.",
        "img_alt": "Orphion Pharma: patient access to innovative therapies",
    },
}


def about_body(lang):
    a = ABOUT[lang]
    intro = "".join(f'\n                                <p class="desc wow fadeInUp" data-wow-delay=".6s">{esc(p)}</p>' for p in a["intro"])
    partner = "".join(f'\n                        <p>{esc(p)}</p>' for p in a["partner"])
    more = "".join(f'\n                        <p>{esc(p)}</p>' for p in a["more"])
    pillars = "".join(
        f'\n                        <li><i class="fa-solid fa-check" aria-hidden="true"></i> {esc(p)}</li>' for p in a["pillars"]
    )
    return f"""{breadcrumb(lang, T[lang]['about'])}
    <!-- Intro -->
    <section class="about-section section-tight fix">
        <div class="about-container-wrapper style2">
            <div class="container">
                <div class="about-wrapper style2">
                    <div class="row gy-5 gx-30 d-flex align-items-center">
                        <div class="col-xl-6 order-2 order-xl-1">
                            <div class="about-content">
                                <div class="section-title mxw-705">
                                    <p class="subtitle h6 wow fadeInUp" data-wow-delay=".3s">{T[lang]['about']}</p>
                                    <h2 class="title wow fadeInUp" data-wow-delay=".4s" lang="en">Bridging <span class="color-text">Innovation</span> and Life.</h2>
                                </div>{intro}
                            </div>
                        </div>
                        <div class="col-xl-6 order-1 order-xl-2 d-flex justify-content-center">
                            <div class="about-thumb">
                                <div class="main-thumb img-custom-anim-left wow fadeInUp" data-wow-delay=".3s">
                                    <img src="assets/images/about/aboutThumb1_2.webp" width="570" height="502" alt="{a['img_alt']}">
                                </div>
                                <div class="shape" aria-hidden="true">
                                    <img src="assets/images/shape/aboutShape2_1.webp" width="845" height="347" alt="">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- Patient access -->
    <section class="section-tight access-band">
        <div class="container">
            <div class="row g-4 align-items-center">
                <div class="col-lg-6">
                    <h2 class="h3 access-title wow fadeInUp" data-wow-delay=".3s">{esc(a['access_title'])}</h2>
                    <p class="wow fadeInUp" data-wow-delay=".4s">{esc(a['access_text'])}</p>
                </div>
                <div class="col-lg-6">
                    <ul class="pillars list-unstyled wow fadeInUp" data-wow-delay=".4s">{pillars}
                    </ul>
                </div>
            </div>
            <div class="partner-role wow fadeInUp" data-wow-delay=".3s">{partner}
            </div>
        </div>
    </section>

    <!-- More than supply -->
    <section class="section-tight">
        <div class="container">
            <div class="more-than">
                <h2 class="title wow fadeInUp" data-wow-delay=".3s">{esc(a['more_title'])}</h2>
                <div class="wow fadeInUp" data-wow-delay=".4s">{more}
                </div>
            </div>
            <div class="about-closing wow fadeInUp" data-wow-delay=".3s">
                <p>{esc(a['closing'])}</p>
                <p class="why">{esc(a['why'])}</p>
                <p class="tagline" lang="en">{TAGLINE}</p>
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
    map_title = f"{c['name']} konum haritası" if tr else f"{c['name']} location map"

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
        info("mail", t["email"], f'<a href="mailto:{c["email"]}">{c["email"]}</a>')
        + info("phone", t["phone"], f'<a href="tel:{c["phone_tel"]}">{c["phone_display"]}</a><br>'
               f'<a href="{c["whatsapp"]}" target="_blank" rel="noopener">{t["whatsapp"]}</a>')
    )

    def office_card(o):
        phones = (f"""
                                <p class="office-phone"><i class="fa-solid fa-phone" aria-hidden="true"></i> <span>{phones_html(o)}</span></p>"""
                  if o["phones"] else "")
        return f"""
                <div class="col-lg-4 col-md-6">
                    <div class="office-card wow fadeInUp" data-wow-delay=".3s">
                        <h2 class="h4"><i class="fa-solid fa-building" aria-hidden="true"></i> {o['title'][lang]}</h2>
                        <p class="office-address"><i class="fa-solid fa-location-dot" aria-hidden="true"></i>
                            <span><a href="{maps_link(o)}" target="_blank" rel="noopener">{'<br>'.join(o['lines'])}</a></span></p>{phones}
                    </div>
                </div>"""

    offices = "".join(office_card(o) for o in OFFICES)

    return f"""{breadcrumb(lang, t['contact_us'])}
    <!-- Offices -->
    <section class="service-details-section section-tight-top">
        <div class="container">
            <div class="row g-4">{offices}
            </div>
        </div>
    </section>

    <!-- Contact -->
    <section class="service-details-section section-tight">
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
                    <div class="map-consent" data-map-src="{esc(maps_embed(MAIN_OFFICE))}" data-map-title="{map_title}">
                        <div>
                            <p><strong>{MAIN_OFFICE['title'][lang]}</strong></p>
                            <p>{map_text}</p>
                            <button type="button" class="theme-btn js-load-map">{map_btn}</button>
                            <p class="mt-3 mb-0"><a href="{maps_link(MAIN_OFFICE)}" target="_blank" rel="noopener">{map_link}</a></p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
"""


def office_lines(lang):
    """KVKK metnindeki adres satırları: merkez ve (varsa) Türkiye ofisi."""
    shown = [MAIN_OFFICE] + [o for o in OFFICES if o["key"] == "tr" and o is not MAIN_OFFICE]
    return "".join(f"{o['title'][lang]}: {', '.join(o['lines'])}<br>\n                " for o in shown).rstrip()


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
                {office_lines('tr')}
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
<!--hr--><tr><td>Özlük / iş başvurusu</td><td>İnsan Kaynakları formuyla gönderdiğiniz özgeçmiş (CV), eğitim ve iş deneyimi bilgileri, başvurulan pozisyon</td></tr><!--/hr-->
                        <tr><td>İşlem güvenliği</td><td>IP adresi, gönderim zamanı (kötüye kullanımı önlemek için)</td></tr>
                    </tbody>
                </table>

                <h2>3. İşleme Amaçları</h2>
                <ul>
                    <li>Talep, soru ve teklif isteklerinizin alınması, değerlendirilmesi ve yanıtlanması,</li>
                    <li>Olası iş birliği ve sözleşme süreçlerinin yürütülmesi,</li>
<!--hr--><li>İş başvurularının değerlendirilmesi ve işe alım süreçlerinin yürütülmesi,</li><!--/hr-->
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
                <p>Şirketimizin Dubai (Birleşik Arap Emirlikleri) ve ABD ofisleri bulunduğundan ve kullanılan e-posta /
                barındırma hizmetlerinin sunucuları yurt dışında olabileceğinden, kişisel verileriniz KVKK’nın 9. maddesi
                kapsamında yurt dışına aktarılabilir. Formlarımızda bu aktarım için açık rızanız alınmaktadır.</p>

                <h2>6. Saklama Süresi</h2>
                <p>Kişisel verileriniz, talebinizin sonuçlandırılması için gerekli süre ve ilgili mevzuatta öngörülen
                zamanaşımı süreleri boyunca saklanır; bu sürelerin sonunda silinir, yok edilir veya anonim hâle getirilir.
                <!--hr-->İş başvurusu kapsamında iletilen özgeçmişler, başvurunun sonuçlanmasından itibaren en fazla 2 yıl saklanır.<!--/hr-->
                Kötüye kullanımı önlemek için tutulan IP kayıtları en fazla 1 saat saklanır.</p>
                <!--hr--><p>Lütfen özgeçmişinizde sağlık, din, mezhep, dernek üyeliği, ceza mahkûmiyeti gibi özel nitelikli kişisel
                verilere ve fotoğrafa yer vermeyin.</p><!--/hr-->

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
                {office_lines('en')}
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
<!--hr--><tr><td>Job application</td><td>CV, education and work history, position applied for (via the Human Resources form)</td></tr><!--/hr-->
                        <tr><td>Security</td><td>IP address and time of submission (to prevent abuse)</td></tr>
                    </tbody>
                </table>

                <h2>3. Purposes</h2>
                <ul>
                    <li>Receiving, assessing and responding to your enquiries and quote requests,</li>
                    <li>Carrying out potential business cooperation and contract processes,</li>
<!--hr--><li>Evaluating job applications and running recruitment processes,</li><!--/hr-->
                    <li>Keeping the website and form secure and preventing spam and abuse,</li>
                    <li>Complying with legal obligations and requests from competent authorities.</li>
                </ul>

                <h2>4. Legal Bases and Collection Method</h2>
                <p>Your data is collected electronically through the contact form, email, phone and WhatsApp, and is
                processed on the following legal bases: performance or conclusion of a contract, compliance with legal
                obligations, our legitimate interests, and — where none of these apply — your explicit consent.</p>

                <h2>5. Transfers</h2>
                <p>Your data may be shared, only for the purposes above, with {c['group']} companies, our email and
                hosting providers, business partners and, on request, competent public authorities. As we have offices in
                Dubai (UAE) and the United States and our service providers' servers may be located abroad, your data may
                be transferred outside Türkiye. Your explicit consent for this transfer is obtained on our forms.</p>

                <h2>6. Retention</h2>
                <p>We keep your data for as long as necessary to handle your enquiry and for the statutory limitation
                periods, after which it is deleted, destroyed or anonymised. <!--hr-->CVs submitted with job applications are kept
                for up to 2 years after the application is concluded. <!--/hr-->IP records kept to prevent abuse are stored
                for no longer than 1 hour. <!--hr-->Please do not include special categories of personal data (health, religion,
                criminal records, etc.) or a photo in your CV.<!--/hr--></p>

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

    # İK sayfası yoksa iş başvurusuyla ilgili bölümleri çıkar
    import re
    if "hr" in PAGES:
        content = content.replace("<!--hr-->", "").replace("<!--/hr-->", "")
    else:
        content = re.sub(r"<!--hr-->.*?<!--/hr-->", "", content, flags=re.S)

    return f"""{breadcrumb(lang, title)}
    <section class="section-tight">
        <div class="container">
            <div class="legal-content">{content}
            </div>
        </div>
    </section>
"""


# ---------------------------------------------------------------------------

def mission_body(lang):
    tr = lang == "tr"
    if tr:
        vision_t, vision = "Vizyonumuz", (
            "Vizyonumuz, Türkiye ilaç pazarında iş birliği arayışında olan uluslararası firmaların ilk adresi olmak "
            "ve hastaların yeni orijinal ilaçlara ve daha iyi jenerik ilaçlara erişimini artırmaktır.")
        mission_t, mission = "Misyonumuz", (
            "Misyonumuz, Türkiye'de ilaç tedarik eden uluslararası firmalar ile Türk bürokrasisi ve ilaç tedarikçisi "
            "kurumlar arasında sürdürülebilir ilişkiler kurarak sinerji yaratmaktır.")
        quote = "“Türkiye’nin ilaç tedarikinde güvenilir markası.”"
    else:
        vision_t, vision = "Our Vision", (
            "Our vision is to become the first address for international companies seeking cooperation in the Turkish "
            "pharmaceutical market and to increase patients' access to new original medicines and better generics.")
        mission_t, mission = "Our Mission", (
            "Our mission is to create synergy by building sustainable relationships between international companies "
            "supplying pharmaceuticals in Türkiye and Turkish public authorities and pharmaceutical procurement institutions.")
        quote = "“The trusted brand in Türkiye’s pharmaceutical supply.”"
    return f"""{breadcrumb(lang, T[lang]['mission'])}
    <section class="section-tight">
        <div class="container">
            <div class="row g-4">
                <div class="col-lg-6">
                    <div class="mv-card wow fadeInUp" data-wow-delay=".3s">
                        <h2 class="h3">{vision_t}</h2>
                        <p>{vision}</p>
                    </div>
                </div>
                <div class="col-lg-6">
                    <div class="mv-card wow fadeInUp" data-wow-delay=".5s">
                        <h2 class="h3">{mission_t}</h2>
                        <p>{mission}</p>
                    </div>
                </div>
                <div class="col-12">
                    <div class="blog-details-section p-0">
                        <div class="blog-details"><div class="content">
                            <blockquote class="mb-0">
                                <p class="h5">{quote} ~{COMPANY['name']}</p>
                            </blockquote>
                        </div></div>
                    </div>
                </div>
            </div>
        </div>
    </section>
{marquee(lang, rows=1, extra_class=" section-padding1 pt-0")}"""


def chairman_body(lang):
    ch = CHAIRMAN
    paras = "".join(
        f"\n                        <p>{esc(p).replace(chr(10), '<br>')}</p>" for p in ch[lang]
    )
    sign = f"""
                        <p class="chairman-sign"><strong>{esc(ch['name'])}</strong><span>{esc(ch['role'])}</span><span>{COMPANY['name']}</span></p>"""
    if ch.get("photo"):
        photo_col = f"""
                <div class="col-lg-4 chairman-photo-col">
                    <img class="chairman-photo" src="{ch['photo']}" width="720" height="{CHAIRMAN_PHOTO_H}" alt="{esc(ch['name'])}, {esc(ch['role'])}">
                    <p class="chairman-caption"><strong>{esc(ch['name'])}</strong><span>{esc(ch['role'])}</span></p>
                </div>"""
        text_cls = "col-lg-8"
    else:
        photo_col, text_cls = "", "col-lg-10 col-xl-9 mx-auto"
    return f"""{breadcrumb(lang, T[lang]['chairman'])}
    <section class="section-tight">
        <div class="container">
            <div class="row g-4 align-items-start">{photo_col}
                <div class="{text_cls}">
                    <div class="legal-content chairman-text">{paras}{sign}
                    </div>
                </div>
            </div>
        </div>
    </section>
"""


def hr_form(lang):
    privacy = PAGES["privacy"][lang]
    if lang == "tr":
        lbl = {
            "name": "Ad Soyad", "email": "E-posta", "phone": "Telefon", "position": "Başvurulan pozisyon (isteğe bağlı)",
            "message": "Ön yazı (isteğe bağlı)", "cv": "Özgeçmiş (CV) yükleyin", "cv_hint": "PDF, DOC veya DOCX · en fazla 5 MB",
            "consent": (f'<a href="{privacy}" target="_blank" rel="noopener">KVKK Aydınlatma Metni</a>’ni okudum. '
                        "İş başvurumun değerlendirilmesi amacıyla özgeçmişimdeki kişisel verilerin işlenmesine ve "
                        "yurt dışına aktarılmasına açık rıza veriyorum."),
            "send": "BAŞVURUYU GÖNDER", "hp": "Bu alanı boş bırakın",
            "success": "Teşekkürler! Başvurunuz bize ulaştı. Uygun bir pozisyon olduğunda sizinle iletişime geçeceğiz.",
        }
    else:
        lbl = {
            "name": "Full Name", "email": "Email", "phone": "Phone", "position": "Position applied for (optional)",
            "message": "Cover letter (optional)", "cv": "Upload your CV", "cv_hint": "PDF, DOC or DOCX · max 5 MB",
            "consent": (f'I have read the <a href="{privacy}" target="_blank" rel="noopener">Privacy Notice</a> and '
                        "consent to the personal data in my CV being processed and transferred abroad in order to "
                        "evaluate my application."),
            "send": "SUBMIT APPLICATION", "hp": "Leave this field empty",
            "success": "Thank you! Your application has been received. We will contact you when a suitable position opens.",
        }
    return f"""
                        <form class="row gy-3 js-contact-form" action="contact.php" method="post" enctype="multipart/form-data" novalidate data-success="{esc(lbl['success'])}">
                            <input type="hidden" name="lang" value="{lang}">
                            <input type="hidden" name="form" value="hr">
                            <input type="hidden" name="ts" value="">
                            <div class="hp-field" aria-hidden="true">
                                <label for="hr-website">{lbl['hp']}</label>
                                <input type="text" id="hr-website" name="website" tabindex="-1" autocomplete="off">
                            </div>
                            <div class="col-md-6">
                                <label class="sr-only" for="hr-name">{lbl['name']}</label>
                                <input type="text" id="hr-name" name="name" placeholder="{lbl['name']} *" autocomplete="name" minlength="2" maxlength="100" required>
                            </div>
                            <div class="col-md-6">
                                <label class="sr-only" for="hr-email">{lbl['email']}</label>
                                <input type="email" id="hr-email" name="email" placeholder="{lbl['email']} *" autocomplete="email" maxlength="200" required>
                            </div>
                            <div class="col-md-6">
                                <label class="sr-only" for="hr-phone">{lbl['phone']}</label>
                                <input type="tel" id="hr-phone" name="phone" placeholder="{lbl['phone']} *" autocomplete="tel" maxlength="40" required>
                            </div>
                            <div class="col-md-6">
                                <label class="sr-only" for="hr-position">{lbl['position']}</label>
                                <input type="text" id="hr-position" name="position" placeholder="{lbl['position']}" maxlength="150">
                            </div>
                            <div class="col-12">
                                <label class="sr-only" for="hr-message">{lbl['message']}</label>
                                <textarea id="hr-message" name="message" placeholder="{lbl['message']}" rows="4" maxlength="5000"></textarea>
                            </div>
                            <div class="col-12 cv-field">
                                <label class="cv-upload" for="hr-cv">
                                    <i class="fa-solid fa-upload" aria-hidden="true"></i>
                                    <span class="cv-label">{lbl['cv']} *</span>
                                    <span class="cv-hint">{lbl['cv_hint']}</span>
                                    <span class="cv-name" aria-live="polite"></span>
                                </label>
                                <input type="file" id="hr-cv" name="cv" class="cv-input" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required>
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


def hr_body(lang):
    tr = lang == "tr"
    if tr:
        h2 = 'Ekibimize <span class="color-text">katılın</span>'
        paras = [
            "Orphion Pharma olarak, uluslararası ilaç firmalarının Türkiye pazarına erişimini kolaylaştıran ekibimizi "
            "alanında yetkin, çözüm odaklı ve gelişime açık profesyonellerle büyütüyoruz.",
            "Açık pozisyonlarımız veya ileride oluşabilecek fırsatlar için özgeçmişinizi aşağıdaki formdan "
            "yükleyebilirsiniz. Başvurunuz İnsan Kaynakları ekibimiz tarafından değerlendirilecektir.",
        ]
        form_title = "Başvuru Formu"
    else:
        h2 = 'Join <span class="color-text">our team</span>'
        paras = [
            "At Orphion Pharma we are growing the team that helps international pharmaceutical companies access the "
            "Turkish market, with competent, solution-oriented professionals who are eager to grow.",
            "Upload your CV using the form below for current openings or future opportunities. "
            "Your application will be reviewed by our Human Resources team.",
        ]
        form_title = "Application Form"
    text = "".join(f'\n                        <p class="desc">{p}</p>' for p in paras)
    return f"""{breadcrumb(lang, T[lang]['hr'])}
    <section class="section-tight">
        <div class="container">
            <div class="row g-4">
                <div class="col-lg-5">
                    <div class="section-title">
                        <p class="subtitle h6">{T[lang]['hr']}</p>
                        <h2 class="title">{h2}</h2>{text}
                    </div>
                </div>
                <div class="col-lg-7" id="application-form">
                    <div class="contact-form contact-page-form">
                        <h2 class="h3 mb-4"><i class="fa-solid fa-briefcase" aria-hidden="true"></i> {form_title}</h2>{hr_form(lang)}
                    </div>
                </div>
            </div>
        </div>
    </section>
"""


def partners_body(lang):
    from urllib.parse import quote
    tr = lang == "tr"
    c = COMPANY
    if tr:
        intro = ("Orphion Pharma, dünyanın önde gelen ilaç firmaları ile iş birliği yapmaktadır. Partnerlerimizin "
                 "ürünlerini doğrudan tedarik programları, devlet ihaleleri ve Yurt Dışı İlaç Programı kapsamında "
                 "Türkiye'deki hastalara ulaştırıyoruz.")
        pf_title = 'Ürün <span class="color-text">Portföyümüz</span>'
        pf_text = ("Partnerlerimizin ürün portföyü ve ürünlerin temin süreçleri hakkında detaylı bilgi almak için "
                   "bize e-posta gönderin; ekibimiz en kısa sürede size dönüş yapacaktır.")
        pf_btn = "Bilgi almak için e-posta gönderin"
        subject = "Ürün portföyü hakkında bilgi talebi"
    else:
        intro = ("Orphion Pharma collaborates with leading pharmaceutical companies worldwide. We bring our partners' "
                 "products to patients in Türkiye through direct supply programs, government tenders and the "
                 "Named Patient Program.")
        pf_title = 'Our Product <span class="color-text">Portfolio</span>'
        pf_text = ("Email us for detailed information about our partners' product portfolio and supply processes; "
                   "our team will get back to you shortly.")
        pf_btn = "Email us for information"
        subject = "Product portfolio information request"
    logos = ""
    if PARTNERS:
        items = "".join(
            f"""
                <div class="col-6 col-md-4 col-lg-3">
                    <{'a href="' + esc(p['url']) + '" target="_blank" rel="noopener"' if p.get('url') else 'div'} class="partner-logo">
                        <img src="{p['logo']}" alt="{esc(p['name'])}" loading="lazy">
                    </{'a' if p.get('url') else 'div'}>
                </div>"""
            for p in PARTNERS
        )
        logos = f"""
            <div class="row g-4 mt-2">{items}
            </div>"""
    return f"""{breadcrumb(lang, T[lang]['partners'])}
    <section class="section-tight-top">
        <div class="container">
            <div class="section-title mxw-720">
                <p class="subtitle h6">{T[lang]['partners']}</p>
                <p class="desc">{intro}</p>
            </div>{logos}
        </div>
    </section>

    <section class="section-tight" id="portfolio">
        <div class="container">
            <div class="portfolio-cta wow fadeInUp" data-wow-delay=".3s">
                <h2 class="title">{pf_title}</h2>
                <p>{pf_text}</p>
                <a class="theme-btn" href="mailto:{c['email']}?subject={quote(subject)}"><i class="fa-solid fa-envelope" aria-hidden="true"></i> {pf_btn}</a>
                <p class="mt-3 mb-0"><a href="mailto:{c['email']}">{c['email']}</a></p>
            </div>
        </div>
    </section>
"""


TITLES = {
    "home": {
        "tr": "Orphion Pharma | Türkiye'de Yenilikçi İlaçlara Hasta ve Pazar Erişimi",
        "en": "Orphion Pharma | Patient & Market Access for Innovative Medicines in Türkiye",
    },
    "about": {"tr": "Hakkımızda | Orphion Pharma", "en": "About Us | Orphion Pharma"},
    "contact": {"tr": "İletişim | Orphion Pharma", "en": "Contact | Orphion Pharma"},
    "privacy": {"tr": "KVKK Aydınlatma Metni ve Çerez Politikası | Orphion Pharma",
                "en": "Privacy Notice & Cookie Policy | Orphion Pharma"},
}

TITLES.update({
    "chairman": {"tr": "YK Başkanının Mesajı | Orphion Pharma", "en": "Message from the Chairman | Orphion Pharma"},
    "mission": {"tr": "Misyon ve Vizyon | Orphion Pharma", "en": "Mission & Vision | Orphion Pharma"},
    "hr": {"tr": "İnsan Kaynakları | Orphion Pharma", "en": "Human Resources | Orphion Pharma"},
    "partners": {"tr": "Partnerlerimiz ve Ürün Portföyümüz | Orphion Pharma",
                 "en": "Our Partners & Product Portfolio | Orphion Pharma"},
})

BODIES = {"home": home_body, "about": about_body, "contact": contact_body, "privacy": privacy_body,
          "chairman": chairman_body, "mission": mission_body, "hr": hr_body, "partners": partners_body}


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
