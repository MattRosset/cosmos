#!/usr/bin/env node
// Budget: apps/web JS assets ≤ 1.2 MB gzip (architecture §12)
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';

const LIMIT_BYTES = 1.2 * 1024 * 1024;
const distDir = resolve(process.cwd(), 'apps/web/dist/assets');

let jsFiles;
try {
  jsFiles = readdirSync(distDir).filter((f) => f.endsWith('.js'));
} catch {
  console.error(`error: could not read ${distDir}`);
  console.error('Run `pnpm build` first.');
  process.exit(1);
}

if (jsFiles.length === 0) {
  console.error('error: no .js files found in dist/assets — run `pnpm build` first.');
  process.exit(1);
}

let total = 0;
const rows = [];
for (const file of jsFiles) {
  const raw = readFileSync(join(distDir, file));
  const gz = gzipSync(raw, { level: 9 });
  total += gz.length;
  rows.push({ file, bytes: gz.length });
}

rows.sort((a, b) => b.bytes - a.bytes);

const PAD = 42;
const LINE = '─'.repeat(PAD + 14);
console.log('\nBundle size (gzip):');
console.log(LINE);
for (const { file, bytes } of rows) {
  console.log(`  ${file.padEnd(PAD)} ${(bytes / 1024).toFixed(1).padStart(8)} kB`);
}
console.log(LINE);
const totalKB = (total / 1024).toFixed(1);
const limitKB = (LIMIT_BYTES / 1024).toFixed(1);
console.log(`  ${'TOTAL'.padEnd(PAD)} ${totalKB.padStart(8)} kB  /  ${limitKB} kB limit\n`);

if (total > LIMIT_BYTES) {
  console.error(`FAIL: bundle exceeds limit (${totalKB} kB > ${limitKB} kB)`);
  process.exit(1);
}

console.log(`OK: bundle within limit`);
