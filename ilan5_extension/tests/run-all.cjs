'use strict';
// Runs every *.test.cjs file in its own process and reports a summary.
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const files = fs.readdirSync(__dirname).filter(name => name.endsWith('.test.cjs')).sort();
const failed = [];
for (const name of files) {
  const result = spawnSync(process.execPath, [path.join(__dirname, name)], {encoding: 'utf8', timeout: 180000});
  const ok = result.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) { failed.push(name); console.log((result.stdout + result.stderr).split('\n').filter(line => /not ok|Error|assert/i.test(line)).slice(0, 12).join('\n')); }
}
console.log(`\n${files.length - failed.length}/${files.length} test dosyası geçti.`);
process.exit(failed.length ? 1 : 0);
