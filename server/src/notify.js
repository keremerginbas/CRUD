// İsteğe bağlı anlık bildirim: NTFY_TOPIC ayarlıysa olaylar ntfy.sh'e gönderilir.
// Telefona "ntfy" uygulamasını kurup aynı konuya abone olursanız, mobil uygulama
// kapalıyken de bildirim alırsınız.
export function createNotifier({ topic = process.env.NTFY_TOPIC, server = process.env.NTFY_SERVER || 'https://ntfy.sh' } = {}) {
  if (!topic) return async () => {};
  return async (event) => {
    try {
      await fetch(`${server}/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers: {
          Title: encodeURIComponent(event.title),
          Tags: event.type === 'freed' || event.type === 'seats_up' ? 'tada' : 'bus',
          ...(event.trip?.url ? { Click: event.trip.url } : {}),
        },
        body: event.message,
      });
    } catch (err) {
      console.warn('ntfy bildirimi gönderilemedi:', err.message);
    }
  };
}
