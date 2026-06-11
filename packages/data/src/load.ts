import type { StarPackManifest } from '@cosmos/core-types';
import { STAR_PACK_FORMAT_VERSION } from '@cosmos/core-types';
import type { StarBatch } from '@cosmos/core-types';
import { StarDataSourceImpl, type StarDataSource } from './source.js';

export type { StarDataSource } from './source.js';
export type { Vec3Pc } from './source.js';

export class PackFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackFormatError';
  }
}

export interface LoadOptions {
  readonly fetchImpl?: typeof fetch;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function resolveRelativeUrl(base: string, relative: string): string {
  // If base looks like a real URL, use URL resolution; otherwise treat as path.
  try {
    return new URL(relative, base).href;
  } catch {
    // Fall back for non-standard base strings (e.g. bare paths in tests)
    const lastSlash = base.lastIndexOf('/');
    return lastSlash >= 0 ? base.slice(0, lastSlash + 1) + relative : relative;
  }
}

export async function loadStarPack(
  manifestUrl: string,
  opts?: LoadOptions,
): Promise<StarDataSource> {
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;

  const manifestRes = await fetchImpl(manifestUrl);
  if (!manifestRes.ok) {
    throw new Error(`Failed to fetch manifest: ${manifestRes.status} ${manifestRes.statusText}`);
  }
  const manifest = (await manifestRes.json()) as StarPackManifest;

  if (manifest.packFormatVersion !== STAR_PACK_FORMAT_VERSION) {
    throw new PackFormatError(
      `Unsupported packFormatVersion ${String(manifest.packFormatVersion)}; expected ${String(STAR_PACK_FORMAT_VERSION)}`,
    );
  }

  const binUrl = resolveRelativeUrl(manifestUrl, manifest.binUrl);
  const namesUrl = resolveRelativeUrl(manifestUrl, manifest.namesUrl);

  const [binRes, namesRes] = await Promise.all([fetchImpl(binUrl), fetchImpl(namesUrl)]);

  if (!binRes.ok) {
    throw new Error(`Failed to fetch bin: ${binRes.status} ${binRes.statusText}`);
  }
  if (!namesRes.ok) {
    throw new Error(`Failed to fetch names: ${namesRes.status} ${namesRes.statusText}`);
  }

  const [binBuffer, names] = await Promise.all([
    binRes.arrayBuffer(),
    namesRes.json() as Promise<Record<string, string>>,
  ]);

  // Validate each slice is contained within the bin
  const binByteLength = binBuffer.byteLength;
  for (const [key, slice] of Object.entries(manifest.buffers)) {
    const end = slice.byteOffset + slice.byteLength;
    if (slice.byteOffset < 0 || end > binByteLength) {
      throw new PackFormatError(
        `Buffer slice '${key}' [${String(slice.byteOffset)}, ${String(end)}) is out of bounds (bin is ${String(binByteLength)} bytes)`,
      );
    }
  }

  // Validate SHA-256
  const actualHash = await sha256Hex(binBuffer);
  if (actualHash !== manifest.contentHashSha256) {
    throw new PackFormatError(
      `SHA-256 mismatch: expected ${manifest.contentHashSha256}, got ${actualHash}`,
    );
  }

  const { positionsPc, absMag, colorIndexBV, catalogIds, hipIds } = manifest.buffers;

  const batch: StarBatch = {
    count: manifest.count,
    originPc: manifest.originPc,
    positionsPc: new Float32Array(binBuffer, positionsPc.byteOffset, positionsPc.byteLength / 4),
    absMag: new Float32Array(binBuffer, absMag.byteOffset, absMag.byteLength / 4),
    colorIndexBV: new Float32Array(binBuffer, colorIndexBV.byteOffset, colorIndexBV.byteLength / 4),
    catalogIds: new Uint32Array(binBuffer, catalogIds.byteOffset, catalogIds.byteLength / 4),
    hipIds: new Uint32Array(binBuffer, hipIds.byteOffset, hipIds.byteLength / 4),
    idPrefix: 'hyg',
  };

  return new StarDataSourceImpl(batch, names);
}
