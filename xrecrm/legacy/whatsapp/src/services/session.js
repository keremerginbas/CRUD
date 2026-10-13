const cache = new Map();
const TTL = 5 * 60 * 1000;

export async function verifyBitrixUser(req) {
  // GEÇİCİ TEST KAPISI — canlıya geçmeden önce sil
  if (process.env.DEV_USER_ID) {
    return { id: +process.env.DEV_USER_ID, name: 'Test Kullanıcı' };
  }

  const auth =
    req.headers['x-bitrix-auth'] ||
    req.query?.AUTH_ID ||
    req.body?.AUTH_ID;

  if (!auth) return null;

  const hit = cache.get(auth);
  if (hit && hit.exp > Date.now()) return hit.user;

  const domain = process.env.BITRIX_DOMAIN;
  const res = await fetch(`https://${domain}/rest/user.current.json?auth=${encodeURIComponent(auth)}`);
  const data = await res.json();
  if (!data.result) return null;

  const user = { id: +data.result.ID, name: `${data.result.NAME} ${data.result.LAST_NAME}` };
  cache.set(auth, { user, exp: Date.now() + TTL });
  return user;
}