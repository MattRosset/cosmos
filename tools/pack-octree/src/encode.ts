import { createHash } from 'node:crypto';
import type { OctreeTileBuffers } from '@cosmos/core-types';
import type { StarData } from './build';

export interface TileEncodeResult {
  readonly bin: Buffer;
  readonly buffers: OctreeTileBuffers;
  readonly contentHashSha256: string;
}

/**
 * Pack a subset of stars into a tile .bin.
 * Positions are stored relative to `center` (ADR-003 §3).
 * Layout: positionsPc | absMag | colorIndexBV | catalogIds | hipIds
 * All f32/u32 = 4 bytes each → naturally 4-byte aligned.
 */
export function encodeTile(
  stars: StarData[],
  indices: readonly number[],
  center: readonly [number, number, number],
): TileEncodeResult {
  const N = indices.length;

  const posByteLen = N * 3 * 4;
  const absMagByteLen = N * 4;
  const colorBVByteLen = N * 4;
  const catIdsByteLen = N * 4;
  const hipIdsByteLen = N * 4;

  const posOff = 0;
  const absMagOff = posOff + posByteLen;
  const colorBVOff = absMagOff + absMagByteLen;
  const catIdsOff = colorBVOff + colorBVByteLen;
  const hipIdsOff = catIdsOff + catIdsByteLen;
  const totalBytes = hipIdsOff + hipIdsByteLen;

  const buf = new ArrayBuffer(totalBytes);
  const positions = new Float32Array(buf, posOff, N * 3);
  const absMags = new Float32Array(buf, absMagOff, N);
  const colorBVs = new Float32Array(buf, colorBVOff, N);
  const catIds = new Uint32Array(buf, catIdsOff, N);
  const hipIds = new Uint32Array(buf, hipIdsOff, N);

  for (let i = 0; i < N; i++) {
    const s = stars[indices[i]!]!;
    positions[i * 3] = s.x - center[0];
    positions[i * 3 + 1] = s.y - center[1];
    positions[i * 3 + 2] = s.z - center[2];
    absMags[i] = s.absMag;
    colorBVs[i] = s.colorIndexBV;
    catIds[i] = s.catalogId;
    hipIds[i] = s.hipId;
  }

  const bin = Buffer.from(buf);
  const contentHashSha256 = createHash('sha256').update(bin).digest('hex');

  return {
    bin,
    contentHashSha256,
    buffers: {
      positionsPc: { byteOffset: posOff, byteLength: posByteLen },
      absMag: { byteOffset: absMagOff, byteLength: absMagByteLen },
      colorIndexBV: { byteOffset: colorBVOff, byteLength: colorBVByteLen },
      catalogIds: { byteOffset: catIdsOff, byteLength: catIdsByteLen },
      hipIds: { byteOffset: hipIdsOff, byteLength: hipIdsByteLen },
    },
  };
}
