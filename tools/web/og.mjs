// Sosyal medya paylaşım görselleri (1200×630): her marka ve dil için bir tane.
// Kullanım: node og.mjs  → ../../{orphion,rome}-pharma/assets/images/og-{tr,en}.jpg
// Görseller depoya eklenir; yalnızca metin/tasarım değişince yeniden çalıştırmak yeterli.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // önceden kurulu Playwright
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const b64 = (p) => readFileSync(p).toString("base64");
const font = (f) => `url(data:font/woff2;base64,${b64(path.join(here, "fonts", f))}) format("woff2")`;

const BRANDS = {
  orphion: {
    dir: "orphion-pharma", logo: "orphion-logo-white.webp", ink: "#16213A", deep: "#0F1729", accent: "#FF914B",
    domain: "orphionpharma.com",
    tr: { kicker: "Dubai · Türkiye · ABD", title: "Yenilikçi ve nadir hastalık ilaçlarını Türkiye’deki hastalarla buluşturuyoruz.",
          tags: ["İsimli hasta erişimi", "Kamu tedariki", "Pazar erişimi"] },
    en: { kicker: "Dubai · Türkiye · USA", title: "Bringing innovative and rare disease medicines to patients in Türkiye.",
          tags: ["Named patient access", "Public supply", "Market access"] },
  },
  rome: {
    dir: "rome-pharma", logo: "rome-logo-white.webp", ink: "#0F2A40", deep: "#0A1E2F", accent: "#2DCE98",
    domain: "romepharma.com",
    tr: { kicker: "Ankara · Dubai · ABD", title: "Uluslararası ilaç firmalarını Türkiye pazarına taşıyoruz.",
          tags: ["İlaç tedariki", "Devlet ihaleleri", "Pazara giriş danışmanlığı"] },
    en: { kicker: "Ankara · Dubai · USA", title: "Helping international pharma companies enter the Turkish market.",
          tags: ["Pharmaceutical supply", "Government tenders", "Market entry consulting"] },
  },
};

function html(b, t) {
  const logo = b64(path.join(repo, b.dir, "assets/images", b.logo));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:G;src:${font("schibsted-normal-latin.woff2")};unicode-range:U+0000-00FF,U+2000-206F}
@font-face{font-family:G;src:${font("schibsted-normal-latin-ext.woff2")};unicode-range:U+0100-024F}
@font-face{font-family:S;src:${font("sourceserif-normal-latin.woff2")};unicode-range:U+0000-00FF,U+2000-206F}
@font-face{font-family:S;src:${font("sourceserif-normal-latin-ext.woff2")};unicode-range:U+0100-024F}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;font-family:G,sans-serif;color:#fff;
 background:radial-gradient(circle at 88% 12%,${b.accent}38,transparent 42%),radial-gradient(circle at 8% 110%,${b.accent}22,transparent 40%),linear-gradient(135deg,${b.ink},${b.deep})}
.wrap{position:absolute;inset:0;padding:64px 72px;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:center}
.top img{height:84px}
.kick{font-size:22px;letter-spacing:.14em;text-transform:uppercase;color:#ffffffb3}
h1{font-family:S,serif;font-weight:400;font-size:62px;line-height:1.12;max-width:960px;margin-top:auto;letter-spacing:-.01em}
.bar{width:96px;height:6px;border-radius:3px;background:${b.accent};margin:34px 0 26px}
.bot{display:flex;justify-content:space-between;align-items:center}
ul{display:flex;gap:12px;padding:0;list-style:none}
li{font-size:21px;padding:9px 18px;border:1.5px solid #ffffff40;border-radius:999px;color:#ffffffe0}
.dom{font-size:24px;font-weight:600;color:${b.accent}}
.ring{position:absolute;right:-140px;top:150px;width:520px;height:520px;border-radius:50%;border:2px solid #ffffff12}
.ring.b{right:-60px;top:230px;width:360px;height:360px;border-color:${b.accent}30}
</style></head><body><div class="ring"></div><div class="ring b"></div><div class="wrap">
<div class="top"><img src="data:image/webp;base64,${logo}" alt=""><span class="kick">${t.kicker}</span></div>
<h1>${t.title}</h1><div class="bar"></div>
<div class="bot"><ul>${t.tags.map((x) => `<li>${x}</li>`).join("")}</ul><span class="dom">${b.domain}</span></div>
</div></body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const [key, b] of Object.entries(BRANDS)) {
  for (const lang of ["tr", "en"]) {
    await page.setContent(html(b, b[lang]), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(repo, b.dir, "assets/images", `og-${lang}.jpg`);
    await page.screenshot({ path: out, type: "jpeg", quality: 88 });
    console.log(key, lang, "->", path.relative(repo, out));
  }
}
await browser.close();
