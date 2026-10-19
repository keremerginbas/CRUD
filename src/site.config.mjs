// Sitenin tüm genel ayarları tek yerde. Alan adı değişirse yalnızca `url` güncellenir.
export default {
  // Ortam değişkenleriyle alt klasör önizlemesi üretilebilir (npm run build:preview)
  url: process.env.SITE_URL || 'https://cmsharfiyat.com.tr',
  basePath: (process.env.BASE_PATH || '').replace(/\/$/, ''),
  preview: process.env.PREVIEW === '1',
  name: 'CMS Hafriyat',
  legalName: 'CMS Hafriyat İnşaat Nakliyat Ltd. Şti.',
  slogan: 'Güvenle Başlar, Değerle Büyür.',
  lang: 'tr',
  locale: 'tr_TR',
  email: 'cmshafriyat01@gmail.com',
  phone: '+905335003779',
  phoneDisplay: '0533 500 37 79',
  address: {
    street: 'Toros Mah. 78090 Sk. Özcan Apt. Sit. No: 10 A',
    district: 'Çukurova',
    city: 'Adana',
    postalCode: '01170',
    country: 'TR',
    display: 'Toros Mahallesi 78090 Sk. Özcan Apt. Sit. No: 10 A, 01170 Çukurova/Adana',
  },
  geo: { lat: 37.03689585, lng: 35.29941937 },
  mapEmbed: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3184.8637094273304!2d35.29941937585567!3d37.03689585432126!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x1528892d455d4bad%3A0xaa05c418325c8d08!2sToros%2C%2078090.%20Sk.%2010%20A%2C%2001170%20%C3%87ukurova%2FAdana!5e0!3m2!1str!2str!4v1792426161496!5m2!1str!2str',
  mapLink: 'https://www.google.com/maps/search/?api=1&query=Toros%2C%2078090.%20Sk.%2010%20A%2C%2001170%20%C3%87ukurova%2FAdana',
  whatsapp: '905335003779',
  whatsappText: 'Merhaba, CMS Hafriyat web sitesinden ulaşıyorum. Bilgi almak istiyorum.',
  publisher: 'CMS Hafriyat İnşaat Nakliyat Ltd. Şti.',
  author: 'CMS Hafriyat',
  themeColor: '#0f172a',
  // Sosyal medya hesapları açıldığında eklenir (schema.org sameAs + footer)
  social: {
    instagram: '',
    facebook: '',
    linkedin: '',
    youtube: '',
  },
  // Ana menü (header + footer) – sıra önemlidir
  nav: [
    { label: 'Ana Sayfa', href: '/' },
    { label: 'Hakkımızda', href: '/hakkimizda/' },
    { label: 'Hizmetlerimiz', href: '/hizmetler/' },
    { label: 'Yaptığımız İşler', href: '/projeler/' },
    { label: 'Blog', href: '/blog/' },
    { label: 'İletişim', href: '/iletisim/' },
  ],
};
