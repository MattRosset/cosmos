import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import type { StarPackManifest } from '@cosmos/core-types';
import { STAR_PACK_FORMAT_VERSION } from '@cosmos/core-types';
import { processRow } from '../src/convert';
import { writePack } from '../src/write-pack';

const FIXTURE = fileURLToPath(new URL('./fixtures/hyg-mini.csv', import.meta.url));

// CSV dist for each kept star id, used to verify |positionPc| ≈ dist
const CSV_DIST: Record<number, number> = {
  0: 0.000004848,
  2: 2.6371,
  3238: 7.676,
  2425: 1.321,
  5: 10.0,
  7: 135.685,
  8: 8.5,
};

function loadFixture() {
  const csv = readFileSync(FIXTURE, 'utf8');
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: false,
  }) as Record<string, string>[];
  const stars = [];
  for (const row of rows) {
    const s = processRow(row);
    if (s !== null) stars.push(s);
  }
  stars.sort((a, b) => a.id - b.id);
  return stars;
}

function mag(v: readonly [number, number, number]) {
  return Math.hypot(v[0], v[1], v[2]);
}

describe('processRow — drop rules', () => {
  it('drops the dist=100000 row silently', () => {
    expect(loadFixture()).toHaveLength(7);
  });

  it('no kept star has id=6 (the placeholder-distance row)', () => {
    expect(loadFixture().find(s => s.id === 6)).toBeUndefined();
  });
});

describe('processRow — galactic conversion', () => {
  it('Sirius galactic longitude ≈ 227.2° ± 0.3°', () => {
    const sirius = loadFixture().find(s => s.id === 2)!;
    const d = mag(sirius.positionPc);
    const lRad = Math.atan2(sirius.positionPc[1] / d, sirius.positionPc[0] / d);
    const lDeg = ((lRad * 180) / Math.PI + 360) % 360;
    expect(Math.abs(lDeg - 227.2)).toBeLessThan(0.3);
  });

  it('Sirius galactic latitude ≈ −8.9° ± 0.3°', () => {
    const sirius = loadFixture().find(s => s.id === 2)!;
    const d = mag(sirius.positionPc);
    const bDeg = (Math.asin(sirius.positionPc[2] / d) * 180) / Math.PI;
    expect(Math.abs(bDeg - -8.9)).toBeLessThan(0.3);
  });

  it('|positionPc| equals CSV dist within 1e-3 relative for every star', () => {
    for (const s of loadFixture()) {
      const expected = CSV_DIST[s.id]!;
      const rel = Math.abs(mag(s.positionPc) - expected) / expected;
      expect(rel).toBeLessThan(1e-3);
    }
  });

  it('Sirius distance ≈ 2.64 pc within 1%', () => {
    const s = loadFixture().find(s => s.id === 2)!;
    expect(Math.abs(mag(s.positionPc) - 2.64) / 2.64).toBeLessThan(0.01);
  });

  it('Vega distance ≈ 7.68 pc within 1%', () => {
    const s = loadFixture().find(s => s.id === 3238)!;
    expect(Math.abs(mag(s.positionPc) - 7.68) / 7.68).toBeLessThan(0.01);
  });

  it('Rigil Kentaurus distance ≈ 1.32 pc within 1%', () => {
    const s = loadFixture().find(s => s.id === 2425)!;
    expect(Math.abs(mag(s.positionPc) - 1.32) / 1.32).toBeLessThan(0.01);
  });
});

describe('processRow — names', () => {
  it('picks proper name first (Sirius)', () => {
    expect(loadFixture().find(s => s.id === 2)?.name).toBe('Sirius');
  });

  it('picks bf when proper is absent (id=7, "21 Tau")', () => {
    expect(loadFixture().find(s => s.id === 7)?.name).toBe('21 Tau');
  });

  it('picks gl when proper and bf are absent (id=8, "GJ 451")', () => {
    expect(loadFixture().find(s => s.id === 8)?.name).toBe('GJ 451');
  });

  it('returns undefined name for stars with no proper/bf/gl (id=5)', () => {
    expect(loadFixture().find(s => s.id === 5)?.name).toBeUndefined();
  });
});

describe('writePack — binary layout and manifest', () => {
  let _dir: string | undefined;
  function dir() {
    _dir ??= join(tmpdir(), `cosmos-pack-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    return _dir;
  }

  it('manifest validates StarPackManifest shape', () => {
    writePack(loadFixture(), dir());
    const m: StarPackManifest = JSON.parse(readFileSync(join(dir(), 'manifest.json'), 'utf8')) as StarPackManifest;
    expect(m.packFormatVersion).toBe(STAR_PACK_FORMAT_VERSION);
    expect(m.source).toBe('hyg-v41');
    expect(m.count).toBe(7);
    expect(m.originPc).toEqual([0, 0, 0]);
    expect(m.contentHashSha256).toHaveLength(64);
    expect(m.binUrl).toMatch(/^stars\.[0-9a-f]{8}\.bin$/);
    expect(m.namesUrl).toBe('names.json');
  });

  it('slice offsets and byte lengths match the spec layout (positionsPc→absMag→colorIndexBV→catalogIds→hipIds)', () => {
    writePack(loadFixture(), dir());
    const m: StarPackManifest = JSON.parse(readFileSync(join(dir(), 'manifest.json'), 'utf8')) as StarPackManifest;
    const N = m.count;

    expect(m.buffers.positionsPc).toEqual({ byteOffset: 0, byteLength: N * 3 * 4 });
    expect(m.buffers.absMag).toEqual({ byteOffset: N * 3 * 4, byteLength: N * 4 });
    expect(m.buffers.colorIndexBV).toEqual({ byteOffset: N * 3 * 4 + N * 4, byteLength: N * 4 });
    expect(m.buffers.catalogIds).toEqual({ byteOffset: N * 3 * 4 + N * 4 * 2, byteLength: N * 4 });
    expect(m.buffers.hipIds).toEqual({ byteOffset: N * 3 * 4 + N * 4 * 3, byteLength: N * 4 });
  });

  it('all slice byteOffsets are 4-byte aligned', () => {
    writePack(loadFixture(), dir());
    const m: StarPackManifest = JSON.parse(readFileSync(join(dir(), 'manifest.json'), 'utf8')) as StarPackManifest;
    for (const slice of Object.values(m.buffers)) {
      expect(slice.byteOffset % 4).toBe(0);
    }
  });

  it('names.json maps Sirius id to "Sirius" and omits the unnamed star', () => {
    writePack(loadFixture(), dir());
    const names: Record<string, string> = JSON.parse(readFileSync(join(dir(), 'names.json'), 'utf8')) as Record<string, string>;
    expect(names['2']).toBe('Sirius');
    expect(names['5']).toBeUndefined();
  });

  it('contentHashSha256 matches actual SHA-256 of the bin file', () => {
    const result = writePack(loadFixture(), dir());
    const binData = readFileSync(join(dir(), result.binFilename));
    expect(createHash('sha256').update(binData).digest('hex')).toBe(result.contentHashSha256);
  });

  it('determinism: two independent runs produce identical SHA-256', () => {
    const d1 = join(tmpdir(), `cosmos-det1-${Date.now()}`);
    const d2 = join(tmpdir(), `cosmos-det2-${Date.now()}`);
    const r1 = writePack(loadFixture(), d1);
    const r2 = writePack(loadFixture(), d2);
    expect(r1.contentHashSha256).toBe(r2.contentHashSha256);
  });
});
