#!/usr/bin/env python3
"""
Orphion Pharma / Rome Pharma - HTML üretici (Tailwind CSS sınıflarıyla).

Doğrudan çalıştırmayın; Node.js derlemesi çağırır:
    cd tools/web && npm run build

Bu dosya HTML sayfalarını, sitemap/robots dosyalarını yazar ve görselleri
yerleştirir. CSS (Tailwind) ve JavaScript (site.js, 3D küre) derlemesini
tools/web/build.mjs yapar ve sayfalardaki ?v=__HASH__ işaretlerini doldurur.

İçerik verileri: build_site.py (ortak), build_rome.py (Rome), site_texts.py.
"""
import html
import json
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import quote, quote_plus

TOOLS = Path(__file__).resolve().parent
REPO = TOOLS.parent
sys.path.insert(0, str(TOOLS))

BRAND_KEY = sys.argv[1] if len(sys.argv) > 1 else "orphion"
if BRAND_KEY == "rome":
    import build_rome as r  # build_site modülünü Rome için uyarlar
    s = r.b
else:
    import build_site as s
    r = None
from site_texts import SERVICES, HOME, MISSION, ROME  # noqa: E402

ROOT = s.ROOT
C = s.COMPANY
LANGS = ("tr", "en")
WEB = TOOLS / "web"


def esc(x):
    return html.escape(str(x), quote=True)


LOGO = {
    "orphion": {"header": ("assets/images/orphion-logo.webp", 289, 125),
                "footer": ("assets/images/orphion-logo-white.webp", 702, 280)},
    "rome": {"header": ("assets/images/rome-logo.webp", 220, 126),
             "footer": ("assets/images/rome-logo-white.webp", 300, 172)},
}[BRAND_KEY]
THEME_COLOR = {"orphion": "#16213A", "rome": "#0F2A40"}[BRAND_KEY]

KEEP_IMAGES = [
    "assets/images/orphion-logo.webp", "assets/images/orphion-logo-white.webp", "assets/images/orphion-logo.png",
    "assets/images/rome-logo.webp", "assets/images/rome-logo-white.webp", "assets/images/rome-logo.png",
    "assets/images/favicon-32.png", "assets/images/fav-icon.png", "assets/images/apple-touch-icon.png",
    "assets/images/og-image.jpg", "assets/images/chairman-fevzi-aydin.webp",
    "assets/images/bg/hero-medicines.webp", "assets/images/bg/hero-medicines-sm.webp",
]

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
                        'Ayrıntılar: <a class="underline" href="kvkk.html#cerezler">KVKK ve Çerez Politikası</a>.'),
        "cookie_accept": "Kabul et", "cookie_reject": "Yalnızca zorunlu",
        "logo_alt": "{} logosu", "all_events": "Tüm etkinlikler",
        "prev_event": "Önceki etkinlik", "next_event": "Sonraki etkinlik",
        "year": "Yıl", "place": "Konum", "focus": "Odak", "drag": "Küreyi sürükleyerek çevirebilirsiniz",
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
                        'Details: <a class="underline" href="privacy-en.html#cookies">Privacy &amp; Cookie Policy</a>.'),
        "cookie_accept": "Accept", "cookie_reject": "Essential only",
        "logo_alt": "{} logo", "all_events": "All events",
        "prev_event": "Previous event", "next_event": "Next event",
        "year": "Year", "place": "Location", "focus": "Focus", "drag": "Drag the globe to turn it",
    },
}
if BRAND_KEY == "rome":
    UI["tr"]["cta"] = "İletişime Geçin"
    UI["en"]["cta"] = "Get in Touch"


# ---------------------------------------------------------------------------
# İkonlar
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
    "arrow": '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
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
    "pill": '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
}
FA_TO_ICON = {
    "fa-user-doctor": "stethoscope", "fa-building-columns": "landmark", "fa-chart-line": "chart",
    "fa-clipboard-check": "clipboard", "fa-handshake": "handshake", "fa-dna": "dna", "fa-truck-medical": "truck",
}


def icon(name, cls="i"):
    return (f'<svg class="{cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">{ICON_PATHS[name]}</svg>')


# ---------------------------------------------------------------------------
# Görseller ve klasör
# ---------------------------------------------------------------------------

def prepare_output():
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
    if BRAND_KEY == "rome":
        src = REPO / "orphion-pharma/assets/images/bg"
        for name in ("hero-medicines.webp", "hero-medicines-sm.webp"):
            if (src / name).exists() and not (ROOT / "assets/images/bg" / name).exists():
                (ROOT / "assets/images/bg").mkdir(parents=True, exist_ok=True)
                shutil.copy2(src / name, ROOT / "assets/images/bg" / name)
    fonts = ROOT / "assets/fonts"
    fonts.mkdir(parents=True, exist_ok=True)
    for f in (TOOLS / "web/fonts").glob("*.woff2"):
        shutil.copy2(f, fonts / f.name)


# ---------------------------------------------------------------------------
# Giriş küresi: şehirler ve yedek SVG harita
# ---------------------------------------------------------------------------

CITIES = {
    "seattle": (47.61, -122.33), "boston": (42.36, -71.06), "atlanta": (33.75, -84.39), "ohio": (39.08, -84.18),
    "frankfurt": (50.11, 8.68), "milan": (45.46, 9.19), "dubai": (25.2, 55.27), "ankara": (39.93, 32.85),
}
if BRAND_KEY == "orphion":
    HUB = ("ankara", {"tr": "Türkiye", "en": "Türkiye"})
    SOURCES = [("seattle", "Seattle", "event"), ("boston", "Boston", "event"), ("atlanta", "Atlanta", "event"),
               ("ohio", "Ohio", "office"), ("frankfurt", "Frankfurt", "event"), ("milan", "Milano/Milan", "event"),
               ("dubai", "Dubai", "hq")]
else:
    HUB = ("ankara", {"tr": "Ankara", "en": "Ankara"})
    SOURCES = [("boston", "Boston", "event"), ("ohio", "Ohio", "office"), ("frankfurt", "Frankfurt", "event"),
               ("milan", "Milano/Milan", "event"), ("dubai", "Dubai", "office")]

MAP = json.loads((TOOLS / "orphion_map.json").read_text(encoding="utf-8"))


def city_label(label, lang):
    return label.split("/")[0 if lang == "tr" else -1]


def fallback_map(lang):
    """WebGL yoksa görünen düz harita (3D küre hazır olunca gizlenir)."""
    P = MAP["pts"]
    hx, hy = P[HUB[0]]
    parts = [f'<path class="map-land" d="{MAP["d"]}"/>']
    for key, label, kind in SOURCES:
        x, y = P[key]
        dist = ((hx - x) ** 2 + (hy - y) ** 2) ** .5
        parts.append(f'<path class="map-arc" d="M{x} {y}Q{(x + hx) / 2:.1f} {min(y, hy) - dist * 0.28:.1f} {hx} {hy}"/>')
        parts.append(f'<circle class="map-node" cx="{x}" cy="{y}" r="3.2"/>')
        parts.append(f'<text class="map-label" x="{x}" y="{y - 10}" text-anchor="middle">{esc(city_label(label, lang))}</text>')
    parts.append(f'<circle class="map-node map-hub" cx="{hx}" cy="{hy}" r="6.5"/>'
                 f'<text class="map-label hub" x="{hx + 12}" y="{hy - 10}">{esc(HUB[1][lang])}</text>')
    return (f'<svg class="globe-fallback absolute inset-0 m-auto h-full w-full" viewBox="190 70 730 230" '
            f'aria-hidden="true">{"".join(parts)}</svg>')


def globe(lang):
    cfg = {
        "hub": {"lat": CITIES[HUB[0]][0], "lon": CITIES[HUB[0]][1], "label": HUB[1][lang]},
        "sources": [{"lat": CITIES[k][0], "lon": CITIES[k][1], "label": city_label(l, lang), "kind": kind}
                    for k, l, kind in SOURCES],
    }
    return (f'<div class="globe aspect-square w-full" data-globe="{esc(json.dumps(cfg, ensure_ascii=False))}" '
            f'role="img" aria-label="{esc(UI[lang]["drag"])}">{fallback_map(lang)}</div>')


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
    items = []
    for key, label, children in nav_items(lang):
        if children:
            current = any(c.split("#")[0] == page for c, _ in children)
            sub = "".join(
                f'<li><a href="{link_of(c, lang)}"{" aria-current=" + chr(34) + "page" + chr(34) if c == page else ""}>{esc(l)}</a></li>'
                for c, l in children)
            items.append(
                f'<li class="nav-item relative{" is-current" if current else ""}">'
                f'<button class="nav-link nav-parent" type="button" aria-expanded="false">{esc(u[key])}'
                f'{icon("chev", "chev h-3 w-3 transition-transform")}</button><ul class="submenu">{sub}</ul></li>')
        else:
            cur = page == key or (key == "events" and page.startswith("event-"))
            items.append(f'<li><a class="nav-link" href="{href(key, lang)}"{" aria-current=" + chr(34) + "page" + chr(34) if cur else ""}>{esc(label)}</a></li>')
    items.append(f'<li class="mt-6 border-0 lg:hidden"><a class="btn w-full" href="{href("contact", lang, "#contact-form")}">{esc(u["cta"])}</a></li>')
    logo, w, h = LOGO["header"]

    def lang_link(code):
        on = code == lang
        cls = "bg-ink text-white" if on else "text-muted hover:text-ink"
        return (f'<a class="rounded px-2.5 py-1.5 text-sm font-semibold no-underline {cls}" href="{PAGES[page][code]}" '
                f'hreflang="{code}" lang="{code}"{" aria-current=" + chr(34) + "true" + chr(34) if on else ""}>{code.upper()}</a>')

    return f"""
<header class="site-header sticky top-0 z-50 border-b border-transparent bg-white transition-colors [&.scrolled]:border-line">
  <div class="wrap flex h-[72px] items-center gap-4 lg:h-[84px] lg:gap-7">
    <a class="shrink-0" href="{href('home', lang)}"><img class="h-11 w-auto lg:h-16" src="{logo}" width="{w}" height="{h}" alt="{esc(u['logo_alt'].format(C['name']))}"></a>
    <nav class="main-nav lg:ml-auto" aria-label="{esc(u['menu'])}">
      <ul class="flex items-center gap-1">{''.join(items)}</ul>
    </nav>
    <div class="ml-auto flex items-center gap-3 lg:ml-0">
      <div class="flex rounded-md border border-line p-[3px]" role="group" aria-label="{esc(u['lang'])}">{lang_link('tr')}{lang_link('en')}</div>
      <a class="btn hidden min-h-[44px] px-4 text-[15px] xl:inline-flex" href="{href('contact', lang, '#contact-form')}">{esc(u['cta'])}</a>
      <button class="menu-toggle grid h-11 w-11 place-items-center rounded-md border border-line bg-white lg:hidden" type="button" aria-expanded="false" aria-label="{esc(u['menu'])}">
        <span class="burger relative block h-0.5 w-[18px] bg-ink transition before:absolute before:-top-1.5 before:left-0 before:h-0.5 before:w-full before:bg-ink before:transition before:content-[''] after:absolute after:left-0 after:top-1.5 after:h-0.5 after:w-full after:bg-ink after:transition after:content-['']"></span>
      </button>
    </div>
  </div>
</header>"""


def phones_html(o, dark=False):
    cls = "text-on-dark" if dark else "text-body"
    return "".join(f'<a class="block no-underline hover:underline {cls}" href="tel:{tel}">{esc(disp)}</a>' for disp, tel in o["phones"])


def maps_link(o):
    return "https://www.google.com/maps/search/?api=1&query=" + quote_plus(o["maps_query"])


def offices_html(lang, dark=False):
    out = []
    for i, o in enumerate(s.OFFICES):
        top = "border-accent" if i == 0 else ("border-white/20" if dark else "border-line")
        title = "text-white" if dark else "text-ink"
        text = "text-on-dark" if dark else "text-body"
        out.append(f"""
      <li class="border-t-2 {top} pt-5" data-reveal data-reveal-delay="{i + 1}">
        <h3 class="mb-2.5 text-lg {title}">{esc(o['title'][lang])}</h3>
        <address class="mb-3 not-italic"><a class="no-underline hover:underline {text}" href="{maps_link(o)}" target="_blank" rel="noopener">{'<br>'.join(esc(l) for l in o['lines'])}</a></address>{phones_html(o, dark)}
      </li>""")
    return f'<ul class="grid gap-8 md:grid-cols-3">{"".join(out)}\n    </ul>'


def footer(lang):
    u = UI[lang]
    logo, w, h = LOGO["footer"]
    tagline = s.TAGLINE if BRAND_KEY == "orphion" else s.T[lang]["tagline"]
    links = [("about", u["about"]), ("contact", u["contact"])]
    if BRAND_KEY == "orphion":
        links = [("about", u["about"]), ("services", u["services"]), ("events", u["events"]),
                 ("partners", u["partners_page"]), ("hr", u["hr"]), ("contact", u["contact"])]
    links_html = "".join(f'<li><a class="font-medium text-on-dark no-underline hover:text-accent" href="{href(k, lang)}">{esc(l)}</a></li>'
                         for k, l in links)
    return f"""
<footer class="bg-ink-deep pb-8 pt-20 text-base text-on-dark">
  <div class="wrap">
    <div class="grid gap-12 border-b border-white/10 pb-14 lg:grid-cols-[4fr_8fr]">
      <div>
        <img class="mb-5 h-16 w-auto" src="{logo}" width="{w}" height="{h}" alt="{esc(u['logo_alt'].format(C['name']))}" loading="lazy">
        <p class="mb-4 font-serif text-[22px] text-white"{' lang="en"' if BRAND_KEY == 'orphion' else ''}>{esc(tagline)}</p>
        <p><a class="text-on-dark hover:text-white" href="mailto:{C['email']}">{C['email']}</a><br><a class="text-on-dark hover:text-white" href="tel:{C['phone_tel']}">{C['phone_display']}</a></p>
        <ul class="mt-6 flex flex-wrap gap-x-6 gap-y-2.5">{links_html}</ul>
      </div>
      {offices_html(lang, dark=True)}
    </div>
    <div class="flex flex-wrap justify-between gap-x-8 gap-y-4 pt-7 text-sm text-on-dark-muted">
      <p>© <span data-current-year>2026</span> {esc(C['name'])}. {u['rights']}</p>
      <nav class="flex flex-wrap gap-x-6 gap-y-2" aria-label="{esc(u['privacy'])}">
        <a class="text-on-dark-muted no-underline hover:text-white hover:underline" href="{href('privacy', lang)}">{esc(u['privacy'])}</a>
        <button class="js-cookie-settings text-on-dark-muted hover:text-white hover:underline" type="button">{esc(u['cookies'])}</button>
      </nav>
    </div>
  </div>
</footer>
<a class="fixed bottom-5 right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-[#1FA855] text-white shadow-[0_10px_24px_rgba(0,0,0,.18)] transition hover:bg-[#178A45]" href="{C['whatsapp']}" target="_blank" rel="noopener" aria-label="{esc(u['whatsapp'])}">{icon('chat', 'h-7 w-7')}</a>
<div class="cookie-banner fixed bottom-3 left-3 right-3 z-[60] rounded-xl border border-line bg-white p-4 text-sm shadow-[0_18px_48px_rgba(16,26,46,.18)] sm:bottom-5 sm:left-5 sm:right-auto sm:max-w-[420px] sm:p-5 sm:text-[15px]" role="dialog" aria-live="polite" aria-label="{esc(u['cookies'])}">
  <p class="mb-3">{u['cookie_text']}</p>
  <div class="flex gap-2.5"><button class="accept min-h-[42px] flex-1 rounded-md bg-ink px-4 font-semibold text-white" type="button">{esc(u['cookie_accept'])}</button><button class="reject min-h-[42px] flex-1 rounded-md border border-ink px-4 font-semibold text-ink" type="button">{esc(u['cookie_reject'])}</button></div>
</div>
<script src="assets/js/site.js?v=__HASH_SITE_JS__" defer></script>"""


def head(page, lang, title, desc, extra=""):
    other = "en" if lang == "tr" else "tr"
    og = s.SITE_URL + getattr(s, "OG_IMAGES", {}).get(page, "assets/images/og-image.jpg")
    globe_js = '\n<script src="assets/js/globe.js?v=__HASH_GLOBE_JS__" defer></script>' if page == "home" else ""
    return f"""<!DOCTYPE html>
<html lang="{lang}" data-brand="{BRAND_KEY}" data-storage="{BRAND_KEY}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<meta name="theme-color" content="{THEME_COLOR}">
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
<link rel="stylesheet" href="assets/css/site.css?v=__HASH_SITE_CSS__">
<script>document.documentElement.classList.add("js")</script>{globe_js}{extra}
</head>"""


def render(page, lang, body):
    u = UI[lang]
    extra = s.organization_schema(lang) if page == "home" else ""
    return (head(page, lang, TITLES[page][lang], DESCRIPTIONS[page][lang], extra)
            + f'\n<body>\n<a class="absolute -top-16 left-4 z-[100] rounded-md bg-ink px-4 py-2.5 text-white focus:top-3" href="#main">{u["skip"]}</a>'
            + header(page, lang) + f'\n<main id="main">{body}\n</main>' + footer(lang) + "\n</body>\n</html>\n")


def page_hero(lang, title, lead="", crumbs=(), extra=""):
    u = UI[lang]
    trail = [(href("home", lang), u["home"])] + list(crumbs)
    crumb_html = "".join(f'<li class="after:mx-2 after:opacity-60 after:content-[\'/\']"><a class="text-on-dark-muted no-underline hover:text-white" href="{h}">{esc(l)}</a></li>'
                         for h, l in trail) + f'<li aria-current="page">{esc(title)}</li>'
    lead_html = f'<p class="lead text-on-dark">{lead}</p>' if lead else ""
    return f"""
<section class="relative overflow-hidden bg-ink pb-14 pt-14 text-on-dark md:pb-20 md:pt-24">
  <div class="pointer-events-none absolute -right-40 top-1/2 h-[520px] w-[520px] -translate-y-1/2 rounded-full border border-white/10"></div>
  <div class="pointer-events-none absolute -right-20 top-1/2 h-[340px] w-[340px] -translate-y-1/2 rounded-full border border-accent/30"></div>
  <div class="wrap relative">
    <ol class="mb-6 flex flex-wrap text-[15px] text-on-dark-muted">{crumb_html}</ol>
    <h1 class="h-page mb-5 max-w-[18ch] text-white">{esc(title)}</h1>{lead_html}{extra}
  </div>
</section>"""


def section_head(title, aside="", dark=False):
    color = "text-white" if dark else ""
    aside_html = f'<div class="max-w-[52ch]">{aside}</div>' if aside else ""
    return (f'<div class="mb-12 flex flex-wrap items-end justify-between gap-x-10 gap-y-5" data-reveal>'
            f'<h2 class="h-section m-0 max-w-[20ch] {color}">{esc(title)}</h2>{aside_html}</div>')


# ---------------------------------------------------------------------------
# Formlar
# ---------------------------------------------------------------------------

def field(fid, name, label, kind="text", required=True, full=False, opt_text="", attrs=""):
    req = " required" if required else ""
    opt = f' <span class="font-normal text-muted">{opt_text}</span>' if opt_text else ""
    ctrl = (f'<textarea id="{fid}" name="{name}"{req}{attrs}></textarea>' if kind == "textarea"
            else f'<input type="{kind}" id="{fid}" name="{name}"{req}{attrs}>')
    return f'<div class="field{" sm:col-span-2" if full else ""}"><label for="{fid}">{label}{opt}</label>{ctrl}</div>'


def consent_html(text):
    return (f'<label class="flex items-start gap-3 text-[15px] leading-normal text-muted sm:col-span-2">'
            f'<input class="mt-0.5 h-5 w-5 shrink-0 accent-ink" type="checkbox" name="kvkk_consent" value="1" required>'
            f'<span class="[&_a]:text-ink [&_a]:underline">{text}</span></label>')


def submit_html(label):
    return (f'<div class="sm:col-span-2"><button class="btn btn-dark" type="submit">{label}</button>'
            f'<div class="form-status" role="status" aria-live="polite"></div></div>')


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
<form class="js-contact-form grid gap-x-5 gap-y-[18px] sm:grid-cols-2" action="contact.php" method="post" novalidate>
  <input type="hidden" name="lang" value="{lang}"><input type="hidden" name="ts" value="">
  <div class="hp-field" aria-hidden="true"><label for="cf-website">Website</label><input type="text" id="cf-website" name="website" tabindex="-1" autocomplete="off"></div>
  {field("cf-name", "name", "Ad Soyad" if tr else "Full name", attrs=' autocomplete="name" minlength="2" maxlength="100"')}
  {field("cf-email", "email", "E-posta" if tr else "Email", "email", attrs=' autocomplete="email" maxlength="200"')}
  {field("cf-phone", "phone", "Telefon" if tr else "Phone", "tel", False, opt_text=opt, attrs=' autocomplete="tel" maxlength="40"')}
  {field("cf-company", "company", "Firma" if tr else "Company", "text", False, opt_text=opt, attrs=' autocomplete="organization" maxlength="150"')}
  {field("cf-message", "message", "Mesajınız" if tr else "Your message", "textarea", True, True, attrs=' minlength="5" maxlength="5000"')}
  {consent_html(consent)}
  {submit_html('Mesajı gönder' if tr else 'Send message')}
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
<form class="js-contact-form grid gap-x-5 gap-y-[18px] sm:grid-cols-2" action="contact.php" method="post" enctype="multipart/form-data" novalidate data-success="{esc(success)}">
  <input type="hidden" name="lang" value="{lang}"><input type="hidden" name="form" value="hr"><input type="hidden" name="ts" value="">
  <div class="hp-field" aria-hidden="true"><label for="hr-website">Website</label><input type="text" id="hr-website" name="website" tabindex="-1" autocomplete="off"></div>
  {field("hr-name", "name", "Ad Soyad" if tr else "Full name", attrs=' autocomplete="name" minlength="2" maxlength="100"')}
  {field("hr-email", "email", "E-posta" if tr else "Email", "email", attrs=' autocomplete="email" maxlength="200"')}
  {field("hr-phone", "phone", "Telefon" if tr else "Phone", "tel", attrs=' autocomplete="tel" maxlength="40"')}
  {field("hr-position", "position", "Başvurduğunuz pozisyon" if tr else "Position", "text", False, opt_text=opt, attrs=' maxlength="150"')}
  {field("hr-message", "message", "Ön yazı" if tr else "Cover letter", "textarea", False, True, opt_text=opt, attrs=' maxlength="5000"')}
  <div class="relative sm:col-span-2">
    <label class="grid cursor-pointer grid-cols-[auto_1fr] items-center gap-x-4 gap-y-0.5 rounded-lg border-[1.5px] border-dashed border-[#AEB9C8] bg-mist px-5 py-4 hover:border-ink" for="hr-cv">
      {icon('upload', 'row-span-2 h-7 w-7 text-ink')}<strong class="text-ink">{'Özgeçmişinizi (CV) yükleyin' if tr else 'Upload your CV'}</strong><span class="text-sm text-muted">{'PDF, DOC veya DOCX, en fazla 5 MB' if tr else 'PDF, DOC or DOCX, up to 5 MB'}</span><span class="cv-name col-start-2 text-[15px] font-semibold text-accent-ink" aria-live="polite"></span>
    </label>
    <input class="cv-input absolute inset-0 h-full w-full cursor-pointer opacity-0" type="file" id="hr-cv" name="cv" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required>
  </div>
  {consent_html(consent)}
  {submit_html('Başvuruyu gönder' if tr else 'Submit application')}
</form>"""


# ---------------------------------------------------------------------------
# Ortak bölümler
# ---------------------------------------------------------------------------

def cap_list(items):
    """items: (ikon, başlık html, açıklama)"""
    rows = "".join(f"""
      <li class="group grid grid-cols-[48px_1fr] gap-x-5 gap-y-1.5 border-b border-line py-6" data-reveal>
        <span class="row-span-2 grid h-12 w-12 place-items-center rounded-xl bg-mist text-ink transition-colors duration-300 group-hover:bg-ink group-hover:text-white">{icon(ic)}</span>
        <h3 class="mt-1 text-xl">{title}</h3>
        <p class="m-0 text-base text-muted">{esc(desc)}</p>
      </li>""" for ic, title, desc in items)
    return f'<ul class="border-t border-line">{rows}\n    </ul>'


def pathway(lang):
    steps = "".join(f"""
      <li class="relative pr-7 pt-9" data-reveal data-reveal-delay="{i + 1}">
        <span class="absolute -top-4 left-0 grid h-8 w-8 place-items-center rounded-full bg-accent text-[15px] font-bold text-accent-on">{i + 1}</span>
        <h3 class="mb-2 text-[21px] text-white">{esc(t[lang])}</h3>
        <p class="m-0 max-w-[30ch] text-base text-on-dark">{esc(d[lang])}</p>
      </li>""" for i, (t, d) in enumerate(s.ACCESS_FLOW))
    return f"""
    <div class="relative mt-14">
      <div class="absolute left-0 right-0 top-0 hidden h-0.5 bg-white/15 md:block"><div class="pathway-track h-full bg-accent"></div></div>
      <ol class="grid gap-y-12 sm:grid-cols-2 md:grid-cols-4">{steps}
      </ol>
    </div>"""


def cta_band(lang, text, dark=True):
    if dark:
        return f"""
<section class="section bg-ink">
  <div class="wrap flex flex-wrap items-center justify-between gap-x-12 gap-y-7" data-reveal>
    <h2 class="h-section m-0 max-w-[22ch] text-white">{esc(text)}</h2>
    <a class="btn" href="{href('contact', lang, '#contact-form')}">{esc(UI[lang]['cta'])} {icon('arrow', 'h-5 w-5')}</a>
  </div>
</section>"""
    return f"""
<section class="section">
  <div class="wrap flex flex-wrap items-center justify-between gap-x-12 gap-y-7" data-reveal>
    <h2 class="h-section m-0 max-w-[22ch]">{esc(text)}</h2>
    <a class="btn btn-dark" href="{href('contact', lang, '#contact-form')}">{esc(UI[lang]['cta'])} {icon('arrow', 'h-5 w-5')}</a>
  </div>
</section>"""


def hero(lang, h1, lead, actions, legend):
    legend_html = "".join(
        f'<li class="flex items-baseline gap-2.5"><span class="h-2.5 w-2.5 shrink-0 translate-y-[-1px] rounded-full {"bg-accent" if k == "hq" else "bg-white"}"></span>'
        f'<span><strong class="font-semibold text-white">{esc(a)}</strong> {esc(b)}</span></li>'
        for k, a, b in legend)
    h1_lang = ' lang="en"' if h1 == getattr(s, "TAGLINE", None) else ""
    size = "max-w-[11ch]" if len(h1) < 32 else "max-w-[16ch] !text-[clamp(38px,4.4vw,62px)]"
    return f"""
<section class="relative overflow-hidden bg-ink text-on-dark">
  <div class="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-accent/10 blur-3xl"></div>
  <div class="wrap relative grid items-center gap-6 pt-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:pt-6">
    <div class="py-6 lg:py-24">
      <h1 class="h-display mb-7 text-white motion-safe:animate-[rise_.8s_ease_both] {size}"{h1_lang}>{esc(h1)}</h1>
      <p class="lead mb-10 max-w-[36ch] text-on-dark motion-safe:animate-[rise_.8s_.12s_ease_both]">{esc(lead)}</p>
      <div class="flex flex-wrap gap-3.5 motion-safe:animate-[rise_.8s_.24s_ease_both]">{actions}</div>
    </div>
    <div class="relative -mx-6 sm:mx-auto sm:w-[86%] lg:-mr-20 lg:w-[112%]">{globe(lang)}</div>
  </div>
  <div class="wrap relative"><ul class="flex flex-wrap gap-x-8 gap-y-2.5 border-t border-white/10 pb-7 pt-5 text-[15px]">{legend_html}</ul></div>
</section>"""


def photo(src, alt, extra_cls="aspect-[4/3]", pos="center", lazy=True):
    return (f'<figure class="m-0 overflow-hidden rounded-lg bg-mist {extra_cls}"><img class="h-full w-full object-cover" '
            f'src="{src}" alt="{esc(alt)}" style="object-position:{pos}"{" loading=" + chr(34) + "lazy" + chr(34) if lazy else ""}></figure>')


# ---------------------------------------------------------------------------
# Orphion sayfaları
# ---------------------------------------------------------------------------

def event_photo(e, i=0):
    p, pos = e["photos"][i]
    return f"assets/images/events/{p}", pos


def event_card(e, lang, big=False, delay=1):
    src, pos = event_photo(e)
    if big:
        return f"""
      <a class="group block no-underline" href="{href('event-' + e['slug'], lang)}" data-reveal>
        <span class="block aspect-[16/10] overflow-hidden rounded-lg bg-mist"><img class="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" src="{src}" alt="{esc(C['name'])}, {esc(e['name'])}" loading="lazy" style="object-position:{pos}"></span>
        <h3 class="mb-2 mt-5 text-[28px] group-hover:text-accent-ink" lang="en">{esc(e['name'])}</h3>
        <p class="m-0 text-muted"><span class="font-semibold text-accent-ink">{esc(e['place'][lang])}, {e['year']}</span><br>{esc(e['summary'][lang])}</p>
      </a>"""
    return f"""
      <a class="group block no-underline" href="{href('event-' + e['slug'], lang)}" data-reveal data-reveal-delay="{delay}">
        <span class="block aspect-[4/3] overflow-hidden rounded-lg bg-mist"><img class="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" src="{src}" alt="{esc(C['name'])}, {esc(e['name'])}" loading="lazy" style="object-position:{pos}"></span>
        <h3 class="mb-1.5 mt-4 text-[21px] group-hover:text-accent-ink" lang="en">{esc(e['name'])}</h3>
        <p class="m-0 text-base text-muted"><span class="font-semibold text-accent-ink">{esc(e['place'][lang])}, {e['year']}</span><br>{esc(e['summary'][lang])}</p>
      </a>"""


def orphion_caps(lang, link=True):
    items = []
    for (fa, title, desc), (slug, *_r) in zip(s.CAPABILITIES, SERVICES[lang]):
        t = esc(title[lang])
        if link:
            t = f'<a class="text-ink no-underline hover:text-accent-ink" href="{href("services", lang, "#" + slug)}">{t}</a>'
        items.append((FA_TO_ICON[fa], t, desc[lang]))
    return cap_list(items)


def orphion_home(lang):
    h = HOME[lang]
    u = UI[lang]
    first, rest = EVENTS[0], EVENTS[1:]
    rows = "".join(f"""
        <li><a class="group grid grid-cols-[112px_1fr] items-center gap-5 border-b border-line py-4 no-underline" href="{href('event-' + e['slug'], lang)}" data-reveal data-reveal-delay="{i + 1}">
          <span class="block aspect-[4/3] overflow-hidden rounded-md bg-mist"><img class="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" src="{event_photo(e)[0]}" alt="" loading="lazy" style="object-position:{event_photo(e)[1]}"></span>
          <span><span class="text-[15px] font-semibold text-accent-ink">{esc(e['place'][lang])}, {e['year']}</span><h3 class="mt-1 text-lg group-hover:text-accent-ink" lang="en">{esc(e['name'])}</h3></span></a></li>"""
                   for i, e in enumerate(rest))
    quote_txt = s.CHAIRMAN[lang][-1].replace("Because ultimately, we believe ", "").replace("Çünkü bizim için ", "")
    quote_txt = quote_txt[0].upper() + quote_txt[1:]
    actions = (f'<a class="btn" href="{href("contact", lang, "#contact-form")}">{esc(s.HERO[lang]["cta_partner"])}</a>'
               f'<a class="btn btn-ghost" href="{href("services", lang)}">{esc(s.HERO[lang]["cta_caps"])}</a>')
    return hero(lang, s.TAGLINE, s.HERO[lang]["lead"], actions, h["legend"]) + f"""

<section class="section">
  <div class="wrap grid items-start gap-12 lg:grid-cols-[5fr_7fr] lg:gap-24">
    <div class="lg:sticky lg:top-32" data-reveal>
      <h2 class="h-section">{esc(h['caps_h'])}</h2>
      <p class="lead mb-7">{esc(h['caps_p'])}</p>
      <a class="link" href="{href('services', lang)}">{esc(h['caps_link'])}</a>
    </div>
    {orphion_caps(lang)}
  </div>
</section>

<section class="section bg-ink">
  <div class="wrap">
    {section_head(h['path_h'], f'<p class="m-0 text-on-dark">{esc(h["path_p"])}</p>', dark=True)}
    {pathway(lang)}
  </div>
</section>

<section class="section">
  <div class="wrap grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
    <div data-reveal>{photo('assets/images/bg/hero-medicines.webp', 'Hekim hastaya ilacını veriyor' if lang == 'tr' else 'A physician handing medicine to a patient')}</div>
    <div data-reveal data-reveal-delay="1">
      <blockquote class="m-0"><p class="font-serif text-[clamp(24px,2.4vw,32px)] leading-[1.35] text-ink before:text-accent before:content-['“'] after:text-accent after:content-['”']">{esc(quote_txt)}</p></blockquote>
      <div class="mt-7 flex items-center gap-4">
        <img class="h-14 w-14 rounded-full object-cover object-top" src="{s.CHAIRMAN['photo']}" alt="" width="56" height="56" loading="lazy">
        <div><strong class="block text-ink">{esc(s.CHAIRMAN['name'])}</strong><span class="text-[15px] text-muted">{esc(s.CHAIRMAN['role'])}</span></div>
      </div>
      <p class="mt-8"><a class="link" href="{href('chairman', lang)}">{esc(h['quote_link'])}</a></p>
    </div>
  </div>
</section>

<section class="section bg-mist">
  <div class="wrap">
    {section_head(h['events_h'], f'<a class="link" href="{href("events", lang)}">{esc(u["all_events"])}</a>')}
    <div class="grid items-start gap-10 lg:grid-cols-[7fr_5fr] lg:gap-14">
      {event_card(first, lang, big=True)}
      <ul class="border-t border-line">{rows}
      </ul>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    {section_head(h['offices_h'], f'<p class="m-0">{esc(h["offices_p"])}</p>')}
    {offices_html(lang)}
  </div>
</section>
{cta_band(lang, h['cta_h'])}"""


def orphion_about(lang):
    a = s.ABOUT[lang]
    u = UI[lang]
    pillars = "".join(f'<li class="rounded-full border border-line bg-white px-4 py-2 text-[15px] font-medium text-ink">{esc(p)}</li>' for p in a["pillars"])
    paras = "".join(f"<p>{esc(p)}</p>" for p in a["partner"] + a["more"])
    return page_hero(lang, u["about"], esc(a["intro"][0])) + f"""
<section class="section">
  <div class="wrap grid items-start gap-12 lg:grid-cols-2 lg:gap-20">
    <p class="m-0 max-w-[30ch] font-serif text-[clamp(26px,3vw,40px)] leading-[1.3] text-ink" data-reveal>{esc(a['intro'][1])}</p>
    <div data-reveal data-reveal-delay="1">
      <h2 class="h-section">{esc(a['access_title'])}</h2>
      <p class="lead">{esc(a['access_text'])}</p>
      <ul class="mt-7 flex flex-wrap gap-2.5">{pillars}</ul>
    </div>
  </div>
</section>
<section class="section bg-mist">
  <div class="wrap grid items-start gap-12 lg:grid-cols-[5fr_7fr] lg:gap-24">
    <h2 class="h-section lg:sticky lg:top-32" data-reveal>{esc(a['more_title'])}</h2>
    <div class="prose-serif" data-reveal>{paras}</div>
  </div>
</section>
<section class="section bg-ink">
  <div class="wrap" data-reveal>
    <p class="m-0 max-w-[34ch] font-serif text-[clamp(26px,3vw,40px)] leading-[1.3] text-white">{esc(a['closing'])}</p>
    <p class="mt-7"><span class="font-semibold text-accent">{esc(a['why'])}</span> <span class="font-semibold text-white" lang="en">{esc(s.TAGLINE)}</span></p>
  </div>
</section>
<section class="section">
  <div class="wrap">
    {section_head(HOME[lang]['offices_h'], f'<a class="link" href="{href("contact", lang)}">{esc(u["contact"])}</a>')}
    {offices_html(lang)}
  </div>
</section>"""


def orphion_chairman(lang):
    c = s.CHAIRMAN
    u = UI[lang]
    paras = []
    for i, p in enumerate(c[lang]):
        if "\n" in p:
            paras.append('<div class="my-8 border-l-[3px] border-accent bg-mist px-7 py-6 text-ink">'
                         + "".join(f'<p class="m-0 [&+p]:mt-1.5">{esc(x)}</p>' for x in p.split("\n")) + "</div>")
        elif i == 0:
            paras.append(f'<p class="text-[24px] leading-[1.45] text-ink">{esc(p)}</p>')
        else:
            paras.append(f"<p>{esc(p)}</p>")
    return page_hero(lang, u["chairman"]) + f"""
<section class="section">
  <div class="wrap grid items-start gap-12 lg:grid-cols-[5fr_7fr] lg:gap-24">
    <div class="lg:sticky lg:top-32" data-reveal>
      {photo(c['photo'], c['name'], 'aspect-[4/5]', 'top', lazy=False)}
      <p class="mt-5"><strong class="block text-xl text-ink">{esc(c['name'])}</strong><span class="text-muted">{esc(c['role'])}, {esc(C['name'])}</span></p>
    </div>
    <article class="prose-serif">{''.join(paras)}
      <p class="mt-10 font-sans"><strong class="block text-ink">{esc(c['name'])}</strong><span class="text-[15px] text-muted">{esc(c['role'])}<br>{esc(C['name'])}</span></p>
    </article>
  </div>
</section>"""


def orphion_mission(lang):
    m = MISSION[lang]
    u = UI[lang]
    values = "".join(f"""
      <li class="border-t-2 border-line pt-5" data-reveal data-reveal-delay="{i + 1}"><h3 class="mb-2 text-[19px]">{esc(t)}</h3><p class="m-0 text-base text-muted">{esc(d)}</p></li>"""
                     for i, (t, d) in enumerate(m["values"]))
    block = lambda t, x, d: (f'<div data-reveal data-reveal-delay="{d}"><h2 class="mb-3.5 text-[22px] text-accent-ink">{t}</h2>'
                             f'<p class="m-0 font-serif text-[clamp(22px,2.2vw,28px)] leading-[1.4] text-ink">{esc(x)}</p></div>')
    return page_hero(lang, u["mission"]) + f"""
<section class="section">
  <div class="wrap grid gap-12 md:grid-cols-2 md:gap-20">
    {block('Misyonumuz' if lang == 'tr' else 'Our mission', m['mission'], 0)}
    {block('Vizyonumuz' if lang == 'tr' else 'Our vision', m['vision'], 1)}
  </div>
</section>
<section class="section bg-mist">
  <div class="wrap">
    {section_head(m['values_h'])}
    <ul class="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">{values}
    </ul>
  </div>
</section>"""


def orphion_services(lang):
    u = UI[lang]
    index, blocks = [], []
    for (fa, title, _d), (slug, summary, detail, ticks) in zip(s.CAPABILITIES, SERVICES[lang]):
        index.append(f'<li><a class="block border-l-2 border-line px-3.5 py-2.5 font-medium text-muted no-underline hover:border-accent hover:text-ink [&.active]:border-accent [&.active]:text-ink" href="#{slug}">{esc(title[lang])}</a></li>')
        tick_html = "".join(f'<li class="relative pl-7 before:absolute before:left-1 before:top-[.55em] before:h-[7px] before:w-3 before:-rotate-45 before:border-b-2 before:border-l-2 before:border-accent-ink before:content-[\'\']">{esc(t)}</li>' for t in ticks)
        blocks.append(f"""
      <section class="mb-14 scroll-mt-28 border-b border-line pb-14 last:mb-0 last:border-0 last:pb-0" id="{slug}" data-reveal>
        <span class="mb-5 grid h-14 w-14 place-items-center rounded-xl bg-ink text-white">{icon(FA_TO_ICON[fa], 'h-[26px] w-[26px]')}</span>
        <h2 class="text-[clamp(28px,2.6vw,36px)]">{esc(title[lang])}</h2>
        <p class="text-xl text-ink">{esc(summary)}</p>
        <p>{esc(detail)}</p>
        <ul class="mt-5 grid gap-2.5">{tick_html}</ul>
      </section>""")
    return page_hero(lang, u["services"], esc(HOME[lang]["caps_p"])) + f"""
<section class="section">
  <div class="wrap grid items-start gap-12 lg:grid-cols-[4fr_8fr] lg:gap-24">
    <nav class="lg:sticky lg:top-32" aria-label="{esc(u['services'])}"><ul class="service-index grid gap-0.5">{''.join(index)}</ul></nav>
    <div>{''.join(blocks)}</div>
  </div>
</section>
<section class="section bg-ink">
  <div class="wrap">
    {section_head(HOME[lang]['path_h'], f'<p class="m-0 text-on-dark">{esc(HOME[lang]["path_p"])}</p>', dark=True)}
    {pathway(lang)}
  </div>
</section>
{cta_band(lang, HOME[lang]['cta_h'], dark=False)}"""


def orphion_events(lang):
    u = UI[lang]
    tr = lang == "tr"
    cards = "".join(event_card(e, lang, delay=i % 3 + 1) for i, e in enumerate(EVENTS))
    lead = ("Kistik fibrozisten nadir hastalıklara, ilaç endüstrisinin en büyük fuarlarından uzmanlık kongrelerine kadar; "
            "yenilikçi tedavileri belirlemek ve onları Türkiye'deki hastalara ulaştıracak ortaklıkları kurmak için dünyanın dört bir yanındayız."
            if tr else
            "From cystic fibrosis to rare diseases, from the industry's largest trade shows to specialist congresses, we travel the "
            "world to identify innovative therapies and build the partnerships that bring them to patients in Türkiye.")
    return page_hero(lang, u["events"], esc(lead)) + f"""
<section class="section">
  <div class="wrap grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">{cards}
  </div>
</section>"""


def orphion_event(e, lang):
    u = UI[lang]
    i = EVENTS.index(e)
    gallery = "".join(
        f'<figure class="m-0 overflow-hidden rounded-lg bg-mist"><img class="max-h-[760px] w-full object-cover" src="assets/images/events/{p}" '
        f'alt="{esc(C["name"])}, {esc(e["name"])}" style="object-position:{pos}"{" loading=" + chr(34) + "lazy" + chr(34) if n else ""}></figure>'
        for n, (p, pos) in enumerate(e["photos"]))
    paras = "".join(f"<p>{esc(p)}</p>" for p in e["body"][lang])
    tags = "".join(f'<li class="rounded-full bg-mist px-3 py-1 text-sm text-muted" lang="en">#{esc(t)}</li>' for t in e["tags"])
    meta = ('<ul class="mt-6 flex flex-wrap gap-x-7 gap-y-2 text-base text-on-dark">'
            f'<li>{u["place"]}: <strong class="font-semibold text-white">{esc(e["place"][lang])}</strong></li>'
            f'<li>{u["year"]}: <strong class="font-semibold text-white">{e["year"]}</strong></li>'
            f'<li>{u["focus"]}: <strong class="font-semibold text-white">{esc(e["topic"][lang])}</strong></li></ul>')
    prev_e = EVENTS[i - 1] if i > 0 else None
    next_e = EVENTS[i + 1] if i + 1 < len(EVENTS) else None

    def pager(ev, label, right=False):
        if not ev:
            return "<span></span>"
        return (f'<a class="group no-underline{" text-right" if right else ""}" href="{href("event-" + ev["slug"], lang)}">'
                f'<small class="block text-sm text-muted">{label}</small><strong class="text-[19px] text-ink group-hover:text-accent-ink" lang="en">{esc(ev["name"])}</strong></a>')

    lead = esc(e["full"][lang]) if e["full"][lang] != e["name"] else ""
    return page_hero(lang, e["name"], lead, [(href("events", lang), u["events"])], meta) + f"""
<section class="section">
  <div class="wrap grid items-start gap-12 lg:grid-cols-2 lg:gap-20">
    <div class="grid gap-4" data-reveal>{gallery}</div>
    <article class="prose-serif" data-reveal data-reveal-delay="1">{paras}
      <blockquote class="my-8"><p class="mb-2 text-[26px] leading-[1.35] text-ink">{esc(e['motto'][lang])}</p><cite class="font-sans text-base not-italic text-muted" lang="en">{esc(C['name'])}, “{esc(s.TAGLINE)}”</cite></blockquote>
      <ul class="flex flex-wrap gap-2 font-sans">{tags}</ul>
    </article>
  </div>
  <div class="wrap"><nav class="mt-16 grid grid-cols-2 gap-6 border-t border-line pt-7" aria-label="{u['events']}">{pager(prev_e, u['prev_event'])}{pager(next_e, u['next_event'], True)}</nav></div>
</section>
{cta_band(lang, 'Bir sonraki etkinlikte görüşelim.' if lang == 'tr' else 'Let’s meet at the next event.')}"""


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
        logos = ('<ul class="mb-16 grid grid-cols-2 gap-6 md:grid-cols-4">' + "".join(
            f'<li class="grid aspect-[3/2] place-items-center rounded-lg border border-line p-6"><img src="{p["logo"]}" alt="{esc(p["name"])}" loading="lazy"></li>'
            for p in s.PARTNERS) + "</ul>")
    subject = quote("Ürün portföyü hakkında bilgi talebi" if tr else "Product portfolio information request")
    text = ('Partnerlerimizin ürün portföyü ve ürünlerin temin süreçleri hakkında ayrıntılı bilgi için bize yazın; ekibimiz en kısa sürede dönüş yapar.'
            if tr else 'Write to us for details on our partners’ product portfolio and how products are supplied; our team will get back to you shortly.')
    return page_hero(lang, u["partners_page"], esc(intro)) + f"""
<section class="section">
  <div class="wrap">{logos}
    <div class="grid scroll-mt-28 items-center gap-10 rounded-2xl bg-ink p-8 text-on-dark md:grid-cols-[7fr_5fr] md:p-14" id="portfolio" data-reveal>
      <div><h2 class="h-section text-white">{esc(u['portfolio'])}</h2><p class="m-0">{text}</p></div>
      <div class="grid justify-items-start gap-3.5">
        <a class="btn" href="mailto:{C['email']}?subject={subject}">{'Bilgi talep edin' if tr else 'Request information'} {icon('mail', 'h-5 w-5')}</a>
        <a class="text-on-dark" href="mailto:{C['email']}">{C['email']}</a>
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
  <div class="wrap grid items-start gap-12 lg:grid-cols-[5fr_7fr] lg:gap-20">
    <div class="lg:sticky lg:top-32" data-reveal><h2 class="h-section">{'Ekibimize katılın' if tr else 'Join our team'}</h2><p class="lead">{esc(paras[1])}</p></div>
    <div class="scroll-mt-28 rounded-2xl border border-line bg-white p-7 md:p-12" id="application-form" data-reveal data-reveal-delay="1">{hr_form(lang)}</div>
  </div>
</section>"""


# ---------------------------------------------------------------------------
# Ortak sayfalar
# ---------------------------------------------------------------------------

def contact_page(lang):
    u = UI[lang]
    tr = lang == "tr"
    main = s.OFFICES[0]
    if BRAND_KEY == "orphion":
        lead = ("Hasta erişimi, tedarik ya da Türkiye pazarına giriş hakkındaki talebinizi iletin; en kısa sürede dönüş yapalım." if tr else
                "Tell us about your patient access, supply or Türkiye market entry needs and we will get back to you shortly.")
    else:
        lead = ("İlaç tedariki, ihale süreçleri ya da Türkiye pazarına giriş danışmanlığı hakkındaki talebinizi iletin; en kısa sürede dönüş yapalım." if tr else
                "Tell us about your pharmaceutical supply, tender or Turkish market entry needs and we will get back to you shortly.")
    row = lambda ic, t, v: (f'<li class="grid grid-cols-[24px_1fr] gap-3.5">{icon(ic, "i mt-0.5 text-accent-ink")}'
                            f'<div><strong class="block text-ink">{t}</strong>{v}</div></li>')
    lines = "".join([
        row("mail", u["email"], f'<a class="no-underline hover:underline" href="mailto:{C["email"]}">{C["email"]}</a>'),
        row("phone", u["phone"], f'<a class="no-underline hover:underline" href="tel:{C["phone_tel"]}">{C["phone_display"]}</a>'),
        row("chat", "WhatsApp", f'<a class="no-underline hover:underline" href="{C["whatsapp"]}" target="_blank" rel="noopener">{u["whatsapp"]}</a>'),
        row("clock", u["hours"], u["hours_v"]),
    ])
    map_note = ('Haritayı görüntülemek için Google Haritalar yüklenir; bu, IP adresiniz gibi bazı verilerin Google’a iletilmesine neden olur.'
                if tr else 'Viewing the map loads Google Maps, which sends some data such as your IP address to Google.')
    return page_hero(lang, u["contact"], esc(lead)) + f"""
<section class="section">
  <div class="wrap grid items-start gap-12 lg:grid-cols-[5fr_7fr] lg:gap-20">
    <div data-reveal><h2 class="h-section">{'Bize ulaşın' if tr else 'Reach us'}</h2><ul class="mt-7 grid gap-6">{lines}</ul></div>
    <div class="scroll-mt-28 rounded-2xl border border-line bg-white p-7 md:p-12" id="contact-form" data-reveal data-reveal-delay="1">
      <h2 class="mb-6 text-[28px]">{'Mesaj gönderin' if tr else 'Send us a message'}</h2>{contact_form(lang)}
    </div>
  </div>
</section>
<section class="section bg-mist">
  <div class="wrap">
    {section_head('Ofislerimiz' if tr else 'Our offices')}
    {offices_html(lang)}
    <div class="map-consent mt-12 grid min-h-[360px] place-items-center rounded-2xl bg-white p-8 text-center [&.loaded]:block [&.loaded]:p-0 [&_iframe]:h-[420px] [&_iframe]:w-full [&_iframe]:rounded-2xl [&_iframe]:border-0" data-map-src="https://maps.google.com/maps?q={quote(main['maps_query'])}&amp;z=15&amp;output=embed" data-map-title="{esc(main['title'][lang])}">
      <div>
        <p class="font-semibold text-ink">{esc(main['title'][lang])}</p>
        <p class="mx-auto max-w-[52ch] text-muted">{map_note}</p>
        <button class="btn btn-dark js-load-map" type="button">{'Haritayı göster' if tr else 'Show map'}</button>
        <p class="mt-4"><a href="{maps_link(main)}" target="_blank" rel="noopener">{'Google Haritalar’da aç' if tr else 'Open in Google Maps'}</a></p>
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
# Rome sayfaları
# ---------------------------------------------------------------------------

def rome_lines(lang):
    R = ROME[lang]
    return cap_list([(ic, esc(t), d) for t, ic, d in zip(R["line_titles"], R["line_icons"], s.BUSINESS_LINES[lang])])


def rome_home(lang):
    R = ROME[lang]
    A = r.ROME_ABOUT[lang]
    actions = (f'<a class="btn" href="{href("contact", lang, "#contact-form")}">{esc(UI[lang]["cta"])}</a>'
               f'<a class="btn btn-ghost" href="{href("about", lang)}">{esc(R["cta2"])}</a>')
    why_t = re.sub("<[^>]+>", "", A["why_t"])
    return hero(lang, R["h1"], R["lead"], actions, R["legend"]) + f"""

<section class="section">
  <div class="wrap grid items-start gap-12 lg:grid-cols-[5fr_7fr] lg:gap-24">
    <div data-reveal><h2 class="h-section">{esc(R['lines_h'])}</h2><p class="lead">{esc(R['lines_p'])}</p></div>
    {rome_lines(lang)}
  </div>
</section>

<section class="section bg-mist">
  <div class="wrap grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
    <div data-reveal>{photo('assets/images/bg/hero-medicines.webp', 'Hekim hastaya ilacını veriyor' if lang == 'tr' else 'A physician handing medicine to a patient')}</div>
    <div data-reveal data-reveal-delay="1">
      <h2 class="h-section">{esc(why_t)}</h2>
      <p class="lead">{esc(A['why'])}</p>
      <blockquote class="mt-7"><p class="font-serif text-[clamp(24px,2.4vw,32px)] leading-[1.35] text-ink before:text-accent before:content-['“'] after:text-accent after:content-['”']">{esc(A['quote'].strip('“”'))}</p></blockquote>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    {section_head(R['offices_h'], f'<p class="m-0">{esc(R["offices_p"])}</p>')}
    {offices_html(lang)}
  </div>
</section>
{cta_band(lang, R['cta_h'])}"""


def rome_about(lang):
    R = ROME[lang]
    A = r.ROME_ABOUT[lang]
    u = UI[lang]
    block = lambda t, x, d: (f'<div data-reveal data-reveal-delay="{d}"><h2 class="mb-3.5 text-[22px] text-accent-ink">{esc(t)}</h2>'
                             f'<p class="m-0 font-serif text-[clamp(22px,2.2vw,28px)] leading-[1.4] text-ink">{esc(x)}</p></div>')
    why_t = re.sub("<[^>]+>", "", A["why_t"])
    return page_hero(lang, u["about"], esc(R["about_lead"])) + f"""
<section class="section">
  <div class="wrap grid items-start gap-12 lg:grid-cols-[5fr_7fr] lg:gap-24">
    <div class="lg:sticky lg:top-32" data-reveal><h2 class="h-section">{esc(R['lines_h'])}</h2><p class="lead">{esc(R['lines_p'])}</p></div>
    {rome_lines(lang)}
  </div>
</section>
<section class="section bg-mist">
  <div class="wrap grid gap-12 md:grid-cols-2 md:gap-20">
    {block(A['vision_t'], A['vision'], 0)}
    {block(A['mission_t'], A['mission'], 1)}
  </div>
</section>
<section class="section bg-ink">
  <div class="wrap" data-reveal>
    <h2 class="h-section text-white">{esc(why_t)}</h2>
    <p class="m-0 max-w-[36ch] font-serif text-[clamp(26px,3vw,40px)] leading-[1.3] text-white">{esc(A['why'])}</p>
  </div>
</section>
<section class="section">
  <div class="wrap">
    {section_head(R['offices_h'], f'<a class="link" href="{href("contact", lang)}">{esc(u["contact"])}</a>')}
    {offices_html(lang)}
  </div>
</section>"""


# ---------------------------------------------------------------------------
# Başlıklar, açıklamalar, çıktı
# ---------------------------------------------------------------------------

TITLES = dict(s.TITLES)
DESCRIPTIONS = dict(s.DESCRIPTIONS)
if BRAND_KEY == "orphion":
    TITLES.update({
        "services": {"tr": "Hizmetlerimiz | Orphion Pharma", "en": "Capabilities | Orphion Pharma"},
        "hr": {"tr": "İnsan Kaynakları | Orphion Pharma", "en": "Careers | Orphion Pharma"},
        "mission": {"tr": "Misyon, Vizyon ve Değerler | Orphion Pharma", "en": "Mission, Vision & Values | Orphion Pharma"},
        "partners": {"tr": "Partnerlerimiz ve Ürün Portföyümüz | Orphion Pharma", "en": "Partners & Product Portfolio | Orphion Pharma"},
    })
    DESCRIPTIONS.update({
        "services": {
            "tr": "Orphion Pharma hizmetleri: isimli hasta erişimi, kamu ve kurum tedariki, pazar erişimi ve geri ödeme, regülasyon desteği, münhasır distribütörlük, nadir hastalık ilaçları ve üreticiden hastaya doğrudan erişim.",
            "en": "Orphion Pharma capabilities: named patient access, government and institutional supply, market access and reimbursement, regulatory support, exclusive distribution, rare disease medicines and direct manufacturer-to-patient access.",
        },
        "mission": {
            "tr": "Orphion Pharma'nın misyonu, vizyonu ve değerleri: tıbbi inovasyon ile hastalar arasındaki mesafeyi kısaltmak.",
            "en": "Orphion Pharma's mission, vision and values: shortening the distance between medical innovation and patients.",
        },
        "hr": {"tr": "Orphion Pharma'da kariyer: özgeçmişinizi gönderin, ekibimize katılın.",
               "en": "Careers at Orphion Pharma: send your CV and join our team."},
    })
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
    print(f"{BRAND_KEY}: {sum(len(v) for v in PAGES.values())} sayfa -> {ROOT}")


main()
