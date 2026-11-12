#!/usr/bin/env python3
"""
Orphion Pharma ve Rome Pharma siteleri - v3 (şablonsuz, sıfırdan tasarım).

Kullanım:
    python3 tools/build_v3.py            # iki siteyi de üretir
    python3 tools/build_v3.py orphion    # yalnızca orphion-pharma/
    python3 tools/build_v3.py rome       # yalnızca rome-pharma/

İçerik (metinler, ofisler, etkinlikler, KVKK metni) build_site.py ve
build_rome.py içindeki verilerden okunur; tasarım tools/v3/ altındadır.
Sayfa dosya adları eski siteyle aynıdır, arama motoru kayıtları bozulmaz.
"""
import hashlib
import html
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote, quote_plus

TOOLS = Path(__file__).resolve().parent
REPO = TOOLS.parent
V3 = TOOLS / "v3"
sys.path.insert(0, str(TOOLS))

BRAND_KEY = sys.argv[1] if len(sys.argv) > 1 else "all"
if BRAND_KEY == "all":
    for key in ("orphion", "rome"):
        subprocess.run([sys.executable, __file__, key], check=True)
    sys.exit(0)

if BRAND_KEY == "rome":
    import build_rome as r  # build_site modülünü Rome için uyarlar
    s = r.b
else:
    import build_site as s
    r = None

ROOT = s.ROOT
C = s.COMPANY
LANGS = ("tr", "en")


def esc(x):
    return html.escape(str(x), quote=True)


# ---------------------------------------------------------------------------
# Marka ayarları
# ---------------------------------------------------------------------------

TOKENS = {
    "orphion": {
        "ink": "#16213A", "ink-deep": "#0F1729", "navy": "#1E2A44",
        "accent": "#FF914B", "accent-hover": "#FFA466", "accent-on": "#16213A", "accent-ink": "#B4501A",
        "paper": "#FFFFFF", "mist": "#F1F4F8", "line": "#DCE3EC",
        "text": "#334155", "muted": "#5D6B7E", "on-dark": "#C4CEDD", "on-dark-muted": "#8A97AB",
        "map-dot": "rgba(196, 206, 221, .24)", "focus-ring": "rgba(255, 145, 75, .35)",
    },
    "rome": {
        "ink": "#0F2A40", "ink-deep": "#0A1E2F", "navy": "#1B3A57",
        "accent": "#2DCE98", "accent-hover": "#52DBAE", "accent-on": "#0F2A40", "accent-ink": "#0E7A57",
        "paper": "#FFFFFF", "mist": "#EEF5F6", "line": "#D6E3E8",
        "text": "#2F4153", "muted": "#58697A", "on-dark": "#BFD0DC", "on-dark-muted": "#86A0B3",
        "map-dot": "rgba(191, 208, 220, .24)", "focus-ring": "rgba(45, 206, 152, .35)",
    },
}[BRAND_KEY]

LOGO = {
    "orphion": {"header": ("assets/images/orphion-logo.webp", 289, 125),
                "footer": ("assets/images/orphion-logo-white.webp", 702, 280)},
    "rome": {"header": ("assets/images/rome-logo.webp", 220, 126),
             "footer": ("assets/images/rome-logo-white.webp", 300, 172)},
}[BRAND_KEY]

# Korunacak görseller (eski assets klasöründen)
KEEP_IMAGES = [
    "assets/images/orphion-logo.webp", "assets/images/orphion-logo-white.webp", "assets/images/orphion-logo.png",
    "assets/images/rome-logo.webp", "assets/images/rome-logo-white.webp", "assets/images/rome-logo.png",
    "assets/images/favicon-32.png", "assets/images/fav-icon.png", "assets/images/apple-touch-icon.png",
    "assets/images/og-image.jpg", "assets/images/chairman-fevzi-aydin.webp",
    "assets/images/bg/hero-medicines.webp", "assets/images/bg/hero-medicines-sm.webp",
]

# Sayfalar (dosya adları eski siteyle aynı; Orphion'a Hizmetler eklendi)
PAGES = dict(s.PAGES)
if BRAND_KEY == "orphion":
    PAGES["services"] = {"tr": "hizmetler.html", "en": "services-en.html"}

EVENTS = s.EVENTS if BRAND_KEY == "orphion" else []


def page_url(key, lang):
    name = PAGES[key][lang]
    return s.SITE_URL if name == "index.html" else s.SITE_URL + name


def href(key, lang, anchor=""):
    return PAGES[key][lang] + anchor


# ---------------------------------------------------------------------------
# Arayüz metinleri
# ---------------------------------------------------------------------------

UI = {
    "tr": {
        "home": "Ana Sayfa", "company": "Kurumsal", "about": "Hakkımızda", "chairman": "Başkanın Mesajı",
        "mission": "Misyon ve Vizyon", "hr": "İnsan Kaynakları", "services": "Hizmetlerimiz",
        "events": "Etkinlikler", "partners": "Partnerler", "partners_page": "Partnerlerimiz",
        "portfolio": "Ürün Portföyümüz", "contact": "İletişim", "cta": "Bizimle Çalışın",
        "skip": "İçeriğe geç", "menu": "Menü", "lang": "Dil seçimi",
        "whatsapp": "WhatsApp ile yazın", "email": "E-posta", "phone": "Telefon", "hours": "Çalışma saatleri",
        "hours_v": "Pazartesi–Cuma, 09.00–18.00",
        "rights": "Tüm hakları saklıdır.", "privacy": "KVKK Aydınlatma Metni", "cookies": "Çerez ayarları",
        "cookie_text": ("Bu sitede yalnızca dil ve çerez tercihinizi hatırlamak için tarayıcınızda zorunlu kayıtlar "
                        "tutulur. İzin verirseniz ziyaret istatistikleri için analitik çerezler de kullanılır. "
                        'Ayrıntılar: <a href="kvkk.html#cerezler">KVKK ve Çerez Politikası</a>.'),
        "cookie_accept": "Kabul et", "cookie_reject": "Yalnızca zorunlu",
        "logo_alt": "{} logosu", "all_events": "Tüm etkinlikler", "read_more": "Devamını okuyun",
        "prev_event": "Önceki etkinlik", "next_event": "Sonraki etkinlik",
        "year": "Yıl", "place": "Konum", "focus": "Odak",
    },
    "en": {
        "home": "Home", "company": "Company", "about": "About Us", "chairman": "Chairman's Message",
        "mission": "Mission & Vision", "hr": "Careers", "services": "Capabilities",
        "events": "Events", "partners": "Partners", "partners_page": "Our Partners",
        "portfolio": "Product Portfolio", "contact": "Contact", "cta": "Partner With Us",
        "skip": "Skip to content", "menu": "Menu", "lang": "Language",
        "whatsapp": "Chat on WhatsApp", "email": "Email", "phone": "Phone", "hours": "Working hours",
        "hours_v": "Monday–Friday, 09:00–18:00",
        "rights": "All rights reserved.", "privacy": "Privacy Notice", "cookies": "Cookie settings",
        "cookie_text": ("This site only stores your language and cookie preferences in your browser. With your "
                        "permission we also use analytics cookies to measure visits. "
                        'Details: <a href="privacy-en.html#cookies">Privacy &amp; Cookie Policy</a>.'),
        "cookie_accept": "Accept", "cookie_reject": "Essential only",
        "logo_alt": "{} logo", "all_events": "All events", "read_more": "Read more",
        "prev_event": "Previous event", "next_event": "Next event",
        "year": "Year", "place": "Location", "focus": "Focus",
    },
}
if BRAND_KEY == "rome":
    UI["tr"]["cta"] = "İletişime Geçin"
    UI["en"]["cta"] = "Get in Touch"


# ---------------------------------------------------------------------------
# İkonlar (çizgi ikonlar, 24x24)
# ---------------------------------------------------------------------------

ICON_PATHS = {
    "pin": '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    "mail": '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    "phone": ('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 '
              '4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3'
              'a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>'),
    "clock": '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    "upload": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    "chev": '<path d="m6 9 6 6 6-6"/>',
    "chat": ('<path d="M3 21l1.7-4.6A9 9 0 1 1 8 19.7Z"/><path d="M9.2 8.6c.3-.6.9-.7 1.2-.2l.7 1.3c.2.3.1.7-.2 '
             '1l-.5.5a5.5 5.5 0 0 0 2.4 2.4l.5-.5c.3-.3.7-.4 1-.2l1.3.7c.5.3.4.9-.2 1.2-.9.6-2 .6-3-.1a9.5 9.5 0 0 1-3-3c-.7-1-.7-2.1-.2-3.1Z"/>'),
    "stethoscope": ('<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 12 0V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/>'
                    '<path d="M8 15v1a6 6 0 0 0 12 0v-4"/><circle cx="20" cy="10" r="2"/>'),
    "landmark": ('<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/>'
                 '<path d="M18 18v-7"/><path d="m12 2 8 5H4Z"/>'),
    "chart": '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
    "clipboard": ('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 '
                  '2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>'),
    "handshake": ('<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.9-3.9a3 3 0 0 0-4.2 '
                  '0l-.9.9a1 1 0 1 1-3-3l2.8-2.8a5.8 5.8 0 0 1 7.1-.9l.5.3a2 2 0 0 0 1.4.2L21 4"/>'
                  '<path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>'),
    "dna": ('<path d="M2 15c6.7-1 11.4-6.6 12-13"/><path d="M22 9c-6.7 1-11.4 6.6-12 13"/><path d="m10 16 1.5 1.5"/>'
            '<path d="m14 8-1.5-1.5"/><path d="m16.5 10.5 1 1"/><path d="m6.5 13.5 1 1"/><path d="m17 6-2.9-2.9"/>'
            '<path d="m7 18 2.9 2.9"/>'),
    "truck": ('<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/>'
              '<path d="M19 18h2a1 1 0 0 0 1-1v-3.6a1 1 0 0 0-.2-.6l-3.5-4.4a1 1 0 0 0-.8-.4H14"/>'
              '<circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>'),
    "pill": ('<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>'),
}
FA_TO_ICON = {
    "fa-user-doctor": "stethoscope", "fa-building-columns": "landmark", "fa-chart-line": "chart",
    "fa-clipboard-check": "clipboard", "fa-handshake": "handshake", "fa-dna": "dna", "fa-truck-medical": "truck",
}


def icon(name):
    return ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
            f'stroke-linejoin="round" aria-hidden="true" focusable="false">{ICON_PATHS[name]}</svg>')


# ---------------------------------------------------------------------------
# Varlıklar (CSS, JS, fontlar, görseller)
# ---------------------------------------------------------------------------

def prepare_output():
    """Eski şablon dosyalarını temizle; gerekli görselleri ve sunucu dosyalarını koru."""
    keep = {}
    for rel in KEEP_IMAGES:
        p = ROOT / rel
        if p.exists():
            keep[rel] = p.read_bytes()
    events_dir = ROOT / "assets/images/events"
    if events_dir.exists():
        for p in events_dir.iterdir():
            keep[f"assets/images/events/{p.name}"] = p.read_bytes()
    shutil.rmtree(ROOT / "assets", ignore_errors=True)
    for p in ROOT.glob("*.html"):
        p.unlink()
    for rel, data in keep.items():
        dst = ROOT / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(data)
    # Rome'un ilaç görseli Orphion'dan
    if BRAND_KEY == "rome":
        src = REPO / "orphion-pharma/assets/images/bg"
        for name in ("hero-medicines.webp", "hero-medicines-sm.webp"):
            if (src / name).exists():
                dst = ROOT / "assets/images/bg" / name
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src / name, dst)
    fonts = ROOT / "assets/fonts"
    fonts.mkdir(parents=True, exist_ok=True)
    for f in (V3 / "fonts").glob("*.woff2"):
        shutil.copy2(f, fonts / f.name)
    css_dir = ROOT / "assets/css"
    css_dir.mkdir(parents=True, exist_ok=True)
    tokens = ":root {\n" + "".join(f"  --{k}: {v};\n" for k, v in TOKENS.items()) + (
        '  --sans: "Schibsted Grotesk", "Helvetica Neue", Arial, sans-serif;\n'
        '  --serif: "Source Serif 4", Georgia, "Times New Roman", serif;\n}\n\n')
    fonts_css = (V3 / "fonts.css").read_text(encoding="utf-8").replace("font-weight: 400 700;", "font-weight: 400 900;")
    (css_dir / "site.css").write_text(fonts_css + "\n" + tokens + (V3 / "site.css").read_text(encoding="utf-8"),
                                      encoding="utf-8")
    js_dir = ROOT / "assets/js"
    js_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(V3 / "site.js", js_dir / "site.js")


def asset(path):
    digest = hashlib.md5((ROOT / path).read_bytes()).hexdigest()[:8]
    return f"{path}?v={digest}"


# ---------------------------------------------------------------------------
# Erişim haritası (ana sayfa girişi)
# ---------------------------------------------------------------------------

MAP = json.loads((TOOLS / "orphion_map.json").read_text(encoding="utf-8"))
P = MAP["pts"]

if BRAND_KEY == "orphion":
    HUB = ("ankara", {"tr": "Türkiye", "en": "Türkiye"})
    SOURCES = [  # (nokta, etiket, tür, etiket konumu)
        ("seattle", "Seattle", "event", "above"),
        ("boston", "Boston", "event", "above"),
        ("atlanta", "Atlanta", "event", "below"),
        ("ohio", "Ohio", "office", "left"),
        ("frankfurt", "Frankfurt", "event", "above"),
        ("milan", "Milano/Milan", "event", "left"),
        ("dubai", "Dubai", "hq", "below"),
    ]
else:
    HUB = ("ankara", {"tr": "Ankara", "en": "Ankara"})
    SOURCES = [
        ("boston", "Boston", "event", "above"),
        ("ohio", "Ohio", "office", "below"),
        ("frankfurt", "Frankfurt", "event", "above"),
        ("milan", "Milano/Milan", "event", "left"),
        ("dubai", "Dubai", "office", "below"),
    ]


def hero_map(lang):
    hx, hy = P[HUB[0]]
    arcs, nodes, labels = [], [], []
    for i, (key, label, kind, pos) in enumerate(SOURCES):
        x, y = P[key]
        dist = ((hx - x) ** 2 + (hy - y) ** 2) ** .5
        cx, cy = (x + hx) / 2, min(y, hy) - dist * 0.28
        delay = 0.35 + i * 0.22
        cls = "map-arc office" if kind in ("office", "hq") else "map-arc"
        arcs.append(f'<path class="{cls}" pathLength="1" style="animation-delay:{delay:.2f}s" '
                    f'd="M{x} {y}Q{cx:.1f} {cy:.1f} {hx} {hy}"/>')
        r_ = 4.2 if kind == "hq" else 3.2
        node_cls = "map-node map-hub" if kind == "hq" else ("map-node" if kind == "office" else "map-node event")
        nodes.append(f'<circle class="{node_cls}" style="animation-delay:{delay - .2:.2f}s" cx="{x}" cy="{y}" r="{r_}"/>')
        text = label.split("/")[0 if lang == "tr" else -1]
        dx, dy, anchor = {"above": (0, -11, "middle"), "below": (0, 20, "middle"), "left": (-9, 4, "end")}[pos]
        labels.append(f'<text class="map-label" style="animation-delay:{delay:.2f}s" x="{x + dx}" y="{y + dy}" '
                      f'text-anchor="{anchor}">{esc(text)}</text>')
    total = 0.35 + len(SOURCES) * 0.22 + 1.2
    hub = (f'<circle class="map-ring" cx="{hx}" cy="{hy}" r="6"/>'
           f'<circle class="map-node map-hub" style="animation-delay:{total - .4:.2f}s" cx="{hx}" cy="{hy}" r="6.5"/>'
           f'<text class="map-label hub" style="animation-delay:{total - .3:.2f}s" x="{hx + 12}" y="{hy - 10}">'
           f'{esc(HUB[1][lang])}</text>')
    return (f'<div class="hero-map" aria-hidden="true"><svg viewBox="190 70 730 230" role="presentation">'
            f'<path class="map-land" d="{MAP["d"]}"/>{"".join(arcs)}{"".join(nodes)}{hub}{"".join(labels)}'
            f'</svg></div>')


# ---------------------------------------------------------------------------
# Sayfa iskeleti
# ---------------------------------------------------------------------------

def nav_items(lang):
    u = UI[lang]
    if BRAND_KEY == "orphion":
        return [
            ("company", None, [("about", u["about"]), ("chairman", u["chairman"]), ("mission", u["mission"]),
                               ("hr", u["hr"])]),
            ("services", u["services"], None),
            ("events", u["events"], None),
            ("partners", None, [("partners", u["partners_page"]), ("partners#portfolio", u["portfolio"])]),
            ("contact", u["contact"], None),
        ]
    return [("home", u["home"], None), ("about", u["about"], None), ("contact", u["contact"], None)]


def link_of(spec, lang):
    key, _, anchor = spec.partition("#")
    return href(key, lang, "#" + anchor if anchor else "")


def header(page, lang):
    u = UI[lang]
    other = "en" if lang == "tr" else "tr"
    items = []
    for key, label, children in nav_items(lang):
        if children:
            current = any(c.split("#")[0] == page for c, _ in children) or (key == "events" and page.startswith("event-"))
            sub = "".join(
                f'<li><a href="{link_of(c, lang)}"{" aria-current=\"page\"" if c == page else ""}>{esc(l)}</a></li>'
                for c, l in children)
            items.append(
                f'<li class="nav-item{" is-current" if current else ""}">'
                f'<button class="nav-parent" type="button" aria-expanded="false">{esc(u[key])}'
                f'<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">'
                f'{ICON_PATHS["chev"]}</svg></button><ul class="submenu">{sub}</ul></li>')
        else:
            cur = page == key or (key == "events" and page.startswith("event-"))
            items.append(f'<li><a href="{href(key, lang)}"{" aria-current=\"page\"" if cur else ""}>{esc(label)}</a></li>')
    items.append(f'<li class="mobile-cta"><a class="btn" href="{href("contact", lang, "#contact-form")}">{esc(u["cta"])}</a></li>')
    logo, w, h = LOGO["header"]
    return f"""
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="{href('home', lang)}"><img src="{logo}" width="{w}" height="{h}" alt="{esc(u['logo_alt'].format(C['name']))}"></a>
    <nav class="main-nav" aria-label="{esc(u['menu'])}">
      <ul>{''.join(items)}</ul>
    </nav>
    <div class="header-tools">
      <div class="lang-switch" role="group" aria-label="{esc(u['lang'])}">
        <a href="{PAGES[page]['tr']}" hreflang="tr" lang="tr"{' aria-current="true"' if lang == 'tr' else ''}>TR</a>
        <a href="{PAGES[page]['en']}" hreflang="en" lang="en"{' aria-current="true"' if lang == 'en' else ''}>EN</a>
      </div>
      <a class="btn" href="{href('contact', lang, '#contact-form')}">{esc(u['cta'])}</a>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-label="{esc(u['menu'])}"><span></span></button>
    </div>
  </div>
</header>"""


def phones_html(o):
    return "".join(f'<a href="tel:{tel}">{esc(disp)}</a>' for disp, tel in o["phones"])


def maps_link(o):
    return "https://www.google.com/maps/search/?api=1&query=" + quote_plus(o["maps_query"])


def offices_html(lang, cls="offices"):
    out = []
    for i, o in enumerate(s.OFFICES):
        phones = f'<div class="phones">{phones_html(o)}</div>' if o["phones"] else ""
        out.append(f"""
      <li class="office{' hq' if i == 0 else ''}">
        <h3>{esc(o['title'][lang])}</h3>
        <address><a href="{maps_link(o)}" target="_blank" rel="noopener">{'<br>'.join(esc(l) for l in o['lines'])}</a></address>{phones}
      </li>""")
    return f'<ul class="{cls}">{"".join(out)}\n    </ul>'


def footer(lang):
    u = UI[lang]
    logo, w, h = LOGO["footer"]
    tagline = s.TAGLINE if BRAND_KEY == "orphion" else s.T[lang]["tagline"]
    links = [("about", u["about"]), ("contact", u["contact"])]
    if BRAND_KEY == "orphion":
        links = [("about", u["about"]), ("services", u["services"]), ("events", u["events"]),
                 ("partners", u["partners_page"]), ("hr", u["hr"]), ("contact", u["contact"])]
    links_html = "".join(f'<li><a href="{href(k, lang)}">{esc(l)}</a></li>' for k, l in links)
    return f"""
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-top">
      <div class="footer-brand">
        <img src="{logo}" width="{w}" height="{h}" alt="{esc(u['logo_alt'].format(C['name']))}" loading="lazy">
        <p class="tagline"{' lang="en"' if BRAND_KEY == 'orphion' else ''}>{esc(tagline)}</p>
        <p><a href="mailto:{C['email']}">{C['email']}</a><br><a href="tel:{C['phone_tel']}">{C['phone_display']}</a></p>
        <ul class="footer-links">{links_html}</ul>
      </div>
      {offices_html(lang)}
    </div>
    <div class="footer-bottom">
      <p>© <span data-current-year>2026</span> {esc(C['name'])}. {u['rights']}</p>
      <nav aria-label="{esc(u['privacy'])}">
        <a href="{href('privacy', lang)}">{esc(u['privacy'])}</a>
        <button type="button" class="js-cookie-settings">{esc(u['cookies'])}</button>
      </nav>
    </div>
  </div>
</footer>
<a class="wa-float" href="{C['whatsapp']}" target="_blank" rel="noopener" aria-label="{esc(u['whatsapp'])}">{icon('chat')}</a>
<div class="cookie-banner" role="dialog" aria-live="polite" aria-label="{esc(u['cookies'])}">
  <p>{u['cookie_text']}</p>
  <div class="cookie-actions"><button type="button" class="accept">{esc(u['cookie_accept'])}</button><button type="button" class="reject">{esc(u['cookie_reject'])}</button></div>
</div>
<script src="{asset('assets/js/site.js')}" defer></script>"""


def head(page, lang, title, desc, extra=""):
    other = "en" if lang == "tr" else "tr"
    og = s.SITE_URL + s.OG_IMAGES.get(page, "assets/images/og-image.jpg") if hasattr(s, "OG_IMAGES") else s.SITE_URL + "assets/images/og-image.jpg"
    return f"""<!DOCTYPE html>
<html lang="{lang}" data-storage="{BRAND_KEY}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<meta name="theme-color" content="{TOKENS['ink']}">
<link rel="canonical" href="{page_url(page, lang)}">
<link rel="alternate" hreflang="{lang}" href="{page_url(page, lang)}">
<link rel="alternate" hreflang="{other}" href="{page_url(page, other)}">
<link rel="alternate" hreflang="x-default" href="{page_url(page, 'en')}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{esc(C['name'])}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{page_url(page, lang)}">
<meta property="og:image" content="{og}">
<meta property="og:locale" content="{'tr_TR' if lang == 'tr' else 'en_US'}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" sizes="32x32" href="assets/images/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="assets/images/fav-icon.png">
<link rel="apple-touch-icon" href="assets/images/apple-touch-icon.png">
<link rel="preload" href="assets/fonts/schibsted-normal-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="{asset('assets/css/site.css')}">{extra}
</head>"""


def render(page, lang, body):
    u = UI[lang]
    title = TITLES[page][lang]
    desc = DESCRIPTIONS[page][lang]
    extra = s.organization_schema(lang) if page == "home" else ""
    return (head(page, lang, title, desc, extra) + f'\n<body>\n<a class="skip-link" href="#main">{u["skip"]}</a>'
            + header(page, lang) + f'\n<main id="main">{body}\n</main>' + footer(lang) + "\n</body>\n</html>\n")


def page_hero(lang, title, lead="", crumbs=(), extra=""):
    u = UI[lang]
    trail = [(href("home", lang), u["home"])] + list(crumbs)
    crumb_html = "".join(f'<li><a href="{h}">{esc(l)}</a></li>' for h, l in trail) + f'<li aria-current="page">{esc(title)}</li>'
    lead_html = f'<p class="lead">{lead}</p>' if lead else ""
    return f"""
<section class="page-hero">
  <div class="wrap">
    <ol class="crumbs">{crumb_html}</ol>
    <h1>{esc(title)}</h1>{lead_html}{extra}
  </div>
</section>"""


# ---------------------------------------------------------------------------
# Formlar
# ---------------------------------------------------------------------------

def field(fid, name, label, kind="input", required=True, full=False, opt_text="", attrs=""):
    req = " required" if required else ""
    opt = f' <span class="opt">{opt_text}</span>' if opt_text else ""
    ctrl = (f'<textarea id="{fid}" name="{name}"{req}{attrs}></textarea>' if kind == "textarea"
            else f'<input type="{kind}" id="{fid}" name="{name}"{req}{attrs}>')
    return f'<div class="field{" full" if full else ""}"><label for="{fid}">{label}{opt}</label>{ctrl}</div>'


def contact_form(lang):
    tr = lang == "tr"
    opt = "(isteğe bağlı)" if tr else "(optional)"
    privacy = href("privacy", lang)
    consent = (f'<a href="{privacy}" target="_blank" rel="noopener">KVKK Aydınlatma Metni</a>’ni okudum. Talebimin '
               "yanıtlanması amacıyla kişisel verilerimin işlenmesine ve yurt dışına aktarılmasına açık rıza veriyorum."
               if tr else
               f'I have read the <a href="{privacy}" target="_blank" rel="noopener">Privacy Notice</a> and consent to my '
               "personal data being processed and transferred abroad in order to respond to my enquiry.")
    return f"""
<form class="form js-contact-form" action="contact.php" method="post" novalidate>
  <input type="hidden" name="lang" value="{lang}"><input type="hidden" name="ts" value="">
  <div class="hp-field" aria-hidden="true"><label for="cf-website">Website</label><input type="text" id="cf-website" name="website" tabindex="-1" autocomplete="off"></div>
  {field("cf-name", "name", "Ad Soyad" if tr else "Full name", attrs=' autocomplete="name" minlength="2" maxlength="100"')}
  {field("cf-email", "email", "E-posta" if tr else "Email", "email", attrs=' autocomplete="email" maxlength="200"')}
  {field("cf-phone", "phone", "Telefon" if tr else "Phone", "tel", False, opt_text=opt, attrs=' autocomplete="tel" maxlength="40"')}
  {field("cf-company", "company", "Firma" if tr else "Company", "text", False, opt_text=opt, attrs=' autocomplete="organization" maxlength="150"')}
  {field("cf-message", "message", "Mesajınız" if tr else "Your message", "textarea", True, True, attrs=' minlength="5" maxlength="5000"')}
  <label class="consent full"><input type="checkbox" name="kvkk_consent" value="1" required><span>{consent}</span></label>
  <div class="full"><button class="btn dark" type="submit">{'Mesajı gönder' if tr else 'Send message'}</button><div class="form-status" role="status" aria-live="polite"></div></div>
</form>"""


def hr_form(lang):
    tr = lang == "tr"
    opt = "(isteğe bağlı)" if tr else "(optional)"
    privacy = href("privacy", lang)
    consent = (f'<a href="{privacy}" target="_blank" rel="noopener">KVKK Aydınlatma Metni</a>’ni okudum. İş başvurumun '
               "değerlendirilmesi amacıyla özgeçmişimdeki kişisel verilerin işlenmesine ve yurt dışına aktarılmasına açık "
               "rıza veriyorum." if tr else
               f'I have read the <a href="{privacy}" target="_blank" rel="noopener">Privacy Notice</a> and consent to the '
               "personal data in my CV being processed and transferred abroad in order to evaluate my application.")
    success = ("Teşekkürler! Başvurunuz bize ulaştı. Uygun bir pozisyon olduğunda sizinle iletişime geçeceğiz." if tr else
               "Thank you! Your application has been received. We will contact you when a suitable position opens.")
    return f"""
<form class="form js-contact-form" action="contact.php" method="post" enctype="multipart/form-data" novalidate data-success="{esc(success)}">
  <input type="hidden" name="lang" value="{lang}"><input type="hidden" name="form" value="hr"><input type="hidden" name="ts" value="">
  <div class="hp-field" aria-hidden="true"><label for="hr-website">Website</label><input type="text" id="hr-website" name="website" tabindex="-1" autocomplete="off"></div>
  {field("hr-name", "name", "Ad Soyad" if tr else "Full name", attrs=' autocomplete="name" minlength="2" maxlength="100"')}
  {field("hr-email", "email", "E-posta" if tr else "Email", "email", attrs=' autocomplete="email" maxlength="200"')}
  {field("hr-phone", "phone", "Telefon" if tr else "Phone", "tel", attrs=' autocomplete="tel" maxlength="40"')}
  {field("hr-position", "position", "Başvurduğunuz pozisyon" if tr else "Position", "text", False, opt_text=opt, attrs=' maxlength="150"')}
  {field("hr-message", "message", "Ön yazı" if tr else "Cover letter", "textarea", False, True, opt_text=opt, attrs=' maxlength="5000"')}
  <div class="cv-field full">
    <label class="cv-upload" for="hr-cv">{icon('upload')}<strong>{'Özgeçmişinizi (CV) yükleyin' if tr else 'Upload your CV'}</strong><span class="hint">{'PDF, DOC veya DOCX, en fazla 5 MB' if tr else 'PDF, DOC or DOCX, up to 5 MB'}</span><span class="cv-name" aria-live="polite"></span></label>
    <input type="file" id="hr-cv" name="cv" class="cv-input" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required>
  </div>
  <label class="consent full"><input type="checkbox" name="kvkk_consent" value="1" required><span>{consent}</span></label>
  <div class="full"><button class="btn dark" type="submit">{'Başvuruyu gönder' if tr else 'Submit application'}</button><div class="form-status" role="status" aria-live="polite"></div></div>
</form>"""


# ---------------------------------------------------------------------------
# Orphion içerikleri
# ---------------------------------------------------------------------------

SERVICES = {
    "tr": [
        ("named-patient",
         "Türkiye'de henüz ruhsatı ya da erişimi olmayan bir tedavi, isimli hasta (Yurt Dışı İlaç) yoluyla hekimin talebiyle tek tek hastalara ulaştırılabilir.",
         "Bu süreci üreticiler adına yönetiyoruz: hekim ve hastaneyle koordinasyondan ithalat belgelerine, tedarikten tedavinin yapılacağı merkeze teslimata kadar.",
         ["Hekim ve hastane koordinasyonu", "İthalat belgeleri ve izin süreçleri", "Tedarik ve tedavi merkezine teslimat"]),
        ("institutional",
         "Kamu kurumlarına ve hastanelere, devlet ihaleleri dahil olmak üzere ilaç tedarik ediyoruz.",
         "İhale dokümantasyonu, sözleşme ve teslimat takvimini yerel mevzuata uygun şekilde yürütüyor, üreticinin Türkiye'deki muhatabı oluyoruz.",
         ["İhale hazırlığı ve başvuru", "Sözleşme ve teslimat takibi", "Kamu alım mevzuatına uyum"]),
        ("market-access",
         "Türkiye'de kalıcı erişim, fiyat onayı ve geri ödemeye bağlıdır.",
         "Ürününüz için fırsatı ve karşılanmamış ihtiyacı birlikte değerlendiriyor, fiyatlandırma ve geri ödeme stratejisini kurup ilgili kurumlarla süreci yürütüyoruz.",
         ["Pazar ve karşılanmamış ihtiyaç analizi", "Fiyatlandırma stratejisi", "Geri ödeme başvurusuna destek"]),
        ("regulatory",
         "Türkiye'nin düzenleyici yolunu, otoritenin beklediği belgelerden onaya ve sonrasındaki yükümlülüklere kadar sizinle birlikte yürüyoruz.",
         "Hangi yolun ürününüze uygun olduğunu belirliyor, dosya hazırlığını destekliyor ve otoriteyle iletişimi koordine ediyoruz.",
         ["Uygun düzenleyici yolun belirlenmesi", "Dosya hazırlığına destek", "Otoriteyle iletişim"]),
        ("distribution",
         "Türkiye'de uzun vadeli bir varlık isteyen ortaklarımız için münhasır distribütör ve yerel temsilci olarak çalışıyoruz.",
         "Ticari ve operasyonel sorumluluğu üstleniyor; hekimler, kurumlar ve tedarik zinciri paydaşlarıyla ilişkiyi yerinde yönetiyoruz.",
         ["Münhasır distribütörlük", "Yerel temsil ve paydaş ilişkileri", "Tedarik zinciri yönetimi"]),
        ("rare-disease",
         "Odağımız, az sayıda tedavi seçeneğinin bulunduğu ve her hastanın önemli olduğu ciddi ve nadir hastalıklar.",
         "Küçük hasta grupları kendine özgü erişim modelleri gerektirir; çalışmalarımızı tam da bu alanda yoğunlaştırıyoruz.",
         ["Nadir hastalık ve yetim (orphan) ilaçlar", "Özel tedaviler", "Hasta grubuna göre erişim modeli"]),
        ("direct-access",
         "Üreticiyi, mevzuata uygun kanallar üzerinden doğrudan hastayla ve tedavi merkeziyle buluşturuyoruz.",
         "Aracı adımları azaltarak tedavinin üretimden hastaya ulaşma süresini kısaltmayı hedefliyoruz.",
         ["Mevzuata uygun doğrudan erişim kanalları", "Tedavi merkezleriyle koordinasyon", "Daha kısa erişim süresi"]),
    ],
    "en": [
        ("named-patient",
         "When a therapy is not yet licensed or available in Türkiye, the named patient pathway allows a physician to request it for an individual patient.",
         "We manage this pathway on behalf of manufacturers: from coordination with the physician and hospital to import documentation, supply and delivery to the treating centre.",
         ["Physician and hospital coordination", "Import documentation and permits", "Supply and delivery to the treating centre"]),
        ("institutional",
         "We supply medicines to public institutions and hospitals, including through government tenders.",
         "We handle tender documentation, contracting and delivery schedules in line with local rules, acting as the manufacturer's counterpart in Türkiye.",
         ["Tender preparation and submission", "Contract and delivery follow-up", "Compliance with public procurement rules"]),
        ("market-access",
         "Sustainable access in Türkiye depends on price approval and reimbursement.",
         "We assess the opportunity and the unmet need for your product with you, build the pricing and reimbursement strategy and take it through the relevant institutions.",
         ["Market and unmet-need assessment", "Pricing strategy", "Reimbursement application support"]),
        ("regulatory",
         "We walk Türkiye's regulatory pathway with you, from the documentation the authority expects to approval and the obligations that follow.",
         "We identify the right pathway for your product, support dossier preparation and coordinate communication with the authority.",
         ["Choosing the right regulatory pathway", "Dossier preparation support", "Communication with the authority"]),
        ("distribution",
         "For partners who want a long-term presence in Türkiye, we act as exclusive distributor and local representative.",
         "We take on commercial and operational responsibility and manage relationships with physicians, institutions and supply chain partners on the ground.",
         ["Exclusive distribution", "Local representation and stakeholder relations", "Supply chain management"]),
        ("rare-disease",
         "Our focus is serious and rare diseases, where few treatment options exist and every patient counts.",
         "Small patient populations need access models of their own, and that is where we concentrate our work.",
         ["Rare disease and orphan medicines", "Specialty therapies", "Access models built around the patient group"]),
        ("direct-access",
         "We connect manufacturers directly with patients and treating centres through compliant channels.",
         "By removing intermediate steps, we aim to shorten the time it takes a therapy to travel from production to the patient.",
         ["Compliant direct access channels", "Coordination with treating centres", "Shorter time to access"]),
    ],
}

HOME = {
    "tr": {
        "caps_h": "Türkiye'ye giriş ve hasta erişimi için tek ortak",
        "caps_p": "Yabancı bir ilaç firmasının ürününü Türkiye'de hastaya ulaştırması için gereken ticari, regülatuvar ve kurumsal köprüyü kuruyoruz.",
        "caps_link": "Hizmetlerimizi inceleyin",
        "path_h": "Bilimden hastaya giden yol",
        "path_p": "Bir tedavinin hastaya ulaşması dört aşamada ilerler. Her birinde ortaklarımızın yanındayız.",
        "quote_link": "Başkanın mesajını okuyun",
        "events_h": "Sektörle buluştuğumuz yerler",
        "events_p": "Kistik fibrozisten nadir hastalıklara, dünyanın önde gelen ilaç etkinliklerinde yeni tedavileri ve ortaklıkları takip ediyoruz.",
        "offices_h": "Dubai'de merkez, Türkiye'de yerel güç",
        "offices_p": "Dubai merkezimiz, Türkiye irtibat ofisimiz ve ABD'deki erişim ağımızla üreticiler ile hastalar arasında köprü kuruyoruz.",
        "cta_h": "Tedavinizi Türkiye'deki hastalara ulaştırmak için görüşelim.",
        "legend": [("hq", "Merkez", "Dubai"), ("office", "Türkiye", "Ankara irtibat ofisi"), ("office", "ABD", "Ohio erişim ofisi")],
    },
    "en": {
        "caps_h": "One partner for entering Türkiye and reaching patients",
        "caps_p": "We build the commercial, regulatory and institutional bridge an international manufacturer needs to bring its product to patients in Türkiye.",
        "caps_link": "See our capabilities",
        "path_h": "From science to the patient",
        "path_p": "Bringing a therapy to patients moves through four stages, and we work alongside our partners at each one.",
        "quote_link": "Read the Chairman's message",
        "events_h": "Where we meet the industry",
        "events_p": "From cystic fibrosis to rare diseases, we follow new therapies and partnerships at the world's leading pharmaceutical events.",
        "offices_h": "Headquartered in Dubai, rooted in Türkiye",
        "offices_p": "With our Dubai headquarters, our Türkiye liaison office and our outreach network in the United States, we connect manufacturers with patients.",
        "cta_h": "Let's talk about bringing your therapy to patients in Türkiye.",
        "legend": [("hq", "Headquarters", "Dubai"), ("office", "Türkiye", "Ankara liaison office"), ("office", "USA", "Ohio outreach office")],
    },
}


def cap_items(lang, link=True):
    out = []
    for (fa, title, desc), (slug, *_rest) in zip(s.CAPABILITIES, SERVICES[lang]):
        t_ = esc(title[lang])
        t_html = f'<a href="{href("services", lang, "#" + slug)}">{t_}</a>' if link else t_
        out.append(f'<li><span class="icon">{icon(FA_TO_ICON[fa])}</span><h3>{t_html}</h3><p>{esc(desc[lang])}</p></li>')
    return "".join(out)


def pathway(lang):
    return "".join(f"<li><h3>{esc(t[lang])}</h3><p>{esc(d[lang])}</p></li>" for t, d in s.ACCESS_FLOW)


def event_photo(e, i=0):
    photo, pos = e["photos"][i]
    return f'assets/images/events/{photo}', pos


def orphion_home(lang):
    h = HOME[lang]
    u = UI[lang]
    legend = "".join(
        f'<li><span class="dot{" dot-office" if k == "office" else ""}"></span><span><strong>{esc(a)}</strong> {esc(b)}</span></li>'
        for k, a, b in h["legend"])
    first, rest = EVENTS[0], EVENTS[1:]
    fsrc, fpos = event_photo(first)
    rows = "".join(f"""
        <li><a class="event-row" href="{href('event-' + e['slug'], lang)}"><span class="thumb"><img src="{event_photo(e)[0]}" alt="" loading="lazy" style="object-position:{event_photo(e)[1]}"></span>
          <span><span class="event-meta">{esc(e['place'][lang])}, {e['year']}</span><h3 lang="en">{esc(e['name'])}</h3></span></a></li>"""
                   for e in rest)
    quote_txt = s.CHAIRMAN[lang][-1].replace("Because ultimately, we believe ", "").replace("Çünkü bizim için ", "")
    quote_txt = quote_txt[0].upper() + quote_txt[1:]
    return f"""
<section class="hero">
  {hero_map(lang)}
  <div class="wrap hero-inner">
    <h1 lang="en">{esc(s.TAGLINE)}</h1>
    <p class="lead">{esc(s.HERO[lang]['lead'])}</p>
    <div class="hero-actions">
      <a class="btn" href="{href('contact', lang, '#contact-form')}">{esc(s.HERO[lang]['cta_partner'])}</a>
      <a class="btn ghost" href="{href('services', lang)}">{esc(s.HERO[lang]['cta_caps'])}</a>
    </div>
  </div>
  <div class="wrap"><ul class="hero-legend">{legend}</ul></div>
</section>

<section class="section">
  <div class="wrap split">
    <div class="sticky">
      <h2>{esc(h['caps_h'])}</h2>
      <p class="lead">{esc(h['caps_p'])}</p>
      <p><a class="text-link" href="{href('services', lang)}">{esc(h['caps_link'])}</a></p>
    </div>
    <ul class="cap-list">{cap_items(lang)}</ul>
  </div>
</section>

<section class="section dark">
  <div class="wrap">
    <div class="section-head"><h2>{esc(h['path_h'])}</h2><p>{esc(h['path_p'])}</p></div>
    <ol class="pathway">{pathway(lang)}</ol>
  </div>
</section>

<section class="section">
  <div class="wrap quote-band">
    <figure class="photo"><img src="assets/images/bg/hero-medicines.webp" width="1920" height="1080" alt="{'Hekim hastaya ilacını veriyor' if lang == 'tr' else 'A physician handing medicine to a patient'}" loading="lazy"></figure>
    <div>
      <blockquote class="pull"><p>{esc(quote_txt)}</p></blockquote>
      <div class="signature"><img src="{s.CHAIRMAN['photo']}" alt="" width="56" height="56" loading="lazy">
        <div><strong>{esc(s.CHAIRMAN['name'])}</strong><span>{esc(s.CHAIRMAN['role'])}</span></div></div>
      <p style="margin-top:28px"><a class="text-link" href="{href('chairman', lang)}">{esc(h['quote_link'])}</a></p>
    </div>
  </div>
</section>

<section class="section tint">
  <div class="wrap">
    <div class="section-head"><h2>{esc(h['events_h'])}</h2><a class="text-link" href="{href('events', lang)}">{esc(u['all_events'])}</a></div>
    <div class="events-feature">
      <a class="event-main" href="{href('event-' + first['slug'], lang)}">
        <span class="photo" style="display:block"><img src="{fsrc}" alt="{esc(C['name'])}, {esc(first['name'])}" loading="lazy" style="object-position:{fpos}"></span>
        <h3 lang="en">{esc(first['name'])}</h3>
        <p><span class="event-meta">{esc(first['place'][lang])}, {first['year']}</span><br>{esc(first['summary'][lang])}</p>
      </a>
      <ul class="event-rows">{rows}
      </ul>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section-head"><h2>{esc(h['offices_h'])}</h2><p>{esc(h['offices_p'])}</p></div>
    {offices_html(lang)}
  </div>
</section>

<section class="section dark">
  <div class="wrap cta-band">
    <h2>{esc(h['cta_h'])}</h2>
    <a class="btn" href="{href('contact', lang, '#contact-form')}">{esc(UI[lang]['cta'])}</a>
  </div>
</section>"""


def orphion_about(lang):
    a = s.ABOUT[lang]
    u = UI[lang]
    pillars = "".join(f"<li>{esc(p)}</li>" for p in a["pillars"])
    more = "".join(f"<p>{esc(p)}</p>" for p in a["more"])
    partner = "".join(f"<p>{esc(p)}</p>" for p in a["partner"])
    return page_hero(lang, u["about"], esc(a["intro"][0])) + f"""
<section class="section">
  <div class="wrap split">
    <div><p class="statement">{esc(a['intro'][1])}</p></div>
    <div>
      <h2>{esc(a['access_title'])}</h2>
      <p class="lead">{esc(a['access_text'])}</p>
      <ul class="pillars">{pillars}</ul>
    </div>
  </div>
</section>
<section class="section tint">
  <div class="wrap split">
    <div class="sticky"><h2>{esc(a['more_title'])}</h2></div>
    <div class="prose">{partner}{more}</div>
  </div>
</section>
<section class="section dark">
  <div class="wrap">
    <p class="statement" style="max-width:34ch">{esc(a['closing'])}</p>
    <p style="margin-top:28px"><span class="kicker" style="display:inline">{esc(a['why'])}</span> <span lang="en" style="color:#fff;font-weight:650">{esc(s.TAGLINE)}</span></p>
  </div>
</section>
<section class="section">
  <div class="wrap">
    <div class="section-head"><h2>{esc(HOME[lang]['offices_h'])}</h2><a class="text-link" href="{href('contact', lang)}">{esc(u['contact'])}</a></div>
    {offices_html(lang)}
  </div>
</section>"""


def orphion_chairman(lang):
    c = s.CHAIRMAN
    u = UI[lang]
    paras = []
    for i, p in enumerate(c[lang]):
        if "\n" in p:
            paras.append('<div class="compass">' + "".join(f"<p>{esc(x)}</p>" for x in p.split("\n")) + "</div>")
        elif i == 0:
            paras.append(f'<p class="emph">{esc(p)}</p>')
        else:
            paras.append(f"<p>{esc(p)}</p>")
    return page_hero(lang, u["chairman"]) + f"""
<section class="section">
  <div class="wrap split">
    <div class="sticky">
      <figure class="portrait" style="margin:0"><img src="{c['photo']}" alt="{esc(c['name'])}" loading="lazy"></figure>
      <div class="portrait-caption"><strong>{esc(c['name'])}</strong><span>{esc(c['role'])}, {esc(C['name'])}</span></div>
    </div>
    <article class="prose">{''.join(paras)}
      <p class="signature" style="display:block;font-family:var(--sans)"><strong>{esc(c['name'])}</strong><span>{esc(c['role'])}<br>{esc(C['name'])}</span></p>
    </article>
  </div>
</section>"""


MISSION = {
    "tr": {
        "mission": "Tıbbi inovasyon ile ona ihtiyaç duyan hastalar arasındaki mesafeyi; güvenilir, sürdürülebilir ve sorumlu erişim yolları kurarak kısaltmak.",
        "vision": "Global ilaç ve biyoteknoloji şirketlerinin, tedavilerini Türkiye'deki ve ötesindeki hastalara ulaştırırken ilk güvendiği ortak olmak.",
        "values_h": "Değerlerimiz",
        "values": [("Uzun vadeli ortaklık", "Bize emanet edilen her tedaviyi yıllara yayılan bir iş birliğinin parçası olarak görürüz."),
                   ("Şeffaflık", "Ortaklarımızla süreçleri, riskleri ve sonuçları açıkça paylaşırız."),
                   ("Bilimsel doğruluk", "Kararlarımızı klinik ihtiyaca ve bilimsel kanıta dayandırırız."),
                   ("Etik sorumluluk", "Yaptığımız her işin sonunda bir insan hayatı olduğunu unutmayız.")],
    },
    "en": {
        "mission": "To shorten the distance between medical innovation and the patients who need it, by building trusted, sustainable and responsible access pathways.",
        "vision": "To be the partner global pharmaceutical and biotechnology companies trust first when bringing their therapies to patients in Türkiye and beyond.",
        "values_h": "Our values",
        "values": [("Long-term partnership", "We treat every therapy entrusted to us as part of a collaboration that spans years."),
                   ("Transparency", "We share processes, risks and results openly with our partners."),
                   ("Scientific integrity", "We base our decisions on clinical need and scientific evidence."),
                   ("Ethical responsibility", "We never forget that behind everything we do, there is a human life.")],
    },
}


def orphion_mission(lang):
    m = MISSION[lang]
    u = UI[lang]
    values = "".join(f"<li><h3>{esc(t)}</h3><p>{esc(d)}</p></li>" for t, d in m["values"])
    return page_hero(lang, u["mission"]) + f"""
<section class="section">
  <div class="wrap mv">
    <div><h2>{'Misyonumuz' if lang == 'tr' else 'Our mission'}</h2><p>{esc(m['mission'])}</p></div>
    <div><h2>{'Vizyonumuz' if lang == 'tr' else 'Our vision'}</h2><p>{esc(m['vision'])}</p></div>
  </div>
</section>
<section class="section tint">
  <div class="wrap">
    <div class="section-head"><h2>{esc(m['values_h'])}</h2></div>
    <ul class="values">{values}</ul>
  </div>
</section>"""


def orphion_services(lang):
    u = UI[lang]
    index, blocks = [], []
    for (fa, title, _d), (slug, summary, detail, ticks) in zip(s.CAPABILITIES, SERVICES[lang]):
        index.append(f'<li><a href="#{slug}">{esc(title[lang])}</a></li>')
        tick_html = "".join(f"<li>{esc(t)}</li>" for t in ticks)
        blocks.append(f"""
      <section class="service" id="{slug}">
        <span class="icon">{icon(FA_TO_ICON[fa])}</span>
        <h2>{esc(title[lang])}</h2>
        <p class="summary">{esc(summary)}</p>
        <p>{esc(detail)}</p>
        <ul class="ticks">{tick_html}</ul>
      </section>""")
    lead = esc(HOME[lang]["caps_p"])
    return page_hero(lang, u["services"], lead) + f"""
<section class="section">
  <div class="wrap split">
    <nav class="sticky" aria-label="{esc(u['services'])}"><ul class="service-index">{''.join(index)}</ul></nav>
    <div>{''.join(blocks)}</div>
  </div>
</section>
<section class="section dark">
  <div class="wrap">
    <div class="section-head"><h2>{esc(HOME[lang]['path_h'])}</h2><p>{esc(HOME[lang]['path_p'])}</p></div>
    <ol class="pathway">{pathway(lang)}</ol>
  </div>
</section>
<section class="section">
  <div class="wrap cta-band" style="--on:1">
    <h2 style="color:var(--ink)">{esc(HOME[lang]['cta_h'])}</h2>
    <a class="btn dark" href="{href('contact', lang, '#contact-form')}">{esc(u['cta'])}</a>
  </div>
</section>"""


def orphion_events(lang):
    u = UI[lang]
    tr = lang == "tr"
    cards = "".join(f"""
    <a class="event-card" href="{href('event-' + e['slug'], lang)}">
      <span class="photo" style="display:block"><img src="{event_photo(e)[0]}" alt="{esc(C['name'])}, {esc(e['name'])}" loading="lazy" style="object-position:{event_photo(e)[1]}"></span>
      <h3 lang="en">{esc(e['name'])}</h3>
      <p><span class="event-meta">{esc(e['place'][lang])}, {e['year']}</span><br>{esc(e['summary'][lang])}</p>
    </a>""" for e in EVENTS)
    lead = ("Kistik fibrozisten nadir hastalıklara, ilaç endüstrisinin en büyük fuarlarından uzmanlık kongrelerine kadar; "
            "yenilikçi tedavileri belirlemek ve onları Türkiye'deki hastalara ulaştıracak ortaklıkları kurmak için dünyanın dört bir yanındayız."
            if tr else
            "From cystic fibrosis to rare diseases, from the industry's largest trade shows to specialist congresses, we travel the "
            "world to identify innovative therapies and build the partnerships that bring them to patients in Türkiye.")
    return page_hero(lang, u["events"], esc(lead)) + f"""
<section class="section">
  <div class="wrap event-grid">{cards}
  </div>
</section>"""


def orphion_event(e, lang):
    u = UI[lang]
    i = EVENTS.index(e)
    gallery = "".join(
        f'<figure><img src="assets/images/events/{p}" alt="{esc(C["name"])}, {esc(e["name"])}" style="object-position:{pos}"{" loading=\"lazy\"" if n else ""}></figure>'
        for n, (p, pos) in enumerate(e["photos"]))
    paras = "".join(f"<p>{esc(p)}</p>" for p in e["body"][lang])
    tags = "".join(f'<li lang="en">#{esc(t)}</li>' for t in e["tags"])
    meta = (f'<ul class="event-hero-meta"><li>{u["place"]}: <strong>{esc(e["place"][lang])}</strong></li>'
            f'<li>{u["year"]}: <strong>{e["year"]}</strong></li><li>{u["focus"]}: <strong>{esc(e["topic"][lang])}</strong></li></ul>')
    prev_e = EVENTS[i - 1] if i > 0 else None
    next_e = EVENTS[i + 1] if i + 1 < len(EVENTS) else None
    prev_html = (f'<a href="{href("event-" + prev_e["slug"], lang)}"><small>{u["prev_event"]}</small><strong lang="en">{esc(prev_e["name"])}</strong></a>'
                 if prev_e else "<span></span>")
    next_html = (f'<a class="next" href="{href("event-" + next_e["slug"], lang)}"><small>{u["next_event"]}</small><strong lang="en">{esc(next_e["name"])}</strong></a>'
                 if next_e else "<span></span>")
    return page_hero(lang, e["name"], esc(e["full"][lang]) if e["full"][lang] != e["name"] else "",
                     [(href("events", lang), u["events"])], meta) + f"""
<section class="section">
  <div class="wrap split even">
    <div class="gallery">{gallery}</div>
    <article class="prose">{paras}
      <blockquote class="motto"><p>{esc(e['motto'][lang])}</p><cite lang="en">{esc(C['name'])}, “{esc(s.TAGLINE)}”</cite></blockquote>
      <ul class="tags">{tags}</ul>
    </article>
  </div>
  <div class="wrap"><nav class="pager" aria-label="{u['events']}">{prev_html}{next_html}</nav></div>
</section>
<section class="section dark">
  <div class="wrap cta-band">
    <h2>{'Bir sonraki etkinlikte görüşelim.' if lang == 'tr' else 'Let’s meet at the next event.'}</h2>
    <a class="btn" href="{href('contact', lang, '#contact-form')}">{esc(u['cta'])}</a>
  </div>
</section>"""


def orphion_partners(lang):
    u = UI[lang]
    tr = lang == "tr"
    intro = ("Orphion Pharma, dünyanın farklı noktalarındaki ilaç ve biyoteknoloji şirketleriyle çalışır. Partnerlerimizin "
             "tedavilerini isimli hasta programları, kamu tedarikleri ve uzun vadeli pazar erişimi yoluyla Türkiye'deki hastalara ulaştırıyoruz."
             if tr else
             "Orphion Pharma works with pharmaceutical and biotechnology companies around the world. We bring our partners' "
             "therapies to patients in Türkiye through named patient programs, public procurement and long-term market access.")
    logos = ""
    if s.PARTNERS:
        logos = '<ul class="partner-logos">' + "".join(
            f'<li><img src="{p["logo"]}" alt="{esc(p["name"])}" loading="lazy"></li>' for p in s.PARTNERS) + "</ul>"
    subject = quote("Ürün portföyü hakkında bilgi talebi" if tr else "Product portfolio information request")
    return page_hero(lang, u["partners_page"], esc(intro)) + f"""
<section class="section">
  <div class="wrap">{logos}
    <div class="portfolio-box" id="portfolio">
      <div>
        <h2>{esc(u['portfolio'])}</h2>
        <p>{'Partnerlerimizin ürün portföyü ve ürünlerin temin süreçleri hakkında ayrıntılı bilgi için bize yazın; ekibimiz en kısa sürede dönüş yapar.' if tr else 'Write to us for details on our partners’ product portfolio and how products are supplied; our team will get back to you shortly.'}</p>
      </div>
      <div class="actions">
        <a class="btn" href="mailto:{C['email']}?subject={subject}">{'Bilgi talep edin' if tr else 'Request information'}</a>
        <a href="mailto:{C['email']}">{C['email']}</a>
      </div>
    </div>
  </div>
</section>"""


def orphion_hr(lang):
    u = UI[lang]
    tr = lang == "tr"
    paras = (["Uluslararası ilaç ve biyoteknoloji şirketlerinin tedavilerini Türkiye'deki hastalara ulaştıran ekibimizi; alanında yetkin, çözüm odaklı ve gelişime açık profesyonellerle büyütüyoruz.",
              "Açık pozisyonlarımız ya da ileride oluşabilecek fırsatlar için özgeçmişinizi bu formdan gönderebilirsiniz. Başvurunuzu İnsan Kaynakları ekibimiz değerlendirir."]
             if tr else
             ["We are growing the team that brings international pharmaceutical and biotechnology companies' therapies to patients in Türkiye, with capable, solution-oriented professionals who want to grow.",
              "Send your CV with this form for current openings or future opportunities. Our Human Resources team reviews every application."])
    return page_hero(lang, u["hr"], esc(paras[0])) + f"""
<section class="section">
  <div class="wrap split">
    <div class="sticky"><h2>{'Ekibimize katılın' if tr else 'Join our team'}</h2><p class="lead">{esc(paras[1])}</p></div>
    <div class="form-card" id="application-form">{hr_form(lang)}</div>
  </div>
</section>"""


# ---------------------------------------------------------------------------
# Ortak sayfalar: İletişim, KVKK
# ---------------------------------------------------------------------------

def contact_page(lang):
    u = UI[lang]
    tr = lang == "tr"
    main = s.OFFICES[0]
    lead = ("Hasta erişimi, tedarik ya da Türkiye pazarına giriş hakkındaki talebinizi iletin; en kısa sürede dönüş yapalım."
            if BRAND_KEY == "orphion" and tr else
            "Tell us about your patient access, supply or Türkiye market entry needs and we will get back to you shortly."
            if BRAND_KEY == "orphion" else
            "İlaç tedariki, ihale süreçleri ya da Türkiye pazarına giriş danışmanlığı hakkındaki talebinizi iletin; en kısa sürede dönüş yapalım."
            if tr else
            "Tell us about your pharmaceutical supply, tender or Turkish market entry needs and we will get back to you shortly.")
    map_q = quote(main["maps_query"])
    lines = f"""
      <ul class="contact-lines">
        <li>{icon('mail')}<div><strong>{u['email']}</strong><a href="mailto:{C['email']}">{C['email']}</a></div></li>
        <li>{icon('phone')}<div><strong>{u['phone']}</strong><a href="tel:{C['phone_tel']}">{C['phone_display']}</a></div></li>
        <li>{icon('chat')}<div><strong>WhatsApp</strong><a href="{C['whatsapp']}" target="_blank" rel="noopener">{u['whatsapp']}</a></div></li>
        <li>{icon('clock')}<div><strong>{u['hours']}</strong>{u['hours_v']}</div></li>
      </ul>"""
    return page_hero(lang, u["contact"], esc(lead)) + f"""
<section class="section">
  <div class="wrap split">
    <div>
      <h2>{'Bize ulaşın' if tr else 'Reach us'}</h2>{lines}
    </div>
    <div class="form-card" id="contact-form"><h2 style="font-size:28px">{'Mesaj gönderin' if tr else 'Send us a message'}</h2>{contact_form(lang)}</div>
  </div>
</section>
<section class="section tint">
  <div class="wrap">
    <div class="section-head"><h2>{'Ofislerimiz' if tr else 'Our offices'}</h2></div>
    {offices_html(lang)}
    <div class="map-consent" style="margin-top:48px" data-map-src="https://maps.google.com/maps?q={map_q}&amp;z=15&amp;output=embed" data-map-title="{esc(main['title'][lang])}">
      <div>
        <p><strong>{esc(main['title'][lang])}</strong></p>
        <p class="muted">{'Haritayı görüntülemek için Google Haritalar yüklenir; bu, IP adresiniz gibi bazı verilerin Google’a iletilmesine neden olur.' if tr else 'Viewing the map loads Google Maps, which sends some data such as your IP address to Google.'}</p>
        <button type="button" class="btn dark js-load-map">{'Haritayı göster' if tr else 'Show map'}</button>
        <p style="margin-top:16px"><a href="{maps_link(main)}" target="_blank" rel="noopener">{'Google Haritalar’da aç' if tr else 'Open in Google Maps'}</a></p>
      </div>
    </div>
  </div>
</section>"""


def privacy_page(lang):
    raw = s.privacy_body(lang)
    m = re.search(r'<div class="legal-content">(.*)</div>\s*</div>\s*</section>', raw, re.S)
    content = m.group(1) if m else raw
    content = content.replace(' class="js-cookie-settings btn btn-link p-0 align-baseline"', ' class="js-cookie-settings"')
    title = "KVKK Aydınlatma Metni ve Çerez Politikası" if lang == "tr" else "Privacy Notice and Cookie Policy"
    return page_hero(lang, title) + f"""
<section class="section">
  <div class="wrap"><div class="legal">{content}</div></div>
</section>"""


# ---------------------------------------------------------------------------
# Rome içerikleri
# ---------------------------------------------------------------------------

ROME = {
    "tr": {
        "h1": "Türkiye ilaç pazarına güvenilir giriş.",
        "lead": "Rome Pharma, uluslararası ilaç firmalarının Türkiye pazarına erişimini kolaylaştıran bir ilaç tedarik ve danışmanlık şirketidir. Kamu kurumlarına ve özel sektöre çözüm sunar.",
        "cta2": "Hakkımızda",
        "lines_h": "İki ana iş kolu",
        "lines_p": "Uluslararası ilaç firmalarının Türkiye'deki hastalara ulaşması için tedarik ve danışmanlığı birlikte sunuyoruz.",
        "line_titles": ["İlaç tedariki", "Danışmanlık ve yerel temsil"],
        "line_icons": ["pill", "handshake"],
        "offices_h": "Ankara'da merkez, dünyaya açık",
        "offices_p": "Ankara merkez ofisimiz, Dubai ofisimiz ve ABD irtibat ofisimizle çalışıyoruz.",
        "cta_h": "Ürününüzü Türkiye pazarına taşımak için görüşelim.",
        "legend": [("hq", "Merkez", "Ankara"), ("office", "Dubai", "ofis"), ("office", "ABD", "irtibat ofisi")],
        "about_lead": "Rome Pharma, Rome Group'un bir parçası olarak uluslararası markaların Türkiye ilaç pazarına erişimini kolaylaştırmaya odaklanır.",
    },
    "en": {
        "h1": "A trusted way into the Turkish pharmaceutical market.",
        "lead": "Rome Pharma is a pharmaceutical supply and consulting company that helps international pharmaceutical companies access the Turkish market, serving both public institutions and the private sector.",
        "cta2": "About us",
        "lines_h": "Two business lines",
        "lines_p": "We combine supply and consulting so international pharmaceutical companies can reach patients in Türkiye.",
        "line_titles": ["Pharmaceutical supply", "Consulting and local representation"],
        "line_icons": ["pill", "handshake"],
        "offices_h": "Based in Ankara, open to the world",
        "offices_p": "We work from our Ankara main office, our Dubai office and our US outreach office.",
        "cta_h": "Let's talk about bringing your product to the Turkish market.",
        "legend": [("hq", "Main office", "Ankara"), ("office", "Dubai", "office"), ("office", "USA", "outreach office")],
        "about_lead": "Rome Pharma, part of Rome Group, focuses on helping international brands access the Turkish pharmaceutical market.",
    },
}


def rome_lines(lang):
    R = ROME[lang]
    return "".join(f'<li><span class="icon">{icon(ic)}</span><h3>{esc(t)}</h3><p>{esc(d)}</p></li>'
                   for t, ic, d in zip(R["line_titles"], R["line_icons"], s.BUSINESS_LINES[lang]))


def rome_home(lang):
    R = ROME[lang]
    A = r.ROME_ABOUT[lang]
    legend = "".join(
        f'<li><span class="dot{" dot-office" if k == "office" else ""}"></span><span><strong>{esc(a)}</strong> {esc(b)}</span></li>'
        for k, a, b in R["legend"])
    return f"""
<section class="hero">
  {hero_map(lang)}
  <div class="wrap hero-inner">
    <h1>{esc(R['h1'])}</h1>
    <p class="lead">{esc(R['lead'])}</p>
    <div class="hero-actions">
      <a class="btn" href="{href('contact', lang, '#contact-form')}">{esc(UI[lang]['cta'])}</a>
      <a class="btn ghost" href="{href('about', lang)}">{esc(R['cta2'])}</a>
    </div>
  </div>
  <div class="wrap"><ul class="hero-legend">{legend}</ul></div>
</section>

<section class="section">
  <div class="wrap split">
    <div><h2>{esc(R['lines_h'])}</h2><p class="lead">{esc(R['lines_p'])}</p></div>
    <ul class="cap-list">{rome_lines(lang)}</ul>
  </div>
</section>

<section class="section tint">
  <div class="wrap quote-band">
    <figure class="photo"><img src="assets/images/bg/hero-medicines.webp" width="1920" height="1080" alt="{'Hekim hastaya ilacını veriyor' if lang == 'tr' else 'A physician handing medicine to a patient'}" loading="lazy"></figure>
    <div>
      <h2>{esc(re.sub('<[^>]+>', '', A['why_t']))}</h2>
      <p class="lead">{esc(A['why'])}</p>
      <blockquote class="pull" style="margin-top:28px"><p>{esc(A['quote'].strip('“”'))}</p></blockquote>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section-head"><h2>{esc(R['offices_h'])}</h2><p>{esc(R['offices_p'])}</p></div>
    {offices_html(lang)}
  </div>
</section>

<section class="section dark">
  <div class="wrap cta-band">
    <h2>{esc(R['cta_h'])}</h2>
    <a class="btn" href="{href('contact', lang, '#contact-form')}">{esc(UI[lang]['cta'])}</a>
  </div>
</section>"""


def rome_about(lang):
    R = ROME[lang]
    A = r.ROME_ABOUT[lang]
    u = UI[lang]
    return page_hero(lang, u["about"], esc(R["about_lead"])) + f"""
<section class="section">
  <div class="wrap split">
    <div class="sticky"><h2>{esc(R['lines_h'])}</h2><p class="lead">{esc(R['lines_p'])}</p></div>
    <ul class="cap-list">{rome_lines(lang)}</ul>
  </div>
</section>
<section class="section tint">
  <div class="wrap mv">
    <div><h2>{esc(A['vision_t'])}</h2><p>{esc(A['vision'])}</p></div>
    <div><h2>{esc(A['mission_t'])}</h2><p>{esc(A['mission'])}</p></div>
  </div>
</section>
<section class="section dark">
  <div class="wrap">
    <h2>{esc(re.sub('<[^>]+>', '', A['why_t']))}</h2>
    <p class="statement" style="max-width:36ch">{esc(A['why'])}</p>
  </div>
</section>
<section class="section">
  <div class="wrap">
    <div class="section-head"><h2>{esc(R['offices_h'])}</h2><a class="text-link" href="{href('contact', lang)}">{esc(u['contact'])}</a></div>
    {offices_html(lang)}
  </div>
</section>"""


# ---------------------------------------------------------------------------
# Başlıklar, açıklamalar ve çıktı
# ---------------------------------------------------------------------------

TITLES = dict(s.TITLES)
DESCRIPTIONS = dict(s.DESCRIPTIONS)
if BRAND_KEY == "orphion":
    TITLES["services"] = {"tr": "Hizmetlerimiz | Orphion Pharma", "en": "Capabilities | Orphion Pharma"}
    DESCRIPTIONS["services"] = {
        "tr": "Orphion Pharma hizmetleri: isimli hasta erişimi, kamu ve kurum tedariki, pazar erişimi ve geri ödeme, regülasyon desteği, münhasır distribütörlük, nadir hastalık ilaçları ve üreticiden hastaya doğrudan erişim.",
        "en": "Orphion Pharma capabilities: named patient access, government and institutional supply, market access and reimbursement, regulatory support, exclusive distribution, rare disease medicines and direct manufacturer-to-patient access.",
    }
    TITLES["hr"] = {"tr": "İnsan Kaynakları | Orphion Pharma", "en": "Careers | Orphion Pharma"}
    TITLES["mission"] = {"tr": "Misyon, Vizyon ve Değerler | Orphion Pharma", "en": "Mission, Vision & Values | Orphion Pharma"}
    TITLES["partners"] = {"tr": "Partnerlerimiz ve Ürün Portföyümüz | Orphion Pharma", "en": "Partners & Product Portfolio | Orphion Pharma"}
    DESCRIPTIONS["mission"] = {
        "tr": "Orphion Pharma'nın misyonu, vizyonu ve değerleri: tıbbi inovasyon ile hastalar arasındaki mesafeyi kısaltmak.",
        "en": "Orphion Pharma's mission, vision and values: shortening the distance between medical innovation and patients.",
    }
    DESCRIPTIONS["hr"] = {"tr": "Orphion Pharma'da kariyer: özgeçmişinizi gönderin, ekibimize katılın.",
                          "en": "Careers at Orphion Pharma: send your CV and join our team."}
    BODIES = {
        "home": orphion_home, "about": orphion_about, "chairman": orphion_chairman, "mission": orphion_mission,
        "services": orphion_services, "events": orphion_events, "partners": orphion_partners, "hr": orphion_hr,
        "contact": contact_page, "privacy": privacy_page,
    }
    for _e in EVENTS:
        BODIES["event-" + _e["slug"]] = (lambda lang, _e=_e: orphion_event(_e, lang))
else:
    BODIES = {"home": rome_home, "about": rome_about, "contact": contact_page, "privacy": privacy_page}


def sitemap():
    urls = []
    for key, langs in PAGES.items():
        for lang in langs:
            alts = "".join(f'\n    <xhtml:link rel="alternate" hreflang="{l}" href="{page_url(key, l)}"/>' for l in LANGS)
            alts += f'\n    <xhtml:link rel="alternate" hreflang="x-default" href="{page_url(key, "en")}"/>'
            prio = "1.0" if key == "home" else ("0.3" if key == "privacy" else "0.8")
            urls.append(f"  <url>\n    <loc>{page_url(key, lang)}</loc>\n    <lastmod>2026-11-12</lastmod>\n"
                        f"    <priority>{prio}</priority>{alts}\n  </url>")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
            'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + "\n".join(urls) + "\n</urlset>\n")


def main():
    prepare_output()
    for key, langs in PAGES.items():
        for lang, filename in langs.items():
            (ROOT / filename).write_text(render(key, lang, BODIES[key](lang)), encoding="utf-8")
    (ROOT / "sitemap.xml").write_text(sitemap(), encoding="utf-8")
    (ROOT / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\nDisallow: /contact.php\n\nSitemap: {s.SITE_URL}sitemap.xml\n", encoding="utf-8")
    print(f"{BRAND_KEY}: {sum(len(v) for v in PAGES.values())} sayfa yazıldı -> {ROOT}")


main()
