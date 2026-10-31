const DAY_KEYS = { Sat: 'saturday', Sun: 'sunday' };

function localParts(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  return { weekday: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// Danışmanın santral ayarlarındaki mesai saatlerine göre şu an çağrı alıp alamayacağı
export function isWithinWorkingHours(user, now = new Date(), timeZone = 'Europe/Istanbul') {
  const { weekday, minutes } = localParts(now, timeZone);
  const day = DAY_KEYS[weekday];
  if (day && !user[`${day}_enabled`]) return false;
  const start = toMinutes(day ? user[`${day}_start`] : user.work_start);
  const end = toMinutes(day ? user[`${day}_end`] : user.work_end);
  // Gece yarısını aşan vardiya (ör. 20:00-02:00)
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/**
 * Santralin "bu çağrıyı nereye yönlendireyim?" sorusuna verilen cevap.
 * - 444 hattı (hunt) → karşılama kuyruğu (müsait olan hat açar)
 * - Danışman hattı (0533 743 ...):
 *     müşteri kayıtlıysa → müşterinin sorumlu danışmanı (yoksa hattın sahibi); müşteri
 *       "satış danışmanınızı arıyorsunuz" anonsunu duyar
 *     müşteri kayıtlı değilse → asistan hattı (tanımlıysa), değilse hattın sahibi
 *     danışman mesai dışındaysa → asistan hattı, o da yoksa karşılama kuyruğu
 */
export function decideInboundRoute({
  number, user, contact, owner, callerPhone, now, timeZone, huntDestination, assistantDestination, callerAnnouncement,
}) {
  const hunt = { action: 'queue', destination: huntDestination, whisper: null, userId: null };
  if (!number || number.type === 'hunt' || !user) return hunt;

  const toAssistant = (reason, userId) => (assistantDestination
    ? { action: 'forward', destination: assistantDestination, userId, reason,
      whisper: whisperText({ number, contact, callerPhone }), callerAnnouncement: null }
    : { ...hunt, userId, reason });

  if (!contact && assistantDestination) return toAssistant('kayitsiz-musteri', user.id);

  const target = owner ?? user;
  if (!target.forward_phone || !isWithinWorkingHours(target, now, timeZone)) {
    return toAssistant('mesai-disi', target.id);
  }
  return {
    action: 'forward',
    destination: target.forward_phone,
    userId: target.id,
    whisper: target.voice_announcement ? whisperText({ number, contact, callerPhone }) : null,
    callerAnnouncement: callerAnnouncement ?? null,
  };
}

// Danışmana çağrı açılmadan önce okunan kısa anons
export function whisperText({ number, contact, callerPhone }) {
  const who = contact ? `${contact.type === 'SATICI' ? 'Satıcı' : 'Alıcı'} ${contact.name}` : 'Yeni müşteri';
  const via = number.type === 'listing' ? `${number.label} ilanından` : 'dijital hattınızdan';
  return `${who} ${via} arıyor.${contact ? '' : ` Numara ${callerPhone}.`}`;
}
