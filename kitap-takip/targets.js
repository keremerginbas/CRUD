// Varsayılan kitap ve takip edilen sayfalar. Panelden yeni sayfa eklenebilir.
const DEFAULT_BOOK = { title: "Özgür'ün Salıncağı", isbn: '9786259756189' };

const DEFAULT_TARGETS = [
  { id: 'hepsiburada', name: 'Hepsiburada', url: 'https://www.hepsiburada.com/bilim-ve-sanat-yayinlari-ozgur-un-salincagi-basak-caliskan-kabiloglu-32-sayfa-turkce-cocuk-kitabi-normal-boy-yas-araligi-pm-HBC0000A6M7ZP' },
  { id: 'amazon', name: 'Amazon', url: 'https://www.amazon.com.tr/dp/6259756186' },
  { id: 'kitapyurdu', name: 'Kitapyurdu', url: 'https://www.kitapyurdu.com/index.php?route=product/search&filter_name=9786259756189' },
  { id: 'dost', name: 'Dost Kitabevi', url: 'https://dostkitabevi.com/ozgurun-salincagi' },
  { id: 'nobel', name: 'Nobel Kitap', url: 'https://nobelkitap.com/kitap/ozgurun-salincagi' },
  { id: 'imge', name: 'İmge Kitabevi', url: 'https://www.imge.com.tr/urun/ozgur-un-salincagi-basak-caliskan-kabiloglu-9786259756189' },
  { id: 'ekitapmedia', name: 'e-kitapmedia (Almanya)', url: 'https://www.e-kitapmedia.de/urun/ozgur-un-salincagi-basak-caliskan-kabiloglu-9786259756189' },
  { id: 'bkm', name: 'BKM Kitap', url: 'https://www.bkmkitap.com/ozgurun-salincagi' },
  { id: '1000kitap', name: '1000Kitap', url: 'https://1000kitap.com/kitap/ozgur-un-salincagi--542304' },
];

// Sepeti olan pazaryerleri. cart: sepet sayfasının adresi (inceleme için).
// probe: sepet sınırı ölçümü bu sitede yapılabilir mi? Amazon'da sınır ürün sayfasındaki adet
// seçiciden okunduğu için sepete hiç dokunulmaz.
const CART_SITES = {
  'www.hepsiburada.com': { cart: 'https://checkout.hepsiburada.com/sepetim', probe: true },
  'www.amazon.com.tr': { cart: 'https://www.amazon.com.tr/gp/cart/view.html', probe: false },
};
