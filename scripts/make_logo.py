#!/usr/bin/env python3
"""
CMS İnşaat / Hafriyat logosunu vektörel (şeffaf arka planlı) SVG olarak üretir,
ardından favicon ve PNG boyutlarını çıkarır.

Çıktılar: dist/assets/brand/{logo.svg, logo-light.svg, mark.svg, logo-*.png}
          dist/{favicon.ico, favicon.svg, apple-touch-icon.png, icon-192.png, icon-512.png}
"""
import io
import os

import cairosvg
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dist")
BRAND = os.path.join(OUT, "assets", "brand")
FONT_DIR = "/usr/share/fonts/opentype/inter"

GOLD = "#E8A317"
GOLD_D = "#C4870C"
DARK = "#3B3D40"
LIGHT = "#F4F4F5"


def glyph_path(font, ch, x, baseline, cap, sx=1.0):
    """Tek karakterin SVG path'i; cap = büyük harf yüksekliği (px). Dönüş: (d, advance)."""
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    gname = cmap[ord(ch)]
    cap_units = font["OS/2"].sCapHeight
    s = cap / cap_units
    pen = SVGPathPen(gs)
    tpen = TransformPen(pen, (s * sx, 0, 0, -s, x, baseline))
    gs[gname].draw(tpen)
    return pen.getCommands(), gs[gname].width * s * sx


def text_path(font, text, x, baseline, cap, sx=1.0, tracking=0.0):
    ds = []
    for ch in text:
        if ch == " ":
            x += cap * 0.32 * sx
            continue
        d, adv = glyph_path(font, ch, x, baseline, cap, sx)
        ds.append(d)
        x += adv + tracking
    return " ".join(ds), x


def arm_svg(gold, dark_cut):
    """C harfinin üst ucundan yükselen ekskavatör kolu ve M'yi ısıran kova."""
    return f"""
  <g fill="{gold}">
    <!-- bom: C'nin üst ucundan yukarı -->
    <path d="M150 168 L196 168 L232 64 Q238 44 220 38 L200 34 Q184 32 178 50 Z"/>
    <!-- stick: dirsekten sağa -->
    <path d="M196 30 Q206 14 226 18 L318 52 Q334 60 326 76 L318 92 L292 84 L216 62 Z"/>
    <!-- kova (dişleri M'nin üstüne gömülü) -->
    <path d="M296 66 Q344 58 362 98 Q372 124 360 150 L352 164 L344 154 L336 166 L328 154 L320 166 L312 154 L304 164 L298 152 Q312 124 300 104 Q290 90 270 90 Z"/>
  </g>
  <g fill="none" stroke="{dark_cut}" stroke-width="5" stroke-linecap="round">
    <path d="M206 58 L262 74"/>
    <path d="M190 120 L214 60"/>
  </g>
  <g fill="{dark_cut}">
    <circle cx="214" cy="40" r="7"/>
    <circle cx="310" cy="80" r="6"/>
    <circle cx="176" cy="150" r="5"/>
  </g>"""


def build_svg(text_color, mark_only=False):
    black = TTFont(os.path.join(FONT_DIR, "InterDisplay-Black.otf"))
    bold = TTFont(os.path.join(FONT_DIR, "InterDisplay-ExtraBold.otf"))
    cap, base = 200, 330
    c_d, c_adv = glyph_path(black, "C", 30, base, cap, sx=1.08)
    m_d, m_adv = glyph_path(black, "M", 30 + c_adv - 6, base, cap, sx=1.08)
    s_d, s_adv = glyph_path(black, "S", 30 + c_adv + m_adv - 4, base, cap, sx=1.08)
    right = 30 + c_adv + m_adv + s_adv
    letters = f"""
  <path fill="{GOLD}" d="{c_d}"/>
  <path fill="{text_color}" d="{m_d}"/>
  <path fill="{text_color}" d="{s_d}"/>"""
    cut = "#FFFFFF00"  # kesik detaylar: şeffaf görünmesi için arka plana göre seçilir
    cut = "#7A5206" if text_color == DARK else "#7A5206"
    arm = arm_svg(GOLD, cut)
    if mark_only:
        vb_w = right + 20
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 0 {vb_w:.0f} {vb_w:.0f}" '
                f'role="img" aria-label="CMS">'
                f'<g transform="translate(0 {(vb_w - 340) / 2:.0f})">{letters}{arm}</g></svg>')
    # alt yazı: İNŞAAT / HAFRİYAT
    sub_cap = 36
    left_d, x = text_path(bold, "İNŞAAT", 0, 0, sub_cap, sx=1.3, tracking=7)
    left_w = x
    _, x2 = text_path(bold, "HAFRİYAT", 0, 0, sub_cap, sx=1.3, tracking=7)
    total = left_w + 54 + x2
    start = max(24, (30 + right) / 2 - total / 2 + 10)
    sub_base = 396
    l_d, x = text_path(bold, "İNŞAAT", start, sub_base, sub_cap, sx=1.3, tracking=7)
    slash_x = x + 16
    r_d, x = text_path(bold, "HAFRİYAT", slash_x + 38, sub_base, sub_cap, sx=1.3, tracking=7)
    slash = (f'<path fill="{GOLD}" d="M{slash_x + 12:.1f} {sub_base - sub_cap - 4} L{slash_x + 26:.1f} {sub_base - sub_cap - 4} '
             f'L{slash_x + 14:.1f} {sub_base + 4} L{slash_x:.1f} {sub_base + 4} Z"/>')
    width = max(right, x) + 30
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} 420" role="img" '
            f'aria-label="CMS İnşaat Hafriyat">'
            f'<title>CMS İnşaat Hafriyat</title>{letters}{arm}'
            f'<path fill="{text_color}" d="{l_d}"/>{slash}<path fill="{text_color}" d="{r_d}"/></svg>')


def png(svg, w):
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode(), output_width=w)))


def main():
    os.makedirs(BRAND, exist_ok=True)
    dark = build_svg(DARK)
    light = build_svg(LIGHT)
    mark = build_svg(DARK, mark_only=True)
    for name, svg in (("logo.svg", dark), ("logo-light.svg", light), ("mark.svg", mark)):
        open(os.path.join(BRAND, name), "w", encoding="utf-8").write(svg)
    png(dark, 1200).save(os.path.join(BRAND, "logo-1200.png"), optimize=True)
    png(light, 480).save(os.path.join(BRAND, "logo-light-480.png"), optimize=True)
    open(os.path.join(OUT, "favicon.svg"), "w", encoding="utf-8").write(mark)
    m = png(mark, 512)
    m.save(os.path.join(OUT, "icon-512.png"), optimize=True)
    m.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, "icon-192.png"), optimize=True)
    # apple-touch: beyaz zemin üzerinde
    bg = Image.new("RGBA", (180, 180), (255, 255, 255, 255))
    small = m.resize((156, 156), Image.LANCZOS)
    bg.alpha_composite(small, (12, 12))
    bg.convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"), optimize=True)
    m.save(os.path.join(OUT, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print("logo + favicon üretildi")


if __name__ == "__main__":
    main()
