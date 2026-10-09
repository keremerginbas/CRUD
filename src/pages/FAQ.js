import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import useReveal from '../hooks/useReveal';
import usePageTitle from '../hooks/usePageTitle';

const FAQS = [
  {
    q: 'Bir web sitesi ne kadar sürede teslim edilir?',
    a: 'Tek sayfalık projeler genellikle 1-2 hafta, çok sayfalı kurumsal siteler 2-4 hafta sürer. Süreyi en çok etkileyen şey içeriklerin (metin, görsel, logo) hazır olma hızıdır — biz hazırsak siz de hazırsanız işler çok hızlı ilerler.',
  },
  {
    q: 'Bu sitedeki gibi 3D animasyonlu bir site benim markam için de yapılır mı?',
    a: 'Evet — arkada gördüğünüz altı sahnenin tamamı gerçek zamanlı kodla çalışıyor ve markanızın renklerine, temposuna göre özelleştirilebiliyor. Mobil cihazlarda performansı koruyan otomatik kalite sistemi de dahil.',
  },
  {
    q: 'Sosyal medya yönetiminde neler pakete dahil?',
    a: 'Aylık içerik takvimi, gönderi tasarımları, Reels kurgu ve senaryosu, açıklama metinleri, hashtag stratejisi ve ay sonu performans raporu. Çekim gereken projelerde yönlendirme ve çekim planı da bizden.',
  },
  {
    q: 'Reklam bütçemi siz mi belirliyorsunuz?',
    a: 'Bütçe her zaman sizin kontrolünüzde. Biz hedefinize göre (satış, mesaj, trafik) minimum verimli bütçeyi önerir, harcamayı şeffaf raporlarla gösteririz. Reklam hesapları sizin adınıza açılır — veri hep sizde kalır.',
  },
  {
    q: 'Kurumsal e-posta (örn. kurumsal@firmaniz.com.tr) kurulumunu siz mi yapıyorsunuz?',
    a: 'Alan adınızın bağlı olduğu hosting/DNS paneline erişiminiz varsa kurulum adımlarında size eşlik ediyoruz: e-posta hesabının açılması, MX/SPF/DKIM/DMARC kayıtlarının doğru girilmesi ve webmail ya da Outlook/Gmail gibi bir istemciye bağlanması. Panel erişim bilgilerini paylaşmak istemiyorsanız adım adım bir kılavuz hazırlıyoruz, siz uyguluyorsunuz.',
  },
  {
    q: 'Site tesliminden sonra destek veriyor musunuz?',
    a: 'Evet. Teslimden sonra küçük düzeltmeler için destek penceresi tanıyoruz; dileyen müşterilerimizle aylık bakım ve güncelleme anlaşması yapıyoruz. Siteniz "teslim edildi ve unutuldu" olmaz.',
  },
  {
    q: 'Siteyi kendi alan adımıza / hosting hesabımıza nasıl taşıyoruz?',
    a: 'Proje tesliminde size statik dosyaları veya derlenmiş (build) çıktıyı teslim ediyor, DNS/hosting tarafında yapılması gerekenleri adım adım anlatıyoruz. İsterseniz yayına alma (deploy) işlemini de biz üstleniyoruz.',
  },
  {
    q: 'Anlaşma süreci nasıl işliyor?',
    a: 'Önce ücretsiz bir keşif görüşmesi yapıyoruz. İhtiyacı netleştirip yazılı kapsam ve fiyat teklifi sunuyoruz. Onayla birlikte proje takvimi başlıyor; her aşamada onayınız alınmadan bir sonraki adıma geçilmiyor.',
  },
];

function FaqItem({ item, isOpen, onToggle }) {
  const ref = useRef(null);
  return (
    <div className={`faq${isOpen ? ' open' : ''}`} data-reveal>
      <button className="faq-q" aria-expanded={isOpen} onClick={onToggle}>
        {item.q}
        <span className="ico">+</span>
      </button>
      <div
        className="faq-a"
        style={{ maxHeight: isOpen ? `${ref.current?.scrollHeight || 500}px` : '0px' }}
      >
        <p ref={ref}>{item.a}</p>
      </div>
    </div>
  );
}

export default function FAQ() {
  usePageTitle('SSS');
  useReveal();
  const [openIdx, setOpenIdx] = useState(null);

  return (
    <div className="wrap">
      <section className="page-hero">
        <div className="breadcrumb" data-reveal>
          <Link to="/" data-hover>Ana Sayfa</Link> / SSS
        </div>
        <div className="sec-tag" data-reveal>SSS</div>
        <h1 data-reveal style={{ '--rd': '.06s' }}>Aklınızdakiler,<br /><b>cevaplarıyla.</b></h1>
      </section>

      <section className="block" style={{ paddingTop: 0 }}>
        <div className="faq-list">
          {FAQS.map((item, i) => (
            <FaqItem
              key={item.q}
              item={item}
              isOpen={openIdx === i}
              onToggle={() => setOpenIdx(openIdx === i ? null : i)}
            />
          ))}
        </div>
      </section>

      <section className="block">
        <div className="cta-band" data-reveal="zoom">
          <h2>Sorunuz listede yok mu?<br /><b>Direkt sorun.</b></h2>
          <p>Form veya Instagram DM üzerinden birkaç saat içinde dönüş yapıyoruz.</p>
          <div className="cta-row">
            <Link to="/iletisim" className="btn primary magnetic" data-hover>
              İletişime geçin <span className="arr">→</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
