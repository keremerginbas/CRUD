// Uygulamanın tasarım belirteçleri (renkler, köşe yuvarlaklıkları). Bileşenler sadece
// buradaki isimleri kullanır; renk değiştirmek için burayı düzenlemek yeterli.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.js', './src/**/*.{js,jsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#1463FF', soft: '#E6EEFF', dark: '#0B4FD6' },
        ink: { DEFAULT: '#16202E', muted: '#667085' },
        surface: { DEFAULT: '#FFFFFF', bg: '#F4F6FA', line: '#E3E7EE' },
        night: { DEFAULT: '#0F1623', card: '#182131', line: '#273247', muted: '#94A0B4' },
        ok: { DEFAULT: '#0F9D58', soft: '#E3F5EA' },
        bad: { DEFAULT: '#D93025', soft: '#FDE8E7' },
        warn: { DEFAULT: '#B26A00', soft: '#FFF3E0' },
        site: { obilet: '#E4002B', enuygun: '#16A34A', ucuzabilet: '#F97316', skyscanner: '#0770E3' },
      },
      borderRadius: { xl2: '14px' },
    },
  },
  plugins: [],
};
