# Exca Dijital — Kurumsal Web Sitesi

Exca Dijital'in çok sayfalı, React (Create React App + React Router)
tabanlı kurumsal web sitesi. Orijinal tek-sayfa HTML şablonundaki tüm
tasarım dili, animasyonlar ve gerçek zamanlı WebGL (three.js) arka plan
motoru korunarak ayrı sayfalara (Ana Sayfa, Hakkımızda, Hizmetler, Süreç,
Projeler, Paketler, SSS, İletişim) bölündü.

## Çalıştırma

```bash
npm install
npm start      # geliştirme sunucusu — http://localhost:3000
npm run build  # production build — build/ klasörü
```

## Proje Yapısı

```
public/index.html         — three.js CDN script, meta/SEO etiketleri
src/
  engine/backgroundEngine.js — 6 sahneli WebGL arka plan motoru
  styles/global.css          — tüm tasarım sistemi (tokens, bileşenler)
  components/                — Layout, Nav, Footer, Counter, Testimonials...
  hooks/                      — useReveal, useRotator, usePageTitle
  pages/                      — Home, About, Services, Process, Portfolio,
                                 Pricing, FAQ, Contact, NotFound
```

## Sayfalar

| Yol | Sayfa |
|---|---|
| `/` | Ana Sayfa |
| `/hakkimizda` | Hakkımızda |
| `/hizmetler` | Hizmetler |
| `/surec` | Süreç |
| `/projeler` | Projeler |
| `/paketler` | Paketler |
| `/sss` | SSS |
| `/iletisim` | İletişim |

## Kurumsal E-posta

`kurumsal@excadijital.com.tr` adresinin hosting panelinizde (cPanel/Plesk)
nasıl kurulacağı, DNS/SPF/DKIM/DMARC ayarları dahil adım adım
[`docs/E-POSTA-KURULUM-REHBERI.md`](./docs/E-POSTA-KURULUM-REHBERI.md)
dosyasında anlatılmıştır.

## Dağıtım (Deploy)

`npm run build` sonrası oluşan `build/` klasörü herhangi bir statik
hosting'e (kendi hosting paneliniz, Netlify, Vercel vb.) yüklenebilir. Site
istemci tarafında yönlendirme (client-side routing) kullandığından, hosting
tarafında "tüm yolları `index.html`'e yönlendir" (SPA fallback) ayarının
açık olması gerekir.
