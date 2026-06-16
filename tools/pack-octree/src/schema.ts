import { z } from 'zod';
import { OCTREE_FORMAT_VERSION, MAX_TILE_BYTES } from '@cosmos/core-types';

const BufferSliceSchema = z.object({
  byteOffset: z.number().int().nonnegative(),
  byteLength: z.number().int().nonnegative(),
});

const OctreeTileBuffersSchema = z.object({
  positionsPc: BufferSliceSchema,
  absMag: BufferSliceSchema,
  colorIndexBV: BufferSliceSchema,
  catalogIds: BufferSliceSchema,
  hipIds: BufferSliceSchema,
});

export const OctreeTileManifestSchema = z
  .object({
    key: z.string().regex(/^\d+\/\d+$/),
    isLeaf: z.boolean(),
    childMask: z.number().int().min(0).max(255),
    pointCount: z.number().int().nonnegative(),
    centerUnits: z.tuple([z.number(), z.number(), z.number()]),
    halfExtentUnits: z.number().positive(),
    binUrl: z.string(),
    contentHashSha256: z.string().regex(/^[0-9a-f]{64}$/),
    buffers: OctreeTileBuffersSchema,
  })
  .superRefine((tile, ctx) => {
    if (tile.isLeaf && tile.childMask !== 0) {
      ctx.addIssue({ code: 'custom', message: 'leaf tile must have childMask === 0' });
    }
    if (!tile.isLeaf && tile.childMask === 0) {
      ctx.addIssue({ code: 'custom', message: 'internal tile must have childMask !== 0' });
    }
    const totalBytes =
      tile.buffers.positionsPc.byteLength +
      tile.buffers.absMag.byteLength +
      tile.buffers.colorIndexBV.byteLength +
      tile.buffers.catalogIds.byteLength +
      tile.buffers.hipIds.byteLength;
    if (totalBytes > MAX_TILE_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: `tile .bin exceeds MAX_TILE_BYTES: ${totalBytes} > ${MAX_TILE_BYTES}`,
      });
    }
  });

export const OctreeManifestSchema = z.object({
  octreeFormatVersion: z.literal(OCTREE_FORMAT_VERSION),
  source: z.string(),
  context: z.enum(['universe', 'galaxy', 'system', 'planet']),
  rootHalfExtentUnits: z.number().positive(),
  idPrefix: z.string(),
  tiles: z.array(OctreeTileManifestSchema),
});
