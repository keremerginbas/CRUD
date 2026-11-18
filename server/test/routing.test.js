import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideInboundRoute, isOfficeOpen, isWithinWorkingHours } from '../src/routing.js';
import { normalizePhone, toLocalFormat } from '../src/phone.js';

const user = {
  id: 7, forward_phone: '+905551112233', voice_announcement: 1,
  work_start: '08:00', work_end: '23:46',
  saturday_enabled: 1, saturday_start: '08:00', saturday_end: '20:00',
  sunday_enabled: 0, sunday_start: '10:00', sunday_end: '17:00',
};
// 2026-10-27 Salı; İstanbul UTC+3
const at = (iso) => new Date(iso);
const base = { timeZone: 'Europe/Istanbul', huntDestination: 'queue:karsilama', callerPhone: '+905321234567' };

test('mesai saatleri hafta içi, cumartesi ve pazar ayrı uygulanır', () => {
  assert.equal(isWithinWorkingHours(user, at('2026-10-27T06:00:00Z')), true);   // Salı 09:00
  assert.equal(isWithinWorkingHours(user, at('2026-10-27T04:30:00Z')), false);  // Salı 07:30
  assert.equal(isWithinWorkingHours(user, at('2026-10-31T17:30:00Z')), false);  // Cumartesi 20:30
  assert.equal(isWithinWorkingHours(user, at('2026-10-31T16:30:00Z')), true);   // Cumartesi 19:30
  assert.equal(isWithinWorkingHours(user, at('2026-11-01T09:00:00Z')), false);  // Pazar kapalı
});

test('gece yarısını aşan mesai', () => {
  const night = { ...user, work_start: '20:00', work_end: '02:00' };
  assert.equal(isWithinWorkingHours(night, at('2026-10-27T22:00:00Z')), true);  // Çarşamba 01:00
  assert.equal(isWithinWorkingHours(night, at('2026-10-27T09:00:00Z')), false); // Salı 12:00
});

test('444: kayıtsız müşteri asistana, asistan tanımlı değilse karşılama kuyruğuna gider', () => {
  const hunt = { type: 'hunt', label: '444 24 53' };
  const d = decideInboundRoute({ ...base, assistantDestination: '+905312814423', number: hunt, user: null, contact: null, now: at('2026-10-27T06:00:00Z') });
  assert.deepEqual([d.action, d.destination, d.reason], ['forward', '+905312814423', 'kayitsiz-musteri']);
  assert.match(d.whisper, /444 24 53 hattından/);
  const q = decideInboundRoute({ ...base, number: hunt, user: null, contact: null, now: at('2026-10-27T06:00:00Z') });
  assert.deepEqual([q.action, q.destination], ['queue', 'queue:karsilama']);
});

test('444: kayıtlı müşteri doğrudan danışmanına gider, danışman mesai dışındaysa asistana/kuyruğa', () => {
  const hunt = { type: 'hunt', label: '444 24 53' };
  const contact = { name: 'AHMET', type: 'ALICI' };
  const d = decideInboundRoute({ ...base, number: hunt, user: null, owner: user, contact, callerAnnouncement: 'anons', now: at('2026-10-27T06:00:00Z') });
  assert.deepEqual([d.action, d.destination, d.userId, d.callerAnnouncement], ['forward', '+905551112233', 7, 'anons']);
  assert.equal(d.whisper, 'Alıcı AHMET 444 24 53 hattından arıyor.');
  const off = decideInboundRoute({ ...base, number: hunt, user: null, owner: user, contact, now: at('2026-11-01T09:00:00Z') });
  assert.equal(off.action, 'queue');
  const offAsst = decideInboundRoute({ ...base, assistantDestination: '+905312814423', number: hunt, user: null, owner: user, contact, now: at('2026-11-01T09:00:00Z') });
  assert.deepEqual([offAsst.destination, offAsst.reason, offAsst.userId], ['+905312814423', 'mesai-disi', 7]);
});

test('mesai içinde dijital numara danışmanın telefonuna fısıltı anonsuyla gider', () => {
  const d = decideInboundRoute({
    ...base, number: { type: 'listing', label: 'Zübeyde Hanım dükkan' }, user,
    contact: { name: 'MUSTAFA UTKU', type: 'ALICI' }, now: at('2026-10-27T06:00:00Z'),
  });
  assert.equal(d.action, 'forward');
  assert.equal(d.destination, '+905551112233');
  assert.equal(d.whisper, 'Alıcı MUSTAFA UTKU Zübeyde Hanım dükkan ilanından arıyor.');
});

test('mesai dışında danışman numarası karşılama kuyruğuna düşer ama danışmana yazılır', () => {
  const d = decideInboundRoute({ ...base, number: { type: 'personal', label: 'Dijital' }, user, now: at('2026-11-01T09:00:00Z') });
  assert.equal(d.action, 'queue');
  assert.equal(d.userId, 7);
});

test('telefon normalizasyonu', () => {
  for (const raw of ['0532 123 45 67', '+90 (532) 123 4567', '905321234567', '5321234567', '00905321234567']) {
    assert.equal(normalizePhone(raw), '+905321234567');
  }
  assert.equal(normalizePhone('444 24 53'), '4442453');
  assert.equal(toLocalFormat('+905321234567'), '05321234567');
});

const assistant = { assistantDestination: '+905312814423', callerAnnouncement: 'satis-danismaninizi-ariyorsunuz' };
const line = { type: 'personal', label: '0533 743 56 80' };

test('kayıtlı müşteri sorumlu danışmana gider ve anons duyar', () => {
  const owner = { ...user, id: 9, forward_phone: '+905559998877' };
  const d = decideInboundRoute({ ...base, ...assistant, number: line, user, owner,
    contact: { name: 'AHMET', type: 'ALICI' }, now: at('2026-10-27T06:00:00Z') });
  assert.deepEqual([d.action, d.destination, d.userId], ['forward', '+905559998877', 9]);
  assert.equal(d.callerAnnouncement, 'satis-danismaninizi-ariyorsunuz');
});

test('kayıtlı olmayan müşteri asistana gider', () => {
  const d = decideInboundRoute({ ...base, ...assistant, number: line, user, contact: null, now: at('2026-10-27T06:00:00Z') });
  assert.deepEqual([d.action, d.destination, d.reason], ['forward', '+905312814423', 'kayitsiz-musteri']);
  assert.match(d.whisper, /Yeni müşteri/);
});

test('mesai dışında kayıtlı müşteri de asistana gider', () => {
  const d = decideInboundRoute({ ...base, ...assistant, number: line, user,
    contact: { name: 'AHMET', type: 'ALICI' }, now: at('2026-11-01T09:00:00Z') });
  assert.deepEqual([d.destination, d.reason], ['+905312814423', 'mesai-disi']);
});

test('sahibi olmayan hat (ayrılan personel) asistana, asistan yoksa kuyruğa gider', () => {
  const free = { type: 'personal', label: 'Boşta (eski personel) 114' };
  const d = decideInboundRoute({ ...base, ...assistant, number: free, user: null, contact: null, now: at('2026-10-27T06:00:00Z') });
  assert.deepEqual([d.action, d.destination, d.reason], ['forward', '+905312814423', 'sahipsiz-hat']);
  assert.match(d.whisper, /Boşta \(eski personel\) 114/);
  const q = decideInboundRoute({ ...base, number: free, user: null, contact: null, now: at('2026-10-27T06:00:00Z') });
  assert.equal(q.action, 'queue');
});

test('hat listesinde olmayan numaraya gelen arama reddedilir (şirketin diğer aramaları yakalanmaz)', () => {
  const d = decideInboundRoute({ ...base, assistantDestination: '+905312814423', number: undefined, user: null, contact: null, now: at('2026-10-27T06:00:00Z') });
  assert.deepEqual([d.action, d.reason], ['reject', 'bilinmeyen-numara']);
});

test('karşılama hattında (444/0850) tuşlanan dahili: o danışmana, mesai dışıysa asistana', () => {
  const hunt = { type: 'hunt', label: '0850' };
  const ahmet = { ...user, id: 20, extension: '2020' };
  const d = decideInboundRoute({ ...base, assistantDestination: '+905312814423', number: hunt, user: null, contact: null,
    extensionUser: ahmet, callerAnnouncement: 'anons', now: at('2026-10-27T06:00:00Z') });
  assert.deepEqual([d.action, d.destination, d.userId, d.callerAnnouncement], ['forward', '+905551112233', 20, 'anons']);
  assert.match(d.whisper, /0850 hattından/);
  const off = decideInboundRoute({ ...base, assistantDestination: '+905312814423', number: hunt, user: null, contact: null,
    extensionUser: ahmet, now: at('2026-11-01T09:00:00Z') });
  assert.deepEqual([off.destination, off.reason, off.userId], ['+905312814423', 'mesai-disi', 20]);
  // Dahili sadece karşılama hattında geçerli; kişisel hatta yok sayılır
  const other = { ...user, id: 30, forward_phone: '+905000000030' };
  const line = decideInboundRoute({ ...base, number: { type: 'personal', label: 'x' }, user: other, contact: null,
    extensionUser: ahmet, now: at('2026-10-27T06:00:00Z') });
  assert.equal(line.destination, '+905000000030');
});

test('ofis kapalıyken (18:00 sonrası) kayıtlı olmayan müşteri de hattın danışmanına gider', () => {
  const owner = { ...user, id: 9, forward_phone: '+905559998877' };
  const open = decideInboundRoute({ ...base, ...assistant, number: line, user, contact: null, officeOpen: true, now: at('2026-10-27T06:00:00Z') });
  assert.deepEqual([open.destination, open.reason], ['+905312814423', 'kayitsiz-musteri']);
  const closed = decideInboundRoute({ ...base, ...assistant, number: line, user, contact: null, officeOpen: false, now: at('2026-10-27T16:30:00Z') });
  assert.deepEqual([closed.action, closed.destination, closed.userId, closed.reason], ['forward', '+905551112233', 7, undefined]);
  // Kayıtlı müşteri ofis kapalıyken danışmanın kendi mesaisi bitmiş olsa da sorumlu danışmana gider
  const reg = decideInboundRoute({ ...base, ...assistant, number: line, user, owner, contact: { name: 'AHMET', type: 'ALICI' },
    officeOpen: false, now: at('2026-11-01T19:00:00Z') });
  assert.deepEqual([reg.destination, reg.userId], ['+905559998877', 9]);
  // Yönlendirme telefonu olmayan danışman: asistana
  const noPhone = decideInboundRoute({ ...base, ...assistant, number: line, user: { ...user, forward_phone: null }, contact: null, officeOpen: false, now: at('2026-10-27T16:30:00Z') });
  assert.equal(noPhone.destination, '+905312814423');
  // Karşılama hattında (444) kural değişmez: kayıtsız müşteri asistana
  const hunt = decideInboundRoute({ ...base, ...assistant, number: { type: 'hunt', label: '444' }, user: null, contact: null, officeOpen: false, now: at('2026-10-27T16:30:00Z') });
  assert.equal(hunt.destination, '+905312814423');
});

test('ofis saatleri: gün ve saat aralığı', () => {
  const office = { office_start: '09:00', office_end: '18:00', office_days: '1,2,3,4,5,6' };
  assert.equal(isOfficeOpen(office, at('2026-10-27T06:00:00Z')), true);   // Salı 09:00
  assert.equal(isOfficeOpen(office, at('2026-10-27T05:59:00Z')), false);  // Salı 08:59
  assert.equal(isOfficeOpen(office, at('2026-10-27T15:00:00Z')), false);  // Salı 18:00
  assert.equal(isOfficeOpen(office, at('2026-10-31T10:00:00Z')), true);   // Cumartesi 13:00
  assert.equal(isOfficeOpen(office, at('2026-11-01T10:00:00Z')), false);  // Pazar
});
