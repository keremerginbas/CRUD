# XRE WhatsApp: Bitrix24 Market ilan metinleri

Bu dosya, Bitrix24 geliştirici alanındaki (https://vendors.bitrix24.com) uygulama kartına girilecek metinleri içerir. Kart **İngilizce** olmak zorunda; Türkçe açıklama isteğe bağlıdır. `[ ]` içindeki yerleri yayından önce doldurun.

## Uygulama kartı (Solution card)

| Alan | Değer |
|---|---|
| Yayın bölgesi | Global |
| Uygulama adı | XRE WhatsApp *(ad konusunda aşağıdaki "Ad ve marka" notuna bakın)* |
| Kategoriler | Integrations → Messengers / Open Channels connectors; CRM; Automation → Chat bots *(bu sonuncusu yalnız Bitrix sohbet botu eklenirse seçilebilir; şimdilik seçmeyin)* |
| İkon | `docs/market/icon-512.png` (512×512, PNG, saydam değil, üçüncü taraf logosu yok) |
| Ekran görüntüleri | `docs/market/screenshots/en-*.png` (1280×720, İngilizce arayüz, gerçek olmayan demo verisi). Bitrix kuralı uygulamanın **Bitrix24 kaydırmalı paneli içinde** görünmesini ister. Yayından önce aynı ekranları kendi test portalınızda, uygulama Bitrix içinde açıkken yeniden çekin. |
| Lisans sözleşmesi | `https://crm.xresoftware.com.tr/b24/legal/terms` |
| Gizlilik politikası | `https://crm.xresoftware.com.tr/b24/legal/privacy` |
| Geliştiriciyle iletişim | `https://crm.xresoftware.com.tr/b24/support` |
| Fiyat politikası | "The application will be distributed for free" + "Users must pay for the external service" |

### Short description

> Connect WhatsApp numbers to Bitrix24 Open Channels and answer every chat from Bitrix24, with auto-translation, an AI assistant and team analytics.

### Full description

> **XRE WhatsApp** brings your WhatsApp numbers into Bitrix24. Each number becomes an Open Channel, so your team answers WhatsApp chats right in Bitrix24, with CRM, history and queues in one place.
>
> **What you get**
> - Connect any number of WhatsApp numbers with a QR code, no developer account required.
> - Roles: decide which employees receive the chats of which numbers. Everyone sees only their own numbers.
> - Text, images, documents, voice messages and video in both directions; incoming calls, edited and deleted messages appear as notes.
> - Automatic translation: foreign-language messages are shown with a translation, and replies are sent back in the customer's language.
> - Voice messages are transcribed so they can be read without listening.
> - AI lead qualification: budget, location, intent and a 0–100 score are added to the lead timeline.
> - AI assistant: answers customers 24/7 or outside business hours from your own knowledge base and hands the chat to an agent when needed.
> - Live monitor: who is online, a live chat feed, today's leads and deals, and lead sources.
> - Performance analytics: message volume, first response times per agent and per number, waiting chats.
> - Daily, weekly and monthly AI manager reports, delivered as a private link via WhatsApp or Bitrix24 notification.
>
> **Requirements and limitations**
> - Installation and setup require Bitrix24 administrator rights. Open Channels must be available on your plan.
> - A WhatsApp account on a phone is required for each number. The number connects as a linked device (like WhatsApp Web), and the phone needs to be online occasionally to keep the link active.
> - XRE WhatsApp is not affiliated with WhatsApp or Meta. Follow WhatsApp's rules; bulk unsolicited messaging can lead to account restrictions by WhatsApp.
> - Business hours for the AI assistant and report delivery times use the UTC+3 time zone.
> - The interface is available in English and Turkish.
>
> **Pricing**
> - Installing the app is free. Every connected number gets a **7-day free trial**.
> - After the trial, each number requires a license: **[PRICE] USD per number per month**, with 10% off for 3 months, 20% off for 6 months and 35% off for 12 months. Prices are shown on the Billing tab before payment.
> - Payment is made by bank transfer from the Billing tab or with a license code. AI features are included in the price.

### Installation process description

> 1. Click **Install** and open **XRE WhatsApp** from the left menu (administrator account). The app registers its Open Channel connector automatically.
> 2. On the **Connections** tab click **Add number**, enter a name (for example "Sales") and click **Add and scan QR**. An Open Channel is created for the number.
> 3. On the phone open WhatsApp → **Settings → Linked devices → Link a device** and scan the QR code. The card turns green when the number is connected.
> 4. On the **Roles** tab create roles and choose which numbers each role can see. On the **Staff** tab assign a role to each employee. Employees are added to the Open Channel queues of their numbers automatically.
> 5. Optional: on **Settings** enable translation, voice transcription and lead qualification. On **AI Assistant** write your knowledge base, choose 24/7 or outside business hours, test it in the **Try it** box and switch it on. On **Reports** choose daily, weekly or monthly reports and their recipients.
> 6. WhatsApp chats now arrive in Bitrix24 **Open Channels**; replies written in Bitrix24 are delivered via WhatsApp.

### Support and feedback information

> E-mail: [support@…] · Phone: [+90 …] · Help page: https://crm.xresoftware.com.tr/b24/support
> Support hours: [Monday–Friday, 09:00–18:00 (UTC+3)]. We reply to every request within 1 business day.

### Keywords

> whatsapp, whatsapp integration, open channels, messenger, chat, connector, qr, translation, transcription, ai assistant, chatbot, lead qualification, live monitor, analytics, response time, sales team, real estate

### Test data (yayınlanmaz, moderatör için)

> The app works on any Bitrix24 account: install it, open it from the left menu, click "Add number" and scan the QR code with any WhatsApp account (Settings → Linked devices). To test on a second Bitrix24, install it there and connect another WhatsApp account (or log the first one out under Linked devices). If you do not have a test WhatsApp account, please see the demo video: [VIDEO LINK]. We can also connect a test number for you during a call; contact [support@…].

## Sürüm kartı (Version card)

| Alan | Değer |
|---|---|
| Teknoloji | Use REST API |
| Uygulama adresi (Application URL) | `https://crm.xresoftware.com.tr/b24/app` |
| Kurulum adresi (Installer URL) | `https://crm.xresoftware.com.tr/b24/install` |
| Sol menüye sayfa ekle | Evet |
| BitrixMobile'a göm | Hayır (panel mobilde çalışır ama ilk sürümde gerekmez) |
| Yönetici olmadan kurulabilir | Hayır |
| İzinler (system sections) | `imconnector`, `imopenlines`, `crm`, `user_basic`, `im` *(yalnız rapor bildirimi için)*. Bitrix, tam `user` iznini yalnız zorunluysa ister. Test portalında `user_basic` ile personel listesi ve çevrimiçi durumu geliyorsa öyle bırakın, gelmiyorsa `user` seçin. Gereksiz izin moderasyondan döner. |
| What's new | İlk sürümde boş bırakılır. |

## Ad ve marka

- Bitrix kuralı: adda "Bitrix24" geçmemeli, ad benzersiz olmalı, ikon ve ekranlarda başkasının logosu olmamalı. İkonda WhatsApp logosu kullanmadım.
- **WhatsApp bir Meta markasıdır.** Meta'nın marka kuralları, ürün adında "WhatsApp" kullanılmasını sınırlar. Pazar yerinde "WhatsApp" adlı birçok bağlayıcı olsa da en güvenli yol, adı kendi markanızla kurup WhatsApp'ı açıklamada geçirmektir (ör. **"XRE Connect: messenger chats for Open Channels"**). Karar sizin; ad sonradan değişirse yeniden moderasyona girer.

## Yayından önce kontrol listesi

- [ ] vendors.bitrix24.com'da geliştirici hesabı ve tüzel kişi bilgileri; "Marketplace Policy" onayı (ücretsiz + uygulama içi ödeme için yeterli).
- [ ] Uygulama kaydı → client_id / client_secret → CRM'de Entegrasyonlar → "Bitrix24 pazar yeri uygulaması" alanlarına girilmesi (mevcut yerel uygulamanın anahtarları yerine).
- [ ] Entegrasyonlar ekranında geliştirici unvanı, adres, destek e-postası (uluslararası alan adı), telefon ve saatlerin girilmesi; `/b24/legal/terms`, `/b24/legal/privacy` ve `/b24/support` sayfalarının kontrolü.
- [ ] `/b24/admin` → Fiyatlar: para birimi **USD** (Bitrix global bölgede uygulama içi ödemeyi USD/EUR ister), aylık fiyat ve banka bilgileri (USD hesabı).
- [ ] Temiz bir test portalında: kur → kullan → kaldır → yeniden kur; yönetici ve normal kullanıcı olarak ayrı ayrı dene. Geliştirme yaptığınız portalda test etmeyin.
- [ ] Bitrix24 içinde, İngilizce arayüzle 1280×720 ekran görüntüleri ve 2–3 dakikalık demo videosu.
- [ ] Moderasyona gönder ("Submit For Moderation"). Süre genelde 1–3 iş günü; düzeltme istenirse moderatör sohbetinden bildirir.
