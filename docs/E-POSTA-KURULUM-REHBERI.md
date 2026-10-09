# kurumsal@excadijital.com.tr — Webmail / Kurumsal E-posta Kurulum Rehberi

Bu rehber, **excadijital.com.tr** alan adınızın bağlı olduğu hosting
firmasının paneli (cPanel/Plesk benzeri) üzerinden `kurumsal@excadijital.com.tr`
adresini kurmanız için adım adım talimatlar içerir. Bu adımlar hosting
panelinize erişim gerektirdiği için (kullanıcı adı/şifre gibi bilgiler
paylaşılması gerektiğinden) bu kurulumu sizin gerçekleştirmeniz gerekiyor —
aşağıdaki adımları takip etmeniz yeterli.

> Panel arayüzleri hosting firmasına göre küçük farklılıklar gösterebilir;
> aşağıdaki adımlar en yaygın cPanel yapısına göre yazılmıştır. Plesk
> kullanıyorsanız 7. bölüme bakın.

---

## 1. Ön Koşullar

- [ ] `excadijital.com.tr` alan adı, e-posta hizmeti sunan bir hosting
      hesabına **bağlı/yönlendirilmiş** olmalı (DNS, o hosting'in isim
      sunucularını (nameserver) gösteriyor olmalı).
- [ ] Hosting paketinizde **e-posta hesabı oluşturma** özelliği bulunmalı
      (bazı çok temel/ücretsiz paketlerde bu özellik kapalı olabilir).
- [ ] cPanel/Plesk kullanıcı adı ve şifreniz elinizde olmalı.

---

## 2. cPanel'de E-posta Hesabı Oluşturma

1. Hosting sağlayıcınızın verdiği cPanel adresine girin
   (genellikle `https://sunucuadresi:2083` veya hosting firmasının
   "cPanel'e Git" bağlantısı).
2. **Email Accounts** (E-posta Hesapları) bölümüne girin.
3. **Create** (Oluştur) butonuna tıklayın.
4. Alanları doldurun:
   - **Kullanıcı adı:** `kurumsal`
   - **Alan adı:** `excadijital.com.tr` (açılır listeden seçin)
   - **Şifre:** Güçlü bir şifre üretin (büyük/küçük harf, rakam, sembol,
     en az 12 karakter). Panelin "Password Generator" aracını kullanın ve
     şifreyi güvenli bir yere (şifre yöneticisi) kaydedin.
   - **Depolama Alanı (Quota):** Önerilen: 2–5 GB (hosting kotanıza göre).
5. **Create** / **Save** ile hesabı oluşturun.
6. Oluşan hesap artık `kurumsal@excadijital.com.tr` olarak aktiftir.

---

## 3. DNS / MX Kayıtlarını Doğrulama

E-posta kutusunun **gelen** e-postaları alabilmesi için MX kaydının doğru
sunucuya işaret etmesi gerekir.

1. cPanel içinde **Email Routing** (veya **MX Entry**) bölümüne girin,
   `excadijital.com.tr` alan adını seçin.
2. Routing seçeneğinin **"Local Mail Exchanger"** (hosting kendi sunucusunda
   e-posta barındırıyorsa) olarak ayarlı olduğundan emin olun.
3. Eğer alan adınızın DNS'i cPanel **dışında** bir yerde (örn. alan adını
   satın aldığınız firmanın DNS paneli) yönetiliyorsa, oradaki DNS
   ayarlarına şu MX kaydını ekleyin (hosting firmanızın size verdiği değer
   ile, örnek):

   | Tip | Ad/Host | Değer | Öncelik |
   |---|---|---|---|
   | MX | @ (veya excadijital.com.tr) | `mail.excadijital.com.tr` | 0 veya 10 |

   > Doğru sunucu adını hosting firmanızın "e-posta kurulum talimatları"
   > sayfasından veya destek ekibinden teyit edin.

4. Değişikliklerin yayılması (propagation) **birkaç dakika ile 24 saat**
   arasında sürebilir.

---

## 4. Teslim Edilebilirlik: SPF, DKIM, DMARC

E-postalarınızın spam kutusuna düşmemesi için bu üç kayıt **kritik**önemde.

### 4.1 SPF (Sender Policy Framework)
cPanel'de **Email Deliverability** sayfasına girin; sistem genellikle
otomatik önerilen SPF kaydını gösterir (örnek):

```
excadijital.com.tr. TXT "v=spf1 +a +mx +ip4:SUNUCU_IP_ADRESI ~all"
```

"Install" / "Kur" butonuna basarak otomatik ekleyin, ya da DNS panelinizde
manuel TXT kaydı olarak girin.

### 4.2 DKIM
Aynı **Email Deliverability** sayfasında DKIM için de bir TXT kaydı önerilir
(örnek host adı `default._domainkey`). "Install" butonuyla otomatik
ekleyebilir veya DNS panelinize manuel girebilirsiniz.

### 4.3 DMARC
DNS panelinizde şu TXT kaydını ekleyin:

| Host | Değer |
|---|---|
| `_dmarc.excadijital.com.tr` | `v=DMARC1; p=quarantine; rua=mailto:kurumsal@excadijital.com.tr` |

`p=quarantine` şüpheli e-postaları spam'e yönlendirir; sorunsuz çalıştığını
gördükten sonra `p=reject` olarak sıkılaştırabilirsiniz.

### 4.4 Test
Kurulum bittikten sonra:
- [mail-tester.com](https://www.mail-tester.com) adresine `kurumsal@excadijital.com.tr`
  üzerinden bir test e-postası gönderip puanınızı kontrol edin (10/10 hedef).
- [mxtoolbox.com/SuperTool.aspx](https://mxtoolbox.com/SuperTool.aspx) ile
  MX/SPF/DKIM/DMARC kayıtlarını doğrulayın.

---

## 5. Webmail'e Giriş

Hesap oluşturulduktan sonra tarayıcıdan şu adreslerden birine girip
webmail'e (genellikle **Roundcube** veya **Horde**) ulaşabilirsiniz:

- `https://excadijital.com.tr/webmail`
- `https://webmail.excadijital.com.tr`
- cPanel içindeki **Email Accounts** listesinde ilgili hesabın yanındaki
  **"Check Email" → "Open"** bağlantısı

Giriş bilgileri: `kurumsal@excadijital.com.tr` + oluşturduğunuz şifre.

---

## 6. Outlook / Gmail / Telefon Uygulamasına Bağlama

cPanel'de **Email Accounts → kurumsal@excadijital.com.tr → Connect Devices**
sayfası, ayarları otomatik gösterir. Genel şablon:

| Ayar | Gelen (IMAP) | Giden (SMTP) |
|---|---|---|
| Sunucu | `mail.excadijital.com.tr` | `mail.excadijital.com.tr` |
| Port (SSL) | 993 | 465 |
| Kullanıcı adı | `kurumsal@excadijital.com.tr` | aynı |
| Şifre | hesap şifresi | aynı |
| Şifreleme | SSL/TLS | SSL/TLS |

> Gmail üzerinden göndermek/almak isterseniz: Gmail → Ayarlar → Hesaplar ve
> İçe Aktarma → "Posta gönder" ve "Başka bir hesaptan e-posta ekle"
> bölümlerine yukarıdaki IMAP/SMTP bilgilerini girin.

---

## 7. Plesk Kullanıyorsanız (Kısa Özet)

1. Plesk panelinde **Mail** sekmesine girin.
2. **Create Email Address** → `kurumsal` yazıp `excadijital.com.tr` alan
   adını seçin, şifre belirleyin.
3. **Mail → Mail Settings → DNS** altında SPF/DKIM/DMARC kayıtlarını
   otomatik ekleyen seçenekleri etkinleştirin (Plesk bunu genelde tek
   tıkla sunar).
4. Webmail erişimi: `https://excadijital.com.tr:8443` üzerinden Plesk'e
   girip **Mail → Webmail** ile, veya doğrudan `webmail.excadijital.com.tr`.

---

## 8. Sık Yapılan Hatalar

- **Hesabı oluşturup MX kaydını kontrol etmemek** → e-postalar hiç ulaşmaz.
- **SPF/DKIM/DMARC atlamak** → e-postalar spam'e düşer.
- **Zayıf şifre** → kurumsal e-posta hesapları saldırganların ilk hedefi
  olur; mutlaka güçlü, benzersiz bir şifre + mümkünse 2FA kullanın.
- **Kotasız/limitsiz "catch-all" açık bırakmak** → spam bombardımanına açık
  hale gelir; sadece ihtiyacınız olan adresleri (örn. `kurumsal@`, `info@`)
  oluşturun.

---

## 9. Bu Siteyle Bağlantı

Bu depodaki web sitesinin **İletişim** sayfasındaki form,
`kurumsal@excadijital.com.tr` adresine `mailto:` bağlantısı ile e-posta
taslağı açacak şekilde ayarlanmıştır (bkz. `src/pages/Contact.js`). Yukarıdaki
kurulum tamamlandığında bu adres canlı olarak e-posta alabilecek duruma
gelecektir — formun kod tarafında ek bir değişikliğe gerek yoktur.

İleride formun, kullanıcıyı e-posta istemcisine yönlendirmek yerine
sayfadan ayrılmadan (arka planda, sessizce) gönderim yapmasını isterseniz,
bir form-backend servisi (örn. Formspree, Resend, veya kendi SMTP
bilgilerinizle basit bir sunucu fonksiyonu) entegre edilebilir; bu, yukarıdaki
e-posta kutusu kurulduktan sonra ayrı bir geliştirme adımı olarak
planlanabilir.
