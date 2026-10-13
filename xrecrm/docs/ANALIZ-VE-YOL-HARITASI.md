# XRE CRM — Eksik analizi ve yol haritası (v7 → v8)

## v8 ikinci tur — tamamlananlar

| Konu | Nerede |
| --- | --- |
| Bağımsız giriş (e-posta/şifre), ilk kurulum, çalışan hesapları | Açılış ekranı · Çalışanlar → Giriş hesapları · Profil → Şifre değiştir |
| QR ile giriş (telefon onayı), Google / Facebook / Apple girişi | Giriş ekranı; anahtarlar Entegrasyonlar → Sosyal giriş |
| MySQL'siz çalışma | `DATABASE_URL` yoksa `data/xrecrm-data.json` |
| Entegrasyon anahtarlarını arayüzden girme (AES-256-GCM) | Entegrasyonlar → Anahtarlar ve bağlantı ayarları |
| Tıkla-ara, gelen aramada müşteri kartı, otomatik CDR | Santral ayarları + arama penceresi "Santralden ara" |
| Hat envanteri arayüzden | Hat yönetimi → Hatları düzenle |
| WhatsApp medya gönderme/alma | WhatsApp → ataş butonu |
| Bitrix24 veri aktarımı | Bitrix aktarımı & uygulamalar |

## v8.2 — tamamlananlar

| Konu | Nerede |
| --- | --- |
| Denetim günlüğü (kim, neyi, ne zaman; gizli alanlar maskeli) | Çalışma alanı → Denetim günlüğü |
| Aşama geçmişi; Genel bakış kazanım tarihini buradan alır | Otomatik |
| Günlük otomatik yedek (son 14), elle yedek, indir, geri yükle (önce otomatik güvenlik yedeği) | Çalışma alanı → Yedekler |
| Anlık bildirim: yeni mesaj, cevapsız arama, size atanan görev (tarayıcı bildirimi dahil) | Tüm sayfalar |
| Bilgisayar açılınca arka planda otomatik başlatma | OTOMATIK-BASLAT-KUR.cmd |

### Santral kurulumu (Asterisk / FreePBX)
1. FreePBX → Settings → Asterisk Manager Users: kullanıcı oluşturun; izinler: `call, originate, cdr, reporting`;
   "Permit" alanına yalnız CRM sunucusunun IP'sini yazın.
2. `cdr_manager.conf` → `enabled = yes` (CDR olayları için).
3. CRM → Entegrasyonlar → Santral: Sürücü `asterisk`, AMI sunucu/port/kullanıcı/şifre, kanal şablonu
   (`PJSIP/{ext}`), context (`from-internal`). "Bağlantıyı test et".
4. Her çalışan arama penceresinde kendi dahili numarasını bir kez girer.
5. Netgsm Netsantral gibi URL tabanlı santrallerde sürücü `http`; tıkla-ara URL şablonunu girin, çalma
   bildirimi için Webhook merkezinde `call.ringing`, arama sonucu için `call.log` kapsamlı bir gelen webhook açın.

### Sosyal giriş kurulumu
Dönüş adresleri: `https://CRM/api/auth/social/google/callback`, `.../facebook/callback`, `.../apple/callback`.
Sosyal giriş yeni kullanıcı oluşturmaz; yöneticinin açtığı hesabın e-postasıyla eşleşir.


Bu belge, Bitrix24'ün yerine geçecek XRE CRM'in v7 kaynaklarının incelenmesinden çıkan
eksikleri, bu turda yapılanları ve sıradaki adımları özetler.

## 1. Bu turda yapılanlar

| Konu | Durum |
| --- | --- |
| Hat envanteri güvenliği | 47 gerçek numara + 13 ICCID kaynak koddan çıkarıldı. Sunucu `config/lines.json` (gitignore) veya `LINES_INVENTORY_JSON`'dan okur, tarayıcı oturumla alır. Repo **public** olduğu için zorunluydu. |
| Webhook merkezi | Bitrix'teki "gelen/giden webhook" karşılığı. Ayrıntı: bölüm 3. |
| Genel bakış | Dönem seçimli KPI'lar, bugünün ajandası, cevapsız arama / yanıt bekleyen mesaj / işsiz fırsat uyarıları, gerçek trend, danışman tablosu, kaynaklar, gerçek entegrasyon durumu. |
| Legacy | Legacy WhatsApp kodundaki sabit `VERIFY_TOKEN` ortam değişkenine taşındı. **Bu değer eski sistemde hâlâ kullanılıyorsa değiştirin.** |

## 2. Kritik eksikler (öncelik sırasıyla)

### P0 — Bitrix'ten çıkışı engelleyenler
1. **Bağımsız giriş yok.** Canlı oturum yalnız Manus OAuth'a bağlı. Kendi sunucunuzda
   kullanıcı adı/şifre (+ 2FA) ile giriş, şifre sıfırlama ve oturum yönetimi gerekli.
   Bu yapılmadan uygulama kendi sunucunuzda canlı kullanılamaz. **Sıradaki ilk iş bu olmalı.**
2. **Bitrix veri göçü.** Bitrix REST (`crm.lead.list`, `crm.deal.list`, `crm.contact.list`,
   `crm.activity.list`, `voximplant.statistic.get`) üzerinden müşteri, fırsat, etkinlik ve
   arama geçmişini Bitrix ID eşlemesiyle aktaran bir içe aktarım sihirbazı. CSV içe aktarım
   var ama Bitrix'e özel, ilişkileri koruyan göç yok.
3. **Telefon altyapısı (bölüm 4).** Şu an yalnız envanter + PBX "sağlık" kontrolü var;
   gerçek arama, CDR, ses kaydı, tıkla-ara ve gelen arama ekranı (screen-pop) yok.
4. **Yedekleme.** MySQL için otomatik günlük yedek + geri yükleme provası.

### P1 — Entegrasyonlar
5. **Entegrasyon ayarları yalnız `.env` ile.** Arayüzden anahtar girme (sunucuda şifreli
   saklama, yalnız sahip görür) ve "bağlantıyı test et" tek ekranda olmalı.
6. **WhatsApp:** Evolution API kurulumu (Docker) + medya (resim/ses/belge) gönderme-alma,
   şablon mesajlar, toplu gönderim kuyruğu ve 24 saat penceresi uyarısı.
7. **Vapi sonuç webhook'u** canlı doğrulanmadı; `VAPI_WEBHOOK_SECRET` ile
   `/api/webhooks/vapi` bağlanmalı (n8n üzerinden geçen akışlar Webhook merkezine taşınabilir).
8. **Eski n8n akışları** Bitrix ID'si bekliyor. Yeni giden webhook olayları
   (`lead.stage_changed`, `call.ended` …) bu akışların tetikleyicisi olarak bağlanmalı;
   akışların Bitrix REST çağrıları XRE gelen webhook işlemleriyle değiştirilmeli.
9. **Google Meet/Takvim OAuth** canlı kurulmadı.
10. **E-posta kanalı** (IMAP/SMTP) yok.

### P2 — Ürün
11. Bildirimler: tarayıcı push / mobil (PWA), Telegram bildirimi.
12. Dosya/doküman ekleri (müşteri kartına sözleşme, tapu vb.), sürümleme.
13. Teklif/fatura, ürün kataloğu (emlak portföyü) ve fırsata portföy bağlama.
14. Raporlar: dönemsel kazanım tarihleri için aşama geçmişi tablosu (şu an kazanım tarihi
    olarak son hareket kullanılıyor), arama SLA'sı, danışman karnesi.
15. Denetim günlüğü (kim neyi değiştirdi) ve KVKK: açık rıza kaydı, veri silme/anonimleştirme.

## 3. Webhook merkezi (yeni)

Yer: **İş akışları → Webhooklar**.

**Gelen webhook** — dış sistemin CRM'e yazması için:

```
POST https://CRM/api/hooks/in/<HOOK_ID>/<TOKEN>/<işlem>
Content-Type: application/json
X-Idempotency-Key: <opsiyonel, aynı olay iki kez işlenmez>
```

| İşlem | Kullanım |
| --- | --- |
| `lead.create` | Web formu, Meta/Google Lead Ads, sahibinden/emlakjet formları (telefon/e-posta ile mükerrer kontrol) |
| `lead.update`, `lead.stage`, `note.add` | n8n'den güncelleme, aşama değişimi (otomasyonlar çalışır), not |
| `lead.find` | n8n'de "bu numara kimin?" sorgusu |
| `task.create`, `activity.create` | Görev / etkinlik açma |
| `call.log` | **Santral/FST/Asterisk CDR** — arama sonucunu müşteriye bağlar, bilinmeyen numaradan müşteri açar, cevapsız aramayı Genel bakış'ta gösterir |
| `message.log` | SMS / harici kanaldan mesaj |

Token yalnız oluşturulurken bir kez gösterilir, sunucuda SHA-256 özeti saklanır. Her webhook
yalnız seçilen işlemleri yapabilir, dakikada 120 istek sınırı vardır.

**Giden webhook** — CRM olayları dış sisteme: `lead.created`, `lead.updated`,
`lead.stage_changed`, `contact.created`, `company.created`, `task.created`,
`task.completed`, `activity.created`, `activity.completed`, `message.received`,
`message.sent`, `call.created`, `call.ended`, `call.missed`.

- İmza: `X-XRE-Signature: sha256=HMAC(secret, X-XRE-Timestamp + "." + gövde)`
- Ek başlık (ör. n8n Header Auth) tanımlanabilir; değerler maskelenir.
- Kalıcı kuyruk: 5xx/ağ hatasında üstel beklemeyle 5 deneme; 4xx kalıcı hata; zaman aşımı
  "inceleme gerekli" (çift gönderim yapılmaz). Teslimatlar olay günlüğünde görünür.
- "Gelen webhooklardan doğan değişiklikleri gönderme" seçeneği n8n döngülerini önler.
- Kendi sunucunuzdaki n8n için: `OUTBOUND_ALLOW_PRIVATE_HOSTS=10.0.0.5`.
- İçe aktarılabilir iki n8n şablonu sayfada indirilebilir (olay alıcı + müşteri gönder).

## 4. Telefon: Netgsm/FST yerine kendi sunucunuz

Önerilen mimari:

```
SIM kartlar ─► GSM gateway (FST/"FCT") ─SIP─► Asterisk / FreePBX (kendi sunucunuz)
Netgsm SIP trunk (0850 / sabit hat) ───SIP─►        │            ├─► Dahili telefonlar / softphone (WebRTC)
                                                     │            └─► Vapi (SIP trunk ile AI hatları)
                                                     └─ AMI/CDR köprüsü ─► XRE CRM /api/hooks/in/.../call.log
```

- Asterisk/FreePBX, aramayı bitirdiğinde CDR'yi `call.log` ile CRM'e gönderir
  (`phone`, `direction`, `status`, `durationSeconds`, `line`, `agent`, `recordingUrl`, `callId`).
  Bu köprü küçük bir Node servisi veya FreePBX "CDR post" / n8n ile yapılabilir.
- Sıradaki geliştirme: AMI üzerinden **tıkla-ara (originate)** ve gelen aramada
  **müşteri kartı açılması (screen-pop)**; tarayıcıda WebRTC softphone (JsSIP/SIP.js).
- Vapi AI hatları: Asterisk ↔ Vapi arasında SIP trunk; Vapi'de "BYO SIP trunk".

Dikkat edilmesi gerekenler (teknik + mevzuat, kesin bilgi için operatör/Netgsm/BTK ile teyit edin):
1. **IMEI kaydı:** GSM gateway'deki her modülün IMEI'si Türkiye'de kayıtlı olmalı. Yurt dışından
   alınan kayıtsız cihazlarda hatlar çalışmaz/kapanır — Türkiye distribütöründen kayıtlı cihaz alın.
2. **Operatör kuralları:** Mobil hatların GSM gateway'de ("SIM box") yoğun giden arama için
   kullanılması operatör sözleşmelerinde kısıtlı olabilir; trafik örüntüsü tespit edilip hat
   kapatılabilir. Hatların kurumsal (şirket adına) olması ve operatörün bilgisi önemlidir.
   Başkasına arama hizmeti satmak (trafik sonlandırma) yasaktır; kendi şirket içi kullanım farklıdır.
3. **Uzun vadede daha temiz yol:** Mobil numaraları gateway'de tutmak yerine Netgsm'in
   **SIP trunk** (sabit/0850 numara) hizmetini doğrudan kendi Asterisk'inize bağlamak. Netgsm'de
   kalan şey yalnız trunk olur; santral, kayıt ve CRM entegrasyonu tamamen sizde olur.
4. Sabit IP, 7/24 çalışan sunucu, UPS, güvenlik duvarı (SIP brute-force saldırıları çok yaygındır:
   fail2ban, yalnız bilinen IP'lerden SIP), ses kaydı için KVKK aydınlatma anonsu.

## 5. Önerilen sıra

1. Bağımsız giriş (kullanıcı/şifre + 2FA) — P0
2. Bitrix → XRE veri göçü sihirbazı — P0
3. Asterisk/FreePBX köprüsü: CDR (`call.log` hazır), tıkla-ara, screen-pop — P0
4. Arayüzden entegrasyon anahtarları (şifreli) — P1
5. Evolution API kurulumu + WhatsApp medya — P1
6. n8n akışlarının yeni olaylara taşınması — P1
