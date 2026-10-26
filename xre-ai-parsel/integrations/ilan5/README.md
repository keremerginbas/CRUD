# İlan5 eklentisi → XRE Parsel Sorgu aktarımı

İlan5 (3.2.0+) arşivindeki **arsa** ilanlarını XRE'ye emsal olarak gönderir. Gönderilen alanlar: kaynak, ilan no, URL, başlık, fiyat, para birimi, m², il/ilçe/mahalle, kategori, imar/KAKS/gabari/tapu/ada-parsel beyanı, tarama tarihi, yayından kalkma durumu. **Satıcı adı, telefon, açıklama, fotoğraf ve notlar gönderilmez.**

## Sunucu
`.env` → `XRE_INGEST_TOKEN=<en az 16 karakter rastgele>` → yeniden başlat. Uç noktalar:
- `POST /api/ingest/listings` — `Authorization: Bearer <token>`, gövde `{records:[...]}` (en çok 2000)
- `GET /api/ingest/ping` — bağlantı testi

## Eklenti
`xre-sync.js` eklenti klasörüne eklenir; `background.js` onu `importScripts` ile yükler, `ILAN_XRE_*` komutlarını ve `xre.sync.auto` alarmını yönlendirir. Popup'taki **XRE Parsel Sorgu'ya aktar** bölümü adresi ve anahtarı kaydeder (adres için izin istenir), bağlantıyı test eder, değişen ilanları veya tümünü aktarır; isteğe bağlı 30 dakikada bir otomatik aktarım.
