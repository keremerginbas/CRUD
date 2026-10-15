# XRE CRM WhatsApp'ı Bitrix24'e yerel uygulama olarak ekleme

Bu uygulama iki şey sağlar:

- **Sol menüde "XRE WhatsApp":** CRM'in WhatsApp gelen kutusunun tamamı Bitrix içinde açılır.
- **Müşteri kartında "WhatsApp" sekmesi:** Lead, anlaşma, kişi ve şirket kartlarında görünür. Kaydın telefonuyla sohbet doğrudan açılır. Anlaşmada önce bağlı kişinin numarası kullanılır, yoksa şirketin numarası.

## 1. CRM tarafı (bir kez)

**Entegrasyonlar → Bitrix24** bölümüne **Bitrix alan adı** girilmeli, örneğin `xre.bitrix24.com.tr`.

Uygulama yalnızca bu portaldan gelen istekleri kabul eder.

## 2. Bitrix tarafı

**Uygulamalar → Geliştirici kaynakları → Diğer → Yerel uygulama**

| Alan | Değer |
|---|---|
| Tür | Arayüzlü uygulama ("Yalnızca script" işaretlenmez) |
| İşleyici yolu | `https://crm.xresoftware.com.tr/bitrix/app` |
| İlk kurulum yolu | `https://crm.xresoftware.com.tr/bitrix/install` |
| Menü öğesi adı | XRE WhatsApp |
| İzinler | `crm`, `user`, `placement` |

Kaydedin. Kurulum ekranı açılır ve müşteri kartlarına "WhatsApp" sekmesi kendiliğinden eklenir.

## Giriş nasıl çalışır

1. Bitrix, uygulamayı açarken kullanıcının Bitrix oturum anahtarını gönderir.
2. CRM bu anahtarı yalnız ayarlı portalda doğrular. Kullanıcıyı **Bitrix kullanıcı kimliğiyle** tanır; e-posta gerekmez.
3. Kullanıcının CRM hesabı yoksa ilk girişte kendiliğinden açılır. Bitrix yöneticileri **Yönetici**, diğerleri **Satış danışmanı** rolünü alır. Bu hesapların şifresi yoktur, yalnız Bitrix'ten girilir.
4. Aynı e-postayla önceden açılmış bir CRM hesabı varsa yenisi açılmaz, o hesaba bağlanır.

Rolleri **Çalışanlar** ve **Erişim izinleri** sayfasından değiştirebilirsiniz. Otomatik hesap açmayı kapatmak için Entegrasyonlar → Bitrix24 → "Bitrix kullanıcılarına otomatik hesap" ayarını `0` yapın.

Tarayıcı Bitrix içindeki çerezleri tamamen engelliyorsa (ör. Safari'nin katı modu) **"WhatsApp'ı yeni sekmede aç"** butonu çıkar.
