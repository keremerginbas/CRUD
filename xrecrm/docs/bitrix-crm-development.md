# Bitrix24 karşılaştırması ve XRE CRM v7 geliştirme raporu

**Tarih:** 13 Ekim 2026  
**Kapsam:** Yüklenen CRM, WhatsApp ve mesai kaynaklarının erişilebilir dosya envanteri; mevcut XRE CRM; verilen n8n iş akışlarının güvenli yapısal incelemesi; kamuya açık resmî Bitrix24 belgeleri. Gizli ayar değerleri rapora alınmadı. Bitrix24’ün kapalı ürününün tüm kaynak koduna erişilmiş olduğu veya tüm özelliklerinin kopyalandığı iddia edilmez.

## Araştırma bulguları ve uygulanan karşılıklar

| İş alanı | Bitrix24 yaklaşımı | XRE CRM’de mevcut/eklenen karşılık | Bu tur dışında kalanlar |
| --- | --- | --- | --- |
| CRM çalışma alanı | Kanban/liste, bağlı CRM öğesi ve tarih filtreleri, kart ayarları | Dört görünüm korunarak kullanıcıya özel kayıtlı filtreler; şehir/aşama/tarih/tutar ve kişi/şirket ilişki filtreleri; sıkı/standart/detaylı kart; gerçek liste sütunu seçimi eklendi | Paylaşılabilir ekip görünümleri, sınırsız özel aşama yapısı, büyük veri için sayfalama |
| Alan ve aşama disiplini | Aşamaya göre gerekli alanlar ve geçiş geçmişi | Huni/aşama bazında telefon, e-posta, şehir, kaynak, sorumlu, kişi/şirket zorunluluğu; sunucuda ortak yazma doğrulaması; güvenilir aşama giriş kimliği ve aktör bilgisi | Önceki kayıtların toplu temizlenmesi, koşullu özel alan türleri |
| Otomasyonlar | Koşul, gecikme ve iş saatleri semantiği | AND/OR koşulları, anlık veya 10–10.080 dakika gecikme, Türkiye hafta içi 09.00–18.00; yan etkisiz müşteriyle kural testi; kalıcı plan ve çalışmadan önce güncel yetki/koşul/aşama yeniden denetimi | Resmî tatil takvimi, tenant kota yönetimi, tüm Bitrix/n8n yazma sözleşmeleri |
| Veri kalitesi | Şirket/kişi sıralı içe aktarma, iletişim üzerinden mükerrer arama | CSV/TSV önizleme ve kullanıcı alan eşlemesi; normalizasyon; yalnız yeni kayıt ekleme; idempotency ve atomik çakışma koruması; eksik iletişim ve görünür mükerrer aday ekranı | XLSX okuma, merge/replace/silme ve uzlaştırma kuyruğunda toplu karar |
| İletişim merkezi | Kanal geçmişi, oturum kimliği, Open Channel kapanış olayları | Mevcut WhatsApp/Vapi/timeline/AI bağları korunuyor; on dakikadan eski yarım kalan gelen webhookların kuyruk kurtarması ve olay günlüğünün plan/atlama etiketleri güçlendirildi | Bütün kanalları tek yeni olay şemasında birleştirme, canlı Open Channel senkronu, QR/SIP/PBX sağlayıcı kurulumu |
| Ekip, görev ve mesai | Oluşturan/sorumlu/katılımcı/gözlemci, proje bazlı roller, Timeman | Mevcut görev, kontrol listesi, takvim, departman, modül izinleri ve mesai korunuyor; kişi/şirket own-scope sahipliği güçlendirildi | Görev katılımcıları/gözlemcileri, bağımsız proje/iş grubu rol modeli, Bitrix görev/flow uzlaştırması |
| Satış analitiği ve teklifler | Katalog, ürün satırı, indirim/vergi/para birimi, müşteri teklifleri | Mevcut tutar, kaynak, danışman, huni ve iletişim raporları korunuyor | Katalog, teklif kalemleri, teklif kabul/yaşlanma ve ürün kârlılık analizi |

## Neden bu dört geliştirme seçildi?

1. **Kişisel çalışma alanı:** Satış ekibinin her gün kullandığı görünüm ve arama yükünü azaltır. Aynı filtreler dört CRM görünümüne bağlıdır; kullanıcılar birbirinin tercihlerini değiştirmez.
2. **Aşama doğrulaması:** Boş telefon/şehir veya yanlış kişi/şirket bağlantısıyla aşama değiştirilmesini kayıt yolundan bağımsız engeller. Randevu tarih ve saati kuralı korunur.
3. **Veri kalitesi ve aktarım:** Eski kayıtları riske atmadan yeni kişi/şirket/müşteri listesini önizleyerek eklemeyi sağlar. Bu sürümde mükerrerleri otomatik birleştirmek yerine atlamak bilinçli veri koruma tercihidir.
4. **Planlı robotlar:** Bir kurala neden uyulduğu/uyulmadığı ve ne zaman çalışacağı görülebilir. Gecikme boyunca değişen müşteri veya yetki eski bir iletişimi tetiklemez.

## Bağımsız inceleme sonrası güçlendirilen güvenlik

- Yetki deposu, yetkilendirmeden sonra randevu/aşama invariantlarını atlamaz.
- Kendi kapsamındaki kişi ve şirketlerin sorumlusu başka kullanıcıya devredilemez; güvenilir sahibi doğrulanmış oturumdan türetilir.
- Aktarım mevcut kimliği yarış koşulunda dahi değiştirmez; MySQL ve bellek deposunda atomik yalnız-ekleme işlemi vardır.
- Aynı aşamadan çıkıp tekrar girişte önceki planın yürütülmesi geçiş kimliğiyle engellenir.
- Yarım kalan gelen webhooklar kurtarılır; belirsiz dış gönderimlerde insan incelemesi davranışı korunur.

Doğrulama, bellek depoları ve sentetik kayıtlarla yapılmıştır. Bu tur gerçek müşterilere arama/WhatsApp gönderimi, canlı n8n iş akışı tetikleme, Bitrix’e yazma, kullanıcı izni değiştirme, gerçek veri aktarımı veya silme yapılmamıştır.

## Sonraki geliştirme sırası

**Önce canlı iletişim kapanışı:** Vapi sonuç webhook’u/transkript, QR sağlayıcısı, SIP/PBX cihaz bağlantısı ve n8n üretim sözleşmeleri tamamlanmalı. API anahtarının mevcut olması tek başına uçtan uca kurulumun tamamlandığı anlamına gelmez.

**Sonra teklif/katalog:** Müşteriye bağlı taslak teklif, kalemler, miktar, indirim, vergi, para birimi, geçerlilik ve tekliften satışa izlenebilir bağ eklenebilir. Eski Bitrix yöntemleri yerine resmî belgelerde önerilen evrensel CRM yöntemleri hedeflenmelidir.

**Sonra proje/ekip modeli:** Göreve katılımcı ve gözlemci, proje üyeliği, proje bazlı eylem izinleri ve güvenli görev senkronu eklenebilir. Genel CRM modül izni ile görev içi katılımcı rolü birbirine karıştırılmamalıdır.

## Resmî kaynaklar

- [Bitrix24 Kanban](https://helpdesk.bitrix24.com/open/25962255/) ve [CRM filtreleri](https://helpdesk.bitrix24.com/open/25355170/)
- [İçe aktarma](https://helpdesk.bitrix24.com/open/25766211/) ve [alan eşleme/ilişkilendirme](https://helpdesk.bitrix24.com/open/25934631/)
- [İletişim bilgisiyle mükerrer arama](https://apidocs.bitrix24.com/api-reference/crm/duplicates/crm-duplicate-find-by-comm.html)
- [Otomasyon kuralları](https://helpdesk.bitrix24.com/open/24695266/), [zamanlama ve işlem sırası](https://helpdesk.bitrix24.com/open/21509930/), [koşullar](https://helpdesk.bitrix24.com/open/21174186/)
- [Contact Center](https://helpdesk.bitrix24.com/open/25935795/), [Open Channel geçmişi](https://apidocs.bitrix24.com/api-reference/imopenlines/openlines/sessions/imopenlines-session-history-get.html)
- [İş grubu görevleri](https://helpdesk.bitrix24.com/open/6337471/) ve [görev erişim izinleri](https://helpdesk.bitrix24.com/open/25908803/)
- [Ürün kataloğu](https://helpdesk.bitrix24.com/open/25829591/), [ürün satırı yöntemi/geçiş notu](https://apidocs.bitrix24.com/api-reference/crm/deals/crm-deal-productrows-set.html), [estimate yöntemi/geçiş notu](https://apidocs.bitrix24.com/api-reference/crm/quote/crm-quote-add.html)

Bu rapordaki eklenen işlevlerin kullanım adımları `crm-v7.md` rehberindedir. Araştırmanın önceki salt-okunur ihtiyaç analizleri tarihsel değerlendirmedir; bu rapor v7 uygulama durumunu günceller.
