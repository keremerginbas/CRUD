/** shadcn/ui tasarım belirteçleri (CSS değişkenleri) + panel bileşen katmanı. */
module.exports = {
  content: ['../*.php', '../app/**/*.php', '../assets/js/panel.js'],
  // PHP'de birleştirilerek üretilen sınıflar (badge-<?= $cls ?> gibi) taramada görünmez
  safelist: [{ pattern: /^(badge|stat|alert)-(ok|warn|err|info|muted|violet)$/ }],
  theme: {
    container: { center: true },
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      transitionTimingFunction: { smooth: 'cubic-bezier(.22, 1, .36, 1)' },
      keyframes: {
        spin: { to: { transform: 'rotate(360deg)' } },
        shine: { from: { transform: 'translateX(-120%) skewX(-20deg)' }, to: { transform: 'translateX(220%) skewX(-20deg)' } },
        pulse: { '0%,100%': { opacity: 1 }, '50%': { opacity: .45 } },
      },
    },
  },
  plugins: [],
};
