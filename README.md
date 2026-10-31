# SEED/STUDIO — Generatif Web Deneyimi

Her ziyarette (ve her **↻ Yeniden üret** tıklamasında) kendini yeniden kuran bir site.
Tek bir **tohum** (seed) değerinden renk paleti, hero'daki akış alanı ve galerideki 7 generatif eser
deterministik olarak üretilir. Aynı tohum her zaman aynı dünyayı verir: `?seed=0x...` ile paylaşılabilir.

## Yığın

| Katman | Kullanım |
|---|---|
| **HTML / JS (React 18 + Vite)** | Bileşen tabanlı arayüz, Canvas 2D generatif çizim |
| **Tailwind CSS v4** | `@theme` token'ları; `c1..c4` renkleri tohumla CSS değişkeni olarak değişir |
| **GSAP** (yüklenen `gsap-public.zip` → `src/vendor/gsap`) | ScrollTrigger, SplitText, ScrambleText, DrawSVG, MotionPath, CustomEase |
| **Lenis** | Pürüzsüz kaydırma; README'deki resmi GSAP senkronu (`gsap.ticker` → `lenis.raf`) |
| **Node.js / Express** | `dist/` sunumu + `/api/seed` (günün tohumu), `/api/palette/:seed` |
| **Figma** | `design/tokens.json` — Tokens Studio for Figma formatında renk/tipografi/radius token'ları |

## Bölümler

1. **Loader**: sayaç ve tohum karıştırma (ScrambleText), ardından perde açılır.
2. **Hero**: imleçle itilen, kaydırma hızıyla bükülen simplex-gürültü akış alanı ve SplitText başlık.
3. **Hız şeridi**: Lenis hızıyla hızlanan, yönü değişen ve eğilen sonsuz marquee (ReactBits *Scroll Velocity* fikri).
4. **Manifesto**: kaydırmayla kelime kelime aydınlanan metin.
5. **Galeri**: sabitlenmiş yatay kaydırma, 7 algoritma (Akış Alanı, Sırtlar, Bölünme, Paketleme, Truchet, Yörüngeler, Yarım Ton) ve 3B eğilen kartlar (*Tilted Card*). Karta tıklayınca yeni bir varyasyon üretilir.
6. **Laboratuvar**: algoritma seçimi, yoğunluk ve kaos sürgüleri, tohum girişi, PNG indirme ve "siteye uygula".
7. **Süreç**: üst üste yığılan yapışkan kartlar (*Scroll Stack*), DrawSVG çizimleri ve MotionPath üzerinde ilerleyen nokta.
8. **Footer**: imleçle dalgalanan dev tipografi ve tohumlu bağlantı paylaşımı.

Bunlara ek olarak özel imleç, tıklama kıvılcımları (*Click Spark*), manyetik butonlar, grain dokusu ve `prefers-reduced-motion` desteği bulunur.

## Çalıştırma

```bash
npm install
npm run dev        # Vite geliştirme sunucusu (http://localhost:5173), /api → :3000 proxy
npm start          # ayrı terminalde Node API sunucusu (http://localhost:3000)
npm run serve      # üretim: build + Express ile tek sunucu
```

## Yapı

```
server/index.js          Express: statik dosyalar + generatif API
src/lib/random.js        tohumlu PRNG, simplex gürültü, palet üretimi (sunucu ve istemci ortak)
src/lib/art.js           7 generatif algoritma
src/lib/gsap.js          zip'teki GSAP + eklenti kaydı + useGsap hook
src/lib/lenis.jsx        Lenis ↔ ScrollTrigger senkronu, hız ref'i
src/lib/seed.jsx         tohum/palet context'i, URL senkronu
src/components/          FlowField, Cursor, ClickSpark, Magnetic, TiltCard, ArtCanvas, Loader...
src/sections/            Nav, Hero, VelocityMarquee, Manifesto, Gallery, Lab, Process, Footer
design/tokens.json       Figma (Tokens Studio) token'ları
```
