// dist/preview çıktısını tek bir HTML dosyasına (dist/xre-crm-onizleme.html) gömer.
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "dist/preview");
let html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const logo = (file) =>
  `data:image/png;base64,${fs.readFileSync(path.join(root, "public", file)).toString("base64")}`;
const replaceLogos = (text) =>
  text
    .replaceAll("/xre-crm-logo-white.png", logo("xre-crm-logo-white.png"))
    .replaceAll("/xre-crm-logo.png", logo("xre-crm-logo.png"));
html = html.replace(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/, (_m, file) => {
  const js = replaceLogos(fs.readFileSync(path.join(dir, file), "utf8")).replaceAll("</script", "<\\/script");
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/, (_m, file) =>
  `<style>${fs.readFileSync(path.join(dir, file), "utf8")}</style>`,
);
html = replaceLogos(html).replace("<title>XRE CRM — İletişim & Satış Merkezi</title>", "<title>XRE CRM Önizleme</title>");
// Artifact iskeleti doctype/html/head/body etiketlerini kendisi ekler.
const head = html.match(/<head>([\s\S]*)<\/head>/)[1].replace(/<meta charset[^>]*>|<meta name="viewport"[^>]*>/g, "");
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
const title = head.match(/<title>.*?<\/title>/)[0];
const out = `${title}\n${head.replace(title, "")}\n${body}`;
const target = path.join(root, "dist/xre-crm-onizleme.html");
fs.writeFileSync(target, out);
console.log(`${target} · ${(out.length / 1024 / 1024).toFixed(2)} MB`);
