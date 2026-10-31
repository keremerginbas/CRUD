// Tohumlanmış rastgelelik + gürültü + palet üretimi. Aynı tohum => aynı sanat.

export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Kullanışlı yardımcılarla tohumlu RNG */
export function createRng(seed) {
  const r = mulberry32(typeof seed === "number" ? seed : hashString(String(seed)));
  const rng = () => r();
  rng.range = (a, b) => a + (b - a) * r();
  rng.int = (a, b) => Math.floor(rng.range(a, b + 1));
  rng.pick = (arr) => arr[Math.floor(r() * arr.length)];
  rng.chance = (p = 0.5) => r() < p;
  rng.gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return rng;
}

export function randomSeed() {
  const chars = "0123456789abcdef";
  let s = "0x";
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

// ---- 3D Simplex noise (Stefan Gustavson'ın kamu malı algoritmasının kompakt hali)
const F3 = 1 / 3, G3 = 1 / 6;
const grad3 = new Float32Array([1,1,0,-1,1,0,1,-1,0,-1,-1,0,1,0,1,-1,0,1,1,0,-1,-1,0,-1,0,1,1,0,-1,1,0,1,-1,0,-1,-1]);

export function createNoise3D(rng = Math.random) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const n = Math.floor((i + 1) * rng());
    const q = p[i]; p[i] = p[n]; p[n] = q;
  }
  const perm = new Uint8Array(512), permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = perm[i] % 12; }

  return function noise3D(x, y, z) {
    let n0, n1, n2, n3;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=1;k2=0; }
      else if (x0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=0;k2=1; }
      else { i1=0;j1=0;k1=1;i2=1;j2=0;k2=1; }
    } else {
      if (y0 < z0) { i1=0;j1=0;k1=1;i2=0;j2=1;k2=1; }
      else if (x0 < z0) { i1=0;j1=1;k1=0;i2=0;j2=1;k2=1; }
      else { i1=0;j1=1;k1=0;i2=1;j2=1;k2=0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
    if (t0 < 0) n0 = 0; else { const g = permMod12[ii+perm[jj+perm[kk]]]*3; t0 *= t0; n0 = t0*t0*(grad3[g]*x0+grad3[g+1]*y0+grad3[g+2]*z0); }
    let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
    if (t1 < 0) n1 = 0; else { const g = permMod12[ii+i1+perm[jj+j1+perm[kk+k1]]]*3; t1 *= t1; n1 = t1*t1*(grad3[g]*x1+grad3[g+1]*y1+grad3[g+2]*z1); }
    let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
    if (t2 < 0) n2 = 0; else { const g = permMod12[ii+i2+perm[jj+j2+perm[kk+k2]]]*3; t2 *= t2; n2 = t2*t2*(grad3[g]*x2+grad3[g+1]*y2+grad3[g+2]*z2); }
    let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
    if (t3 < 0) n3 = 0; else { const g = permMod12[ii+1+perm[jj+1+perm[kk+1]]]*3; t3 *= t3; n3 = t3*t3*(grad3[g]*x3+grad3[g+1]*y3+grad3[g+2]*z3); }
    return 32 * (n0 + n1 + n2 + n3);
  };
}

// ---- Palet: HSL uyumlarından okunabilir 4 renk + zemin/mürekkep
export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

const HARMONIES = {
  triadic: [0, 120, 240, 60],
  split: [0, 150, 210, 30],
  analog: [0, 30, 60, 200],
  tetradic: [0, 90, 180, 270],
  neon: [0, 165, 300, 45],
};

export function generatePalette(seed) {
  const rng = createRng(`palette:${seed}`);
  const name = rng.pick(Object.keys(HARMONIES));
  const base = rng.range(0, 360);
  const colors = HARMONIES[name].map((off, i) =>
    hslToHex(base + off + rng.range(-12, 12), rng.range(78, 100), i === 0 ? rng.range(58, 66) : rng.range(55, 70))
  );
  return {
    name,
    base: Math.round(base),
    colors,
    ink: hslToHex(base, 12, 4),
    paper: hslToHex(base + 40, 25, 94),
  };
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const map = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
