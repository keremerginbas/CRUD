# WhatsApp by XRE'nin XRE CRM'den ayrılması

Bitrix24 Market uygulaması (WhatsApp by XRE) artık XRE CRM'den bağımsız çalışır.

| | Önce | Sonra |
|---|---|---|
| Adres | `crm.xresoftware.com.tr/b24/...` | `whatsapp.xresoftware.com.tr/b24/...` |
| Uygulama | CRM ile aynı konteyner (`xrecrm-crm`) | Ayrı konteyner (`xrecrm-wa`), CRM ekranları ve API'leri yok |
| Veri | CRM veri klasöründe | Ayrı veri hacmi (`wa_data`); CRM'in Market verisine erişimi yok |
| Yönetim ekranı | CRM sahibi oturumuyla | Kendi şifresiyle (`B24_ADMIN_PASSWORD`) |
| Telefondaki bağlı cihaz adı | "XRE CRM" | "WhatsApp by XRE" (yeni bağlantılarda) |

WhatsApp sunucusu (Evolution) ikisinde ortak kalır. Oturumlar ayrı tutulur: Market oturumlarının adı `b24-` ile başlar ve olayları yalnız WhatsApp by XRE sunucusuna gider.

## Ayırma adımları (bir kez)

1. **DNS:** `whatsapp.xresoftware.com.tr` için bu sunucunun IP adresine bir A kaydı ekleyin.
2. **Sessiz bir saatte** sunucuda çalıştırın:
   ```
   cd /opt/xre && git pull && sudo bash xrecrm/deploy/vps/whatsapp-ayir.sh
   ```
   Betik sırasıyla şunları yapar:
   - Yeni uygulamayı hazırlar.
   - CRM'i yaklaşık 20 saniye durdurur.
   - Market verisini kopyalar (CRM verisi değişmez).
   - İki sunucuyu başlatır.
   - Caddy'yi günceller.

   En sonda yönetim şifresini gösterir; şifreyi bir yere not edin.
3. **Kontrol:**
   ```
   docker logs xrecrm-wa 2>&1 | grep -E "taşındı|sunucusu"
   ```
   Her portal için "Bitrix bağlantıları … adresine taşındı" satırı görünmeli.
4. **Bitrix partner paneli** (vendors.bitrix24.com → uygulama → sürüm ayarları) adreslerini güncelleyin:

   | Alan | Yeni değer |
   |---|---|
   | Uygulama adresi (Application URL) | `https://whatsapp.xresoftware.com.tr/b24/app` |
   | Kurulum adresi (Installer URL) | `https://whatsapp.xresoftware.com.tr/b24/install` |
   | Lisans sözleşmesi | `https://whatsapp.xresoftware.com.tr/b24/legal/terms` |
   | Gizlilik politikası | `https://whatsapp.xresoftware.com.tr/b24/legal/privacy` |
   | Destek | `https://whatsapp.xresoftware.com.tr/b24/support` |

   Bu adımı hemen yapmasanız da sistem çalışır: eski adresteki `/b24/...` istekleri Caddy üzerinden yeni sunucuya yönlendirilir. Adres değişikliği yeni sürüm ve moderasyon gerektirirse, Bitrix sonucu bekleyen süre boyunca da kesinti olmaz.

Kendi portalınızdaki yerel uygulamanın (Geliştirici kaynakları → yerel uygulama) adreslerini de aynı şekilde güncelleyin.

## Ne olur, ne olmaz

- **Mevcut müşteriler** bir şey yapmaz. Olay bildirimleri, kanal ayar sayfası ve CRM kart sekmesi uygulama açılışında yeni adrese kendiliğinden yeniden kaydedilir. Eski kayıtlar kaldırılır, böylece mesajlar iki kez gelmez.
- **WhatsApp bağlantıları kopmaz.** Telefonlarda yeniden QR okutmak gerekmez. Evolution yeniden başlarken bağlantılar birkaç saniye kopup geri gelir.
- **Kısa bakım boşluğu:** Taşıma sırasındaki yaklaşık 20 saniyede gelen mesajlar kaybolabilir; bu yüzden sessiz bir saatte çalıştırın. Bu sürenin dışında CRM'e gelen Market olayları yeni sunucuya iletilir.
- **OpenAI anahtarı ve Bitrix uygulama anahtarları** CRM ayarlarından kopyalanır. CRM'in diğer entegrasyon anahtarları (Meta, santral, n8n…) kopyalanmaz.
- **Ayar değişikliği:** Bundan sonra OpenAI anahtarı gibi uygulama ayarlarını değiştirmek için sunucudaki `.env` dosyasına yazıp `kurulum.sh` çalıştırın.

## Geri alma

```
sudo bash xrecrm/deploy/vps/whatsapp-ayir.sh --geri-al
```

Bu komut CRM'i eski haline (WhatsApp by XRE dahil) döndürür ve Caddy yedeğini geri yükler. Ayırmadan sonra yeni sunucuya gelen sohbet ve ödemeler CRM'deki eski kopyada bulunmaz.
