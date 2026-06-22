import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { assertAttribution, buildPack, parseSource } from './convert.js';
import { ConstellationPackSchema } from './schema.js';

const rawArgs = process.argv.slice(2);
const { values } = parseArgs({
  args: rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs,
  options: {
    input: { type: 'string' },
    out: { type: 'string' },
    attributions: { type: 'string' },
  },
});

// pnpm changes CWD to the package dir; INIT_CWD is the workspace root.
const baseCwd = process.env['INIT_CWD'] ?? process.cwd();

const inputPath = resolve(baseCwd, values.input ?? 'tools/pack-constellations/src/constellation-lines.dat');
const outDir = resolve(baseCwd, values.out ?? 'apps/web/public/packs');
const attributionsPath = resolve(baseCwd, values.attributions ?? 'ATTRIBUTIONS.md');

assertAttribution(attributionsPath);

const sourceText = readFileSync(inputPath, 'utf-8');
const constellations = parseSource(sourceText);
const pack = buildPack(constellations);
ConstellationPackSchema.parse(pack);

const packPath = join(outDir, 'constellations.json');
mkdirSync(outDir, { recursive: true });
writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n');

const segmentCount = pack.constellations.reduce((n, c) => n + c.hipPairs.length / 2, 0);
console.log(`Pack written : ${packPath}`);
console.log(`Constellations: ${pack.constellations.length}, Segments: ${segmentCount}`);
