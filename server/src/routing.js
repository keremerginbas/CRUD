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
 * - Danışmanın dijital numarası / ilan numarası → mesai içindeyse danışmanın telefonu, değilse karşılama kuyruğu
 */
export function decideInboundRoute({ number, user, contact, callerPhone, now, timeZone, huntDestination }) {
  const hunt = { action: 'queue', destination: huntDestination, whisper: null, userId: null };
  if (!number || number.type === 'hunt' || !user) return hunt;
  if (!user.forward_phone || !isWithinWorkingHours(user, now, timeZone)) {
    return { ...hunt, userId: user.id, reason: 'mesai-disi' };
  }
  return {
    action: 'forward',
    destination: user.forward_phone,
    userId: user.id,
    whisper: user.voice_announcement ? whisperText({ number, contact, callerPhone }) : null,
  };
}

// Danışmana çağrı açılmadan önce okunan kısa anons
export function whisperText({ number, contact, callerPhone }) {
  const who = contact ? `${contact.type === 'SATICI' ? 'Satıcı' : 'Alıcı'} ${contact.name}` : 'Yeni müşteri';
  const via = number.type === 'listing' ? `${number.label} ilanından` : 'dijital hattınızdan';
  return `${who} ${via} arıyor.${contact ? '' : ` Numara ${callerPhone}.`}`;
}
