import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGaiaPack } from './gaia-ingest';

// pnpm forwards '--' literally: pnpm run build:gaia -- --snapshot ...
const rawArgs = process.argv.slice(2);
const { values } = parseArgs({
  args: rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs,
  options: {
    snapshot: { type: 'string' },
    hyg: { type: 'string' },
    out: { type: 'string' },
    attributions: { type: 'string' },
    sample: { type: 'boolean' },
  },
});

if (!values.snapshot || !values.hyg || !values.out) {
  if (values.snapshot !== undefined || values.hyg !== undefined || values.out !== undefined) {
    console.error(
      'Usage: tsx src/gaia-cli.ts --snapshot <gaia-dr3-snapshot.csv> --hyg <hyg-pack-dir> --out <pack-dir> [--sample] [--attributions <path>]',
    );
    process.exit(1);
  }
  // No args: turbo build pass — exit cleanly.
  process.exit(0);
}

// ATTRIBUTIONS.md lives at the repo root (../../ from tools/pack-octree/src).
const defaultAttributions = fileURLToPath(new URL('../../../ATTRIBUTIONS.md', import.meta.url));

const result = buildGaiaPack({
  snapshotPath: resolve(values.snapshot),
  hygPackDir: resolve(values.hyg),
  outDir: resolve(values.out),
  attributionsPath: values.attributions ? resolve(values.attributions) : defaultAttributions,
  sample: values.sample ?? false,
});

console.log(`Surviving sources : ${result.survivingSources}`);
console.log(`Dropped (dedup/clip): ${result.droppedDuplicates}`);
console.log(`Tiles written     : ${result.tileCount}`);
console.log(`Stars in leaves   : ${result.leafStarCount}`);
