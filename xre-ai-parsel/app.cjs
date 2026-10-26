// cPanel "Setup Node.js App" (Passenger) başlangıç dosyası: Application startup file = app.cjs
// Passenger CommonJS ile yükler; asıl sunucu ES modülüdür.
process.chdir(__dirname);
process.env.XRE_BEHIND_PASSENGER = '1';
import('./server/index.mjs').catch(err => { console.error(err); process.exit(1); });
