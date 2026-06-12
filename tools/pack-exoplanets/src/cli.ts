import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse as parseCsv } from 'csv-parse/sync';
import { CsvRowSchema, SystemsPackManifestSchema } from './schema.js';
import { buildPack } from './convert.js';

const rawArgs = process.argv.slice(2);
const { values } = parseArgs({
  args: rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs,
  options: {
    input: { type: 'string' },
    out: { type: 'string' },
    'generated-at': { type: 'string' },
  },
});

if (!values.input || !values.out || !values['generated-at']) {
  // Turbo's build pipeline runs without arguments — skip gracefully.
  // To actually build the pack run:
  //   pnpm --filter @cosmos/pack-exoplanets build -- \
  //     --input <path-to-pscomppars.csv> \
  //     --out apps/web/public/packs \
  //     --generated-at <iso>
  if (values.input !== undefined || values.out !== undefined) {
    console.error(
      'Usage: tsx src/cli.ts --input <csv> --out <dir> --generated-at <iso>',
    );
    process.exit(1);
  }
  process.exit(0);
}

// pnpm changes CWD to the package dir; INIT_CWD is the workspace root.
const baseCwd = process.env['INIT_CWD'] ?? process.cwd();
const inputPath = resolve(baseCwd, values.input);
const outDir = resolve(baseCwd, values.out);
const generatedAtIso = values['generated-at'];

const csvText = readFileSync(inputPath, 'utf-8');

const rawRows = parseCsv(csvText, {
  columns: true,
  skip_empty_lines: true,
  trim: true,
  comment: '#',
}) as unknown[];

console.log(`Parsed ${rawRows.length} raw rows from CSV.`);

// Validate and filter rows: drop rows that fail ra/dec/sy_dist (drop rules),
// fail loudly on anything else that violates the schema.
const rows = rawRows.flatMap((raw, i) => {
  const result = CsvRowSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues;
    // Drop rules: if only ra/dec/sy_dist fields failed, silently skip.
    const dropFields = new Set(['ra', 'dec', 'sy_dist']);
    const onlyDropFields = issues.every((iss) =>
      iss.path.length > 0 && dropFields.has(String(iss.path[0])),
    );
    if (onlyDropFields) {
      console.warn(`Row ${i + 2}: dropped (unparseable ra/dec/sy_dist)`);
      return [];
    }
    throw new Error(
      `Row ${i + 2} failed validation:\n${result.error.issues.map((e) => `  ${e.path.join('.')}: ${e.message}`).join('\n')}`,
    );
  }
  return [result.data];
});

console.log(`${rows.length} rows passed validation.`);

const pack = buildPack(rows, generatedAtIso);
SystemsPackManifestSchema.parse(pack);

const packPath = join(outDir, 'systems-exo.json');
mkdirSync(outDir, { recursive: true });
writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n');

const systemCount = pack.systems.length;
const planetCount = pack.systems.reduce((n, s) => n + s.bodies.length, 0);
console.log(`Pack written : ${packPath}`);
console.log(`Systems: ${systemCount}, Planets: ${planetCount}`);
