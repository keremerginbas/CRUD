#!/usr/bin/env python3
"""
Yeni tasarım önizlemesi üreticisi (Orphion + Rome ana sayfa).

    python3 tools/build_redesign.py

Çıktı: redesign/index.html (Orphion), redesign/rome.html (Rome)
Dünya haritası noktaları: tools/redesign_map.json (d3-geo ile bir kez üretildi).
"""

import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "redesign"
MAP = json.loads((Path(__file__).resolve().parent / "redesign_map.json").read_text())

OFFICES = [
    {"key": "ankara", "city": "Ankara", "role": "Merkez ofis",
     "address": "Kızılırmak Mah. Dumlupınar Bulvarı<br>NEXT LEVEL İş Merkezi A Blok No:3/108 Kat:23<br>Çankaya / Ankara",
     "phones": [("+90 312 215 50 10", "+903122155010"), ("+90 312 222 54 58", "+903122225458")],
     "tz": "Europe/Istanbul"},
    {"key": "dubai", "city": "Dubai", "role": "Uluslararası operasyonlar",
     "address": "Meydan Grandstand, 6th Floor<br>Meydan Road, Nad Al Sheba<br>Dubai, B.A.E.",
     "phones": [], "tz": "Asia/Dubai"},
    {"key": "ohio", "city": "Ohio", "role": "ABD irtibat ofisi",
     "address": "3324 Sunbeam Place<br>Batavia, OH 45103<br>Amerika Birleşik Devletleri",
     "phones": [("+1 513 388 1634", "+15133881634")], "tz": "America/New_York"},
]

ICONS = {
    "analysis": '<path d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6"/><circle cx="19" cy="7" r="1.6"/>',
    "regulation": '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 13l2 2 4-4"/>',
    "people": '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3.5 19c.6-3 2.8-5 5.5-5s4.9 2 5.5 5M14.5 14.6c2.4-.4 4.6 1.2 5.2 4.4"/>',
    "patient": '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/><path d="M12 10v4M10 12h4"/>',
    "supply": '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>',
    "consult": '<path d="M4 5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    "arrow": '<path d="M5 12h14M13 6l6 6-6 6"/>',
    "quote": '<path d="M9 7H6a2 2 0 0 0-2 2v3h5v5H4M20 7h-3a2 2 0 0 0-2 2v3h5v5h-5"/>',
}


def icon(name, cls=""):
    return (f'<svg class="{cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>')


BRANDS = {
    "orphion": {
        "file": "index.html", "name": "Orphion Pharma", "email": "info@orphionpharma.com",
        "favicon": "assets/img/favicon-32.png",
        "logo_light": ("assets/img/orphion-logo-white.webp", 702, 280),
        "logo_dark": ("assets/img/orphion-logo.webp", 702, 280),
        "tag": "Uluslararası ilaç ve hasta erişim şirketi",
        "h1": 'Bridging Innovation and Life.', "h1_lang": "en",
        "lede": ("Ciddi ve nadir hastalıklarda, dünyanın farklı noktalarında geliştirilen tedaviler ile onlara "
                 "ihtiyaç duyan hastalar arasındaki mesafeyi kısaltıyoruz."),
        "float": ("Stratejik yerel ortak", "Global ilaç ve biyoteknoloji şirketlerine Türkiye'de uçtan uca eşlik."),
        "about_kicker": "Hakkımızda",
        "about_h2": "Hasta erişimi yalnızca bir ilacın tedarik edilmesi değildir.",
        "about_p": [
            "Bir tedavinin hastaya ulaşması; regülasyon, pazar erişimi, geri ödeme, fiyatlandırma, tedarik zinciri, "
            "lojistik ve yerel paydaş yönetiminin birlikte ve doğru şekilde yürütülmesini gerektirir.",
            "Orphion, global ilaç ve biyoteknoloji şirketlerine bu yolculukta stratejik yerel ortak olarak eşlik eder.",
        ],
        "chips": ["Regülasyon", "Pazar erişimi", "Geri ödeme", "Fiyatlandırma", "Tedarik zinciri", "Lojistik", "Yerel paydaş yönetimi"],
        "badge": ("Ciddi ve nadir hastalıklar", "Karşılanmamış tıbbi ihtiyacın yüksek olduğu alanlara odaklanıyoruz."),
        "services_h2": "Tedarikten fazlası. Temsilcilikten fazlası.",
        "services_p": "Her tedaviyi kendi klinik ihtiyacı, hasta popülasyonu, düzenleyici yolu ve pazar dinamikleri içinde değerlendiriyoruz.",
        "services": [
            ("analysis", "Pazar ve ihtiyaç analizi", "Pazar fırsatlarını ve karşılanmamış klinik ihtiyaçları değerlendiriyoruz."),
            ("regulation", "Regülasyon ve ticari erişim", "Düzenleyici ve ticari erişim yollarını oluşturuyoruz."),
            ("people", "Paydaş yönetimi", "Sağlık otoriteleri, geri ödeme kurumları, hekimler ve diğer paydaşlarla süreçleri yönetiyoruz."),
            ("patient", "Named Patient ve erken erişim", "Uygun olduğunda isimli hasta ve erken erişim programlarını yürütüyoruz."),
            ("supply", "Kamu tedariki ve pazara giriş", "Kamu tedariklerinden uzun vadeli pazara giriş stratejilerine kadar süreci uçtan uca destekliyoruz."),
        ],
        "chair": {
            "photo": "assets/img/chairman-fevzi-aydin.webp", "name": "Fevzi Aydın", "role": "Chairman & Managing Partner",
            "quote": ("Bizim için bir ilacın değeri, yalnızca geliştirildiği laboratuvarda veya aldığı ruhsatta değil, "
                      "ihtiyaç duyan hastaya gerçekten ulaştığı anda ortaya çıkar."),
        },
        "cta_h2": "Bir tedaviyi Türkiye'deki hastalara ulaştırmak mı istiyorsunuz?",
        "footer_line": "Bridging Innovation and Life.",
    },
    "rome": {
        "file": "rome.html", "name": "Rome Pharma", "email": "fevziaydin@rome-pharma.com",
        "favicon": "assets/img/rome-favicon-32.png",
        "logo_light": ("assets/img/rome-logo-white.webp", 347, 199),
        "logo_dark": ("assets/img/rome-logo.webp", 760, 436),
        "tag": "İlaç tedarik ve danışmanlık şirketi",
        "h1": "Türkiye’nin ilaç tedarikinde güvenilir marka.", "h1_lang": "tr",
        "lede": ("Rome Pharma, Rome Group çatısı altında uluslararası ilaç firmalarının Türkiye pazarına erişimini "
                 "kolaylaştırır; devlet kurumlarına ve özel sektöre güvenilir çözümler sunar."),
        "float": ("Türkiye pazarına erişim", "Uluslararası ilaç firmaları ile Türk sağlık sistemi arasında köprü."),
        "about_kicker": "Hakkımızda",
        "about_h2": "Uluslararası firmaların Türkiye ilaç pazarındaki ilk adresi olmak.",
        "about_p": [
            "Vizyonumuz, hastaların yeni orijinal ilaçlara ve daha iyi jenerik ilaçlara erişimini artırmaktır.",
            "Misyonumuz, Türkiye’de ilaç tedarik eden uluslararası firmalar ile Türk bürokrasisi ve ilaç tedarikçisi "
            "kurumlar arasında sürdürülebilir ilişkiler kurarak sinerji yaratmaktır.",
        ],
        "chips": ["Doğrudan tedarik", "Devlet ihaleleri", "Yurt Dışı İlaç Programı", "Danışmanlık", "Yerel temsilcilik"],
        "badge": ("Rome Group", "Dünyanın önde gelen ilaç firmaları ile iş birliği."),
        "services_h2": "İki ana iş kolumuz",
        "services_p": "Uluslararası firmaların Türkiye pazarına sorunsuz bir şekilde giriş yapmasını sağlıyoruz.",
        "services": [
            ("supply", "İlaç tedariki", "Doğrudan tedarik programları, devlet ihaleleri ve reçeteye dayalı programlar (Yurt Dışı İlaç Programı) için farmasötik ürünlerin tedarik edilmesi."),
            ("consult", "Danışmanlık ve yerel temsilcilik", "Türkiye ilaç pazarına girmeyi planlayan uluslararası firmalara danışmanlık verilmesi ve yerel temsilcilik yapılması."),
        ],
        "chair": None,
        "cta_h2": "Türkiye ilaç pazarına girmeyi mi planlıyorsunuz?",
        "footer_line": "Healthcare Solutions",
    },
}

BRIDGE = [
    ("İnovasyon", "Dünyanın farklı noktalarında geliştirilen tedaviler"),
    ("Regülasyon", "Düzenleyici ve ticari erişim yolları"),
    ("Geri ödeme", "Sağlık otoriteleri ve geri ödeme kurumları"),
    ("Tedarik", "Named Patient, erken erişim ve kamu tedariki"),
    ("Hasta", "Tedaviye ihtiyaç duyan insan"),
]


def world_map():
    W, H, p = MAP["W"], MAP["H"], MAP["pts"]

    def arc(a, b, lift):
        (x1, y1), (x2, y2) = p[a], p[b]
        cx, cy = (x1 + x2) / 2, min(y1, y2) - lift
        return f"M{x1} {y1} Q{cx:.1f} {cy:.1f} {x2} {y2}"

    arcs = [arc("ankara", "dubai", 60), arc("ankara", "ohio", 150)]
    labels = {"ankara": ("Ankara", "Merkez", 14, -16), "dubai": ("Dubai", "Operasyon", 14, 22), "ohio": ("Ohio", "ABD irtibat", -14, -16)}
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Ankara, Dubai ve Ohio ofislerini birbirine bağlayan dünya haritası">',
           f'<path class="land" d="{MAP["d"]}"/>']
    for i, d in enumerate(arcs):
        out.append(f'<path class="arc" d="{d}"/><path class="arc-flow {"ab"[i]}" d="{d}" pathLength="826"/>')
    for i, (k, (name, sub, dx, dy)) in enumerate(labels.items()):
        x, y = p[k]
        anchor = "end" if dx < 0 else "start"
        out.append(f'<circle class="pulse {"abc"[i]}" cx="{x}" cy="{y}" r="9"/><circle class="pin" cx="{x}" cy="{y}" r="6"/>'
                   f'<text class="label" x="{x + dx}" y="{y + dy}" text-anchor="{anchor}">{name}</text>'
                   f'<text class="label-sub" x="{x + dx}" y="{y + dy + 17}" text-anchor="{anchor}">{sub}</text>')
    out.append("</svg>")
    return "".join(out)


def page(key):
    b = BRANDS[key]
    other = "rome" if key == "orphion" else "orphion"
    img = f"assets/img/{key}"

    stations = "".join(f"<li><strong>{t}</strong>{d}</li>" for t, d in BRIDGE)
    chips = "".join(f"<li>{c}</li>" for c in b["chips"])
    cards = "".join(
        f'<article class="card reveal reveal-d{i % 3 + 1}"><div class="icon">{icon(ic)}</div><h3>{t}</h3><p>{d}</p></article>'
        for i, (ic, t, d) in enumerate(b["services"])
    )
    offices = "".join(
        f'<div class="office reveal reveal-d{i + 1}"><h3>{o["city"]}</h3><p class="role">{o["role"]}</p>'
        f'<address>{o["address"]}</address>'
        + (f'<p class="phones">' + "".join(f'<a href="tel:{t}">{d}</a>' for d, t in o["phones"]) + "</p>" if o["phones"] else "")
        + f'<p class="clock" data-tz="{o["tz"]}"></p></div>'
        for i, o in enumerate(OFFICES)
    )
    nav = (['<a href="#hakkimizda">Kurumsal</a>'] if b["chair"] else ['<a href="#hakkimizda">Hakkımızda</a>'])
    nav += ['<a href="#hizmetler">Hizmetler</a>', '<a href="#ofisler">Ofisler</a>', '<a href="#iletisim">İletişim</a>']

    chair = ""
    if b["chair"]:
        c = b["chair"]
        chair = f"""
    <section class="section">
      <div class="wrap chair">
        <div class="chair-photo reveal"><img src="{c['photo']}" width="720" height="994" alt="{c['name']}" loading="lazy"></div>
        <figure class="reveal reveal-d1">
          <blockquote>{icon('quote')}<p>{c['quote']}</p></blockquote>
          <figcaption><strong>{c['name']}</strong>{c['role']}</figcaption>
          <a class="more" href="#">Mesajın tamamını okuyun</a>
        </figure>
      </div>
    </section>"""

    ll, ld = b["logo_light"], b["logo_dark"]
    cards_cls = "cards" if len(b["services"]) > 2 else "cards cards--two"

    return f"""<!DOCTYPE html>
<html lang="tr" data-brand="{key}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>{b['name']} | Yeni tasarım önizlemesi</title>
  <link rel="icon" type="image/png" href="{b['favicon']}">
  <link rel="preload" href="assets/fonts/schibsted-normal-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="assets/css/fonts.css">
  <link rel="stylesheet" href="assets/css/site.css">
</head>
<body>
  <a class="skip" href="#main">İçeriğe geç</a>

  <header class="site-header">
    <div class="wrap">
      <a class="brand" href="{b['file']}">
        <img class="logo-light" src="{ll[0]}" width="{ll[1]}" height="{ll[2]}" alt="{b['name']}">
        <img class="logo-dark" src="{ld[0]}" width="{ld[1]}" height="{ld[2]}" alt="" aria-hidden="true">
      </a>
      <nav class="nav" id="nav" aria-label="Ana menü">{''.join(nav)}</nav>
      <div class="lang" aria-label="Dil seçimi"><a href="{b['file']}" hreflang="tr" aria-current="true">TR</a><a href="#" hreflang="en">EN</a></div>
      <a class="btn btn--accent" href="#iletisim">Bize ulaşın</a>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="nav" aria-label="Menüyü aç"><span></span><span></span><span></span></button>
    </div>
  </header>

  <main id="main">
    <section class="hero">
      <canvas id="network" aria-hidden="true"></canvas>
      <div class="wrap hero-grid">
        <div class="hero-copy">
          <p class="hero-tag"><i aria-hidden="true"></i>{b['tag']}</p>
          <h1 lang="{b['h1_lang']}">{b['h1']}</h1>
          <p class="hero-lede">{b['lede']}</p>
          <div class="hero-actions">
            <a class="btn btn--accent" href="#iletisim">Bize ulaşın {icon('arrow')}</a>
            <a class="btn btn--ghost-light" href="#hizmetler">Hizmetlerimiz</a>
          </div>
        </div>
        <div class="hero-visual" aria-hidden="true">
          <div class="capsule capsule--a"><img src="{img}/cap-a.webp" width="270" height="634" alt=""></div>
          <div class="capsule capsule--b"><img src="{img}/cap-b.webp" width="400" height="700" alt=""></div>
          <div class="capsule capsule--c"></div>
          <div class="float-card"><strong>{b['float'][0]}</strong>{b['float'][1]}
            <div class="route"><b></b><s></s>Türkiye<s></s><b></b></div>
          </div>
        </div>
      </div>
      <div class="bridge-band">
        <div class="wrap bridge" role="group" aria-label="Bir tedavinin hastaya ulaşma yolu">
          <svg viewBox="0 0 1200 40" aria-hidden="true" focusable="false">
            <path class="bridge-line" d="M24 20 H1176" pathLength="1200"/>
            <path class="bridge-glow" d="M24 20 H1176" pathLength="1200"/>
            <rect class="bridge-cap" x="0" y="8" width="48" height="24" rx="12"/>
            <circle class="bridge-node" cx="360" cy="20" r="9"/>
            <circle class="bridge-node" cx="600" cy="20" r="9"/>
            <circle class="bridge-node" cx="840" cy="20" r="9"/>
            <rect class="bridge-cap" x="1152" y="8" width="48" height="24" rx="12"/>
          </svg>
          <ol class="bridge-stations">{stations}</ol>
        </div>
      </div>
    </section>

    <section class="section" id="hakkimizda">
      <div class="wrap about">
        <div class="about-media reveal">
          <span class="pill-deco" aria-hidden="true"></span>
          <div class="photo"><img src="{img}/about.webp" width="710" height="560" alt="Laboratuvar çalışması" loading="lazy"></div>
          <div class="badge"><strong>{b['badge'][0]}</strong>{b['badge'][1]}</div>
        </div>
        <div class="reveal reveal-d1">
          <p class="kicker">{b['about_kicker']}</p>
          <h2>{b['about_h2']}</h2>
          {''.join(f'<p>{x}</p>' for x in b['about_p'])}
          <ul class="chips">{chips}</ul>
        </div>
      </div>
    </section>

    <section class="section services" id="hizmetler">
      <div class="wrap">
        <div class="section-head center reveal">
          <p class="kicker">Hizmetler</p>
          <h2>{b['services_h2']}</h2>
          <p class="center">{b['services_p']}</p>
        </div>
        <div class="{cards_cls}">{cards}</div>
      </div>
    </section>

    <section class="section global" id="ofisler">
      <div class="wrap">
        <div class="section-head reveal">
          <p class="kicker">Küresel varlık</p>
          <h2>Türkiye'den dünyaya üç ofis</h2>
          <p>Türkiye'deki yerel yapılanmamızı Dubai'deki uluslararası operasyonlarımız ve ABD'deki erişim ağımızla birleştiriyoruz.</p>
        </div>
        <div class="map reveal">{world_map()}</div>
        <div class="offices">{offices}</div>
      </div>
    </section>
{chair}
    <section class="section" id="iletisim">
      <div class="wrap">
        <div class="cta-box reveal">
          <div>
            <h2>{b['cta_h2']}</h2>
            <p>Bize yazın, ekibimiz en kısa sürede dönüş yapsın: <a class="mail" href="mailto:{b['email']}">{b['email']}</a></p>
          </div>
          <a class="btn btn--light" href="#">İletişim formunu açın {icon('arrow')}</a>
        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="wrap">
      <div class="footer-grid">
        <div>
          <img class="f-logo" src="{ll[0]}" width="{ll[1]}" height="{ll[2]}" alt="{b['name']}" loading="lazy">
          <p style="margin-top:16px" lang="en">{b['footer_line']}</p>
        </div>
        <div><h3>Ankara, merkez ofis</h3><address>NEXT LEVEL İş Merkezi A Blok<br>Çankaya / Ankara</address><a href="tel:+903122155010">+90 312 215 50 10</a></div>
        <div><h3>Dubai</h3><address>Meydan Grandstand, 6th Floor<br>Dubai, B.A.E.</address></div>
        <div><h3>Ohio</h3><address>Batavia, OH 45103<br>ABD</address><a href="tel:+15133881634">+1 513 388 1634</a></div>
      </div>
      <div class="footer-bottom">
        <span>© <span data-year>2026</span> {b['name']}</span>
        <span><a href="mailto:{b['email']}">{b['email']}</a> &nbsp; <a href="#">KVKK Aydınlatma Metni</a></span>
      </div>
    </div>
  </footer>

  <nav class="proto-bar" aria-label="Önizleme">
    <a href="index.html"{' aria-current="page"' if key == 'orphion' else ''}>Orphion</a>
    <a href="rome.html"{' aria-current="page"' if key == 'rome' else ''}>Rome</a>
  </nav>

  <script src="assets/js/site.js" defer></script>
</body>
</html>
"""


if __name__ == "__main__":
    for k, b in BRANDS.items():
        (OUT / b["file"]).write_text(page(k), encoding="utf-8")
        print("yazıldı:", b["file"])
