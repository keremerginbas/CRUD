// Node.js (Express) sunucusu: build edilmiş siteyi sunar + generatif API uçları.
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { generatePalette, createRng } from "../src/lib/random.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, "..", "dist");
const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");

/** Günün tohumu: o gün herkes aynı dünyayı görür (?fresh=1 ile tamamen rastgele) */
app.get("/api/seed", (req, res) => {
  const day = new Date().toISOString().slice(0, 10);
  const seed = req.query.fresh
    ? "0x" + [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("")
    : (() => {
        const r = createRng(`day:${day}`);
        const hex = () => Math.floor(r() * 0x1000000).toString(16).padStart(6, "0");
        return "0x" + hex() + hex();
      })();
  res.set("Cache-Control", "no-store").json({ seed, day, palette: generatePalette(seed) });
});

/** Herhangi bir tohum için paleti döndürür — tasarım araçlarına (ör. Figma eklentisi) beslemek için */
app.get("/api/palette/:seed", (req, res) => {
  const seed = String(req.params.seed).slice(0, 32);
  res.json({ seed, ...generatePalette(seed) });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

if (existsSync(dist)) {
  app.use(express.static(dist, { maxAge: "1y", index: false }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
} else {
  app.get("/", (_req, res) => res.type("text").send("dist/ yok — önce `npm run build` çalıştırın."));
}

app.listen(PORT, () => console.log(`SEED/STUDIO → http://localhost:${PORT}`));
