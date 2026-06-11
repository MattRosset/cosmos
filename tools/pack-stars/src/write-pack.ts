import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StarPackManifest } from '@cosmos/core-types';
import { STAR_PACK_FORMAT_VERSION } from '@cosmos/core-types';
import type { StarRecord } from './convert';

export interface PackResult {
  readonly binFilename: string;
  readonly count: number;
  readonly contentHashSha256: string;
}

export function writePack(stars: StarRecord[], outDir: string): PackResult {
  const N = stars.length;

  // Slice byte lengths (all f32/u32 → 4 bytes each, naturally 4-byte aligned)
  const positionsByteLen = N * 3 * 4; // f32 × 3N
  const absMagByteLen = N * 4; // f32 × N
  const colorIndexBVByteLen = N * 4; // f32 × N
  const catalogIdsByteLen = N * 4; // u32 × N
  const hipIdsByteLen = N * 4; // u32 × N

  const posOff = 0;
  const absMagOff = posOff + positionsByteLen;
  const ciOff = absMagOff + absMagByteLen;
  const catOff = ciOff + colorIndexBVByteLen;
  const hipOff = catOff + catalogIdsByteLen;
  const totalBytes = hipOff + hipIdsByteLen;

  const buf = new ArrayBuffer(totalBytes);
  const positions = new Float32Array(buf, posOff, N * 3);
  const absMags = new Float32Array(buf, absMagOff, N);
  const colorIndices = new Float32Array(buf, ciOff, N);
  const catalogIds = new Uint32Array(buf, catOff, N);
  const hipIds = new Uint32Array(buf, hipOff, N);

  for (let i = 0; i < N; i++) {
    const s = stars[i]!;
    positions[i * 3] = s.positionPc[0];
    positions[i * 3 + 1] = s.positionPc[1];
    positions[i * 3 + 2] = s.positionPc[2];
    absMags[i] = s.absMag;
    colorIndices[i] = s.colorIndexBV;
    catalogIds[i] = s.id;
    hipIds[i] = s.hipId;
  }

  const binData = Buffer.from(buf);
  const hash = createHash('sha256').update(binData).digest('hex');
  const hash8 = hash.slice(0, 8);
  const binFilename = `stars.${hash8}.bin`;

  const names: Record<string, string> = {};
  for (const s of stars) {
    if (s.name !== undefined) names[String(s.id)] = s.name;
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, binFilename), binData);
  writeFileSync(join(outDir, 'names.json'), JSON.stringify(names, null, 2) + '\n');

  const manifest: StarPackManifest = {
    packFormatVersion: STAR_PACK_FORMAT_VERSION,
    source: 'hyg-v41',
    contentHashSha256: hash,
    count: N,
    binUrl: binFilename,
    namesUrl: 'names.json',
    originPc: [0, 0, 0],
    buffers: {
      positionsPc: { byteOffset: posOff, byteLength: positionsByteLen },
      absMag: { byteOffset: absMagOff, byteLength: absMagByteLen },
      colorIndexBV: { byteOffset: ciOff, byteLength: colorIndexBVByteLen },
      catalogIds: { byteOffset: catOff, byteLength: catalogIdsByteLen },
      hipIds: { byteOffset: hipOff, byteLength: hipIdsByteLen },
    },
  };

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  return { binFilename, count: N, contentHashSha256: hash };
}
