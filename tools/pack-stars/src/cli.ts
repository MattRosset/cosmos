import { parseArgs } from 'node:util';
import { packFromCsv } from './pack-from-csv';

// pnpm forwards '--' literally when called as: pnpm run build -- --input ...
const rawArgs = process.argv.slice(2);
const { values } = parseArgs({
  args: rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs,
  options: {
    input: { type: 'string' },
    out: { type: 'string' },
  },
});

if (!values.input || !values.out) {
  // In turbo's build pipeline this script runs without arguments — skip gracefully.
  // To actually build the pack, pass --input and --out explicitly:
  //   pnpm --filter @cosmos/pack-stars build -- --input <csv> --out <dir>
  if (values.input !== undefined || values.out !== undefined) {
    console.error('Usage: tsx src/cli.ts --input <hygdata_v41.csv> --out <dir>');
    process.exit(1);
  }
  process.exit(0);
}

const result = packFromCsv(values.input, values.out);

console.log(`Stars written : ${result.count}`);
console.log(`Output file   : ${result.binFilename}`);
console.log(`SHA-256       : ${result.contentHashSha256}`);
