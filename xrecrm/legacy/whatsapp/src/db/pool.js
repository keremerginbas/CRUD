import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: +(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  timezone: 'Z',
});

// Her yeni bağlantıda MySQL oturumunu UTC'ye sabitle.
// Bu olmadan NOW() sunucunun yerel saatini (+03) yazar, kod UTC sanır,
// mesaj saatleri 3 saat ileri görünür ve 24 saat penceresi yanlış hesaplanır.
pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

export async function q(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return { rows: Array.isArray(rows) ? rows : [], result: rows };
}