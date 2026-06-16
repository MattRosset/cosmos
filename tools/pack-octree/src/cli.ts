import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { StarPackManifest } from '@cosmos/core-types';
import { buildOctree } from './build';
import type { StarData } from './build';

// pnpm forwards '--' literally: pnpm run build -- --in ...
const rawArgs = process.argv.slice(2);
const { values } = parseArgs({
  args: rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs,
  options: {
    in: { type: 'string' },
    out: { type: 'string' },
    'root-half-extent': { type: 'string' },
    source: { type: 'string' },
  },
});

if (!values.in || !values.out) {
  if (values.in !== undefined || values.out !== undefined) {
    console.error(
      'Usage: tsx src/cli.ts --in <manifest.json> --out <dir> [--root-half-extent 65536] [--source name]',
    );
    process.exit(1);
  }
  // No args: turbo build pass — exit cleanly.
  process.exit(0);
}

const manifestPath = resolve(values.in);
const outDir = resolve(values.out);
const rootHalfExtent = values['root-half-extent'] ? parseInt(values['root-half-extent'], 10) : 65536;
const source = values.source ?? 'hyg-v41-octree';

const manifest: StarPackManifest = JSON.parse(
  readFileSync(manifestPath, 'utf8'),
) as StarPackManifest;

const binDir = dirname(manifestPath);
const binData = readFileSync(join(binDir, manifest.binUrl));
// Slice the Buffer to get an owned ArrayBuffer for TypedArray views.
const buf = binData.buffer.slice(
  binData.byteOffset,
  binData.byteOffset + binData.byteLength,
) as ArrayBuffer;

const [ox, oy, oz] = manifest.originPc;
const count = manifest.count;

const positions = new Float32Array(buf, manifest.buffers.positionsPc.byteOffset, count * 3);
const absMags = new Float32Array(buf, manifest.buffers.absMag.byteOffset, count);
const colorBVs = new Float32Array(buf, manifest.buffers.colorIndexBV.byteOffset, count);
const catIds = new Uint32Array(buf, manifest.buffers.catalogIds.byteOffset, count);
const hipIds = new Uint32Array(buf, manifest.buffers.hipIds.byteOffset, count);

const stars: StarData[] = [];
for (let i = 0; i < count; i++) {
  stars.push({
    x: ox + positions[i * 3]!,
    y: oy + positions[i * 3 + 1]!,
    z: oz + positions[i * 3 + 2]!,
    absMag: absMags[i]!,
    colorIndexBV: colorBVs[i]!,
    catalogId: catIds[i]!,
    hipId: hipIds[i]!,
  });
}

const octree = buildOctree(stars, outDir, {
  rootHalfExtent,
  source,
  // Carry through the input pack's source as idPrefix so BodyIds round-trip.
  idPrefix: manifest.source,
});

const leaves = octree.tiles.filter((t) => t.isLeaf);
const starCount = leaves.reduce((s, t) => s + t.pointCount, 0);
const tileBytes = octree.tiles.map(
  (t) =>
    t.buffers.positionsPc.byteLength +
    t.buffers.absMag.byteLength +
    t.buffers.colorIndexBV.byteLength +
    t.buffers.catalogIds.byteLength +
    t.buffers.hipIds.byteLength,
);
const totalKB = tileBytes.reduce((s, b) => s + b, 0) / 1024;
const maxKB = Math.max(...tileBytes) / 1024;

console.log(`Tiles written    : ${octree.tiles.length} (${leaves.length} leaves)`);
console.log(`Stars in leaves  : ${starCount}`);
console.log(`Total tile bytes : ${totalKB.toFixed(1)} KB`);
console.log(`Max tile bytes   : ${maxKB.toFixed(1)} KB`);
