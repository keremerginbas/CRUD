#!/usr/bin/env node
/**
 * Türkiye'deki apart otellerin iletişim bilgilerini OpenStreetMap (Overpass API)
 * üzerinden çeker ve CSV olarak kaydeder.
 *
 * Çıktı sütunları: Apart Adı, Telefon, İl, İlçe, Mahalle
 *
 * Kullanım:
 *   node scripts/apart-scraper.js                       # tüm Türkiye -> apartlar.csv
 *   node scripts/apart-scraper.js --il Antalya          # sadece bir il
 *   node scripts/apart-scraper.js --sadece-telefonlu    # telefonu olmayanları atla
 *   node scripts/apart-scraper.js --cikti dosya.csv
 *   node scripts/apart-scraper.js --endpoint https://overpass.kumi.systems/api/interpreter
 *
 * Gereksinim: Node.js 18+ (yerleşik fetch). Ek paket gerekmez.
 *
 * Veri kaynağı: © OpenStreetMap katkıcıları, ODbL lisansı.
 * Not: OSM topluluk verisidir; her apartın telefonu kayıtlı olmayabilir.
 */

const fs = require('fs');

const DEFAULT_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// Türkiye OSM idari seviyeleri: 4 = il, 6 = ilçe, 8 = belde/köy, 10 = mahalle
const LEVEL_IL = '4';
const LEVEL_ILCE = '6';
const LEVELS_MAHALLE = ['10', '8'];

function parseArgs(argv) {
  const opts = { il: null, sadeceTelefonlu: false, cikti: 'apartlar.csv', endpoint: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--il') opts.il = argv[++i];
    else if (a === '--sadece-telefonlu') opts.sadeceTelefonlu = true;
    else if (a === '--cikti') opts.cikti = argv[++i];
    else if (a === '--endpoint') opts.endpoint = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
      process.exit(0);
    }
  }
  return opts;
}

function escapeOverpassString(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildQuery({ il }) {
  const areaFilter = il
    ? `area["boundary"="administrative"]["admin_level"="4"]["name"="${escapeOverpassString(il)}"]->.bolge;`
    : `area["ISO3166-1"="TR"]["admin_level"="2"]->.bolge;`;

  // "apart" geçen ama konut binası olan "... Apartmanı" kayıtlarını hariç tutar.
  return `[out:json][timeout:1800][maxsize:1073741824];
${areaFilter}
(
  nwr["tourism"]["name"~"apart",i]["name"!~"apartman",i](area.bolge);
  nwr["tourism"="apartment"]["name"](area.bolge);
)->.tum;
foreach.tum->.e(
  .e out tags center;
  (node.e; node(w.e); way(r.e); node(w);)->.n;
  .n is_in->.alanlar;
  area.alanlar["boundary"="administrative"]["admin_level"~"^(4|6|8|10)$"];
  out tags;
);`;
}

function pickPhone(tags) {
  const raw =
    tags.phone ||
    tags['contact:phone'] ||
    tags['contact:mobile'] ||
    tags.mobile ||
    tags['phone:mobile'] ||
    '';
  return raw
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' / ');
}

function areaName(tags) {
  return tags['name:tr'] || tags.name || '';
}

function stripSuffix(name, suffixes) {
  let out = name;
  for (const s of suffixes) {
    const re = new RegExp(`\\s+${s}$`, 'i');
    out = out.replace(re, '');
  }
  return out.trim();
}

/**
 * Overpass foreach çıktısı sıralıdır: her kayıt için önce tesis (node/way/relation),
 * ardından onu içeren idari alanlar (type=area) gelir.
 */
function parseElements(elements) {
  const records = [];
  let current = null;

  for (const el of elements) {
    if (el.type !== 'area') {
      current = { el, areas: [] };
      records.push(current);
    } else if (current) {
      current.areas.push(el);
    }
  }

  const seen = new Set();
  const rows = [];
  for (const { el, areas } of records) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const tags = el.tags || {};
    const byLevel = {};
    for (const a of areas) {
      const lvl = a.tags && a.tags.admin_level;
      if (lvl && !byLevel[lvl]) byLevel[lvl] = areaName(a.tags);
    }

    const il = byLevel[LEVEL_IL] || tags['addr:province'] || tags['addr:state'] || '';
    const ilce = byLevel[LEVEL_ILCE] || tags['addr:district'] || tags['addr:city'] || '';
    let mahalle = tags['addr:neighbourhood'] || tags['addr:suburb'] || tags['addr:quarter'] || '';
    if (!mahalle) {
      for (const lvl of LEVELS_MAHALLE) {
        if (byLevel[lvl]) {
          mahalle = byLevel[lvl];
          break;
        }
      }
    }

    rows.push({
      ad: tags.name || '',
      telefon: pickPhone(tags),
      il: stripSuffix(il, ['İli', 'ili']),
      ilce: stripSuffix(ilce, ['İlçesi', 'ilçesi']),
      mahalle,
    });
  }

  rows.sort(
    (a, b) =>
      a.il.localeCompare(b.il, 'tr') ||
      a.ilce.localeCompare(b.ilce, 'tr') ||
      a.ad.localeCompare(b.ad, 'tr')
  );
  return rows;
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  const header = ['Apart Adı', 'Telefon', 'İl', 'İlçe', 'Mahalle'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([r.ad, r.telefon, r.il, r.ilce, r.mahalle].map(csvCell).join(','));
  }
  // BOM: Excel'in Türkçe karakterleri doğru açması için
  return '﻿' + lines.join('\r\n') + '\r\n';
}

async function fetchOverpass(query, endpoints) {
  let lastErr;
  for (const url of endpoints) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.error(`Sorgu gönderiliyor: ${url} (deneme ${attempt})`);
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'apart-scraper/1.0 (OSM Overpass client)',
          },
          body: 'data=' + encodeURIComponent(query),
        });
        if (res.status === 429 || res.status === 504) {
          throw new Error(`Sunucu meşgul (HTTP ${res.status})`);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const json = await res.json();
        if (json.remark && /error|timed out/i.test(json.remark)) {
          throw new Error(`Overpass: ${json.remark}`);
        }
        return json.elements || [];
      } catch (err) {
        lastErr = err;
        console.error(`  Hata: ${err.message}`);
        await new Promise((r) => setTimeout(r, 5000 * attempt));
      }
    }
  }
  throw lastErr;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const endpoints = opts.endpoint ? [opts.endpoint] : DEFAULT_ENDPOINTS;
  const query = buildQuery(opts);

  const elements = await fetchOverpass(query, endpoints);
  let rows = parseElements(elements);
  const toplam = rows.length;
  if (opts.sadeceTelefonlu) rows = rows.filter((r) => r.telefon);

  fs.writeFileSync(opts.cikti, toCsv(rows), 'utf8');
  const telefonlu = rows.filter((r) => r.telefon).length;
  console.error(
    `Bitti: ${toplam} apart bulundu, ${rows.length} kayıt yazıldı (${telefonlu} telefonlu) -> ${opts.cikti}`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Başarısız:', err.message);
    process.exit(1);
  });
}

module.exports = { buildQuery, parseElements, toCsv, pickPhone };
