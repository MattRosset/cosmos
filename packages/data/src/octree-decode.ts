import type { OctreeTileManifest, StarBatch, OctreeDecodeRequest } from '@cosmos/core-types';

export function decodeTile(
  bin: ArrayBuffer,
  tile: OctreeTileManifest,
  idPrefix: string,
): { batch: StarBatch; buffer: ArrayBuffer } {
  const N = tile.pointCount;
  const { positionsPc, absMag, colorIndexBV, catalogIds, hipIds } = tile.buffers;

  const batch: StarBatch = {
    count: N,
    originPc: tile.centerUnits,
    positionsPc: new Float32Array(bin, positionsPc.byteOffset, positionsPc.byteLength / 4),
    absMag: new Float32Array(bin, absMag.byteOffset, absMag.byteLength / 4),
    colorIndexBV: new Float32Array(bin, colorIndexBV.byteOffset, colorIndexBV.byteLength / 4),
    catalogIds: new Uint32Array(bin, catalogIds.byteOffset, catalogIds.byteLength / 4),
    hipIds: new Uint32Array(bin, hipIds.byteOffset, hipIds.byteLength / 4),
    idPrefix,
  };

  return { batch, buffer: bin };
}

export function octreeDecodeHandler(
  req: OctreeDecodeRequest,
): { readonly batch: StarBatch; readonly transfer: readonly ArrayBuffer[] } {
  const { batch, buffer } = decodeTile(req.bin, req.tile, req.idPrefix);
  return { batch, transfer: [buffer] };
}
