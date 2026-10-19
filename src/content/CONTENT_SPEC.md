# İçerik Dosyası Formatı

Tüm içerikler ES module (`.mjs`) olarak yazılır ve `export default { ... }` ile tek bir nesne döndürür.
Build betiği (`scripts/build.mjs`) bu dosyaları okuyup statik HTML üretir ve SEO kurallarını doğrular.

## Zorunlu SEO kuralları (build bunları kontrol eder, ihlalde build durur)

- `title`: **en fazla 55 karakter** (marka eki dahil, örn. `"Hafriyat Hizmeti | CMS Hafriyat"`).
- `description`: **120–150 karakter** arası.
- `keywords`: 4–8 anahtar kelime, virgülle ayrılmış tek string.
- Dil: Türkçe (doğru Türkçe karakterler: ç ğ ı İ ö ş ü).

## Firma bilgileri (yalnızca bunlar kesin bilgidir)

- Unvan: CMS Hafriyat İnşaat Nakliyat Ltd. Şti.
- Faaliyet: hafriyat, iş makineleri operasyonları, inşaat, nakliye, ihracat
- E-posta: cmshafriyat01@gmail.com · Telefon/WhatsApp: 0533 500 37 79
- Slogan: "Güvenle Başlar, Değerle Büyür."
- Değerler: Güvenilirlik, Kalite, Sorumluluk, Müşteri Memnuniyeti, Sürekli Gelişim, Sürdürülebilirlik

**Uydurma bilgi YASAK:** proje sayısı, yıl, makine sayısı, müşteri adı, adres/il, sertifika,
ödül, fiyat gibi doğrulanamayan somut veriler yazılmaz. Genel, bilgilendirici, uzman dilli içerik yazılır.

## Görsel/video anahtarları (`scene`)

`hafriyat` | `insaat` | `nakliye` | `ihracat` | `makine`

## İç linkler

`body`/`sections` HTML içindeki linkler kök göreli ve sonda `/` ile yazılır:
`/hizmetler/hafriyat/`, `/hizmetler/is-makineleri/`, `/hizmetler/insaat-taahhut/`,
`/hizmetler/nakliye/`, `/hizmetler/ihracat/`, `/hakkimizda/`, `/iletisim/`, `/projeler/`,
`/sss/`, `/blog/`, `/haberler/`, `/blog/<slug>/`, `/haberler/<slug>/`.

HTML içinde yalnızca şu etiketler: `h2`, `h3`, `p`, `ul`, `ol`, `li`, `strong`, `em`, `a`, `blockquote`,
`table/thead/tbody/tr/th/td`. Sınıf (class) kullanılmaz; stil şablondan gelir. `h1` kullanılmaz (şablon basar).
