# cPanel'e kurulum — https://xresoftware.com.tr/parsel-sorgu

Uygulama bir **Node.js uygulamasıdır** (statik site değil). `public_html` içine dosya yüklenmez; cPanel'in **Setup Node.js App** aracıyla çalışır. Kod ve `.env` web kökünün **dışında** durur, böylece şifre/anahtar dosyaları tarayıcıdan indirilemez.

## 1. Node.js uygulamasını oluşturun
cPanel → **Setup Node.js App** → **Create Application**
- **Node.js version:** listedeki en yüksek 22.x veya 24.x (en az 22.13)
- **Application mode:** Production
- **Application root:** `parsel-sorgu-app`  ← public_html'in dışında
- **Application URL:** `xresoftware.com.tr` / `parsel-sorgu`
- **Application startup file:** `app.cjs`
- **Create**

cPanel, `public_html/parsel-sorgu` içine yönlendirme için `.htaccess` yazar. O klasöre başka dosya yüklemeyin, silmeyin.

## 2. Dosyaları yükleyin
File Manager → `/home/xresoftware/parsel-sorgu-app` → **Yükle** → zip → **Çıkar (Extract)**.
Zip'in içindeki `parsel-sorgu-app` klasörünün **içeriği** (app.cjs, server, dist, worker, package.json, .env …) doğrudan bu klasörde olmalı. Gerekirse taşıyın.

`.env` gizli dosyadır: File Manager → Ayarlar → **Gizli dosyaları göster**. İçinde `APP_PASSWORD` ve `OPENAI_API_KEY` dolu olmalı.

## 3. Paketleri kurun ve başlatın
Setup Node.js App → uygulamanız → **Run NPM Install** → **Restart**.

## 4. Python (TKGM sorgusu için)
cPanel → **Terminal**:
```
python3 -m pip install --user -r ~/parsel-sorgu-app/worker/requirements.txt
```
Terminal yoksa hosting firmasından `python3` için `requests` paketinin kurulmasını isteyin.

## 5. Açın
https://xresoftware.com.tr/parsel-sorgu/ → şifre ekranı → giriş.

## Sorun giderme
- **Uygulama açılmıyor / 503:** `~/parsel-sorgu-app/stderr.log` dosyasına bakın.
  - `APP_PASSWORD tanımlı değil` → `.env` eksik veya yanlış klasörde.
  - `Bu Node sürümünde SQLite yok` → daha yüksek Node seçin **veya** cPanel → MySQL Databases ile veritabanı + kullanıcı oluşturup `.env` içine `DATABASE_URL=mysql://kullanici:sifre@localhost/veritabani` yazın (tablolar otomatik kurulur).
- **İl listesi gelmiyor:** Python/requests kurulu değil (adım 4) veya TKGM hosting IP'sini reddediyor. Alım satım yoğunluğu için "TKGM yanıtını yapıştır" yolu her zaman çalışır.
- **Güncelleme:** yeni zip'i aynı klasöre çıkarın (`.env` ve `data/` korunur) → Restart.

## Güvenlik
- Giriş zorunludur; `APP_PASSWORD` olmadan sunucu başlamaz. 5 hatalı denemede IP 15 dk bekletilir.
- `AI_DAILY_LIMIT` günlük AI analiz sayısını sınırlar (OpenAI faturası).
- TKGM servislerini Parsel Sorgu ekranındaki kadar kullanın; toplu/otomatik tarama yapmayın.
