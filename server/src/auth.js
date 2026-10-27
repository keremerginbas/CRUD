import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const TOKEN_TTL_SEC = 60 * 60 * 24 * 30;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

// Minimal HS256 JWT
export function signToken(payload, secret) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC };
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(body)}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}

export function verifyToken(token, secret) {
  const [header, body, sig] = (token ?? '').split('.');
  if (!sig) return null;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > Date.now() / 1000 ? payload : null;
  } catch {
    return null;
  }
}

export function requireAuth(secret) {
  return (req, res, next) => {
    const token = req.get('authorization')?.replace(/^Bearer /, '');
    const payload = verifyToken(token, secret);
    if (!payload) return res.status(401).json({ error: 'Oturum geçersiz' });
    req.user = payload;
    next();
  };
}

// Santral webhook'ları: X-Signature = HMAC-SHA256(rawBody, secret) veya ?token=secret
export function verifyWebhook(secret) {
  return (req, res, next) => {
    const sig = req.get('x-signature');
    const ok = sig
      ? safeEqual(sig, createHmac('sha256', secret).update(req.rawBody ?? '').digest('hex'))
      : safeEqual(String(req.query.token ?? ''), secret);
    if (!ok) return res.status(401).json({ error: 'Geçersiz imza' });
    next();
  };
}

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
