import type { BodyId, BodyRecord, StarSystemRecord, SystemsPackManifest } from '@cosmos/core-types';
import { SYSTEMS_PACK_FORMAT_VERSION } from '@cosmos/core-types';
import type { LoadOptions } from './load.js';

export class SystemsPackFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SystemsPackFormatError';
  }
}

export interface SystemsSource {
  readonly systems: readonly StarSystemRecord[];
  getSystem(systemId: BodyId): StarSystemRecord | undefined;
  /** Host stars (by star id) AND planets/moons (by body id). */
  getBody(id: BodyId): BodyRecord | undefined;
  /** The system a body (host star or planet) belongs to. */
  systemOfBody(id: BodyId): StarSystemRecord | undefined;
}

/** Fetch + validate. Rejects wrong packFormatVersion or eccentricity >= 1. */
export async function loadSystemsPack(
  manifestUrl: string,
  opts?: LoadOptions,
): Promise<SystemsSource> {
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;
  const res = await fetchImpl(manifestUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch systems manifest: ${res.status} ${res.statusText}`);
  }
  const manifest = (await res.json()) as SystemsPackManifest;

  if (manifest.packFormatVersion !== SYSTEMS_PACK_FORMAT_VERSION) {
    throw new SystemsPackFormatError(
      `Unsupported packFormatVersion ${String(manifest.packFormatVersion)}; expected ${String(SYSTEMS_PACK_FORMAT_VERSION)}`,
    );
  }

  for (const system of manifest.systems) {
    for (const body of system.bodies) {
      if (body.elements !== undefined && body.elements.eccentricity >= 1) {
        throw new SystemsPackFormatError(
          `Body "${body.id}" has eccentricity ${String(body.elements.eccentricity)} ≥ 1 (not a bound orbit)`,
        );
      }
    }
  }

  return new SystemsSourceImpl(manifest.systems);
}

class SystemsSourceImpl implements SystemsSource {
  readonly systems: readonly StarSystemRecord[];
  private readonly _systemById: Map<BodyId, StarSystemRecord>;
  private readonly _bodyToSystem: Map<BodyId, StarSystemRecord>;

  constructor(systems: readonly StarSystemRecord[]) {
    this.systems = systems;
    this._systemById = new Map();
    this._bodyToSystem = new Map();
    for (const system of systems) {
      this._systemById.set(system.id, system);
      this._bodyToSystem.set(system.star.id, system);
      for (const body of system.bodies) {
        this._bodyToSystem.set(body.id, system);
      }
    }
  }

  getSystem(systemId: BodyId): StarSystemRecord | undefined {
    return this._systemById.get(systemId);
  }

  getBody(id: BodyId): BodyRecord | undefined {
    const system = this._bodyToSystem.get(id);
    if (system === undefined) return undefined;
    if (system.star.id === id) return system.star;
    for (const body of system.bodies) {
      if (body.id === id) return body;
    }
    return undefined;
  }

  systemOfBody(id: BodyId): StarSystemRecord | undefined {
    return this._bodyToSystem.get(id);
  }
}
