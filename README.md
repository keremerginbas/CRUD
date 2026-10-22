# Bilet Radar 🚌✈️

obilet, Enuygun, Ucuzabilet, Skyscanner ve **TCDD (YHT)** biletlerini **tek ekranda** gösteren,
sizin filtrelerinize göre **en ucuz/en uygun** olanları bulan ve **dolu bir bilet boşalınca telefonunuza
bildirim gönderen** kişisel bir bot + mobil uygulama.

```
 Telefon (Expo Go)  ──Wi-Fi──▶  Bilgisayarınızdaki sunucu  ──▶  obilet / Enuygun / Ucuzabilet / Skyscanner / TCDD
   Ara · Alarmlar · Ayarlar       arama + filtre + alarm motoru + yapay zekâ (OpenAI)
```

## Neler yapıyor?

- **Otobüs, YHT/tren ve uçak:** TCDD'nin YHT ve anahat seferleri de aynı listede; dolu YHT boşalınca alarm çalışır.
- **Güzergâh:** nereden nereye kaç km, arabayla kaç saat, seferlerin kaç saat sürdüğü, geçilen otoyollar
  (ör. O-4 Anadolu Otoyolu, D-100) ve uygulama içinde harita. **Google Maps** ve **Yandex Maps** butonlarıyla
  rota o uygulamalarda açılır (API anahtarı gerekmez).
- **Tüm sitelerde tek aramada sonuç:** dolu biletler de dahil hepsi listelenir; her kartta site, firma, saat, süre, fiyat ve boş koltuk sayısı görünür.
- **Filtreler:** dolu / müsait, site seçimi, fiyat aralığı, kalkış saati aralığı (sabah/akşam ya da ss:dd), en az boş koltuk, en uzun yolculuk süresi, firma/havayolu, sıralama (en ucuz, kalkış, en kısa, en çok koltuk).
- **Yapay zekâ asistanı:** *"Yarın akşam 18-23 arası İstanbul'dan Ankara'ya 1000 TL altı otobüs, dolu olan boşalırsa haber ver"* gibi yazın. Asistan cümlenizi filtrelere çevirir, tüm sitelerde arar, en iyi 3 seçeneği önerir ve alarm kurmayı teklif eder.
- **Alarm (bot):** kaydedilen arama 2, 5, 10 ya da 30 dakikada bir tekrar çalışır. Seçtiğiniz tarih ve saat aralığında şu durumlarda bildirim gönderir:
  - 🎉 dolu bir sefer **boşalınca**
  - 💺 koltuk açılınca
  - 📉 fiyat düşünce
  - 🆕 yeni sefer eklenince
  - ⛔ (isterseniz) sefer dolunca

## Kurulum (bir kez)

Gerekenler: bilgisayarda [Node.js 20+](https://nodejs.org), telefonda **Expo Go** (App Store / Google Play).

```bash
git clone https://github.com/keremerginbas/CRUD.git bilet-radar && cd bilet-radar
npm run setup
cp server/.env.example server/.env
```

`server/.env` dosyasını açıp doldurun:

```ini
PROVIDERS=demo            # önce demo ile deneyin, sonra "live" yapın
OPENAI_API_KEY=sk-...     # yapay zekâ için (boş kalırsa kural tabanlı asistan çalışır)
NTFY_TOPIC=               # isteğe bağlı: uygulama kapalıyken bildirim (aşağıda)
```

> 🔐 `.env` dosyası git'e gönderilmez. API anahtarınızı koda, sohbete ya da GitHub'a yazmayın. Yazdıysanız
> [platform.openai.com/api-keys](https://platform.openai.com/api-keys) adresinden iptal edip yenisini oluşturun.

## Çalıştırma

İki terminal açın:

```bash
npm run server     # ekrana "Sunucu adresi: http://192.168.x.x:4000" yazar
npm run mobile     # ekrana bir QR kod çıkar
```

1. Telefonda **Expo Go**'yu açın ve QR kodu okutun (iPhone'da kamera uygulamasıyla).
2. Uygulamada **Ayarlar** sekmesine sunucunun yazdığı adresi girin, ardından *Kaydet ve bağlantıyı test et*'e dokunun.
3. **Bildirim izni ver**'e dokunun.
4. **Ara** sekmesinden arayın ya da asistana yazın.

Telefon ve bilgisayar **aynı Wi-Fi ağında** olmalı. Bağlanmıyorsa bilgisayarın güvenlik duvarında 4000 numaralı porta izin verin.

## Gerçek sitelere bağlanma

```bash
cd server
npx playwright install chromium   # bir kez
# .env içinde PROVIDERS=live  (ya da sadece bazıları: PROVIDERS=enuygun,skyscanner)
npm start
```

Sunucu her siteyi arka planda gerçek bir tarayıcıyla açar ve sitenin kendi sonuç verisini okur.
Sitelerin adres yapısı `server/config/sites.json` dosyasındadır.

- **obilet otobüs** sayısal şehir kodu kullanır. obilet.com'da bir kez arama yapın; adres
  `obilet.com/seferler/349-356/...` gibi olur. Bu sayıları `sites.json` → `obilet.modes.bus.cities` içine
  `{"istanbul": 349, "ankara": 356}` şeklinde ekleyin.
- **Uçuşlarda** şehir yerine havalimanı kodu girin: IST, SAW, ESB, ADB, AYT…
- **TCDD (YHT):** ebilet.tcddtasimacilik.gov.tr'nin arama adresi yok. Sunucu siteyi açar, sitenin kendi oturumunu
  kullanarak istasyon listesini ve sefer/boş koltuk bilgisini sorgular. Şehir adı istasyona `sites.json` →
  `tcdd.stationAliases` ile eşlenir (ör. "istanbul" → "İSTANBUL(SÖĞÜTLÜÇEŞME)"). Pendik, Bostancı gibi başka bir
  istasyon için doğrudan istasyon adını yazabilirsiniz. Deneme: `npm run probe -- tcdd train Ankara İstanbul 2026-11-05`
- Bir site sonuç getirmiyorsa `npm run probe -- enuygun flight IST ESB 2026-11-05` komutunu çalıştırın.
  Komut, yakalanan veriyi `server/data/probe-enuygun/` klasörüne kaydeder. Bu dosyalara bakarak
  `server/src/providers/heuristic.js` uyarlanır.

⚠️ **Bilmeniz gerekenler:**
- Bu siteler herkese açık bir API sunmuyor. Otomatik sorgu yapmak kullanım koşullarına aykırı olabilir ve siteler bot korumasıyla (captcha) engelleyebilir; özellikle Skyscanner'da bu sık olur.
- Uygulama **kişisel kullanım** için tasarlandı: sonuçları 60 sn önbellekler, alarmları sırayla kontrol eder ve en sık 2 dakikada bir sorgular. Bu sınırları düşürmeyin.
- Sitelerin iç yapısı değiştikçe adaptörlerin güncellenmesi gerekebilir.
- Bilet satın alma işlemi yapılmaz. Karta dokununca ilgili sitedeki sayfa açılır.

## Güzergâh ve harita servisleri

- Rota, mesafe, süre ve otoyollar: [OSRM](https://project-osrm.org) (ücretsiz, anahtarsız). Kendi sunucunuzu kullanmak için `.env` dosyasına `OSRM_URL=` satırını ekleyin.
- Şehir konumları: yerleşik tablo, bulunamazsa OpenStreetMap Nominatim.
- Harita: Leaflet + OpenStreetMap; sunucunun `/map` sayfası uygulamaya gömülü açılır.
- Google Maps / Yandex Maps: rota bu uygulamalarda (yüklü değilse tarayıcıda) açılır; trafik ve canlı süre orada görünür.
- Tren ve uçakta harita düz çizgi ve kuş uçuşu mesafe gösterir; demiryolu hattı çizilmez.

## Uygulama kapalıyken bildirim (ntfy)

Expo Go'da uygulama açıkken alarmlar dakikada bir kontrol edilir ve yerel bildirim gösterilir. Telefon cebinizdeyken de
haber almak için:

1. Telefona **ntfy** uygulamasını kurun (ücretsiz).
2. Tahmin edilmesi zor bir konu adı seçin (ör. `bilet-radar-k7x2m9`) ve uygulamada bu konuya abone olun.
3. `server/.env` dosyasına `NTFY_TOPIC=bilet-radar-k7x2m9` satırını ekleyin.

Sunucu çalıştığı sürece alarmlar telefonunuza anlık bildirim olarak düşer. Sunucuyu sürekli açık tutmak
için evdeki bir bilgisayar, Raspberry Pi veya küçük bir VPS kullanabilirsiniz.

## Proje yapısı

```
server/                 Node.js sunucu (bot)
  src/providers/        site adaptörleri (sites.js), demo veri (mock.js), tarayıcı (browser.js), veri çıkarıcı (heuristic.js)
  src/aggregator.js     tüm sitelerde paralel arama + önbellek
  src/filters.js        filtre ve sıralama
  src/watcher.js        alarm motoru (dolu → boş, fiyat düşüşü…)
  src/ai.js             yapay zekâ asistanı (OpenAI + kural tabanlı yedek)
  src/routes.js, geo.js güzergâh, otoyollar, konum bulma
  src/providers/tcdd.js TCDD (YHT) adaptörü
  public/map.html       uygulamaya gömülen harita
  config/sites.json     site adresleri ve şehir kodları
mobile/                 Expo (React Native) uygulaması
  src/screens/          Ara, Alarmlar, Ayarlar ekranları
```

## Tasarım altyapısı (mobil)

| Kütüphane | Ne için |
|---|---|
| NativeWind 4 (Tailwind CSS 3) | Tüm stiller `className` ile; açık/koyu tema otomatik (`dark:`) |
| class-variance-authority | Buton ve rozet varyasyonları (`src/components/ui.js`) |
| tailwind-merge + clsx | Çakışan sınıfları birleştiren `cn()` (`src/lib/cn.js`) |
| lucide-react-native | İkonlar |
| react-native-reanimated | Kart giriş animasyonları, basınca küçülen butonlar |
| react-native-webview | Güzergâh haritası |
| react-native-gifted-charts | "Saate göre en ucuz fiyat" grafiği (çubuğa dokununca o saat aralığı filtrelenir) |

Renkler `mobile/tailwind.config.js` içinde tanımlı (`brand`, `ink`, `surface`, `night`, `ok`, `bad`, `warn`, `site`).
Rengi değiştirmek için oradaki değeri ve `mobile/src/theme.js`'deki aynı değeri güncellemeniz yeterli.
Tüm paketler Expo Go ile çalışır.

Testler: `npm test`
