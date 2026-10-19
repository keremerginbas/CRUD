/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./dist/**/*.html', './src/static/assets/js/**/*.js', './src/templates/**/*.mjs'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#f5b82e', 500: '#e8a317', 600: '#c4870c', 700: '#9a6a0b', 800: '#7a5206', 900: '#5c3d05' },
        ink: { 50: '#f8fafc', 500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a', 950: '#0a0f1c' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Barlow Condensed"', 'Impact', 'Arial Narrow', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
