import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import {
  CONTEXT_UNIT_METERS,
  ECLIPTIC_TO_GALACTIC,
  applyMat3,
  type BodyId,
  type StarSystemRecord,
  type UniversePosition,
} from '@cosmos/core-types';
import type { OriginManager } from '@cosmos/coords';
import type { FlightController } from '@cosmos/nav';
import { packElements, propagateBatch, orbitPolylineAu } from '@cosmos/orbits';
import {
  createPlanetMesh,
  createOrbitLine,
  createAtmosphere,
  type PlanetMesh,
  type OrbitLine,
  type Atmosphere,
} from '@cosmos/render-planets';
import { PRIORITY_RENDER, useFrameContext, useQuality } from '@cosmos/scene-host';
import { useSettingsStore } from '@cosmos/app-state';
import { systemFeed, systemPickGroup, deactivateSystemFeed } from '../glue/system-feed';
import { atmosphereHolder } from '../glue/test-hook';

const AU_METERS = CONTEXT_UNIT_METERS.system;
const J2000_EPOCH_JD = 2451545.0;
const TWO_PI = Math.PI * 2;
const ORBIT_SEGMENTS = 256;
/** The one body that carries an atmosphere shell for M4a (ADR-005 §5: one atmosphere). */
const ATMOSPHERE_BODY_ID: BodyId = 'sol:earth';

/** System origin (host star) — constant UniversePosition for the render offset. */
const SYSTEM_ORIGIN: UniversePosition = { context: 'system', local: [0, 0, 0] };

// ── Module-scoped scratch — zero allocations inside the frame callback (§9) ──
const ownGalScratch: [number, number, number] = [0, 0, 0];
const renderScratch: [number, number, number] = [0, 0, 0];
const parentRenderScratch: [number, number, number] = [0, 0, 0];
const starDirScratch: [number, number, number] = [0, 0, 0];
const originRenderScratch: [number, number, number] = [0, 0, 0];
const systemLocalScratch: [number, number, number] = [0, 0, 0];
const systemPosScratch: UniversePosition = { context: 'system', local: systemLocalScratch };
const atmOffScratch: [number, number, number] = [0, 0, 0];
const atmStarDirScratch: [number, number, number] = [0, 0, 0];

interface BodyEntry {
  readonly bodyId: BodyId;
  readonly mesh: PlanetMesh;
  readonly line: OrbitLine | null;
  readonly isMoon: boolean;
  /** Index (into `entries`) of a moon's parent planet; -1 for direct bodies. */
  readonly parentIndex: number;
  readonly hasSpin: boolean;
  readonly rotationPeriodH: number;
}

interface BuiltScene {
  readonly entries: readonly BodyEntry[];
  /** Packed elements for the first `elemCount` entries (planets then moons). */
  readonly packed: Float64Array;
  /** propagateBatch output: 3 × elemCount, AU, parent frame, ecliptic axes. */
  readonly outAu: Float64Array;
  /** Absolute system positions (AU, galactic axes): 3 × entries.length. */
  readonly absAu: Float64Array;
  /** Camera-relative render offsets (system units): 3 × entries.length. */
  readonly renderOffAu: Float64Array;
  /** Count of entries carrying Keplerian elements (the propagated prefix). */
  readonly elemCount: number;
  /** Index of the atmosphere body (Earth) in `entries`, or -1 if absent. */
  readonly atmosphereIndex: number;
  /** Atmosphere body surface radius in system units (AU), for the shell scale. */
  readonly atmosphereRadiusUnits: number;
}

interface SystemSceneProps {
  readonly system: StarSystemRecord;
  readonly origin: OriginManager;
  /** Manifest URL of the pack this system came from (texture base, §11). */
  readonly packUrl: string;
  readonly controllerRef: RefObject<FlightController | null>;
}

/** Load one KTX2 texture, tag its color space; null (with a warning) on failure. */
async function loadTexture(
  loader: KTX2Loader,
  url: string,
  colorSpace: THREE.ColorSpace,
): Promise<THREE.Texture | null> {
  try {
    const tex = await loader.loadAsync(url);
    tex.colorSpace = colorSpace;
    return tex;
  } catch (err) {
    console.warn(`[cosmos] texture load failed: ${url}`, err);
    return null;
  }
}

/**
 * Mounts the anchored system: textured planet meshes, day/night terminator,
 * orbit lines, and per-frame Keplerian propagation. Mounted on the React tree
 * only while `contextId === 'system'`; positions/spins flow imperatively (§2.2).
 */
export function SystemScene({ system, origin, packUrl, controllerRef }: SystemSceneProps) {
  void controllerRef; // picking is handled by StarScene against systemPickGroup
  const gl = useThree((s) => s.gl);
  const rootGroup = useMemo(() => new THREE.Group(), []);
  const builtRef = useMemo(() => ({ current: null as BuiltScene | null }), []);

  // ADR-005 §5 atmosphere quality gate: the shell is MOUNTED only at the 'high' tier
  // (atmosphereEnabled), absent at medium/low. useQuality re-renders on tier change.
  const atmosphereEnabled = useQuality().atmosphereEnabled;
  // Bumped when the async build completes so the atmosphere effect (which reads the
  // imperatively-built scene) re-runs once entries exist.
  const [builtVersion, setBuiltVersion] = useState(0);
  const atmRef = useRef<Atmosphere | null>(null);

  // Exposure relay for the additive atmosphere shell (transient — no Canvas re-render).
  const exposureRef = useRef(useSettingsStore.getState().exposure);
  useEffect(() => {
    const apply = (e: number): void => {
      exposureRef.current = e;
    };
    apply(useSettingsStore.getState().exposure);
    return useSettingsStore.subscribe((s) => apply(s.exposure));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loader = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(gl);
    const ownedTextures: THREE.Texture[] = [];
    let built: BuiltScene | null = null;

    const disposeBuilt = (): void => {
      if (built) {
        for (const e of built.entries) {
          e.mesh.dispose();
          e.line?.dispose();
        }
      }
      for (const t of ownedTextures) t.dispose();
      rootGroup.clear();
      loader.dispose();
      deactivateSystemFeed();
      systemPickGroup.current = null;
      builtRef.current = null;
    };

    void (async () => {
      // Load textures per body (albedo sRGB; ring strip sRGB). Failures → null.
      const texByBody = new Map<BodyId, { albedo: THREE.Texture | null; ring: THREE.Texture | null }>();
      await Promise.all(
        system.bodies.map(async (body) => {
          const albedoUrl = body.textures?.albedoUrl;
          const ringUrl = body.textures?.ringUrl;
          const albedo = albedoUrl
            ? await loadTexture(loader, new URL(albedoUrl, new URL(packUrl, location.href)).href, THREE.SRGBColorSpace)
            : null;
          const ring = ringUrl
            ? await loadTexture(loader, new URL(ringUrl, new URL(packUrl, location.href)).href, THREE.SRGBColorSpace)
            : null;
          if (albedo) ownedTextures.push(albedo);
          if (ring) ownedTextures.push(ring);
          texByBody.set(body.id, { albedo, ring });
        }),
      );
      if (cancelled) {
        for (const t of ownedTextures) t.dispose();
        loader.dispose();
        return;
      }

      // Order: direct planets WITH elements, then moons WITH elements, then the
      // remaining (no-element) bodies — e.g. the unlit Sol disc at the origin.
      const hostId = system.star.id;
      const planetsWithElems = system.bodies.filter((b) => b.parentId === hostId && b.elements);
      const moonsWithElems = system.bodies.filter((b) => b.parentId !== hostId && b.elements);
      const noElem = system.bodies.filter((b) => !b.elements);
      const ordered = [...planetsWithElems, ...moonsWithElems, ...noElem];
      const elemCount = planetsWithElems.length + moonsWithElems.length;

      const indexOf = new Map<BodyId, number>();
      ordered.forEach((b, i) => indexOf.set(b.id, i));

      const polyScratch: [number, number, number] = [0, 0, 0];
      const entries: BodyEntry[] = ordered.map((body) => {
        const tex = texByBody.get(body.id);
        const mesh = createPlanetMesh({
          record: body,
          contextUnitMeters: AU_METERS,
          albedoTexture: tex?.albedo ?? null,
          ringTexture: tex?.ring ?? null,
        });
        // The host-star disc (unlit, element-less, parented to the host) is a
        // `kind:"planet"` body for rendering only — it IS the star. Make a click
        // select the host StarRecord so the InfoPanel shows stellar info, not
        // "Planet" (NAV-B). Applies to Sol's sun and every exoplanet host disc.
        const isHostStarDisc =
          body.parentId === hostId && body.elements === undefined && body.unlit === true;
        mesh.object.userData.bodyId = isHostStarDisc ? hostId : body.id;
        rootGroup.add(mesh.object);

        let line: OrbitLine | null = null;
        if (body.elements) {
          const poly = orbitPolylineAu(body.elements, ORBIT_SEGMENTS);
          for (let k = 0; k < poly.length; k += 3) {
            applyMat3(ECLIPTIC_TO_GALACTIC, poly[k]!, poly[k + 1]!, poly[k + 2]!, polyScratch);
            poly[k] = polyScratch[0];
            poly[k + 1] = polyScratch[1];
            poly[k + 2] = polyScratch[2];
          }
          line = createOrbitLine({ pointsUnits: poly });
          rootGroup.add(line.object);
        }

        const isMoon = body.parentId !== hostId;
        return {
          bodyId: body.id,
          mesh,
          line,
          isMoon,
          parentIndex: isMoon ? indexOf.get(body.parentId) ?? -1 : -1,
          hasSpin: body.rotationPeriodH !== undefined && body.rotationPeriodH !== 0,
          rotationPeriodH: body.rotationPeriodH ?? 1,
        };
      });

      const packed = packElements(ordered.slice(0, elemCount).map((b) => b.elements!));
      const atmosphereIndex = ordered.findIndex((b) => b.id === ATMOSPHERE_BODY_ID);
      const atmosphereRadiusUnits =
        atmosphereIndex >= 0 ? (ordered[atmosphereIndex]!.radiusKm * 1000) / AU_METERS : 0;
      built = {
        entries,
        packed,
        outAu: new Float64Array(elemCount * 3),
        absAu: new Float64Array(ordered.length * 3),
        renderOffAu: new Float64Array(ordered.length * 3),
        elemCount,
        atmosphereIndex,
        atmosphereRadiusUnits,
      };

      // Publish the shared feed (NavDriver surface speed + goto live positions).
      systemFeed.positionsAu = new Float64Array(ordered.length * 3);
      systemFeed.radiiUnits = new Float64Array(ordered.length);
      const indexById = new Map<BodyId, number>();
      ordered.forEach((b, i) => {
        indexById.set(b.id, i);
        systemFeed.radiiUnits[i] = (b.radiusKm * 1000) / AU_METERS;
      });
      systemFeed.indexById = indexById;
      systemFeed.count = ordered.length;
      systemFeed.active = true;
      systemPickGroup.current = rootGroup;
      builtRef.current = built;
      if (!cancelled) setBuiltVersion((v) => v + 1);
    })();

    return () => {
      cancelled = true;
      disposeBuilt();
    };
  }, [system, origin, gl, packUrl, rootGroup, builtRef]);

  // Atmosphere mount/unmount (ADR-005 §5): created only when the built scene has the
  // atmosphere body AND the tier enables it; disposed (truly absent) otherwise. The
  // §10 transparent band is respected — the additive shell renders after the opaque
  // planet (depthWrite:false). `atmosphereHolder` mirrors mount state to the test hook.
  useEffect(() => {
    const b = builtRef.current;
    if (b === null || b.atmosphereIndex < 0 || !atmosphereEnabled) {
      atmosphereHolder.current = false;
      return;
    }
    const atm = createAtmosphere({ planetRadiusUnits: b.atmosphereRadiusUnits });
    rootGroup.add(atm.object);
    atmRef.current = atm;
    atmosphereHolder.current = true;
    return () => {
      rootGroup.remove(atm.object);
      atm.dispose();
      atmRef.current = null;
      atmosphereHolder.current = false;
    };
  }, [atmosphereEnabled, builtVersion, rootGroup, builtRef]);

  useFrameContext((ctx) => {
    const b = builtRef.current;
    if (b === null) return;
    const epoch = ctx.epochJD;

    propagateBatch(b.packed, epoch, b.outAu);
    origin.toRenderSpace(SYSTEM_ORIGIN, originRenderScratch);

    for (let i = 0; i < b.entries.length; i++) {
      const e = b.entries[i]!;
      let ax = 0;
      let ay = 0;
      let az = 0;
      if (i < b.elemCount) {
        // Own AU vector (parent frame, ecliptic) → galactic axes.
        applyMat3(
          ECLIPTIC_TO_GALACTIC,
          b.outAu[i * 3]!,
          b.outAu[i * 3 + 1]!,
          b.outAu[i * 3 + 2]!,
          ownGalScratch,
        );
        ax = ownGalScratch[0];
        ay = ownGalScratch[1];
        az = ownGalScratch[2];
        if (e.isMoon && e.parentIndex >= 0) {
          ax += b.absAu[e.parentIndex * 3]!;
          ay += b.absAu[e.parentIndex * 3 + 1]!;
          az += b.absAu[e.parentIndex * 3 + 2]!;
        }
      }
      b.absAu[i * 3] = ax;
      b.absAu[i * 3 + 1] = ay;
      b.absAu[i * 3 + 2] = az;
      systemFeed.positionsAu[i * 3] = ax;
      systemFeed.positionsAu[i * 3 + 1] = ay;
      systemFeed.positionsAu[i * 3 + 2] = az;

      // Camera-relative render offset for the body.
      systemLocalScratch[0] = ax;
      systemLocalScratch[1] = ay;
      systemLocalScratch[2] = az;
      origin.toRenderSpace(systemPosScratch, renderScratch);
      b.renderOffAu[i * 3] = renderScratch[0];
      b.renderOffAu[i * 3 + 1] = renderScratch[1];
      b.renderOffAu[i * 3 + 2] = renderScratch[2];
      e.mesh.setRenderOffset(renderScratch);

      // Star direction = −normalize(absolute) (host at origin).
      const len = Math.hypot(ax, ay, az) || 1;
      starDirScratch[0] = -ax / len;
      starDirScratch[1] = -ay / len;
      starDirScratch[2] = -az / len;
      e.mesh.setStarDirection(starDirScratch);

      if (e.hasSpin) {
        const rotations = ((epoch - J2000_EPOCH_JD) * 24) / e.rotationPeriodH;
        e.mesh.setSpinAngleRad((rotations - Math.floor(rotations)) * TWO_PI);
      }

      if (e.line) {
        if (e.isMoon && e.parentIndex >= 0) {
          parentRenderScratch[0] = b.renderOffAu[e.parentIndex * 3]!;
          parentRenderScratch[1] = b.renderOffAu[e.parentIndex * 3 + 1]!;
          parentRenderScratch[2] = b.renderOffAu[e.parentIndex * 3 + 2]!;
          e.line.setRenderOffset(parentRenderScratch);
        } else {
          e.line.setRenderOffset(originRenderScratch);
        }
      }
    }

    // Atmosphere shell follows the Earth mesh: same camera-relative offset + star
    // direction, additive over the lit planet (ADR-005 §5). Zero-alloc per frame.
    const atm = atmRef.current;
    if (atm !== null && b.atmosphereIndex >= 0) {
      const ai = b.atmosphereIndex;
      atmOffScratch[0] = b.renderOffAu[ai * 3]!;
      atmOffScratch[1] = b.renderOffAu[ai * 3 + 1]!;
      atmOffScratch[2] = b.renderOffAu[ai * 3 + 2]!;
      atm.setRenderOffset(atmOffScratch);
      const ex = b.absAu[ai * 3]!;
      const ey = b.absAu[ai * 3 + 1]!;
      const ez = b.absAu[ai * 3 + 2]!;
      const elen = Math.hypot(ex, ey, ez) || 1;
      atmStarDirScratch[0] = -ex / elen;
      atmStarDirScratch[1] = -ey / elen;
      atmStarDirScratch[2] = -ez / elen;
      atm.setStarDirection(atmStarDirScratch);
      atm.setExposure(exposureRef.current);
      atm.setOpacity(1);
    }
  }, PRIORITY_RENDER);

  return <primitive object={rootGroup} />;
}
