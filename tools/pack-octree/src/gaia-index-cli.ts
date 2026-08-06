/**
 * Backfill `gaia-sourceids-index.bin` for an ALREADY-BUILT Gaia pack (TASK-070), without
 * re-running the full ingest from the multi-GB snapshot. The logic lives in
 * `writeSourceIdIndexFromPack` (unit-tested); this is the thin CLI wrapper.
 *
 * Use it for local dense packs built before this task (e.g. the gitignored `octree-gaia` pack
 * behind VITE_GAIA_OCTREE_MANIFEST_URL) so Gaia search-by-source_id works locally too:
 *   pnpm --filter @cosmos/pack-octree build:gaia-index -- --pack apps/web/public/packs/octree-gaia
 *
 * (Freshly built packs already ship the index — `buildGaiaPack` emits it. This is only for
 * packs that predate the writer.)
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { writeSourceIdIndexFromPack } from './gaia-ingest';

const rawArgs = process.argv.slice(2);
const { values } = parseArgs({
  args: rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs,
  options: { pack: { type: 'string' } },
});

if (!values.pack) {
  if (rawArgs.length === 0) process.exit(0); // no args: turbo build pass — exit cleanly
  console.error('Usage: tsx src/gaia-index-cli.ts --pack <gaia-pack-dir>');
  process.exit(1);
}

const packDir = resolve(values.pack);
const count = writeSourceIdIndexFromPack(packDir);
console.log(`Wrote gaia-sourceids-index.bin: ${count} records (${count * 16} bytes) to ${packDir}`);
