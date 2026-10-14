# cPanel / WHM kurulumu

Panel ve SMS zamanlayıcısı cPanel'deki **Setup Node.js App** (CloudLinux Node.js Selector) ile çalışır.
Önerilen adres bir alt alan adı: ör. `sms.xreproject.com` (panel kök dizinde çalışacak şekilde hazırlandı).

## 0. Ön koşullar

- cPanel'de **Setup Node.js App** menüsü olmalı ve **Node.js 22.13 veya üstü** seçilebilmeli
  (veritabanı Node'un dahili SQLite'ı ile çalışır). Listede 22 yoksa WHM'den (EasyApache / CloudLinux
  "alt-nodejs22") yüklenmesi gerekir.
- Alt alan adı: cPanel > **Domains** > `sms.xreproject.com` oluşturun. SSL: **SSL/TLS Status** > AutoSSL çalıştırın.

## 1. Dosyaları yükleyin

1. `sms-otomasyon-cpanel.zip` dosyasını cPanel > **File Manager** ile ana dizine (`/home/KULLANICI/`) yükleyip
   **Extract** edin. Sonuç:
   ```
   /home/KULLANICI/sms-otomasyon/build/      (panel arayüzü)
   /home/KULLANICI/sms-otomasyon/server/     (API + zamanlayıcı)
   ```

## 2. Node.js uygulamasını oluşturun

cPanel > **Setup Node.js App** > **Create Application**:

| Alan | Değer |
| --- | --- |
| Node.js version | 22.x (en az 22.13) |
| Application mode | Production |
| Application root | `sms-otomasyon/server` |
| Application URL | `sms.xreproject.com` |
| Application startup file | `src/index.js` |

**Create** deyin, sonra **Run NPM Install** butonuna basın.

## 3. Ayarlar (.env)

File Manager'da `sms-otomasyon/server/.env.example` dosyasını kopyalayıp adını `.env` yapın ve düzenleyin:

```
SMS_PROVIDER=erccell
ERCCELL_USERNAME=...
ERCCELL_PASSWORD=...
ERCCELL_HEADER=XRE
ERCCELL_SMS_TYPE=UC

BITRIX_WEBHOOK_URL=https://xre.bitrix24.com.tr/rest/1/.../
BITRIX_APP_TOKEN=            (4. adımda Bitrix'in verdiği anahtar)
BITRIX_OPTOUT_FIELD=UF_CRM_XRE_CSAT_STOP
BITRIX_DEFAULT_CONSENT=false (Bitrix'teki herkesin İYS onayı varsa true)

PANEL_USER=admin
PANEL_PASSWORD=güçlü-bir-şifre
SCHEDULER_INTERVAL_MS=0
```

Setup Node.js App ekranında **Restart** deyin. `https://sms.xreproject.com` açıldığında kullanıcı adı/şifre sormalı.

## 4. Zamanlayıcı (Cron)

cPanel uygulamayı boşta kalınca uyuttuğu için SMS gönderimini Cron yapar.
Setup Node.js App ekranının üstünde görünen "Enter to the virtual environment" komutundaki Node yolunu kullanın.
cPanel > **Cron Jobs** > her dakika (`* * * * *`):

```
cd /home/KULLANICI/sms-otomasyon/server && /home/KULLANICI/nodevenv/sms-otomasyon/server/22/bin/node scripts/tick.js >> /home/KULLANICI/sms-otomasyon/tick.log 2>&1
```

(Aynı anda iki zamanlayıcı çalışsa bile kilit sayesinde aynı SMS iki kez gitmez.)

## 5. XRE kampanyalarını oluşturun

Setup Node.js App ekranındaki sanal ortam komutuyla terminale girip (veya cPanel > **Terminal**):

```
cd ~/sms-otomasyon/server && npm run kurulum
```

10 proje serisi **pasif** olarak ve durdurma statüleri oluşturulur.

## 6. Bitrix giden webhook

Bitrix24 > **Geliştirici kaynakları** > **Diğer** > **Giden webhook**:
- İşleyici adresi: `https://sms.xreproject.com/api/bitrix/webhook`
- Olaylar: **Potansiyel müşteri oluşturuldu** (`ONCRMLEADADD`), **Potansiyel müşteri güncellendi** (`ONCRMLEADUPDATE`)
- Verilen **uygulama anahtarını** `.env` içindeki `BITRIX_APP_TOKEN`'a yazıp uygulamayı Restart edin.

## 7. Canlı deneme (sırayla)

1. Panel > **Canlı test** > **Test SMS gönder**: kendi numaranıza bir SMS atın. Telefonunuza geldiğini ve
   ekranda Erccell'in yanıtını görün. (Yanıtı bize iletin; başarı/hata ayrımını kesinleştirelim.)
2. Panel > **Kampanyalar**: bir projeyi (ör. Ankaport) açın, mesajları kontrol edin, **Aktif** işaretleyip kaydedin.
3. Bitrix'te kendi telefonunuzla bir test lead'i oluşturup statüsünü **ankaport reklam** yapın.
   Panel > **Akışlar**'da 3-5-10-14-30. gün planıyla görünmeli. (Webhook çalışmıyorsa **Canlı test** >
   **Bitrix kaydını seriye al** ile lead ID'sini girerek deneyin.)
4. Hemen mesaj görmek için o akışın başlangıcını geriye çekmek gerekmez: test kampanyasına geçici olarak
   0. gün 00:00 adımı ekleyip **Zamanlayıcıyı şimdi çalıştır**'a basın, sonra adımı silin.
5. Test lead'ini **OLUMSUZ** statüsüne alın: akış **İptal** olmalı.

## Güncelleme

Yeni paketi yükleyip `sms-otomasyon/server` altındaki dosyaları değiştirin (`data/` klasörüne ve `.env`'e dokunmayın),
gerekirse **Run NPM Install**, sonra **Restart**.

## Sorun giderme

- Panel açılmıyor: `sms-otomasyon/server/stderr.log` dosyasına bakın.
- `No such built-in module: node:sqlite`: Node sürümü 22.13'ten eski; Setup Node.js App'te sürümü yükseltin.
- SMS gitmiyor: Panel > SMS geçmişi'nde hata mesajı; `tick.log`; müşterinin SMS izni (Müşteriler sekmesi).
