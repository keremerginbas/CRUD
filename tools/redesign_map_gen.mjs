import { geoNaturalEarth1, geoContains } from "d3-geo";
import { feature } from "topojson-client";
import fs from "fs";
const topo = JSON.parse(fs.readFileSync("node_modules/world-atlas/land-110m.json"));
const land = feature(topo, topo.objects.land);
const W = 1200, H = 560;
const proj = geoNaturalEarth1().scale(238).translate([W / 2 + 40, H / 2 + 70]);
const step = 9;
let d = "";
let n = 0;
for (let y = step / 2; y < H; y += step) {
  for (let x = step / 2; x < W; x += step) {
    const ll = proj.invert([x, y]);
    if (!ll || ll[1] < -56) continue;
    if (geoContains(land, ll)) { d += `M${x} ${y}h0`; n++; }
  }
}
const cities = {
  ankara: [32.85, 39.93], dubai: [55.27, 25.2], ohio: [-84.18, 39.08],
};
const pts = Object.fromEntries(Object.entries(cities).map(([k, v]) => [k, proj(v).map(c => +c.toFixed(1))]));
fs.writeFileSync("map.json", JSON.stringify({ W, H, d, pts, n }));
console.log(n, "nokta", pts, (d.length / 1024).toFixed(1) + "KB");
