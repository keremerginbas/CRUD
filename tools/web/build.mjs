// ------------------------------------------------------------------
// Orphion Pharma / Rome Pharma - derleme
//   npm run build            -> iki site
//   npm run build:orphion    -> yalnızca orphion-pharma/
//   npm run build:rome       -> yalnızca rome-pharma/
// Adımlar: HTML üretimi (tools/generate.py), Tailwind CSS, JS paketleme
// (site.js + Three.js küresi), sayfalardaki ?v= sürüm işaretlerinin doldurulması.
// ------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const SITES = { orphion: "orphion-pharma", rome: "rome-pharma" };
const brands = process.argv[2] ? [process.argv[2]] : Object.keys(SITES);

const hash = (file) => createHash("md5").update(readFileSync(file)).digest("hex").slice(0, 8);

for (const brand of brands) {
  const dir = join(repo, SITES[brand]);
  console.log(`\n[${brand}] HTML üretiliyor`);
  execFileSync("python3", [join(repo, "tools/generate.py"), brand], { stdio: "inherit" });

  console.log(`[${brand}] Tailwind CSS derleniyor`);
  mkdirSync(join(dir, "assets/css"), { recursive: true });
  execFileSync(join(here, "node_modules/.bin/tailwindcss"),
    ["-c", "tailwind.config.cjs", "-i", "src/site.css", "-o", join(dir, "assets/css/site.css"), "--minify"],
    { cwd: here, stdio: "inherit", env: { ...process.env, SITE_DIR: dir } });

  console.log(`[${brand}] JavaScript paketleniyor`);
  await esbuild.build({
    entryPoints: brand === "orphion"
      ? { site: join(here, "src/site.js"), globe: join(here, "src/globe.js") }
      : { site: join(here, "src/site.js") },
    outdir: join(dir, "assets/js"),
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2018"],
    legalComments: "none",
    loader: { ".json": "json" },
    logLevel: "warning",
  });

  const marks = {
    __HASH_SITE_CSS__: hash(join(dir, "assets/css/site.css")),
    __HASH_SITE_JS__: hash(join(dir, "assets/js/site.js")),
    __HASH_GLOBE_JS__: brand === "orphion" ? hash(join(dir, "assets/js/globe.js")) : "",
  };
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".html"))) {
    const p = join(dir, f);
    let html = readFileSync(p, "utf8");
    for (const [k, v] of Object.entries(marks)) html = html.split(k).join(v);
    writeFileSync(p, html);
  }
  console.log(`[${brand}] tamam`);
}
