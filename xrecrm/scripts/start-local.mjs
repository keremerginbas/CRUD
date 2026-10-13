import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'dist', 'server.js');
if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error('Node.js 22 veya daha yeni bir surum gerekli.');
  process.exit(1);
}
if (!fs.existsSync(entry)) {
  console.error('dist/server.js bulunamadi. Once pnpm build calistirin.');
  process.exit(1);
}
if (!fs.existsSync(path.join(root, 'node_modules', 'express'))) {
  console.error('Bagimliliklar eksik. Once pnpm install --frozen-lockfile calistirin.');
  process.exit(1);
}
console.log('XRE CRM: http://localhost:' + (process.env.PORT || '3000'));
console.log('Terminali acik tutun. Durdurmak icin Ctrl+C.');
const child = spawn(process.execPath, ['--env-file-if-exists=.env', entry], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
