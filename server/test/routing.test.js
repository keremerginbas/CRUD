import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideInboundRoute, isWithinWorkingHours } from '../src/routing.js';
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

test('444 hattı her zaman karşılama kuyruğuna gider', () => {
  const d = decideInboundRoute({ ...base, number: { type: 'hunt', label: '444' }, user: null, now: at('2026-10-27T06:00:00Z') });
  assert.deepEqual([d.action, d.destination], ['queue', 'queue:karsilama']);
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
