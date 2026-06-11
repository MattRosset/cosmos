import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const FIXTURE_CSV = join(
  REPO_ROOT,
  'tools/pack-stars/test/fixtures/hyg-mini.csv',
);

const CLI_TS = join(REPO_ROOT, 'tools/pack-stars/src/cli.ts');

// tsx binary — use .CMD on Windows so the shell finds it
const TSX_BIN =
  process.platform === 'win32'
    ? join(REPO_ROOT, 'node_modules/.bin/tsx.CMD')
    : join(REPO_ROOT, 'node_modules/.bin/tsx');

/** Run the pack-stars CLI on the fixture CSV and return the output directory. */
export function buildFixturePack(): string {
  const dir = join(
    tmpdir(),
    `cosmos-data-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  execFileSync(TSX_BIN, [CLI_TS, '--input', FIXTURE_CSV, '--out', dir], {
    shell: process.platform === 'win32',
  });
  return dir;
}

/** fetch implementation backed by the local filesystem for Node tests. */
export function makeFileFetch(): typeof fetch {
  return async (input: RequestInfo | URL) => {
    const href =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const filePath = fileURLToPath(href);
    const buf = readFileSync(filePath);
    if (filePath.endsWith('.json')) {
      return new Response(buf.toString('utf8'), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Copy into a fresh ArrayBuffer — Node Buffer.buffer may be a pool slice
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    return new Response(ab, { status: 200 });
  };
}
