// XRE Bitrix statüleriyle proje SMS serilerini ve durdurma statülerini oluşturur.
// Mesajlar mevcut Erccell SMS'lerinin üslubunda (Türkçe karaktersiz, linkli) yazıldı.
// Kampanyalar PASİF oluşturulur; mesajları kontrol edip panelden aktif ettiğinizde gönderim başlar.
// Kullanım: npm run kurulum   (tekrar çalıştırılırsa var olan kampanyalara dokunmaz)
const { openDb } = require('../src/db');
const { setStopStages, getStopStages } = require('../src/bitrix');

const SITE = 'https://xreproject.com';

// project: mesajdaki {proje}; link: proje sayfası (bilinmeyenlerde ana sayfa).
const PROJECTS = [
  { project: 'West Point', stages: ['UC_3CG0TQ'] },
  { project: 'Ankaport Saray', stages: ['UC_0RQEPM'], link: `${SITE}/projeDetay/ankaport-saray` },
  { project: 'Maximum Life', stages: ['UC_6NYK69'] },
  { project: 'Gimart', stages: ['UC_H16SU3'] },
  { project: 'Finest Yasamkent', stages: ['UC_5M177N'] },
  { project: 'Didim Akbuk', stages: ['UC_D2AMA8', 'UC_I7H1D9'] },
  { project: 'Natura Paryal', stages: ['UC_BX1JIT'] },
  { project: 'EFAS N-Tepe', stages: ['UC_PQDHUK', 'UC_3W9EXO', 'UC_P8Z2WH', 'UC_LF04EU', 'UC_R94GLM', 'UC_PTDA4Y'] },
  { project: 'Eskisehir', stages: ['UC_1216EB'] },
  { project: 'Motto', stages: ['UC_7DXC14'] },
];

// Randevu, satış, olumsuz ve kapanış statüleri: müşteri buraya geçince seri durur.
const STOP_STAGES = [
  'UC_WK3LVR', // RANDEVU OLUŞTURANLAR
  'UC_Z3VV8S', // OFİS RANDEVUSU
  'UC_ML92HM', // YAPAY ZEKA RANDEVU OLUŞTURANLAR
  'UC_UB8IU8', // RANDEVUYA KATILIM OLDU
  'UC_W7A1X5', // YAPAY ZEKA RANDEVU SAATİ DÜZENLENECEK
  '8', // TEKLİF GÖNDERİLDİ
  'UC_I8G5YP', // SATIŞ
  'UC_4WD4HQ', // OLUMSUZ
  'UC_QBFMY1', // YAPAY ZEKA OLUMSUZ
  'UC_0JRF4W', // KULLANIM DIŞI NUMARA
  'CONVERTED', // Olumlu Müşteri
  'JUNK', // Güven Problemleri
  '5', '1', '2', '3', '4', '9', // Olumsuz / Ertelendi / Fiyat / Lokasyon / Kullanım Dışı / seçim araması
];

// Seriler 3-5-10. gün; 0. gün "başvurunuz alındı" mesajı ayrı otomasyonla gidiyor.
const steps = (link = SITE) => [
  [3, `Merhaba, XRE Project {proje} projesini hala degerlendiriyor musunuz? Size ozel sunum icin randevu planlayabiliriz. ${link}`],
  [5, `Merhaba, XRE Project {proje} projesinin guncel fiyat ve odeme planlarini sizinle paylasmak isteriz. Detaylar: ${link}`],
  [10, `Merhaba, XRE Project {proje} projesini yerinde gormek ister misiniz? Size uygun bir gun icin randevu planlayalim. ${link}`],
].map(([day_offset, message]) => ({ day_offset, send_time: '10:30', message }));

// Projesi belli olmayan statüler (REKLAMDAN GELEN): proje adı geçmeyen genel seri.
const GENERIC = [
  {
    name: 'Reklamdan Gelen - Genel seri',
    stages: ['UC_I0U6EY'],
    steps: [
      [3, `Merhaba, XRE Project projemizle ilgilendiginiz icin tesekkurler. Hala degerlendiriyor musunuz? Size ozel randevu planlayalim. ${SITE}`],
      [5, `Merhaba, XRE Project projemizin guncel fiyat ve odeme planlarini sizinle paylasmak isteriz. Hala ilgileniyor musunuz? ${SITE}`],
      [10, `Merhaba, XRE Project projemizden memnun musunuz, hala istiyor musunuz? Sorulariniz icin buradayiz, randevu planlayalim. ${SITE}`],
    ].map(([day_offset, message]) => ({ day_offset, send_time: '10:30', message })),
  },
];

function run(db = openDb(), log = console.log) {
  const insertCampaign = db.prepare(`INSERT INTO campaigns (name, type, project, active, bitrix_entity, bitrix_stages)
    VALUES (?, 'proje', ?, 0, 'lead', ?)`);
  const insertStep = db.prepare('INSERT INTO campaign_steps (campaign_id, day_offset, send_time, message) VALUES (?, ?, ?, ?)');
  for (const p of PROJECTS) {
    const name = `${p.project} - Teşvik serisi`;
    const existing = db.prepare('SELECT id FROM campaigns WHERE name = ?').get(name);
    if (existing) {
      // Önceki kurulumdan kalan 14. ve 30. gün adımları kaldırılır (seriler artık 3-5-10).
      const removed = db.prepare('DELETE FROM campaign_steps WHERE campaign_id = ? AND day_offset IN (14, 30)').run(existing.id).changes;
      log(removed ? `Güncellendi (14. ve 30. gün kaldırıldı): ${name}` : `Var, atlandı: ${name}`);
      continue;
    }
    const { lastInsertRowid } = insertCampaign.run(name, p.project, JSON.stringify(p.stages));
    for (const s of steps(p.link)) insertStep.run(lastInsertRowid, s.day_offset, s.send_time, s.message);
    log(`Oluşturuldu (pasif): ${name}`);
  }
  for (const g of GENERIC) {
    if (db.prepare('SELECT 1 FROM campaigns WHERE name = ?').get(g.name)) { log(`Var, atlandı: ${g.name}`); continue; }
    const { lastInsertRowid } = insertCampaign.run(g.name, null, JSON.stringify(g.stages));
    for (const st of g.steps) insertStep.run(lastInsertRowid, st.day_offset, st.send_time, st.message);
    log(`Oluşturuldu (pasif): ${g.name}`);
  }
  if (!getStopStages(db).length) {
    setStopStages(db, STOP_STAGES);
    log(`Durdurma statüleri ayarlandı (${STOP_STAGES.length})`);
  }
}

if (require.main === module) run();
module.exports = { run, steps, PROJECTS, GENERIC, STOP_STAGES };
