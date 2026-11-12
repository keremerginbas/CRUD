# SMS (Turkcell Mesajüssü)

XRE CRM, Turkcell Mesajüssü hesabınız üzerinden müşterilere SMS gönderir.

## Kurulum
1. Turkcell Mesajüssü hesabınızda **API (entegrasyon) izninin** açık olduğundan ve onaylı bir **gönderici başlığınız** olduğundan emin olun. Turkcell IP kısıtı uyguluyorsa sunucunuzun IP adresini tanımlatın.
2. CRM'de **Entegrasyonlar → SMS (Turkcell) → Bağla**: kullanıcı adı, şifre ve gönderici başlığını girip kaydedin.
3. **Bağlantıyı test et**: yalnızca giriş denenir, SMS gönderilmez.

## Kullanım
- Müşteri kartında **SMS gönder** düğmesi.
- Otomasyonlarda **SMS gönder** işlemi (`{{name}}` gibi alanlar kullanılabilir).
- Gönderilen her SMS müşteri kartının akışına "SMS gönderildi: …" olarak yazılır.

## Ayarlar
| Ayar | Açıklama |
|---|---|
| Ticari ileti (İYS) | `0`: bilgilendirme (varsayılan). `1`: reklam/kampanya; yalnız İYS izni olan numaralara gider. |
| Numara biçimi | `10`: 5xxxxxxxxx (varsayılan). `90`: 905xxxxxxxxx. Gönderim reddedilirse diğerini deneyin. |
| Servis adresi | Turkcell farklı bir adres verdiyse yazın. |

## Sınırlar ve bilinmesi gerekenler
- Kullanıcı başına dakikada 20, çalışma alanı başına saatte 600 SMS.
- Kayıtla açılan firmalar ortak SMS hesabını kullanamaz.
- Teslim raporu ve gelen SMS okunmaz.
- Bağlantı, Turkcell'in herkese açık örneklerindeki sözleşmeye göre yazıldı (`/login` → `token`, `/sms/campaign/create/json`); resmî doküman geliştirme ortamından okunamadı. İlk gönderimi kendi numaranıza yaparak doğrulayın.
