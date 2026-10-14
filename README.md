# SMS Otomasyonu

Her reklam veya proje için müşterilere belirli günlerde (ör. **3. – 5. – 10. – 14. – 30. gün**) otomatik SMS gönderen sistem.

- **Kampanya**: Reklam veya proje. Her kampanyanın kendi SMS adımları var (gün + saat + mesaj).
- **Müşteri**: Ad, cep telefonu, SMS izni (İYS onayı), RET durumu.
- **Akış**: Müşteri bir kampanyaya eklendiği an akış başlar. Gün 0 = eklendiği gün; "3. gün" = 3 gün sonra, adımın saatinde.
- **Zamanlayıcı**: Sunucu her dakika zamanı gelen SMS'leri gönderir. Hata olursa 3 kez dener. Zamanı 24 saatten fazla geçmiş adımlar (sunucu kapalıyken kaçırılan ya da eski müşterilere sonradan eklenen adımlar) gönderilmez, "atlandı" olarak işaretlenir.

Mesajlarda `{ad}`, `{adsoyad}`, `{proje}`, `{kampanya}` değişkenleri kullanılabilir. 0. gün 00:00 = hemen gönder.

## Çalıştırma

Node.js 22.9+ gerekir (veritabanı olarak dahili SQLite kullanılır).

```bash
npm install && npm --prefix server install
cp server/.env.example server/.env   # SMS sağlayıcı bilgilerini girin

npm run server   # API + zamanlayıcı  -> http://localhost:4000
npm start        # Yönetim paneli (geliştirme) -> http://localhost:3000
```

Üretimde `npm run build` sonrası sadece `npm run server` yeterli; panel de 4000 portundan servis edilir.

`SMS_PROVIDER=console` iken SMS gönderilmez, mesajlar sunucu loguna yazılır. Gerçek gönderim için:

- **Erccell:** `SMS_PROVIDER=erccell`, `ERCCELL_USERNAME`, `ERCCELL_PASSWORD`, `ERCCELL_HEADER` (ör. `XRE`). Numaralar `90532...` biçiminde gönderilir.
- **Netgsm:** `SMS_PROVIDER=netgsm` ve `NETGSM_*` bilgileri.

Kullanıcı adı/şifreyi sadece `server/.env` dosyasına yazın; bu dosya git'e eklenmez.

Testler: `npm run server:test`

## Bitrix24 entegrasyonu (statüye göre otomatik SMS)

Her kampanya bir **Bitrix aşamasına** (deal stage veya lead statüsü) ve istenirse bir **proje alanı değerine** bağlanır.
Müşteri Bitrix'te o aşamaya girdiği anda kampanyanın SMS serisi başlar (ör. hemen "projemiz hakkında ne düşünüyorsunuz?",
3. gün "hâlâ değerlendiriyor musunuz?", 5. gün fiyat bilgisi…). Müşteri başka bir aşamaya geçince eski seri durur;
yeni aşamaya bağlı bir kampanya varsa o başlar. Kazanıldı/kaybedildi gibi kampanya bağlanmamış aşamalarda seri sadece durur.

Kurulum:
1. Bitrix'te **Gelen webhook** oluşturun (CRM izni) ve URL'yi `BITRIX_WEBHOOK_URL`'ye yazın.
2. Bitrix'te **Giden webhook** oluşturun: işleyici adresi `https://<sunucunuz>/api/bitrix/webhook`, olaylar
   `ONCRMDEALADD`, `ONCRMDEALUPDATE` (lead kullanıyorsanız `ONCRMLEADADD`, `ONCRMLEADUPDATE`). Verilen uygulama anahtarını `BITRIX_APP_TOKEN`'a yazın.
3. Projeler (West Point, Ankaport…) ayrı **pipeline** ise ek ayar gerekmez; aşama listesinde "Ankaport › Yeni müşteri" gibi görünür.
   Projeler bir **özel alanda** tutuluyorsa alan kodunu `BITRIX_PROJECT_FIELD`'a yazın.
4. Panelde kampanya oluştururken "Bitrix tetikleyicisi" bölümünden aşamayı (ve gerekiyorsa projeyi) seçin.

Telefon, deal'e bağlı kişinin (contact) ilk geçerli cep numarasından alınır. Test için: `POST /api/bitrix/sync {"type":"deal","id":123}`.

## Reklam formlarından otomatik müşteri ekleme

Meta/Google lead formu, web sitesi formu veya n8n/Zapier şu uç noktaya POST ederek müşteriyi ekleyip akışı başlatabilir:

```bash
curl -X POST http://localhost:4000/api/leads \
  -H 'content-type: application/json' -H 'x-api-key: <API_KEY>' \
  -d '{"name":"Ayşe Yılmaz","phone":"0532 111 22 33","campaign_id":1,"consent":true}'
```

Aynı telefon tekrar gelirse yeni müşteri açılmaz; mevcut müşteri kampanyaya eklenir.

## Yasal notlar (İYS / 6563 sayılı Kanun)

- Ticari SMS yalnızca **onayı olan** ve **İYS'de kayıtlı** alıcılara gönderilebilir. Sistem, izni işaretlenmemiş müşteriye SMS göndermez; Netgsm tarafında da `iysfilter` ile İYS kontrolü yapılır.
- Müşteri RET dediğinde paneldeki **RET** butonu (veya `POST /api/opt-out {"phone": "..."}`) tüm akışlarını durdurur.
- Mesajlarda ret bilgisi (ör. "SMS almamak için RET yazıp XXXX'e gönderin") bulunmalıdır.

## API özeti

| Uç nokta | Açıklama |
| --- | --- |
| `GET/POST /api/campaigns`, `GET/PUT/DELETE /api/campaigns/:id` | Kampanyalar ve adımları (`steps: [{day_offset, send_time, message}]`) |
| `GET/POST /api/customers`, `PUT/DELETE /api/customers/:id` | Müşteriler (`campaign_id` verilirse akış da başlar) |
| `GET/POST /api/enrollments`, `POST /api/enrollments/:id/cancel` | Akışlar ve her adımın planlanan zamanı/durumu |
| `POST /api/leads` | Dış entegrasyon (API anahtarı ile) |
| `POST /api/bitrix/webhook`, `POST /api/bitrix/sync` | Bitrix olayları / elle senkron |
| `GET /api/bitrix/stages?type=deal`, `GET /api/bitrix/project-options?type=deal` | Panel için aşama ve proje listeleri |
| `POST /api/opt-out` | RET |
| `GET /api/messages`, `GET /api/stats` | Gönderim geçmişi ve özet |
| `POST /api/scheduler/run` | Zamanlayıcıyı elle tetikle |

> Yönetim paneli ve API'de kullanıcı girişi yoktur; sunucuyu internete açarken önüne kimlik doğrulama (VPN, reverse proxy basic auth vb.) koyun.
