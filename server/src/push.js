// Expo Push servisi üzerinden danışmanın telefonuna bildirim (iOS + Android)
export async function sendPush(token, title, body, data = {}) {
  if (!token) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: token, title, body, data, sound: 'default', priority: 'high' }),
    });
  } catch (err) {
    console.error('Push gönderilemedi:', err.message);
  }
}
