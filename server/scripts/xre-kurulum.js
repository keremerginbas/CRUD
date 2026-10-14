// XRE Bitrix statüleriyle proje SMS serilerini ve durdurma statülerini oluşturur.
// Kampanyalar PASİF oluşturulur: [FİYAT], [LİNK], [KAMPANYA] doldurulup panelden aktif edilmeden SMS gitmez.
// Kullanım: npm run kurulum   (tekrar çalıştırılırsa var olan kampanyalara dokunmaz)
const { openDb } = require('../src/db');
const { setStopStages, getStopStages } = require('../src/bitrix');

const PROJECTS = [
  { project: 'West Point', stages: ['UC_3CG0TQ'] },
  { project: 'Ankaport Saray', stages: ['UC_0RQEPM'], link: 'https://xreproject.com/projeDetay/ankaport-saray' },
  { project: 'Maximum Life', stages: ['UC_6NYK69'] },
  { project: 'Gimart', stages: ['UC_H16SU3'] },
  { project: 'Finest Yaşamkent', stages: ['UC_5M177N'] },
  { project: 'Didim Akbük', stages: ['UC_D2AMA8', 'UC_I7H1D9'] },
  { project: 'Natura Paryal', stages: ['UC_BX1JIT'] },
  { project: 'EFAS N-Tepe', stages: ['UC_PQDHUK', 'UC_3W9EXO', 'UC_P8Z2WH', 'UC_LF04EU', 'UC_R94GLM', 'UC_PTDA4Y'] },
  { project: 'Eskişehir', stages: ['UC_1216EB'] },
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

const steps = (link) => [
  [3, 'Merhaba {ad}, {proje} projemizi hâlâ değerlendiriyor musunuz? Size özel sunum için randevu planlayabiliriz.'],
  [5, '{ad}, {proje} güncel fiyat ve ödeme seçenekleri: [FİYAT]. Detaylı bilgi için bize ulaşın.'],
  [10, `{ad}, {proje} projemizde sınırlı sayıda daire kaldı. Yerinde görmek ister misiniz? ${link || '[LİNK]'}`],
  [14, '{ad}, {proje} için bu aya özel fırsat: [KAMPANYA]. Bilgi almak için bize yazın.'],
  [30, 'Merhaba {ad}, {proje} ile ilgili kararınızı verdiniz mi? Yardımcı olabileceğimiz bir konu var mı?'],
].map(([day_offset, message]) => ({ day_offset, send_time: '10:30', message }));

function run(db = openDb(), log = console.log) {
  const insertCampaign = db.prepare(`INSERT INTO campaigns (name, type, project, active, bitrix_entity, bitrix_stages)
    VALUES (?, 'proje', ?, 0, 'lead', ?)`);
  const insertStep = db.prepare('INSERT INTO campaign_steps (campaign_id, day_offset, send_time, message) VALUES (?, ?, ?, ?)');
  for (const p of PROJECTS) {
    const name = `${p.project} - Teşvik serisi`;
    if (db.prepare('SELECT 1 FROM campaigns WHERE name = ?').get(name)) { log(`Var, atlandı: ${name}`); continue; }
    const { lastInsertRowid } = insertCampaign.run(name, p.project, JSON.stringify(p.stages));
    for (const s of steps(p.link)) insertStep.run(lastInsertRowid, s.day_offset, s.send_time, s.message);
    log(`Oluşturuldu (pasif): ${name}`);
  }
  if (!getStopStages(db).length) {
    setStopStages(db, STOP_STAGES);
    log(`Durdurma statüleri ayarlandı (${STOP_STAGES.length})`);
  }
}

if (require.main === module) run();
module.exports = { run, PROJECTS, STOP_STAGES };
