import { q as query } from '../db/pool.js';

const ADMIN_USERS = (process.env.ADMIN_BITRIX_USERS || '').split(',').map(Number).filter(Boolean);

export const isAdmin = (user) => ADMIN_USERS.includes(user.id);

export async function allowedChannels(user) {
  if (isAdmin(user)) {
    const { rows } = await query('SELECT id FROM wa_channels');
    return rows.map((r) => r.id);
  }
  const { rows } = await query(
    'SELECT channel_id FROM wa_channel_access WHERE bitrix_user = ?', [user.id]);
  return rows.map((r) => r.channel_id);
}

export async function requireChannel(user, channelId) {
  const ids = await allowedChannels(user);
  if (!ids.includes(channelId)) {
    const e = new Error('Bu kanala erişim yetkiniz yok');
    e.statusCode = 403;
    throw e;
  }
  const { rows: [ch] } = await query('SELECT * FROM wa_channels WHERE id = ?', [channelId]);
  return ch;
}