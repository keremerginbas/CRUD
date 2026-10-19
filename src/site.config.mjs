// Sitenin tüm genel ayarları tek yerde. Alan adı değişirse yalnızca `url` güncellenir.
export default {
  url: 'https://cmsharfiyat.com.tr',
  name: 'CMS Hafriyat',
  legalName: 'CMS Hafriyat İnşaat Nakliyat Ltd. Şti.',
  slogan: 'Güvenle Başlar, Değerle Büyür.',
  lang: 'tr',
  locale: 'tr_TR',
  email: 'cmshafriyat01@gmail.com',
  phone: '+905335003779',
  phoneDisplay: '0533 500 37 79',
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
