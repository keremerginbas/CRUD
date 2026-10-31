// Generatif algoritmalar. Her biri: draw(ctx, w, h, rng, palette, params) — saf ve tohumla deterministik.
import { createNoise3D } from "./random.js";

const TAU = Math.PI * 2;

function bg(ctx, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}

/** 01 — Truchet karoları: çeyrek yaylar, rastgele dönüşler */
export function truchet(ctx, w, h, rng, pal, { density = 0.5 } = {}) {
  bg(ctx, w, h, pal.ink);
  const cols = Math.round(6 + density * 18);
  const s = w / cols;
  const rows = Math.ceil(h / s);
  ctx.lineCap = "round";
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * s, py = y * s;
      ctx.strokeStyle = rng.chance(0.18) ? rng.pick(pal.colors) : pal.paper;
      ctx.lineWidth = s * (rng.chance(0.1) ? 0.28 : 0.12);
      ctx.beginPath();
      if (rng.chance()) {
        ctx.arc(px, py, s / 2, 0, Math.PI / 2);
        ctx.moveTo(px + s, py + s / 2);
        ctx.arc(px + s, py + s, s / 2, -Math.PI / 2, -Math.PI, true);
      } else {
        ctx.arc(px + s, py, s / 2, Math.PI / 2, Math.PI);
        ctx.moveTo(px + s / 2, py + s);
        ctx.arc(px, py + s, s / 2, -Math.PI / 2, 0);
      }
      ctx.stroke();
    }
  }
}

/** 02 — Daire paketleme: çakışmasız büyüyen daireler */
export function circlePack(ctx, w, h, rng, pal, { density = 0.5 } = {}) {
  bg(ctx, w, h, pal.paper);
  const circles = [];
  const attempts = 1500 + density * 4000;
  const maxR = Math.min(w, h) * (0.22 - density * 0.12);
  for (let i = 0; i < attempts; i++) {
    const x = rng() * w, y = rng() * h;
    let r = maxR;
    for (const c of circles) {
      const d = Math.hypot(c.x - x, c.y - y) - c.r - 2;
      if (d < r) r = d;
      if (r < 2) break;
    }
    if (r >= 2) circles.push({ x, y, r });
  }
  for (const c of circles) {
    const col = rng.pick([...pal.colors, pal.ink, pal.ink]);
    if (rng.chance(0.55)) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU); ctx.fill();
    } else {
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, c.r * 0.08);
      for (let rr = c.r; rr > 1; rr -= Math.max(3, c.r * 0.22)) {
        ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, TAU); ctx.stroke();
      }
    }
  }
}

/** 03 — Özyinelemeli bölme (Mondrian'ın kaotik kuzeni) */
export function subdivide(ctx, w, h, rng, pal, { density = 0.5 } = {}) {
  bg(ctx, w, h, pal.ink);
  const gap = Math.max(2, w * 0.006);
  const maxDepth = 3 + Math.round(density * 5);
  const split = (x, y, sw, sh, depth) => {
    const canSplit = depth < maxDepth && sw > 20 && sh > 20 && (depth < 2 || rng.chance(0.82));
    if (!canSplit) {
      const r = rng();
      ctx.fillStyle = r < 0.55 ? pal.paper : rng.pick(pal.colors);
      ctx.fillRect(x + gap, y + gap, sw - gap * 2, sh - gap * 2);
      if (r > 0.9) {
        ctx.fillStyle = pal.ink;
        ctx.beginPath();
        ctx.arc(x + sw / 2, y + sh / 2, Math.min(sw, sh) * 0.3, 0, TAU);
        ctx.fill();
      }
      return;
    }
    const t = rng.range(0.3, 0.7);
    if (sw > sh ? rng.chance(0.8) : rng.chance(0.2)) {
      split(x, y, sw * t, sh, depth + 1);
      split(x + sw * t, y, sw * (1 - t), sh, depth + 1);
    } else {
      split(x, y, sw, sh * t, depth + 1);
      split(x, y + sh * t, sw, sh * (1 - t), depth + 1);
    }
  };
  split(0, 0, w, h, 0);
}

/** 04 — Sırt çizgileri: gürültüyle şişen yatay dalgalar (gizli çizgi kaldırmalı) */
export function ridges(ctx, w, h, rng, pal, { density = 0.5, chaos = 0.5 } = {}) {
  bg(ctx, w, h, pal.ink);
  const noise = createNoise3D(rng);
  const lines = Math.round(20 + density * 50);
  const step = (h * 0.8) / lines;
  const z = rng() * 100;
  const accent = rng.pick(pal.colors);
  for (let i = 0; i < lines; i++) {
    const y0 = h * 0.15 + i * step;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 3) {
      const center = 1 - Math.abs(x / w - 0.5) * 2;
      const amp = Math.pow(Math.max(0, center), 2.2) * h * (0.08 + chaos * 0.25);
      const n = noise(x * 0.008, i * 0.12, z) * 0.5 + 0.5;
      const y = y0 - n * amp;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = pal.ink;
    ctx.fill();
    ctx.strokeStyle = i % 9 === 4 ? accent : pal.paper;
    ctx.lineWidth = i % 9 === 4 ? 2 : 1.2;
    ctx.stroke();
  }
}

/** 05 — Akış alanı izleri: gürültü vektör alanında süzülen parçacıklar */
export function flowTrails(ctx, w, h, rng, pal, { density = 0.5, chaos = 0.5 } = {}) {
  bg(ctx, w, h, pal.paper);
  const noise = createNoise3D(rng);
  const scale = 0.0015 + chaos * 0.006;
  const count = Math.round(300 + density * 1500);
  ctx.globalAlpha = 0.75;
  for (let i = 0; i < count; i++) {
    let x = rng() * w, y = rng() * h;
    ctx.strokeStyle = rng.chance(0.7) ? pal.ink : rng.pick(pal.colors);
    ctx.lineWidth = rng.range(0.5, 2.2);
    ctx.beginPath(); ctx.moveTo(x, y);
    const len = rng.int(20, 90);
    for (let s = 0; s < len; s++) {
      const a = noise(x * scale, y * scale, 0.3) * TAU * 2;
      x += Math.cos(a) * 3; y += Math.sin(a) * 3;
      if (x < 0 || x > w || y < 0 || y > h) break;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** 06 — Yörüngeler: eş merkezli, kırık halkalar ve uydular */
export function orbits(ctx, w, h, rng, pal, { density = 0.5 } = {}) {
  bg(ctx, w, h, pal.ink);
  const cx = w / 2, cy = h / 2;
  const rings = Math.round(8 + density * 26);
  const maxR = Math.hypot(w, h) * 0.55;
  ctx.lineCap = "round";
  for (let i = 0; i < rings; i++) {
    const r = (maxR / rings) * (i + 1);
    const segs = rng.int(1, 5);
    for (let s = 0; s < segs; s++) {
      const a0 = rng() * TAU, len = rng.range(0.2, 1.6);
      ctx.strokeStyle = rng.chance(0.3) ? rng.pick(pal.colors) : pal.paper;
      ctx.globalAlpha = rng.range(0.35, 1);
      ctx.lineWidth = rng.range(1, (maxR / rings) * 0.55);
      ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + len); ctx.stroke();
    }
    if (rng.chance(0.35)) {
      const a = rng() * TAU;
      ctx.globalAlpha = 1;
      ctx.fillStyle = rng.pick(pal.colors);
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rng.range(3, 10), 0, TAU); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.colors[0];
  ctx.beginPath(); ctx.arc(cx, cy, maxR / rings * 0.6, 0, TAU); ctx.fill();
}

/** 07 — Yarım ton gürültü: noktalar boyut ve renkte gürültüyü izler */
export function halftone(ctx, w, h, rng, pal, { density = 0.5, chaos = 0.5 } = {}) {
  bg(ctx, w, h, pal.ink);
  const noise = createNoise3D(rng);
  const cell = Math.max(6, 26 - density * 18);
  const sc = 0.002 + chaos * 0.01;
  for (let y = cell / 2; y < h; y += cell) {
    for (let x = cell / 2; x < w; x += cell) {
      const n = noise(x * sc, y * sc, 1.7) * 0.5 + 0.5;
      const r = n * n * cell * 0.62;
      if (r < 0.6) continue;
      ctx.fillStyle = n > 0.72 ? pal.colors[1] : n > 0.55 ? pal.colors[0] : pal.paper;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
  }
}

export const ALGORITHMS = [
  { id: "flow", name: "Akış Alanı", desc: "Simplex gürültü vektör alanında binlerce iz", draw: flowTrails },
  { id: "ridges", name: "Sırtlar", desc: "Gürültüyle şişen, birbirini örten çizgiler", draw: ridges },
  { id: "subdivide", name: "Bölünme", desc: "Özyinelemeli dikdörtgen ayrışması", draw: subdivide },
  { id: "pack", name: "Paketleme", desc: "Çakışmayan, büyüyen daireler", draw: circlePack },
  { id: "truchet", name: "Truchet", desc: "Rastgele dönen çeyrek yay karoları", draw: truchet },
  { id: "orbits", name: "Yörüngeler", desc: "Kırık halkalar ve kayıp uydular", draw: orbits },
  { id: "halftone", name: "Yarım Ton", desc: "Gürültü yoğunluğunu izleyen nokta ızgarası", draw: halftone },
];

/** Canvas'ı DPR'a göre boyutlandırıp algoritmayı çalıştır */
export function render(canvas, algo, rng, pal, params) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  algo.draw(ctx, width, height, rng, pal, params);
}
