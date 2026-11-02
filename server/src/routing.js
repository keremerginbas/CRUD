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
 * - 444 hattı (hunt): müşteri bir danışmana kayıtlıysa ve danışman mesaideyse doğrudan o danışman,
 *     değilse asistan hattı (tanımlı değilse karşılama kuyruğu: 0312 hatları sırayla çalar)
 * - Danışman hattı (0533 743 ...):
 *     müşteri kayıtlıysa → müşterinin sorumlu danışmanı (yoksa hattın sahibi); müşteri
 *       "satış danışmanınızı arıyorsunuz" anonsunu duyar
 *     müşteri kayıtlı değilse → asistan hattı (tanımlıysa), değilse hattın sahibi
 *     danışman mesai dışındaysa → asistan hattı, o da yoksa karşılama kuyruğu
 * - Kimseye atanmamış hat (ör. ayrılan personelin numarası) → asistan hattı, o da yoksa karşılama kuyruğu
 */
export function decideInboundRoute({
  number, user, contact, owner, callerPhone, now, timeZone, huntDestination, assistantDestination, callerAnnouncement,
}) {
  const hunt = { action: 'queue', destination: huntDestination, whisper: null, userId: null };
  if (!number) return hunt;

  const toConsultant = (target) => ({
    action: 'forward',
    destination: target.forward_phone,
    userId: target.id,
    whisper: target.voice_announcement ? whisperText({ number, contact, callerPhone }) : null,
    callerAnnouncement: callerAnnouncement ?? null,
  });
  const available = (target) => target?.forward_phone && isWithinWorkingHours(target, now, timeZone);


  const toAssistant = (reason, userId) => (assistantDestination
    ? { action: 'forward', destination: assistantDestination, userId, reason,
      whisper: whisperText({ number, contact, callerPhone, toAssistant: true }), callerAnnouncement: null }
    : { ...hunt, userId, reason });

  if (number.type === 'hunt') {
    if (contact && available(owner)) return toConsultant(owner);
    return toAssistant(contact ? 'mesai-disi' : 'kayitsiz-musteri', owner?.id ?? null);
  }
  if (!user) return toAssistant('sahipsiz-hat', null);
  if (!contact && assistantDestination) return toAssistant('kayitsiz-musteri', user.id);

  const target = owner ?? user;
  return available(target) ? toConsultant(target) : toAssistant('mesai-disi', target.id);
}

// Danışmana çağrı açılmadan önce okunan kısa anons
// Asistana giden aramada hat asistanın değildir; hangi hattın arandığı adıyla söylenir
export function whisperText({ number, contact, callerPhone, toAssistant = false }) {
  const who = contact ? `${contact.type === 'SATICI' ? 'Satıcı' : 'Alıcı'} ${contact.name}` : 'Yeni müşteri';
  const via = number.type === 'listing' ? `${number.label} ilanından`
    : toAssistant || number.type === 'hunt' ? `${number.label} hattından` : 'dijital hattınızdan';
  return `${who} ${via} arıyor.${contact ? '' : ` Numara ${callerPhone}.`}`;
}
