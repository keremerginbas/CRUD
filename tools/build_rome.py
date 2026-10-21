#!/usr/bin/env python3
"""
Rome Pharma statik site üreticisi.

Orphion Pharma üreticisini (build_site.py) Rome Pharma'nın marka ayarları,
metinleri ve iletişim bilgisiyle çalıştırır. İletişim kısmı (ofisler, telefonlar)
Orphion ile birebir aynıdır; e-posta olarak yalnızca fevziaydin@rome-pharma.com
kullanılır.

Kullanım:
    python3 tools/build_rome.py

Çıktı: rome-pharma/ (sunucuya olduğu gibi yüklenir)
Ortak dosyalar (CSS, JS, fontlar, contact.php, .htaccess) her çalıştırmada
orphion-pharma/ klasöründen kopyalanıp Rome'a uyarlanır; böylece Orphion'da
yapılan bir düzeltme Rome'a da geçer.
"""

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_site as b  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "orphion-pharma"
DST = REPO / "rome-pharma"

EMAIL = "fevziaydin@rome-pharma.com"
MAIL_FROM = "no-reply@romepharma.com"


def sync_shared_files():
    """Ortak dosyaları Orphion'dan kopyala ve Rome'a uyarla."""
    for d in ("assets/css", "assets/js", "assets/fonts"):
        shutil.rmtree(DST / d, ignore_errors=True)
        shutil.copytree(SRC / d, DST / d)
    for f in (".htaccess", ".user.ini", "contact.php"):
        shutil.copy2(SRC / f, DST / f)

    def patch(path, pairs):
        p = DST / path
        s = p.read_text(encoding="utf-8")
        for old, new in pairs:
            assert old in s, f"{path}: bulunamadı: {old}"
            s = s.replace(old, new)
        p.write_text(s, encoding="utf-8")

    # Rome'un kendi renkleri (eski Rome sitesindeki main.css değerleri)
    patch("assets/css/main.css", [
        ("--theme: #EE7A33;", "--theme: #2DCE98;"),
        ("--theme2: #FF914B;", "--theme2: #00A6ED;"),
        ("--title: #1E2A44;", "--title: #1B3A57;"),
        ("--bg-3: #EEF2F8;", "--bg-3: #D9E2EC;"),
    ])
    patch("assets/css/custom.css", [("Orphion Pharma - site özel stilleri", "Rome Pharma - site özel stilleri")])
    patch("assets/js/main.js", [
        ("Orphion Pharma - main.js", "Rome Pharma - main.js"),
        ('"orphion_lang"', '"rome_lang"'),
        ('"orphion_cookie_consent"', '"rome_cookie_consent"'),
        ("info@orphionpharma.com", EMAIL),
    ])
    patch("contact.php", [
        ("Orphion Pharma - iletişim formu işleyicisi", "Rome Pharma - iletişim formu işleyicisi"),
        ("const MAIL_TO      = 'fevziaydin@orphionpharma.com';", f"const MAIL_TO      = '{EMAIL}';"),
        ("const MAIL_FROM    = 'no-reply@orphionpharma.com';", f"const MAIL_FROM    = '{MAIL_FROM}';"),
        ("'From: Orphion Pharma Web <'", "'From: Rome Pharma Web <'"),
        ("info@orphionpharma.com", EMAIL),
    ])


# ---------------------------------------------------------------------------
# Marka ve sayfa ayarları
# ---------------------------------------------------------------------------

b.ROOT = DST
b.SITE_URL = "https://romepharma.com/"
b.BRAND = {
    "word": "Rome",
    "theme_color": "#2DCE98",
    "logo_header": ("assets/images/rome-logo.webp", 220, 126),
    "logo_dark_bg": ("assets/images/rome-logo-white.webp", 300, 172),
    "logo_png": "assets/images/rome-logo.png",
}
b.COMPANY = dict(b.COMPANY, name="Rome Pharma", group="Rome Group", email=EMAIL)
b.CHAIRMAN = None

# Rome'da yalnızca bu sayfalar var (Kurumsal alt sayfaları Orphion'a özel)
b.PAGES = {k: v for k, v in b.PAGES.items() if k in ("home", "about", "contact", "privacy")}
b.MENU = [
    ("home", "home", []),
    ("about", "about", []),
    ("contact", "contact", []),
]

b.HOME_INTRO = {
    "tr": ("Rome Pharma, Rome Group çatısı altında faaliyet gösteren, uluslararası ilaç firmalarının Türkiye "
           "pazarına erişimini kolaylaştırmayı misyon edinen, yenilikçi ve dinamik bir ilaç tedarik ve danışmanlık "
           "şirketidir. Global farmasötik çözümleri Türkiye'nin sağlık sektörüne entegre eden Rome Pharma, hem devlet "
           "kurumlarına hem de özel sektöre yönelik çözümleri ile güvenilir bir iş ortağıdır."),
    "en": ("Rome Pharma, operating under Rome Group, is an innovative and dynamic pharmaceutical supply and consulting "
           "company whose mission is to facilitate international pharmaceutical companies' access to the Turkish market. "
           "Integrating global pharmaceutical solutions into Türkiye's healthcare sector, Rome Pharma is a reliable "
           "business partner for both government institutions and the private sector."),
}

ROME_ABOUT = {
    "tr": {
        "h2": 'Yenilikçi ilaçlara erişimi kolaylaştırarak <span class="color-text">hastaların umudu oluyoruz.</span>',
        "p1": ("Rome Pharma, Rome Group'un bir parçası olarak, uluslararası markaların Türkiye ilaç pazarına "
               "erişimini kolaylaştırmaya odaklanmış genç ve dinamik bir şirkettir."),
        "p2": "Rome Pharma iki ana iş koluna sahiptir:",
        "vision_t": "Vizyonumuz",
        "vision": ("Vizyonumuz, Türkiye ilaç pazarında iş birliği arayışında olan uluslararası firmaların ilk adresi "
                   "olmak ve hastaların yeni orijinal ilaçlara ve daha iyi jenerik ilaçlara erişimini artırmaktır."),
        "mission_t": "Misyonumuz",
        "mission": ("Misyonumuz, Türkiye'de ilaç tedarik eden uluslararası firmalar ile Türk bürokrasisi ve ilaç "
                    "tedarikçisi kurumlar arasında sürdürülebilir ilişkiler kurarak sinerji yaratmaktır."),
        "quote": "“Türkiye’nin ilaç tedarikinde güvenilir markası.”",
        "why_t": 'Neden <span lang="en">Rome Pharma</span>?',
        "why": ("Rome Pharma, dünyanın önde gelen ilaç firmaları ile iş birliği yapmaktadır. Güvenilirliğimiz ve "
                "profesyonelliğimiz sayesinde, uluslararası firmaların Türkiye pazarına sorunsuz bir şekilde giriş "
                "yapmasını sağlıyoruz."),
        "img_alt": "Rome Pharma ilaç tedarik süreçleri",
    },
    "en": {
        "h2": 'We become the hope of patients by <span class="color-text">facilitating access to innovative medicines.</span>',
        "p1": ("Rome Pharma, as part of Rome Group, is a young and dynamic company focused on facilitating "
               "international brands' access to the Turkish pharmaceutical market."),
        "p2": "Rome Pharma has two main business lines:",
        "vision_t": "Our Vision",
        "vision": ("Our vision is to become the first address for international companies seeking cooperation in the "
                   "Turkish pharmaceutical market and to increase patients' access to new original medicines and "
                   "better generics."),
        "mission_t": "Our Mission",
        "mission": ("Our mission is to create synergy by building sustainable relationships between international "
                    "companies supplying pharmaceuticals in Türkiye and local institutions and pharmaceutical suppliers."),
        "quote": "“The trusted brand in Türkiye’s pharmaceutical supply.”",
        "why_t": "Why Rome Pharma?",
        "why": ("Rome Pharma collaborates with leading pharmaceutical companies around the world. Thanks to our "
                "reliability and professionalism, we help international companies enter the Turkish market smoothly."),
        "img_alt": "Rome Pharma pharmaceutical supply processes",
    },
}


def home_about_text(lang):
    return ROME_ABOUT[lang]["p1"]


def about_body(lang):
    a = ROME_ABOUT[lang]
    lines = "".join(
        f'\n                                        <li><i class="fa-solid fa-check" aria-hidden="true"></i>{l}</li>'
        for l in b.BUSINESS_LINES[lang]
    )
    return f"""{b.breadcrumb(lang, b.T[lang]['about'])}
    <!-- About -->
    <section class="about-section section-tight fix">
        <div class="about-container-wrapper style2">
            <div class="container">
                <div class="about-wrapper style2">
                    <div class="row gy-5 gx-30 d-flex align-items-center">
                        <div class="col-xl-6 order-2 order-xl-1">
                            <div class="about-content">
                                <div class="section-title mxw-705">
                                    <p class="subtitle h6 wow fadeInUp" data-wow-delay=".3s">{b.T[lang]['about']}</p>
                                    <h2 class="title wow fadeInUp" data-wow-delay=".4s">{a['h2']}</h2>
                                </div>
                                <p class="desc wow fadeInUp" data-wow-delay=".5s">{a['p1']}</p>
                                <div class="business-lines wow fadeInUp" data-wow-delay=".5s">
                                    <h3>{a['p2']}</h3>
                                    <ul class="list-unstyled">{lines}
                                    </ul>
                                </div>
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

    <!-- Vision & Mission -->
    <section class="section-tight access-band">
        <div class="container">
            <div class="row g-4">
                <div class="col-lg-6">
                    <div class="mv-card bg-white wow fadeInUp" data-wow-delay=".3s">
                        <h2 class="h3">{a['vision_t']}</h2>
                        <p>{a['vision']}</p>
                    </div>
                </div>
                <div class="col-lg-6">
                    <div class="mv-card bg-white wow fadeInUp" data-wow-delay=".5s">
                        <h2 class="h3">{a['mission_t']}</h2>
                        <p>{a['mission']}</p>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- Why -->
    <section class="section-tight">
        <div class="container">
            <div class="more-than">
                <h2 class="title wow fadeInUp" data-wow-delay=".3s">{a['why_t']}</h2>
                <p class="wow fadeInUp" data-wow-delay=".4s">{a['why']}</p>
            </div>
            <div class="about-closing wow fadeInUp" data-wow-delay=".3s">
                <p class="tagline">{a['quote']}</p>
                <p class="why mb-0">~{b.COMPANY['name']}</p>
            </div>
        </div>
    </section>
{b.marquee(lang, rows=1, extra_class=" section-padding1 pt-0")}"""


b.home_about_text = home_about_text
b.BODIES = dict(b.BODIES, home=b.legacy_home_body, about=about_body)

# Rome: Ankara merkez ofis, ardından Dubai ve ABD
_offices = {o["key"]: o for o in b.OFFICES}
b.OFFICES = [
    dict(_offices["tr"], title={"tr": "Merkez Ofis", "en": "Main Office"}),
    dict(_offices["dubai"], title={"tr": "Dubai Ofisi", "en": "Dubai Office"}),
    _offices["us"],
]
b.MAIN_OFFICE = b.OFFICES[0]
b.ORG_ADDRESS = {
    "@type": "PostalAddress",
    "streetAddress": "Kızılırmak Mahallesi Dumlupınar Bulvarı, NEXT LEVEL İş Merkezi A Blok No:3/108 Kat:23",
    "addressLocality": "Çankaya",
    "addressRegion": "Ankara",
    "addressCountry": "TR",
}

b.DESCRIPTIONS = dict(b.DESCRIPTIONS)
b.DESCRIPTIONS.update({
    "home": {
        "tr": ("Rome Pharma; uluslararası ilaç firmalarının Türkiye pazarına erişimi için ilaç tedariki, devlet "
               "ihaleleri, Yurt Dışı İlaç Programı ve pazara giriş danışmanlığı sunan bir tedarik ve danışmanlık şirketidir."),
        "en": ("Rome Pharma is a pharmaceutical supply and consulting company helping international pharmaceutical "
               "companies access the Turkish market through direct supply, government tenders, named patient programs "
               "and market entry consulting."),
    },
    "about": {
        "tr": "Rome Pharma hakkında: Rome Group çatısı altında ilaç tedariki ve Türkiye ilaç pazarına giriş danışmanlığı. Vizyonumuz ve misyonumuz.",
        "en": "About Rome Pharma: pharmaceutical supply and Turkish market entry consulting under Rome Group. Our vision and mission.",
    },
    "contact": {
        "tr": "Rome Pharma ile iletişime geçin: Ankara merkez ofis, Dubai ve ABD ofislerimiz, e-posta ve iletişim formu.",
        "en": "Contact Rome Pharma: our Ankara main office, Dubai and US offices, email and contact form.",
    },
    "privacy": {
        "tr": "Rome Pharma KVKK aydınlatma metni ve çerez politikası.",
        "en": "Rome Pharma privacy notice and cookie policy.",
    },
})
b.TITLES = {
    "home": {"tr": "Rome Pharma | Türkiye İlaç Tedariki ve Pazar Danışmanlığı",
             "en": "Rome Pharma | Pharmaceutical Supply & Turkish Market Consulting"},
    "about": {"tr": "Hakkımızda | Rome Pharma", "en": "About Us | Rome Pharma"},
    "contact": {"tr": "İletişim | Rome Pharma", "en": "Contact | Rome Pharma"},
    "privacy": {"tr": "KVKK Aydınlatma Metni ve Çerez Politikası | Rome Pharma",
                "en": "Privacy Notice & Cookie Policy | Rome Pharma"},
}


if __name__ == "__main__":
    sync_shared_files()
    b.main()
