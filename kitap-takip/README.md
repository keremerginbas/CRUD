# Kitap Takip

*Özgür'ün Salıncağı* (ISBN 9786259756189) kitabının satıldığı sitelerdeki stok, fiyat ve yorum
bilgilerini düzenli olarak kaydeden bir Chrome / Edge eklentisi.

Eklenti sayfaları sizin tarayıcınızda, arka plan sekmesinde açar, bilgiyi okur ve sekmeyi kapatır.
Bir site doğrulama (CAPTCHA) isterse sekme açık kalır; doğrulamayı siz tamamlarsınız ve
"Yeniden tara"ya basarsınız. Veriler yalnızca tarayıcınızda saklanır, hiçbir yere gönderilmez.

## Kurulum

1. Bu depoyu bilgisayarınıza indirin (GitHub'da **Code > Download ZIP**) ve klasöre çıkarın.
2. Chrome'da `chrome://extensions` (Edge'de `edge://extensions`) adresini açın.
3. Sağ üstten **Geliştirici modu**nu açın.
4. **Paketlenmemiş öğe yükle**ye basıp `kitap-takip` klasörünü seçin.
5. Açılan panelde **Şimdi tara**ya basın. Panele daha sonra araç çubuğundaki eklenti simgesinden ulaşırsınız.

Otomatik tarama, tarayıcı açıkken seçtiğiniz aralıkta (varsayılan 12 saat) çalışır.

## Neleri kaydeder

| Bilgi | Kaynak |
| --- | --- |
| Stok durumu (stokta, tükendi, satışa kapalı, listelenmiyor) | Sayfanın yapısal verisi, satın alma düğmesi, "Tükendi" yazısı |
| Stok adedi | "Son 3 ürün" gibi uyarılar veya sayfaya gömülü stok alanı; yalnızca site paylaşıyorsa |
| Fiyat ve liste fiyatı | Yapısal veri veya sayfa metni |
| Temin süresi, baskı sayısı | Sayfa metni |
| Puan, yorum sayısı, satış sıralaması, satıcı sayısı | Site gösteriyorsa |

Stok geçmişi şeridi her gün için durumu gösterir; "Değişiklikler" listesi tükenme, yenilenme,
fiyat ve baskı değişikliklerini tarihleriyle verir. Tüm kayıtlar **CSV indir** ile dışa aktarılır.

## Sınırlar

- Gerçek satış adedi hiçbir sitede yayımlanmaz. Bu araç dolaylı işaretleri kaydeder.
- Çoğu site adet vermez. Nobel Kitap'ın sayfasındaki `100` değeri bütün kitaplarda aynıdır;
  eklenti bunu tanır ve "Adet gizli" olarak gösterir.
- Hepsiburada, Amazon, Dost Kitabevi ve 1000Kitap geliştirme ortamından açılamadığı için bu
  sitelerin okuyucusu yalnızca örnek sayfalarla denendi. İlk taramada bu satırlarda eksik ya da
  yanlış bilgi görürseniz okuyucunun o siteye göre ayarlanması gerekir.

## Geliştirme

```bash
npm install
npx playwright install chromium
npm test
```

- `extractor.js`: açık sayfadan veriyi okur.
- `background.js`: zamanlama ve tarama.
- `lib.js`: değişiklik ve geçmiş hesapları.
- `dashboard.*`: takip ekranı.
- `targets.js`: varsayılan kitap ve sayfalar.
