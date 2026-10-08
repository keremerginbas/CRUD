// Tarayıcı kütüphanelerini ve Inter fontunu assets/vendor altına kopyalar.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, '..', 'assets', 'vendor');
const files = {
  'gsap.min.js': 'gsap/dist/gsap.min.js',
  'ScrollTrigger.min.js': 'gsap/dist/ScrollTrigger.min.js',
  'motion.js': 'motion/dist/motion.js',
  'confetti.browser.js': 'canvas-confetti/dist/confetti.browser.js',
  'fonts/inter-latin-wght-normal.woff2': '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  'fonts/inter-latin-ext-wght-normal.woff2': '@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2',
  'licenses/motion.txt': 'motion/LICENSE.md',
  'licenses/lucide.txt': 'lucide-static/LICENSE',
  'licenses/canvas-confetti.txt': 'canvas-confetti/LICENSE',
  'licenses/inter.txt': '@fontsource-variable/inter/LICENSE',
};
for (const [to, from] of Object.entries(files)) {
  mkdirSync(dirname(join(out, to)), { recursive: true });
  cpSync(join(nm, from), join(out, to));
}
writeFileSync(join(out, 'licenses', 'gsap.txt'), 'GSAP 3 (gsap.min.js, ScrollTrigger.min.js) — GreenSock Standard "No Charge" License: https://gsap.com/standard-license\n');
console.log(`vendor: ${Object.keys(files).length} dosya kopyalandı`);
