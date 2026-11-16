# Netsantral (Netgsm bulut santrali)

XRE CRM, Netgsm Netsantral ile üç iş yapar:

- **Tek tıkla arama:** Müşteri kartındaki düğmeye basınca önce sizin dahili telefonunuz çalar, açınca müşteri aranır.
- **Gelen aramada müşteri kartı:** Telefonunuz çalarken ekranınızda "arama geliyor" bildirimi ve arayan müşterinin kartı açılır. Numara kayıtlı değilse yeni müşteri kartı oluşturulur.
- **Görüşme kaydı:** Görüşme bitince süre, yön (gelen/giden), sonuç (görüşüldü/cevapsız) ve varsa ses kaydı bağlantısı müşterinin geçmişine yazılır.

> **Önemli:** Bu bağlantı Netgsm'in yayımladığı örneklere göre yazıldı; **henüz gerçek bir Netsantral hesabıyla denenmedi.** Kurulumdan sonra sayfanın sonundaki [ilk gerçek aramada kontrol listesi](#henüz-gerçek-hesapla-doğrulanmadı)ni mutlaka uygulayın.

## 1. Netgsm'den isteyecekleriniz

Netgsm destek hattını arayın ya da panelden talep açın ve şunları isteyin:

1. **Netsantral için API yetkili alt kullanıcı** (bir kullanıcı adı ve şifre verirler). Panele girdiğiniz ana şifreyi kullanmayın.
2. Hesabınızda **IP kısıtlaması** varsa CRM sunucunuzun dış IP adresinin izinli listeye eklenmesi. (IP adresinizi bilmiyorsanız CRM'i kuran kişiye sorun.)
3. **Santral numaranız** (genelde 0850 ile başlayan numara) ve birden fazla numaranız varsa aramalarda hangisinin görüneceği.
4. Her çalışanın **dahili numarası** (101, 102 gibi). Netsantral panelindeki dahili listesinde de görünür.

## 2. CRM'de ayarları girin

CRM'e **yönetici (çalışma alanı sahibi)** hesabıyla girin: **Entegrasyonlar → Telefon santrali → Bağla** ve açılan pencerede **Netsantral (Netgsm bulut santrali)** bölümü. (Aynı alanlar Entegrasyonlar sayfasının altındaki "Tüm gelişmiş ayarlar" içinde de vardır.)

| Alan | Ne yazılır |
|---|---|
| API kullanıcı adı | Netgsm'in verdiği API yetkili alt kullanıcının adı. |
| API şifresi | O kullanıcının şifresi. Kaydedildikten sonra ekranda yalnız son 4 karakteri görünür. |
| Santral numarası | Netsantral'a bağlı ana numaranız, başında 0 olmadan ve boşluksuz. Örnek: `8500000000` |
| Dış hat numarası (isteğe bağlı) | Müşteriyi ararken görünecek numara. Tek numaranız varsa boş bırakın. |
| Çalma süresi | Telefonun kaç saniye çalacağı. Boş bırakırsanız 20 saniye. |
| Arama sırası | `if`: önce sizin dahiliniz çalar (önerilen). `of`: önce müşteri aranır. |
| Servis adresi (isteğe bağlı) | **Boş bırakın.** Yalnız Netgsm size farklı bir adres verirse yazın. |
| Bildirim adresi anahtarı | **Boş bırakın.** CRM kendisi üretir. |

**Kaydet**'e basın. Başka bir santral ayarı girili değilse CRM Netsantral'ı kendiliğinden kullanır. Daha önce Asterisk ya da URL tabanlı santral ayarı girdiyseniz, "Santral" bölümündeki **Sürücü** alanına `netsantral` yazıp kaydedin.

## 3. Bildirim adresini Netsantral'a yapıştırın

Gelen aramaların ve görüşme kayıtlarının CRM'e düşmesi için Netsantral'ın CRM'e haber vermesi gerekir.

1. CRM'de Netsantral bölümünün altında **"Netsantral'a yapıştırılacak bildirim adresi"** kutusu görünür. **Kopyala**'ya basın.
   - Kutu boşsa önce Entegrasyonlar → "Genel" bölümüne CRM'inizin internet adresini (ör. `https://crm.firmaniz.com`) yazıp kaydedin.
2. Netgsm paneline girin: **Netsantral → Ayarlar → Genel Ayarlar → API Talep Ayarları**.
3. Kopyaladığınız adresi yapıştırın, kaydedin ve **etkinleştirin**.

Bu adres gizlidir; içindeki uzun anahtar sizin şifreniz gibidir. Kimseyle paylaşmayın. Yanlış kişilerin eline geçtiğini düşünürseniz CRM'de "Bildirim adresi anahtarı" alanının yanındaki çöp kutusuna basın; CRM yeni bir adres üretir, onu Netsantral paneline yeniden yapıştırın.

## 4. Her çalışan dahili numarasını girer

Her çalışan kendi hesabıyla bir kez yapar:

1. Herhangi bir müşteri kartını açın ve **arama** düğmesine basın.
2. "Santralden ara" bölümünde **Dahili numaranız** kutusuna kendi dahilinizi yazın (ör. `101`).
3. **Dahilimi çaldır ve ara**'ya basın. Numara kaydedilir; bir daha sormaz.

Gelen aramalarda bildirim, o an çalan dahilinin sahibi olan çalışanın ekranında çıkar. Bu yüzden herkesin doğru dahiliyi girmesi önemlidir.

## 5. Deneyin

1. Netsantral bölümünde **Bağlantıyı test et**'e basın. Bu düğme yalnız ayarların eksiksiz olduğunu denetler ve yapıştırmanız gereken adresi gösterir; **gerçek arama yapmaz** (Netgsm zararsız bir deneme isteği sunmuyor).
2. Kendi cep numaranızla bir deneme müşterisi açın, kartından **Dahilimi çaldır ve ara**'ya basın. Önce masa telefonunuz, açınca cebiniz çalmalı.
3. Cebinizden santral numaranızı arayın. CRM açık olan çalışanın ekranında "arama geliyor" bildirimi çıkmalı.
4. Görüşmeyi kapatın. Bir iki dakika içinde müşteri kartının geçmişinde görüşme tek satır olarak görünmeli.

## Sık karşılaşılan iletiler

| CRM'in gösterdiği ileti | Ne yapmalı |
|---|---|
| Dahili numaranız ya da dış hat numarası santralde tanımlı görünmüyor | Arama penceresindeki dahilinizi ve ayarlardaki santral / dış hat numarasını kontrol edin. |
| Netsantral girişi kabul etmedi | API kullanıcı adı/şifresini yeniden girin. Doğruysa Netgsm'e API yetkisini ve IP kısıtlamasını sorun. |
| Çok sık istek geldiğini bildirdi | Bir dakika bekleyip yeniden deneyin. |
| Netsantral sunucusuna ulaşılamadı | Sunucunuzun internete çıkışını (9111 numaralı kapı dahil) kontrol ettirin. |
| Dahili telefonunuz santrale bağlı görünmüyor | Masa telefonunuzun ya da telefon uygulamanızın açık ve bağlı olduğuna bakın. |

## Bilinmesi gerekenler

- Netgsm'in bu servisi **şifresiz (HTTP) bağlantı** kullanır ve API şifresi adresin içinde gider. Bu Netgsm'in tasarımıdır. CRM bu adresi hiçbir yere yazmaz, hata iletilerinde göstermez. Netgsm size HTTPS'li yeni bir adres verirse "Servis adresi" alanına yazmanız yeterlidir.
- Bu nedenle API kullanıcısına **yalnız gerekli yetkiyi** verdirin ve mümkünse Netgsm'de **IP kısıtlaması** açtırın.
- Netsantral bildirimlerinde imza ya da şifre yoktur; tek koruma adresin içindeki gizli anahtardır.
- Ses kaydı bağlantısı yalnız `https://dosyaindir.netgsm.com.tr/…` ile başlıyorsa saklanır; başka adresler atılır. Bağlantı kayıtta tutulur ama müşteri kartında henüz gösterilmez.
- Netsantral'ın geçmiş aramaları topluca çekme servisi (rapor) kullanılmıyor; kayıtlar yalnız bildirim adresi üzerinden gelir. Bildirim adresi yapıştırılmadan önceki görüşmeler CRM'e düşmez.
- Bildirim adresi dakikada en fazla 300 bildirim kabul eder; fazlası geri çevrilir. Olağan kullanımda bu sınıra yaklaşılmaz; amaç, adres yanlış ellere geçerse CRM'in sahte kayıtlarla dolmasını önlemektir.
- CRM bir bildirimi o anda işleyemezse (ör. veritabanı kısa süre yanıt vermezse) bildirimi saklar ve kısa süre sonra kendisi yeniden işler; görüşme kaydı kaybolmaz.
- Tarayıcıdaki telefonu (web telefon) da kullanıyorsanız: Netsantral bildirimleri gelmeye başladıktan sonra görüşmeler yalnız bildirimlerden kaydedilir, tarayıcı ayrıca ikinci bir satır yazmaz.
- CRM'den başlatılan aramayı CRM'den kapatma (kapat düğmesi) yoktur; telefonunuzdan kapatın.

## Henüz gerçek hesapla doğrulanmadı

Bu bağlantı Netgsm'in 2023 tarihli resmî PHP paketindeki (`netgsm/netsantral`) adres ve örneklere göre yazıldı. Netgsm'in güncel resmî belgesi geliştirme sırasında okunamadı ve gerçek hesapla deneme yapılmadı. İlk gerçek aramada şunları tek tek kontrol edin; biri tutmazsa CRM'i kuran kişiye bu listeyi ve gördüğünüzü iletin (düzeltmelerin tamamı `server/netsantral.ts` dosyasındadır):

1. **Hesabınız hangi sistemde?** Netgsm'in "Netsipp" adında daha yeni bir santral altyapısı olduğu görülüyor; onun arama servisi farklıdır (anahtarla giriş, farklı adres). Netgsm'e "Hesabım `crmsntrl.netgsm.com.tr:9111` adresindeki Netsantral API'sini kullanıyor mu?" diye sorun. Kullanmıyorsa bu bağlantı çalışmaz.
2. **Tek tıkla arama başlıyor mu?** Başlamıyorsa gösterilen iletiye bakın. Denenecekler:
   - Adresteki hesap bölümü: varsayılan olarak API kullanıcı adı kullanılır. Netgsm örneklerinde burada 850'li numara da görünüyor. Tutmazsa "Servis adresi" alanına `http://crmsntrl.netgsm.com.tr:9111/8500000000` biçiminde (sonuna santral numaranızı ekleyerek) yazın.
   - "Dış hat numarası" boşken santral numarası gönderiliyor; Netgsm farklı bir değer istiyorsa o alanı doldurun.
   - Santral numarası ve müşteri numarasının biçimi (`8500000000`, `05xxxxxxxxx`) kabul ediliyor mu?
   - CRM'in gönderdiği arama kimliği (`crm_id`, 45 karakter, harf-rakam-tire) kabul ediliyor mu?
   - **Başarılı yanıt nasıl görünüyor?** CRM yalnız Netgsm örneğindeki gibi `"status":"Success"` içeren yanıtı "arama başladı" sayar; başka her yanıtta hata iletisi gösterir. Telefonunuz çaldığı hâlde CRM "Netsantral beklenmeyen bir yanıt verdi" ya da "aramayı başlatmadı" diyorsa başarılı yanıt örnekteki gibi değildir ve düzeltme gerekir (`netsantralAccepted`).
3. **Arama sırası doğru mu?** `if` iken önce dahilinin çaldığını doğrulayın.
4. **Çok sık istek sınırı aramaları da kapsıyor mu?** Netgsm "dakikada en fazla 2 sorgu" sınırından söz ediyor; bunun tek tıkla aramaya uygulanıp uygulanmadığı belli değil. Arka arkaya üç arama deneyin.
5. **Bildirimler geliyor mu ve hangi biçimde?** Netsantral'ın bildirimleri JSON olarak mı form olarak mı gönderdiği belgelenmemiş; CRM ikisini de kabul eder. Deneme aramasından sonra hiç kayıt oluşmuyorsa adresin panelde etkin olduğunu kontrol edin.
6. **Gelen aramada bildirim doğru kişide çıkıyor mu?** Netgsm örneğinde çalan dahili `pbx_num` alanında, başka örnekte `internal_num` alanında geliyor; CRM ikisine de bakar. Bildirim herkese çıkıyorsa ya da hiç çıkmıyorsa dahili bilgisi beklenen alanda gelmiyordur.
7. **Aynı görüşme tek satır mı?** Bu, tahmine en çok dayanan bölümdür. Netgsm'in örneklerinde canlı bildirimlerdeki arama kimliği `1428481945.3543` gibi, görüşme sonu kaydındaki kimlik ise `sip8-1611752738.106785` gibi yazılmış; ancak bu örnekler **farklı aramalara ait**. Aynı aramanın iki yerde aynı numarayla geldiğini gösteren bir örnek yok. CRM şu varsayımlarla eşleştirir:
   - Baştaki `sip8-` bölümü yalnız sunucu adıdır; atılınca iki kimlik aynıdır.
   - Tek tıkla aramada Netgsm'in yanıtında döndürdüğü kimlik, sonradan gelen bildirimlerdeki kimlikle aynıdır. Aynı değilse CRM bildirimi, **son 10 dakikada CRM'den aynı numaraya başlatılmış ve henüz bitmemiş** aramaya yazar. (Bu yüzden aynı müşteriyi 10 dakika içinde hem CRM'den hem telefonun tuşlarından ararsanız iki arama tek satırda birleşebilir.)
   - Netgsm bildirimde CRM'in gönderdiği `crm_id` değerini geri yollarsa CRM doğrudan onu kullanır; yollayıp yollamadığı bilinmiyor.
   - Kuyruk ya da aktarma içeren aramalarda Netgsm aynı görüşme için birden çok görüşme sonu satırı gönderebilir; CRM bunları `ortakkimlik` alanı aynıysa tek satırda toplar. Bu alanın adı ve anlamı da doğrulanmalı.

   Aynı görüşme müşteri geçmişinde iki satır görünüyorsa (özellikle biri "Arama başlatıldı" durumunda kalmışsa) bu varsayımlardan biri tutmuyordur; iki satırın da saatini ve yönünü not edip iletin.
8. **Görüşüldü / cevapsız doğru mu?** Görüşme sonu kaydındaki `sondurum` ve `yon` kodlarının anlamı belgelenmemiş. CRM bu yüzden kararı süreye göre verir: görüşme sonu kaydındaki süre (`sure`) ya da kapanış bildirimindeki konuşma süresi 0'dan büyükse "görüşüldü", süre 0 ise "cevapsız". Kayıtta süre alanı hiç yoksa cevap bildiriminin (Answer) gelip gelmediğine bakılır. Şunları deneyin:
   - Gelen bir aramayı **açmadan** çaldırıp kapatın. Kayıt "görüşüldü" çıkıyorsa süre çalma süresini de içeriyordur ve düzeltme gerekir.
   - Tek tıkla aramada dahilinizi açın ama müşteri (cebiniz) **açmasın**. Kayıt "cevapsız" çıkmalı.

   Ham `sondurum`, `yon`, `sure` değerleri kayıtta saklanır (`providerMeta`); birkaç farklı aramanın değerleri karşılaştırılarak kodların anlamı çıkarılabilir.
9. **Yön doğru mu?** Gelen/giden bilgisi arayan ve aranan numaralardan çıkarılır (dahili ya da santral numarası hangi taraftaysa). Kuyruk, aktarma ve yönlendirme içeren aramalarda yanlış çıkıp çıkmadığına bakın.
10. **Cevap ve kapanış bildirimleri (Answer, Hangup) geliyor mu?** Bu iki bildirimin varlığı yalnız dolaylı olarak biliniyor; alan adları tahmindir. Gelmezlerse kayıt görüşme bitene kadar "çalıyor" görünür, görüşme sonu kaydıyla düzelir. Cevap bildirimi geldiğinde kayıt "görüşülüyor" olur; son karar yine 8. maddedeki süreye göre verilir. Kuyruklu aramalarda bir dahili açmadan önce "cevapsız" bildirimi çıkıyorsa bildirin.
11. **Ses kaydı bağlantısı** `https://dosyaindir.netgsm.com.tr/` ile mi başlıyor? Farklı bir adresten geliyorsa kayıt bağlantısı saklanmaz.
12. **Saat doğru mu?** Görüşme başlangıcı (`bas`) Türkiye saati kabul edilir.
13. **Netsantral aynı bildirimi yeniden gönderiyor mu?** CRM birebir aynı bildirimi ikinci kez işlemez; yine de çift kayıt görürseniz bildirin.
14. **Arayan numara hangi biçimde geliyor?** Numara başında 0 olmadan gelirse (ör. `2125550000`) CRM başına 0 ekleyerek kayıtlı müşteriyle eşleştirir. Kayıtlı bir müşteri aradığında yeni bir müşteri kartı açılıyorsa numara beklenmeyen bir biçimde geliyordur.
