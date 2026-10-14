# cPanel kurulumu — xresoftware.com.tr/sms

Panel ve SMS zamanlayıcısı cPanel'deki **Setup Node.js App** ile çalışır ve
**https://xresoftware.com.tr/sms** adresinde yayınlanır. Ana sitenize dokunulmaz.

> **Önemli:** Uygulama dosyaları `public_html` içine konmaz. `public_html/sms` klasörünü cPanel yönetir
> (içine sadece kendi `.htaccess` dosyasını yazar). Dosyalar `public_html`'e konursa `.env` (Erccell şifresi,
> Bitrix webhook) ve müşteri veritabanı tarayıcıdan indirilebilir hale gelebilir.

## 0. Ön koşul

cPanel > **Setup Node.js App** > **Create Application** ekranında **Node.js 22.13 veya üstü** seçilebilmeli
(veritabanı Node'un dahili SQLite'ı ile çalışır). Yoksa WHM'den CloudLinux "alt-nodejs22" yüklenmeli.

## 1. Dosyaları yükleyin

1. File Manager'da **`public_html/sms` klasörünü boş bırakın** (içine dosya koymayın).
2. `sms-otomasyon-cpanel.zip` dosyasını ana dizine, yani **`/home/xresoftware/`** altına yükleyip **Extract** edin:
   ```
   /home/xresoftware/sms-otomasyon/build/     (panel arayüzü)
   /home/xresoftware/sms-otomasyon/server/    (API + zamanlayıcı)
   ```

## 2. Node.js uygulamasını oluşturun

cPanel > **Setup Node.js App** > **Create Application**:

| Alan | Değer |
| --- | --- |
| Node.js version | 22.x (en az 22.13) |
| Application mode | Production |
| Application root | `sms-otomasyon/server` |
| Application URL | `xresoftware.com.tr` / `sms` |
| Application startup file | `src/index.js` |

**Create** deyin, sonra **Run NPM Install** butonuna basın.
(cPanel "sms klasörü zaten var" diye hata verirse boş `public_html/sms` klasörünü silip tekrar deneyin.)

## 3. Ayarlar (.env)

File Manager'da `sms-otomasyon/server/.env.example` dosyasını **Kopyala** > adı `.env` olacak şekilde aynı klasöre
kopyalayın ve **Düzenle** ile şunları girin (gizli dosyaları görmek için File Manager > Ayarlar > "Gizli dosyaları göster"):

```
BASE_PATH=/sms

SMS_PROVIDER=erccell
ERCCELL_USERNAME=...
ERCCELL_PASSWORD=...
ERCCELL_HEADER=XRE
ERCCELL_SMS_TYPE=UC

BITRIX_WEBHOOK_URL=https://xre.bitrix24.com.tr/rest/1/.../
BITRIX_APP_TOKEN=            (6. adımda Bitrix'in verdiği anahtar)
BITRIX_OPTOUT_FIELD=UF_CRM_XRE_CSAT_STOP
BITRIX_DEFAULT_CONSENT=false (Bitrix'teki herkesin İYS onayı varsa true)

PANEL_USER=admin
PANEL_PASSWORD=güçlü-bir-şifre
SCHEDULER_INTERVAL_MS=0
```

Setup Node.js App ekranında **Restart** deyin. **https://xresoftware.com.tr/sms** açıldığında kullanıcı adı/şifre sormalı.

## 4. Zamanlayıcı (Cron)

cPanel uygulamayı boşta kalınca uyuttuğu için SMS gönderimini Cron yapar.
cPanel > **Cron Jobs** > "Once Per Minute" (`* * * * *`), komut:

```
cd /home/xresoftware/sms-otomasyon/server && /home/xresoftware/nodevenv/sms-otomasyon/server/22/bin/node scripts/tick.js >> /home/xresoftware/sms-otomasyon/tick.log 2>&1
```

Node yolu, Setup Node.js App ekranının üstündeki "Enter to the virtual environment" komutunda görünür;
`22` farklıysa (ör. `22.14`) ona göre düzeltin. Aynı anda iki zamanlayıcı çalışsa bile aynı SMS iki kez gitmez.

## 5. XRE kampanyalarını oluşturun

cPanel > **Terminal** (veya SSH):

```
source /home/xresoftware/nodevenv/sms-otomasyon/server/22/bin/activate
cd ~/sms-otomasyon/server && npm run kurulum
```

10 proje serisi **pasif** olarak ve durdurma statüleri oluşturulur.

## 6. Bitrix giden webhook

Bitrix24 > **Geliştirici kaynakları** > **Diğer** > **Giden webhook**:
- İşleyici adresi: `https://xresoftware.com.tr/sms/api/bitrix/webhook`
- Olaylar: **Potansiyel müşteri oluşturuldu** (`ONCRMLEADADD`), **Potansiyel müşteri güncellendi** (`ONCRMLEADUPDATE`)
- Verilen **uygulama anahtarını** `.env` içindeki `BITRIX_APP_TOKEN`'a yazıp uygulamayı **Restart** edin.

## 7. Canlı deneme (sırayla)

1. Panel > **Canlı test** > **Test SMS gönder**: kendi numaranıza bir SMS atın. Telefona geldiğini ve ekranda
   Erccell'in yanıtını görün (yanıtı iletin; başarı/hata ayrımını kesinleştirelim).
2. Panel > **Kampanyalar**: Ankaport serisini açın, mesajları kontrol edin, **Aktif** işaretleyip kaydedin.
3. Bitrix'te kendi telefonunuzla test lead'i oluşturup statüsünü **ankaport reklam** yapın.
   Panel > **Akışlar**'da 3-5-10-14-30. gün planıyla görünmeli. (Görünmezse **Canlı test** >
   **Bitrix kaydını seriye al** ile lead ID'sini girin; çalışıyorsa sorun giden webhook ayarındadır.)
4. Test lead'ini **OLUMSUZ** statüsüne alın: akış **İptal** olmalı.

## Güncelleme

Yeni paketteki `build/` ve `server/` dosyalarını üzerine yazın (`server/data/` klasörüne ve `server/.env`'e dokunmayın),
gerekirse **Run NPM Install**, sonra **Restart**.

## Sorun giderme

- **/sms açılınca ana sitenin 404 sayfası geliyor:** `public_html/.htaccess` içindeki yönlendirme kuralları
  `/sms`'i yakalıyor olabilir. `public_html/sms/.htaccess` dosyasının (cPanel'in yazdığı, Passenger satırları olan)
  durduğunu kontrol edin; gerekirse ana `.htaccess`'teki RewriteRule'lardan önce
  `RewriteRule ^sms(/.*)?$ - [L]` ekleyin.
- **Panel açılıyor ama boş/beyaz sayfa:** `.env`'de `BASE_PATH=/sms` olduğundan emin olup **Restart** edin.
- **Uygulama başlamıyor:** `sms-otomasyon/server/stderr.log` dosyasına bakın.
- **`No such built-in module: node:sqlite`:** Node sürümü 22.13'ten eski; Setup Node.js App'te yükseltin.
- **SMS gitmiyor:** Panel > SMS geçmişi'ndeki hata, `sms-otomasyon/tick.log`, müşterinin SMS izni (Müşteriler sekmesi).
