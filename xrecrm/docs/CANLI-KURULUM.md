# XRE CRM canlı kurulum

## Hangi sunucu?
| | cPanel / WHM paylaşımlı hosting | VPS (önerilen) |
| --- | --- | --- |
| CRM arayüzü | Sınırlı (Node.js App varsa; uygulama boşta uyutulur) | ✅ |
| WhatsApp QR (Evolution) | ❌ Docker/arka plan servisi çalıştırılamaz | ✅ |
| Santral (Asterisk AMI), canlı bildirimler, otomatik yedek | ❌ Kalıcı süreç yok | ✅ |

Öneri: Ubuntu 24.04, 2 vCPU / 4 GB RAM / 40 GB disk bir VPS. cPanel'i e-posta ve web sitesi için kullanmaya devam edin,
sadece `crm.alanadiniz.com.tr` alt alan adını VPS'e yönlendirin.

## Adımlar
1. cPanel → **Zone Editor**: `crm` için **A kaydı** → VPS'in IP adresi.
2. ZIP'i VPS'e yükleyin (ör. WinSCP ile `/opt/`), açın: `cd /opt && unzip XRE-CRM-*.zip`
3. `sudo bash /opt/xrecrm/deploy/vps/kurulum.sh` — alan adı ve e-posta sorulur; Docker, veritabanı,
   WhatsApp sunucusu ve HTTPS sertifikası kendiliğinden kurulur. Veritabanını elle oluşturmanız gerekmez.
4. `https://crm.alanadiniz.com.tr` → yönetici hesabını oluşturun.
5. Bilgisayarınızdaki verileri taşımak için: eski CRM'de **Yedekler → Şimdi yedekle → İndir**, yeni CRM'de
   yedeği yükleyin (aşağıya bakın).

## Eski verileri taşıma
Yeni sunucuda yönetici hesabını oluşturduktan sonra yedek dosyasını sunucuya kopyalayın:
```
docker compose -f /opt/xrecrm/deploy/vps/docker-compose.yml cp xrecrm-*.json.gz crm:/app/data/backups/
```
Sonra CRM → Yedekler → ilgili yedek → **Geri yükle**. Yedekteki hesaplarla giriş yaparsınız.
