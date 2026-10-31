# Santral — Numara Maskeleme ve Çağrı Takip Uygulaması

fibimi IRM'deki "dijital telefon / maske no" mantığının şirket içi karşılığı:

- **Danışman müşteriyi aradığında** müşteri danışmanın cep numarasını değil, danışmanın **dijital (maske) numarasını** görür. Müşteriye "satış danışmanınız sizi arıyor, görüşmeniz kayıt altındadır" anonsu çalınır, görüşme kaydedilir.
- **Müşteri dijital numarayı / ilan numarasını aradığında** çağrı mesai saatleri içindeyse danışmanın telefonuna yönlendirilir. Danışman açmadan önce "Alıcı Mustafa Utku, Zübeyde Hanım dükkan ilanından arıyor" anonsunu duyar ve telefonuna bildirim düşer. Mesai dışındaysa çağrı karşılama hattına (444'teki 7 hat) gider, danışmana cevapsız çağrı bildirimi gelir.
- **444 24 53'ü arayan** müşteri santralin kuyruğuna düşer; 7 karşılama hattından hangisi müsaitse o açar.
- Bütün çağrılar, hangi numaranın arandığı, süre ve ses kaydı uygulamada listelenir. Kayıtları danışmanın kendisi, izin verirse broker/asistan dinler.

## Önemli: maskeleme telefonda değil santralde yapılır

iOS ve Android hiçbir uygulamanın giden aramada arayan numarayı değiştirmesine ya da arama sesini kaydetmesine izin vermez. fibimi de dahil bu tür bütün uygulamalar şöyle çalışır:

```
           (1) "Ara" butonu                (2) originate / click-to-call API
 Danışman ─────────────────▶ Bizim sunucu ─────────────────────────────▶ Bulut Santral
 telefonu ◀────────────────────────────────────────────────── (3) önce danışmanı arar
                                                               (4) danışman açınca müşteriyi
 Müşteri  ◀──────────── arayan: danışmanın dijital numarası ──     dijital numarayla arar,
                                                                    anons çalar, kaydeder
                                                               (5) olaylar + kayıt ──▶ Bizim sunucu ──▶ Uygulama
```

Yani **numaraların bağlı olduğu santralin bir API'si olması şart**. Gereken API'ler:

| İhtiyaç | Santralde karşılığı |
|---|---|
| Danışman uygulamadan aradığında maskeli arama | Click-to-call / originate (önce dahili, sonra dış numara; arayan numara seçilebilir) |
| Gelen çağrıyı danışmana/mesaiye göre yönlendirme | Dinamik yönlendirme webhook'u (santral "nereye aktarayım?" diye sorar) — yoksa santral panelinde sabit yönlendirme |
| Çağrı listesi | Çağrı olayı / CDR webhook'u |
| Ses kaydı | Kayıt indirme API'si |
| "Danışmanınız sizi arıyor" anonsu, 444 kuyruğu | Santral panelinde ses dosyası + kuyruk tanımı |

### Türk Telekom numaralarıyla ne yapmalı?

1. Türk Telekom (veya numaraları aldığınız bayi) **bulut santral API'si** veriyor mu, yukarıdaki tabloyu göstererek sorun. fibimi'nin Türk Telekom ile özel bir entegrasyonu olabilir; bu API size de açılıyorsa yeni bir adaptör yazmak yeterli (`server/src/providers/`).
2. API verilmiyorsa numaraları (0312'ler, 0850'ler ve 444 24 53) **numara taşıma** ile herkese açık API'si olan bir BTK lisanslı bulut santrale taşıyın — ör. Verimor veya Netgsm. Projede Verimor adaptörü hazır.

## Netgsm hatlarıyla kurulum (mevcut yapı)

Şirketin 0533 743 xx xx numaraları Netgsm santralinde birer dahiliye bağlı (ör. 114 → 0533 743 56 80). Uygulamada her danışmanın "dijital numarası" bu hattır:

- **Giden arama:** Santral önce danışmanın dahilisini çaldırır, açınca müşteriyi danışmanın 0533 hattından arar. Müşteri danışmanın kişisel numarasını görmez.
- **Gelen arama:** Müşteri 0533 hattını arar, santral sistemimize sorar, hattın sahibi danışmanın telefonu çalar. Santral aranan numara yerine dahiliyi gönderse de eşleşme yapılır.

Hat listesi `server/hatlar.csv` dosyasında. Son sütuna danışmanın e-postasını yazıp `npm run import-lines -- hatlar.csv` çalıştırın.

**Netgsm adaptörü henüz yok.** Netgsm'in arama başlatma, webhook ve ses kaydı API'lerinin dokümanı alındığında `server/src/providers/netgsm.js` yazılacak. İlk test aramasında `PBX_LOG_WEBHOOKS=1` ile Netgsm'in gönderdiği alanlar loglanır.

## Proje yapısı

```
server/   Node.js API (Express + SQLite)  — santral entegrasyonu, yönlendirme kuralları, çağrı kayıtları
mobile/   Expo / React Native uygulaması  — iOS (App Store) ve Android (Play Store) tek kod tabanı
```

### Sunucu

```bash
cd server
npm install
cp .env.example .env      # değerleri doldurun
npm run seed              # örnek kullanıcılar (şifre: Sifre1234)
npm start
npm test                  # yönlendirme kuralları ve API testleri
```

Node.js 22.13+ gerekir (yerleşik SQLite kullanılıyor). `PBX_PROVIDER=mock` ile santral olmadan çalışır.

**Canlı sunucu:** Kendi Proxmox + Hestia sunucunuza kurulum adımları: [`server/deploy/kurulum-proxmox.md`](server/deploy/kurulum-proxmox.md). Alternatif olarak Türkiye'de bir VPS (KVKK için tercihen yurt içi), bir alan adı (ör. `santral.sirketiniz.com`) ve Docker yeterli. `Caddyfile` içine alan adını yazıp `docker compose up -d` çalıştırın; HTTPS sertifikası otomatik alınır.

**Bitrix24:** Biten her çağrı müşteri kartına arama aktivitesi ve ses kaydıyla yazılır, kayıtlı olmayan numara için potansiyel müşteri açılır. Bitrix'te *Geliştirici kaynakları → Gelen webhook* (izinler: telephony, crm, user) oluşturup URL'yi `BITRIX_WEBHOOK_URL` olarak girin ve her danışmanın Bitrix kullanıcı kimliğini `users.bitrix_user_id` alanına yazın.

**Santral panelinde yapılacak tanımlar**

- Çağrı olayı webhook'u → `POST https://<sunucu>/webhooks/pbx/event?token=<PBX_WEBHOOK_SECRET>`
- Dinamik yönlendirme → `POST https://<sunucu>/webhooks/pbx/route?token=<PBX_WEBHOOK_SECRET>`
  (santral HMAC imzası gönderebiliyorsa `X-Signature` başlığı da desteklenir)
- Her danışmana bir dahili ve bir dijital numara; ilan bazlı takip istenirse ilan başına ek numara
- 444 24 53 → karşılama kuyruğu (7 hat), adı `HUNT_GROUP_DESTINATION` ile aynı
- Giden aramada müşteriye çalınacak anons ve "görüşmeniz kayıt altına alınmaktadır" bilgilendirmesi

> Verimor adaptöründeki webhook alan adları panelde seçilen biçime göre değişebilir. Canlıya almadan önce panelden örnek bir istek alıp `server/src/providers/verimor.js` içindeki alanları doğrulayın.

**Veri modeli:** `users` (danışman, mesai saatleri, kayıt dinleme izinleri), `numbers` (dijital numara / ilan numarası / 444 hattı ve kime ait olduğu), `contacts` (alıcı/satıcı), `calls`.
Yeni danışman ve numara tanımı şimdilik doğrudan veritabanına yapılır (`src/seed.js` örnek); yönetim paneli sonraki adım.

### Mobil uygulama

```bash
cd mobile
npm install
npx expo start            # geliştirme
npm run typecheck
```

Ekranlar: giriş, aramalar (gelen/giden/cevapsız, ofis geneli broker/asistan için), kişiler (arama + maskeli arama butonu), çağrı detayı (ses kaydı dinleme, geri ara), profil, santral ayarları (yönlendirilen telefon, sesli yönlendirme, kayıt dinleme izinleri, hafta içi/cumartesi/pazar mesai saatleri).

`mobile/app.json` içinde güncellenmesi gerekenler: `extra.apiUrl` (sunucu adresi), `ios.bundleIdentifier` ve `android.package` (ör. `com.sirketadi.santral`), uygulama adı ve ikonlar (`assets/`).

## App Store ve Play Store'da yayınlama

Mac gerekmez; derleme ve gönderim Expo EAS bulutunda yapılır.

1. Hesaplar: **Apple Developer Program** (yıllık 99 $, şirket adına D-U-N-S numarası gerekir) ve **Google Play Console** (tek seferlik 25 $, kuruluş hesabı).
2. `npx eas-cli@latest login` → `npx eas-cli@latest init` (projectId `app.json`'a yazılır, push bildirimleri için gerekli).
3. iOS push için Apple anahtarı ve Android push için Firebase (FCM) kimliği: `npx eas-cli@latest credentials`.
4. Derleme: `npx eas-cli@latest build --platform all --profile production`
5. Gönderim: `npx eas-cli@latest submit --platform ios` / `--platform android` (`eas.json` içindeki `ascAppId` ve Play servis hesabı dosyasını doldurun).
6. Mağaza sayfaları: gizlilik politikası URL'si (zorunlu), ekran görüntüleri, açıklama. Uygulama giriş gerektirdiği için **inceleme ekibine bir demo hesap** verin (mock santralli bir sunucu bu iş için uygundur). Şirket içi kullanım için App Store'da "Unlisted" dağıtım veya Apple Business Manager seçenekleri de değerlendirilebilir.

## KVKK

Görüşme kaydı kişisel veri işleme sayılır. Müşteriye arama başında kayıt bilgilendirmesi yapılmalı, aydınlatma metni yayınlanmalı, kayıtların saklama süresi belirlenmeli; danışmanlar için de ayrı aydınlatma yapılmalıdır. Ses kayıtları santralde durur, uygulama yalnızca yetkili kullanıcıya sunucu üzerinden aktarır.
