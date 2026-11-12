/** Tailwind ayarları: renkler marka değişkenlerinden (src/site.css içindeki [data-brand]) gelir. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: [`${process.env.SITE_DIR || "../../orphion-pharma"}/*.html`, "./src/*.js"],
  theme: {
    extend: {
      colors: {
        ink: v("ink"),
        "ink-deep": v("ink-deep"),
        navy: v("navy"),
        accent: v("accent"),
        "accent-hover": v("accent-hover"),
        "accent-on": v("accent-on"),
        "accent-ink": v("accent-ink"),
        mist: v("mist"),
        line: v("line"),
        body: v("body"),
        muted: v("muted"),
        "on-dark": v("on-dark"),
        "on-dark-muted": v("on-dark-muted"),
      },
      fontFamily: {
        sans: ['"Schibsted Grotesk"', '"Helvetica Neue"', "Arial", "sans-serif"],
        serif: ['"Source Serif 4"', "Georgia", '"Times New Roman"', "serif"],
      },
      maxWidth: { wrap: "1200px" },
      keyframes: {
        rise: { from: { opacity: "0", transform: "translateY(18px)" }, to: { opacity: "1", transform: "none" } },
      },
    },
  },
  plugins: [],
};
