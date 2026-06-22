import { describe, expect, it, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { assertAttribution, buildPack, parseSource } from '../src/convert.js';
import { ConstellationPackSchema } from '../src/schema.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE = join(REPO_ROOT, 'tools/pack-constellations/src/constellation-lines.dat');
const COMMITTED_PACK = join(REPO_ROOT, 'apps/web/public/packs/constellations.json');
const GOLDEN = join(REPO_ROOT, 'tools/pack-constellations/test/fixtures/golden-hash.json');
const ATTRIBUTIONS = join(REPO_ROOT, 'ATTRIBUTIONS.md');

describe('parseSource', () => {
  it('parses a single-polyline constellation into flat hipPairs', () => {
    const [c] = parseSource('And|Andromeda|1,2,3,4');
    expect(c).toEqual({ code: 'And', name: 'Andromeda', hipPairs: [1, 2, 2, 3, 3, 4] });
  });

  it('concatenates multiple polylines in source order', () => {
    const [c] = parseSource('Ant|Antlia|1,2;3,4,5');
    expect(c!.hipPairs).toEqual([1, 2, 3, 4, 4, 5]);
  });

  it('rejects a non-3-letter code', () => {
    expect(() => parseSource('Andr|Andromeda|1,2')).toThrow();
  });

  it('rejects a non-positive-integer HIP', () => {
    expect(() => parseSource('And|Andromeda|1,-2')).toThrow();
    expect(() => parseSource('And|Andromeda|1,2.5')).toThrow();
  });

  it('skips comment and blank lines', () => {
    const result = parseSource('# comment\n\nAnd|Andromeda|1,2');
    expect(result).toHaveLength(1);
  });
});

describe('buildPack', () => {
  it('sorts constellations by code', () => {
    const pack = buildPack([
      { code: 'Vir', name: 'Virgo', hipPairs: [1, 2] },
      { code: 'And', name: 'Andromeda', hipPairs: [3, 4] },
    ]);
    expect(pack.constellations.map((c) => c.code)).toEqual(['And', 'Vir']);
  });

  it('sets packFormatVersion 1 and a non-empty source string', () => {
    const pack = buildPack([{ code: 'And', name: 'Andromeda', hipPairs: [1, 2] }]);
    expect(pack.packFormatVersion).toBe(1);
    expect(pack.source.length).toBeGreaterThan(0);
  });

  it('throws on a duplicate code', () => {
    expect(() =>
      buildPack([
        { code: 'And', name: 'A', hipPairs: [1, 2] },
        { code: 'And', name: 'B', hipPairs: [3, 4] },
      ]),
    ).toThrow(/Duplicate/);
  });

  it('throws on odd-length hipPairs', () => {
    expect(() => buildPack([{ code: 'And', name: 'A', hipPairs: [1, 2, 3] }])).toThrow(/odd length/);
  });
});

describe('attribution', () => {
  it('passes when the Stellarium CC BY-SA 4.0 credit is present in ATTRIBUTIONS.md', () => {
    expect(() => assertAttribution(ATTRIBUTIONS)).not.toThrow();
  });

  it('throws when the credit is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cosmos-attr-'));
    const path = join(dir, 'ATTRIBUTIONS.md');
    writeFileSync(path, '# nothing here\n');
    expect(() => assertAttribution(path)).toThrow(/Stellarium/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('committed pack', () => {
  let builtPack: ReturnType<typeof buildPack>;

  beforeAll(() => {
    const sourceText = readFileSync(SOURCE, 'utf-8');
    builtPack = buildPack(parseSource(sourceText));
  });

  it('validates as a ConstellationPack', () => {
    expect(ConstellationPackSchema.safeParse(builtPack).success).toBe(true);
  });

  it('has 88 IAU constellations, each with a unique 3-letter code', () => {
    expect(builtPack.constellations).toHaveLength(88);
    const codes = new Set(builtPack.constellations.map((c) => c.code));
    expect(codes.size).toBe(88);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Za-z]{3}$/);
    }
  });

  it('every hipPairs array has even length and only positive integers', () => {
    for (const c of builtPack.constellations) {
      expect(c.hipPairs.length % 2).toBe(0);
      for (const hip of c.hipPairs) {
        expect(Number.isInteger(hip)).toBe(true);
        expect(hip).toBeGreaterThan(0);
      }
    }
  });

  it('includes Orion (Ori) with the Betelgeuse↔Bellatrix segment (HIP 27989↔25336)', () => {
    const ori = builtPack.constellations.find((c) => c.code === 'Ori');
    expect(ori).toBeDefined();
    expect(ori!.name.toLowerCase()).toBe('orion');
    let hasSegment = false;
    for (let i = 0; i < ori!.hipPairs.length; i += 2) {
      const a = ori!.hipPairs[i];
      const b = ori!.hipPairs[i + 1];
      if ((a === 27989 && b === 25336) || (a === 25336 && b === 27989)) hasSegment = true;
    }
    expect(hasSegment).toBe(true);
  });

  it('rebuilds byte-identically and matches the committed pack + golden hash (reproducible)', () => {
    const expected = JSON.stringify(builtPack, null, 2) + '\n';
    const committed = readFileSync(COMMITTED_PACK, 'utf-8');
    expect(expected).toBe(committed);

    const golden = JSON.parse(readFileSync(GOLDEN, 'utf-8'));
    const hash = createHash('sha256').update(readFileSync(COMMITTED_PACK)).digest('hex');
    expect(hash).toBe(golden.constellationsJsonSha256);
  });

  it('is small (within the 128 KB pack budget)', () => {
    const bytes = readFileSync(COMMITTED_PACK).byteLength;
    expect(bytes).toBeLessThanOrEqual(128 * 1024);
  });
});
