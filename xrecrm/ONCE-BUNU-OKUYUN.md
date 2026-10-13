# XRE CRM — ZIP, Windows ve XAMPP kurulum rehberi

## Önce önemli ayrım

Bu CRM **React + Node.js/Express + MySQL** uygulamasıdır; PHP uygulaması değildir. XAMPP’nin Apache sunucusu Node.js kodunu çalıştırmaz. Bu nedenle dosyaları `htdocs` içine koyup `http://localhost/xrecrm` açmak **yeterli değildir**.

- **Doğru uygulama adresi:** `http://localhost:3000`
- **Kanban adresi:** `http://localhost:3000/kanban`
- XAMPP, istenirse yerel **MySQL/MariaDB** hizmeti için kullanılabilir.
- Demo arayüzünü açmak için XAMPP/Apache/MySQL başlatmak zorunlu değildir; Node.js sunucusu yeterlidir.
- Windows/XAMPP cihazınıza erişilmediği için orada kurulum yapıldığı veya Windows’ta denenmiş olduğu iddia edilmez. Paket Linux’ta izole yerel başlatma ve kaynak/derleme kontrolleriyle doğrulanmıştır.

## 1. ZIP’i nereye çıkaracağım?

**Güvenlik açısından önerilen:** `C:\xrecrm` gibi `htdocs` dışı bir klasör.

İsteğiniz doğrultusunda `htdocs` kullanacaksanız ZIP içindeki **xrecrm** klasörünü şu konuma çıkarabilirsiniz:

```text
C:\xampp\htdocs\xrecrm
```

Şu dosya doğrudan burada bulunmalıdır:

```text
C:\xampp\htdocs\xrecrm\package.json
```

`xrecrm\xrecrm\package.json` biçiminde çift klasör olmamasına dikkat edin.

Paketteki `.htaccess`, Apache 2.4’ün ilgili kuralları uygulaması halinde bu kaynak klasörünü web erişimine kapatır. `http://localhost/xrecrm` adresinin 403 vermesi bu durumda **beklenen korumadır**. `.htaccess` devre dışıysa kaynaklar/ayarlar erişime açılabilir. Bu yüzden htdocs dışındaki konum daha güvenlidir; korumanın kesin uygulandığı varsayılmamalıdır.

## 2. Node.js ve pnpm kurun

1. [Node.js resmî sitesinden](https://nodejs.org/) **Node.js 22 veya daha yeni bir sürümü** Windows kurucusuyla yükleyin. npm ve PATH seçenekleri açık kalsın.
2. Kurulumdan sonra eski terminali kapatıp yeni **Komut İstemi / CMD** açın.
3. Şunları çalıştırın:

```bat
node -v
npm -v
npm install -g pnpm@10.15.1
pnpm -v
```

İlk iki komut bulunamıyorsa Node.js kurulumu/PATH tamamlanmamıştır. Kurulum sırasında internet gerekir. Komutlar PowerShell’de script engeline takılırsa CMD kullanın; sistem yürütme politikasını gevşetmek gerekmez.

## 3. İlk kurulum

En kolay yöntem, klasörde **1-KURULUM.cmd** dosyasına çift tıklamaktır. Bu dosya bağımlılıkları kurar, `.env.example` dosyasını yalnız `.env` yoksa kopyalar ve projeyi derler. Mevcut `.env` ayarlarını değiştirmez.

Elle kurmak için CMD’de:

```bat
cd /d C:\xampp\htdocs\xrecrm
pnpm install --frozen-lockfile
copy .env.example .env
pnpm build
```

**Uyarı:** `.env` zaten varsa `copy` ile üzerine yazmayın. Htdocs dışında çıkardıysanız ilk komuttaki yolu kendi klasörünüzle değiştirin.

## 4. CRM’yi açın

**2-CRM-BASLAT.cmd** dosyasına çift tıklayın. Alternatif komut:

```bat
cd /d C:\xampp\htdocs\xrecrm
pnpm start
```

Tarayıcıdan açın:

```text
http://localhost:3000
```

Kanbanı doğrudan açmak için:

```text
http://localhost:3000/kanban
```

**Terminal açık kalmalıdır.** Kapatırsanız CRM sunucusu durur. Ctrl+C ile durdurabilirsiniz. Bilgisayar yeniden açıldığında `2-CRM-BASLAT.cmd` dosyasını yeniden çalıştırın. Bu paket Windows hizmeti olarak otomatik çalıştırma kurmaz.

Kaynak geliştirmek için üretim sunucusunu durdurun ve `pnpm dev` çalıştırın. Aynı portta ikisini eşzamanlı başlatmayın.

## 5. Yerel demo ile canlı kullanım farkı

**Hemen açılabilen:** Kanban/Liste/Etkinlikler/Takvim, müşteri kartı, örnek kayıtlar, kişisel temalar ve demo iş akışları. Demo değişiklikleri ilgili tarayıcının localStorage alanındadır. Farklı tarayıcıdaki veya Manus önizlemesindeki demo kayıtları otomatik taşınmaz.

**Bu ZIP tek başına sağlamaz:** bağımsız kullanıcı adı/şifre girişi, otomatik canlı hesap taşıma, buluttaki müşteri veritabanı veya sağlayıcı anahtarları.

Mevcut canlı giriş **Manus OAuth** bağlantısına bağlıdır. Yerelde **Giriş yap** düğmesi uygun OAuth ayarları olmadığında `OAUTH_NOT_CONFIGURED` dönebilir. Paket bir admin şifresi içermez. Yalnız MySQL adresi ve OpenAI/Vapi anahtarlarını doldurmak, yetkili canlı oturum oluşturmaz. Yerelde tam bağımsız çok kullanıcılı operasyon için ayrıca bağımsız kimlik doğrulama ya da uygun desteklenen OAuth kurulumu gerekir; bu teslimde eklenmemiştir.

**Demo modunda anahtar yazsanız bile gerçek arama/mesaj/AI isteği gönderilmez.** Canlı API’ler yetkili oturum gerektirir. Güvenlik denetimini kapatarak bunu aşmayın.

## 6. XAMPP MySQL/MariaDB hazırlığı — isteğe bağlı

Bu bölüm kalıcı veri altyapısını hazırlar; önceki bölümdeki canlı oturum gereksinimini kaldırmaz.

1. XAMPP Control Panel’de **MySQL → Start** seçin.
2. phpMyAdmin kullanacaksanız Apache’yi de başlatın ve `http://localhost/phpmyadmin` açın.
3. **Yeni** bölümünden `xrecrm` adlı veritabanı oluşturun. Karakter kümesi/collation olarak `utf8mb4 / utf8mb4_unicode_ci` seçin.
4. `xrecrm_user` adında, yalnız bu veritabanına erişen bir kullanıcı ve güçlü yerel parola oluşturun. Uygulama tablo oluşturduğu için bu veritabanında CREATE/SELECT/INSERT/UPDATE/DELETE ve indeks işlemleri için gerekli izinleri verin; sunucu genelinde yönetici izni vermeyin.
5. Proje kökündeki `.env` dosyasına kendi bağlantınızı yazın:

```dotenv
PORT=3000
PUBLIC_ORIGIN=http://localhost:3000
DATABASE_URL=mysql://xrecrm_user:YEREL_PAROLANIZ@127.0.0.1:3306/xrecrm
```

Parolada `@`, `:`, `#`, `/` gibi URL özel karakterleri varsa bunlar URL-encode edilmelidir. MySQL portunuz farklıysa 3306’yı değiştirin.

6. CRM’yi durdurup yeniden başlatın. Başlangıçta `xre_records` ve `xre_events` tabloları otomatik oluşturulur. Eski CRM SQL müşteri dökümü bu şemayla doğrudan uyumlu değildir; üzerine rastgele import etmeyin.
7. `http://localhost:3000/health` adresinde `database` durumunu kontrol edin. Veritabanı yapılandırılmadan uygulama/demo açılabilir ancak kalıcı yazma kullanılamaz.

XAMPP’de kullanılan MariaDB sürümü üzerinde bu teslimde doğrudan test yapılmadı. Kod MySQL protokolü ve JSON/InnoDB tablolarını kullanır; eski veritabanı sürümü veya izin hataları varsa başlangıç logu kontrol edilmelidir.

## 7. Entegrasyon ayarları ve dış webhooklar

Anahtarlar ZIP’e konulmadı. Kullanıcıya ait anahtarlar gerektiğinde **yalnız proje kökündeki `.env`** içine yazılmalı; `public`, `client` veya JavaScript dosyasına yazılmamalıdır:

```dotenv
XRE_OPENAI_API_KEY=
N8N_API_KEY=
VAPI_API_KEY=
VAPI_WEBHOOK_SECRET=
```

Bu satırlara kendi güncel değerlerinizi yerelde güvenli biçimde girin. Paylaşılan anahtarları yeniden mesajla göndermenize gerek yoktur. Sohbette paylaşılmış anahtarların yenilenmesi önerilir.

- **Vapi:** API key, hesap kataloğunu ve arama yetkilendirmesini sağlar; doğru asistan/hat eşlemesi ile sonuç/transkript webhook’u ayrıca gereklidir.
- **WhatsApp QR:** Sürekli çalışan uygun Evolution sağlayıcısı ve oturum/webhook ayarları gerekir. ZIP tek başına QR cihaz oturumu işletmez.
- **PBX/Netgsm:** FST/SIP/PBX cihazları ve ağ geçidi ayrı kurulmalıdır.
- **n8n:** Bağlantı URL’si ve seçilen akışlar bulut veritabanındaki ayarlardır; bu ZIP o veritabanını taşımaz. Yerel canlı ayar ekranında tekrar yapılandırılmalıdır.
- **Google Meet:** Google Cloud OAuth istemcisi, takvim yetkilendirmesi ve callback adresi ayrıca gerekir.

**`localhost` dış servislerin ulaşabileceği bir adres değildir.** Vapi/WhatsApp/n8n’in bilgisayarınızdaki CRM’ye olay göndermesi için erişilebilir, güvenli HTTPS alan adı ve uygun dağıtım/ters proxy gerekir. Üretim kurulumu, TLS, güvenlik duvarı ve erişim denetimi olmadan bilgisayarınızı internete açmayın. Google callback ve webhook URL’leri yeni dağıtım adresine göre güncellenmelidir.

## 8. Sorun giderme

| Belirti | Yapılacak işlem |
| --- | --- |
| `http://localhost/xrecrm` açılmıyor / 403 | PHP uygulaması değildir. Node.js sunucusunu başlatıp `http://localhost:3000` kullanın. Apache kaynak koruması nedeniyle 403 beklenebilir. |
| `node` veya `pnpm` tanınmıyor | Node.js/pnpm kurulumunu tamamlayıp yeni CMD açın. |
| `Cannot find package express` | Proje kökünde `pnpm install --frozen-lockfile` çalıştırın. |
| `dist/server.js` bulunamadı | Proje kökünde `pnpm build` çalıştırın. |
| `EADDRINUSE` | 3000 portunu kullanan kendi önceki CRM terminalini kapatın veya `.env` içinde PORT=3001 ve PUBLIC_ORIGIN=http://localhost:3001 kullanın. |
| Veritabanı hazır değil / 503 | XAMPP MySQL, DATABASE_URL, veritabanı/kullanıcı/izin/port ayarlarını kontrol edin. |
| `OAUTH_NOT_CONFIGURED`, 401 veya 403 | Yerel canlı oturum kurulumu/erişim izni yoktur; demo kullanılabilir. Güvenlik kodunu devre dışı bırakmayın. |
| Demo mesajı/araması gerçek gitmiyor | Beklenen davranıştır. Demo dış servis çağırmaz. |
| Webhook gelmiyor | localhost dış dünyaya kapalıdır; erişilebilir HTTPS ve sağlayıcı webhook kurulumu gereklidir. |
| Ayar değişti ama etkilenmedi | Node.js terminalini durdurup yeniden başlatın. |

## Paketin içeriği

- Son CRM v7 kaynakları: `client`, `server`, `shared`, `public`.
- Önceden derlenmiş uygulama: `dist`; Windows’ta ilk kurulum tekrar derleme de yapar.
- Testler, pnpm kilit dosyası, TypeScript/Vite ayarları, Dockerfile, proje planı ve geliştirme belgeleri.
- Korunmuş eski CRM/WhatsApp kaynakları: `legacy`; bunlar güncel ana uygulamanın yerine ayrıca başlatılmaz.
- `.env.example`, kurulum/başlatma komut dosyaları ve bu rehber.

**Hariç tutulanlar:** gerçek API anahtarları/parolalar, `.env`, bulut veritabanı/oturumları, müşteri SQL dökümleri, özel medya, `node_modules` ve `.git`. Hat envanteri/ICCID eşleşmeleri uygulamada vardır; ZIP’i yalnız yetkili kişilerle paylaşın.

Kaynak temeli `KAYNAK_SURUMU.txt` dosyasındadır. Teslimde yalnız pakete eklenen taşınabilir başlatıcı nedeniyle `package.json` içindeki `start` komutu Windows uyumlu hale getirilmiştir; çalışan bulut projesinin kaynakları değiştirilmemiştir.
