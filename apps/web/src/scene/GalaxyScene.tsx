import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import type { ChunkKind, ContextId, StarBatch } from '@cosmos/core-types';
import type { OriginManager } from '@cosmos/coords';
import type { FlightController } from '@cosmos/nav';
import type { StreamingPolicy } from '@cosmos/streaming';
import { useSettingsStore } from '@cosmos/app-state';
import { createStarPoints, type StarPoints } from '@cosmos/render-stars';
import {
  createGalaxyPoints,
  createDustLanes,
  createGalaxyImpostor,
  type GalaxyPoints,
  type DustLanes,
  type GalaxyImpostor,
} from '@cosmos/render-galaxy';
import { PRIORITY_RENDER, PRIORITY_STREAMING, useFrameContext } from '@cosmos/scene-host';
import {
  createDustTexture,
  createHiiTexture,
  createImpostorTexture,
  buildDustLanes,
  buildHiiRegions,
} from '../glue/galaxy-assets';
import { milkyWayArmGeometry } from '../glue/milky-way-gen';
import { profileSpan } from '../glue/frame-profiler';
import { procgenOpacityHolder } from '../glue/test-hook';

/**
 * Galaxy / streaming render tier (TASK-040, §5.8/§5.9). Subscribes to the policy's
 * lifecycle registry and mounts ready batches: octree HYG tiles via render-stars
 * point machinery (they are real stars), the procedural Milky Way via render-galaxy
 * (particle cloud + dust lanes + far-LOD impostor). React owns only the rare
 * mount/unmount (event-driven state); per-frame offsets + cross-fade opacities flow
 * imperatively with zero allocations (§2.2, §9).
 *
 * ## Tier hand-off (composition decision, see TASK-040 notes)
 * The M2 star field + system scene are the galaxy/system representation and must
 * stay visually identical (m2 baselines). So this streaming tier renders only while
 * the camera is in the `universe` context, cross-fading to nothing across the
 * universe⇄galaxy boundary — by which point M2's always-mounted HYG field (which
 * grows continuously from a sub-pixel dot) owns the screen. No blank frame results
 * because that field is never absent. The policy still `update()`s every frame
 * (budgets/stats) regardless of this visual gate.
 *
 * M3 overlap debt (procgen + octree + M2 HYG near Sol) — Phase 4 unification plan:
 * docs/research/phase4-render-tier-handoff.md
 */

// Discrete-LOD blend window for the procgen Milky Way: at fine LOD (near, low
// level) the particle cloud is fully shown; at coarse LOD (far, high level) the
// impostor takes over. Cross-fade between, ~per §5.8.
const LOD_CLOUD_FULL = 2;
const LOD_IMPOSTOR_FULL = 6;

// Arm glow is a subtle hint only — the star cloud carries the spiral (Tier-1 trial).
const DUST_MAX_OPACITY = 0.1;
// HII star-forming knots along the arms (Tier-2).
const HII_MAX_OPACITY = 0.38;
const HII_GLOW_COLOR: readonly [number, number, number] = [1.0, 0.35, 0.72];

// The procgen cloud is rendered with magnitude-based per-star brightness, so at the
// galaxy "view" vantage (~50 kpc) the distance modulus (~18 mag) drives each star's
// brightness to ~1e-9 — mathematically invisible. The exposure uniform multiplies
// AFTER the magnitude term, so a large cloud-only boost (~10^distModulus·0.4) brings
// the additive cloud back to a bright spiral. Tuned for the ~50 kpc vantage; the
// layer fades out (layerFade→0) before the camera gets close enough to blow out.
const CLOUD_EXPOSURE_BOOST = 4e5;

// Galaxy catalog-field exposure boost. The global default exposure (25) is tuned for the
// bright HYG monolith near Sol; measured, it leaves ~98% of the Gaia octree field below the
// visibility threshold (only ~1.6% / 47k of the 3M pack perceptible) — see
// docs/research/gaia-visibility-and-realness-problem.md §3. The galaxy field is dominated by
// faint Gaia stars (90% are mag 10-14), so it needs a higher base sensitivity than the slider
// nominal. Verified live on the 3M pack: ×4 (effective ~100) reveals the stars but they sit at
// the dim floor (mag 8.5-10, brightness ~0.01) so the uplift is subtle; effective ~150-200 is
// where the field "reads as a rich sky". ×6 → effective ~150 at the default slider: Gaia is
// clearly visible without touching the control, with headroom left on the slider. Bright stars
// clamp at flux 1 so they do not blow out. The slider stays a relative trim on top of this base.
const GALAXY_FIELD_EXPOSURE_BOOST = 6;

/**
 * Distance guard (parsecs from the Milky Way centre) so the heavy 1M-point procgen
 * cloud is suppressed near Sol / the inner disc REGARDLESS of the coverage signal.
 * Coverage (ADR-006 §5) is the primary fade, but it is weak with the committed Gaia
 * *sample* pack and lags while tiles stream in — and drawing the full cloud on top of
 * the real catalog near home is the §2/§5.8 redundancy + an additive-overdraw perf
 * trap. Below LO the cloud is off (octree owns the neighbourhood); it ramps to full
 * by the Milky Way vantage. The retired M3 `GAL_PROCGEN_FLOOR` floor is NOT restored —
 * near Sol the cloud truly reaches 0.
 *
 * LO is the MEASURED hand-off where the real catalog stops filling the view: the
 * brightest real star drops below the visibility floor by ≈1.5–2.5 kpc, then 0 visible
 * px out to the old LO=18 kpc — a black "empty band" mid-transit (P1). LO=1500 ramps
 * procgen on right where the real field fades out, so there is no gap parked or flying,
 * while staying 0 below ~1.5 kpc (local hops show only the real field; no overdraw on
 * the dense catalog near Sol — R1). See docs/research/galaxy-transit-procgen-floor-design.md §8.
 */
const GAL_FADE_LO_PC = 1_500;
const GAL_FADE_HI_PC = 45_000;

/**
 * Procgen LOD cap (ADR-006 §5.4 / docs/research/procgen-lod-near-sol.md). The Milky Way
 * cloud carries `MILKY_WAY_STAR_COUNT` (1,000,000) points, but procgen has no per-distance
 * LOD: whenever the layer is on it would draw the full 1M. That is the sole cause of the
 * `flythrough4` §5.4 near-Sol regression — the inner approach band (just above
 * `GAL_FADE_LO_PC`) full-draws 1M while the gate budgets ≤109,971 total scene points.
 *
 * The cloud never NEEDS 1M to read as a dense field: the far vantage is the impostor
 * (cloudFactor→0, lod≥LOD_IMPOSTOR_FULL) and the near field is the real catalog. So cap
 * the DRAWN points to this budget via `setDrawFraction` (a contiguous prefix of the
 * well-mixed seeded placement sequence — a representative uniform thin of the disc, not a
 * bright-core bias). The cap is on COUNT only, at FULL opacity — it does NOT re-create P2
 * ("nebulas without stars"): P2 was the count AND opacity both collapsing together at low
 * blend; here opacity still carries the whole fade and ~90k points stay lit under the
 * nebula sprites. Headroom: 90k cloud + ~5k near-Sol octree + ~600 overlay ≈ 96k < 109,971.
 */
const PROCGEN_MAX_DRAW_POINTS = 90_000;
/** Octree tile mounts deferred during flight — flushed gradually after arrival. */
const OCTREE_FLUSH_PER_FRAME = 2;

function smoothstep(lo: number, hi: number, x: number): number {
  if (hi <= lo) return x >= hi ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

interface Mount {
  readonly chunkId: string;
  readonly kind: ChunkKind;
  readonly context: ContextId;
  readonly originPc: readonly [number, number, number];
  readonly batch: StarBatch;
  readonly objects: readonly THREE.Object3D[];
  /** Last frame this mount was on the visible cut (hide stale mounts each frame). */
  seen: number;
  applyFrame(
    offset: readonly [number, number, number],
    opacity: number,
    lod: number,
    drawFraction?: number,
  ): void;
  setViewportHeight(px: number): void;
  setExposure(exposure: number): void;
  hide(): void;
  dispose(): void;
}

function makeOctreeMount(
  chunkId: string,
  batch: StarBatch,
  viewportPx: number,
  exposure: number,
): Mount {
  const points: StarPoints = createStarPoints({ batch });
  points.object.frustumCulled = false;
  points.setViewportHeight(viewportPx);
  points.setExposure(exposure * GALAXY_FIELD_EXPOSURE_BOOST);
  return {
    chunkId,
    kind: 'octree',
    context: 'galaxy',
    originPc: batch.originPc,
    batch,
    objects: [points.object],
    seen: 0,
    applyFrame(offset, opacity): void {
      points.object.visible = true;
      points.setRenderOffset(offset);
      points.setOpacity(opacity);
    },
    setViewportHeight: (px) => points.setViewportHeight(px),
    setExposure: (e) => points.setExposure(e * GALAXY_FIELD_EXPOSURE_BOOST),
    // Hard hide via object.visible — additive/multiply opacity 0 does NOT remove a
    // draw (and MultiplyBlending at 0 would darken), so toggle visibility instead.
    hide: () => {
      points.object.visible = false;
    },
    dispose: () => points.dispose(),
  };
}

function makeProcgenMount(
  chunkId: string,
  batch: StarBatch,
  viewportPx: number,
  exposure: number,
  dustTexture: THREE.Texture,
  hiiTexture: THREE.Texture,
  impostorTexture: THREE.Texture,
  dust: { centersUnits: Float32Array; radiiUnits: Float32Array },
  hii: { centersUnits: Float32Array; radiiUnits: Float32Array },
  impostorRadiusUnits: number,
): Mount {
  const cloud: GalaxyPoints = createGalaxyPoints({
    batch,
    minPointPx: 2,
    basePointPx: 5,
    maxPointPx: 48,
    armGeometry: milkyWayArmGeometry(),
  });
  cloud.object.frustumCulled = false;
  cloud.setViewportHeight(viewportPx);
  cloud.setExposure(exposure * CLOUD_EXPOSURE_BOOST);
  const lanes: DustLanes = createDustLanes({
    centersUnits: dust.centersUnits,
    radiiUnits: dust.radiiUnits,
    dustTexture,
  });
  lanes.object.frustumCulled = false;
  const hiiRegions: DustLanes = createDustLanes({
    centersUnits: hii.centersUnits,
    radiiUnits: hii.radiiUnits,
    dustTexture: hiiTexture,
    glowColor: HII_GLOW_COLOR,
  });
  hiiRegions.object.frustumCulled = false;
  const impostor: GalaxyImpostor = createGalaxyImpostor({
    spriteTexture: impostorTexture,
    radiusUnits: impostorRadiusUnits,
  });
  impostor.object.frustumCulled = false;

  return {
    chunkId,
    kind: 'procgen',
    context: 'galaxy',
    originPc: batch.originPc,
    batch,
    objects: [impostor.object, lanes.object, cloud.object, hiiRegions.object],
    seen: 0,
    applyFrame(offset, opacity, lod, drawFraction = 1): void {
      const cloudFactor = 1 - smoothstep(LOD_CLOUD_FULL, LOD_IMPOSTOR_FULL, lod);
      cloud.setDrawFraction(drawFraction);
      cloud.object.visible = true;
      lanes.object.visible = true;
      hiiRegions.object.visible = true;
      impostor.object.visible = true;
      cloud.setRenderOffset(offset);
      cloud.setOpacity(opacity * cloudFactor);
      lanes.setRenderOffset(offset);
      lanes.setOpacity(opacity * cloudFactor * DUST_MAX_OPACITY);
      hiiRegions.setRenderOffset(offset);
      hiiRegions.setOpacity(opacity * cloudFactor * HII_MAX_OPACITY);
      impostor.setRenderOffset(offset);
      impostor.setOpacity(opacity * (1 - cloudFactor));
    },
    setViewportHeight: (px) => cloud.setViewportHeight(px),
    setExposure: (e) => cloud.setExposure(e * CLOUD_EXPOSURE_BOOST),
    hide(): void {
      cloud.object.visible = false;
      lanes.object.visible = false;
      hiiRegions.object.visible = false;
      impostor.object.visible = false;
    },
    dispose(): void {
      cloud.dispose();
      lanes.dispose();
      hiiRegions.dispose();
      impostor.dispose();
    },
  };
}

interface GalaxySceneProps {
  readonly streaming: StreamingPolicy;
  readonly origin: OriginManager;
  readonly controllerRef: RefObject<FlightController | null>;
  /** Impostor sprite radius in galaxy units (pc) — the Milky Way's visual extent. */
  readonly milkyWayRadiusPc: number;
}

// Module-scoped scratch — no allocations inside the frame callback (§9).
const posScratch: { context: ContextId; local: [number, number, number] } = {
  context: 'galaxy',
  local: [0, 0, 0],
};
const offScratch: [number, number, number] = [0, 0, 0];

export function GalaxyScene({
  streaming,
  origin,
  controllerRef,
  milkyWayRadiusPc,
}: GalaxySceneProps) {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  // Caller-owned galaxy assets (render-galaxy injects none): built once.
  const assets = useMemo(
    () => ({
      dustTexture: createDustTexture(),
      hiiTexture: createHiiTexture(),
      impostorTexture: createImpostorTexture(),
      dustLanes: buildDustLanes(),
      hiiRegions: buildHiiRegions(),
    }),
    [],
  );
  useEffect(
    () => () => {
      assets.dustTexture.dispose();
      assets.hiiTexture.dispose();
      assets.impostorTexture.dispose();
    },
    [assets],
  );

  // Mount registry: a ref Map (driven by lifecycle events) + a parallel list for
  // zero-alloc per-frame iteration. `version` bumps only on mount/unmount so React
  // re-renders the <primitive> set; it never changes per frame.
  const mounts = useRef<Map<string, Mount>>(new Map());
  const mountList = useRef<Mount[]>([]);
  const [version, setVersion] = useState(0);
  const frameTick = useRef(0);
  const flightActiveRef = useRef(false);
  const deferredOctree = useRef<{ chunkId: string; batch: StarBatch }[]>([]);
  const addMountRef = useRef<(chunkId: string, kind: ChunkKind, batch: StarBatch) => void>(
    () => {},
  );

  // Stable refs to the latest viewport/exposure so the event-driven mount factory
  // can initialise new mounts without re-subscribing the lifecycle listener.
  const viewportPx = useRef(size.height * dpr);
  const exposure = useRef(useSettingsStore.getState().exposure);

  useEffect(() => {
    const addMount = (chunkId: string, kind: ChunkKind, batch: StarBatch): void => {
      if (mounts.current.has(chunkId)) return;
      profileSpan(kind === 'octree' ? 'galaxy.mountOctree' : 'galaxy.mountProcgen', () => {
      const m =
        kind === 'octree'
          ? makeOctreeMount(chunkId, batch, viewportPx.current, exposure.current)
          : makeProcgenMount(
              chunkId,
              batch,
              viewportPx.current,
              exposure.current,
              assets.dustTexture,
              assets.hiiTexture,
              assets.impostorTexture,
              assets.dustLanes,
              assets.hiiRegions,
              milkyWayRadiusPc,
            );
      m.hide(); // start invisible; the frame loop fades it in via the cut opacity.
      mounts.current.set(chunkId, m);
      mountList.current.push(m);
      setVersion((v) => v + 1);
      });
    };
    addMountRef.current = addMount;
    const removeMount = (chunkId: string): void => {
      const m = mounts.current.get(chunkId);
      if (!m) return;
      mounts.current.delete(chunkId);
      const i = mountList.current.indexOf(m);
      if (i >= 0) mountList.current.splice(i, 1);
      m.dispose();
      setVersion((v) => v + 1);
    };

    const unsub = streaming.onChunk((e) => {
      if (e.phase === 'ready' && e.batch !== null) {
        if (e.kind === 'octree' && flightActiveRef.current) {
          deferredOctree.current.push({ chunkId: e.chunkId, batch: e.batch });
          return;
        }
        addMount(e.chunkId, e.kind, e.batch);
      } else if (e.phase === 'evict') removeMount(e.chunkId);
    });
    return () => {
      unsub();
      deferredOctree.current = [];
      for (const m of mountList.current) m.dispose();
      mountList.current = [];
      mounts.current.clear();
    };
  }, [streaming, assets, milkyWayRadiusPc]);

  // Viewport height → all mounts (and remember for future mounts).
  useEffect(() => {
    const h = size.height * dpr;
    viewportPx.current = h;
    for (const m of mountList.current) m.setViewportHeight(h);
  }, [size.height, dpr, version]);

  // Exposure: transient store subscription — never a React re-render.
  useEffect(() => {
    const apply = (e: number): void => {
      exposure.current = e;
      for (const m of mountList.current) m.setExposure(e);
    };
    apply(useSettingsStore.getState().exposure);
    return useSettingsStore.subscribe((s) => apply(s.exposure));
  }, []);

  // §5.8 brain: the visible cut / fetch / evict decisions, on the main thread,
  // BEFORE render. dtMs is the clamped wall delta from the frame context.
  useFrameContext((ctx) => {
    profileSpan('streaming.update', () => {
      streaming.update(size.height * dpr, ctx.dtMs);
    });
  }, PRIORITY_STREAMING);

  useFrameContext(() => {
    profileSpan('galaxy.render', () => {
    const tick = ++frameTick.current;
    const ctrl = controllerRef.current;
    const ctx: ContextId = ctrl ? ctrl.contextId : origin.context;
    const flying = ctrl?.goToActive ?? false;
    flightActiveRef.current = flying;

    // Flush octree tiles deferred during flight, a couple per frame after arrival.
    // (The in-flight procgen draw-cap that used to live here was removed: it was the
    // sole cause of P2 — a thinned star cloud under full-opacity nebula sprites,
    // "nebulas without stars" — and protected no measured budget. The resting far
    // vantage already full-draws the 1M-point cloud continuously, so full draw in the
    // mid-band during flight adds no new worst case; near Sol blend≈0 keeps it off
    // anyway. See docs/research/galaxy-transit-procgen-floor-design.md §5 E / §8.)
    if (!flying) {
      for (let n = 0; n < OCTREE_FLUSH_PER_FRAME && deferredOctree.current.length > 0; n++) {
        const p = deferredOctree.current.shift()!;
        addMountRef.current(p.chunkId, 'octree', p.batch);
      }
    }

    // Streaming tier: active in universe + galaxy. ADR-006 §5 wanted the procgen cloud
    // to fade by catalogCoverage() (procgen yields as the real octree tiles cover the
    // cut). That signal is UNUSABLE inside the galaxy with the current data: the octree
    // is galaxy-scale-boxed (rootHalfExtent ≈ 65 kpc) but its stars are Sol-local, so
    // far out the cut collapses to a few COARSE tiles whose geometric boxes fill the
    // screen → coverage saturates to ~1 at every distance → `1 − cov` permanently vetoes
    // the spiral. That made the whole Milky Way INVISIBLE at the ~49 kpc vantage (BUG).
    // Distance is the reliable driver here (Sol is the galaxy-frame origin, so
    // distFromCenter is 0 at home and large far out): smoothstep gives procgen OFF near
    // Sol (catalog owns the view) and full far out (impostor + coarse spiral, ADR-006
    // table). Distance drives the opacity DURING a goTo flight too — the old code took
    // min(coverageFade, distanceFade) while flying, but coverageFade saturates to 0
    // in-galaxy (cov→1, see above) so that min pinned the spiral to 0 for the WHOLE
    // breadcrumb flight: the camera flew through the band (where distanceFade
    // is non-zero) rendering black, and the spiral only popped in once it parked
    // (flying→false). Using distanceFade alone fades the spiral in along the trajectory.
    // The near-Sol flight budget (flythrough4 §5.4) is still protected: below GAL_FADE_LO_PC
    // distanceFade is 0, so the cloud is off near home.
    //
    // Procgen-visibility contract (anti-regression — see design doc §6). The whole
    // procgen LAYER (cloud + dust lanes + HII + impostor) shares one blend so stars and
    // nebulas are always visible TOGETHER — never sprites floating in black (P2):
    //   - Parked near Sol (< GAL_FADE_LO_PC ~1.5 kpc): real catalog owns the view,
    //     procgen OFF (blend 0) — no overdraw on the dense catalog (R1, R4).
    //   - Mid band (LO->HI): real field is sub-pixel; procgen ramps on, fills P1.
    //   - Far vantage (>= HI): real field gone, full spiral (R2).
    //   - In flight, any distance: same as parked at that distance — no extra
    //     suppression that empties the view (P1/P3).
    // See docs/research/galaxy-transit-procgen-floor-design.md and goto-galaxy-transit-black.md.
    let procgenBlend = 1;
    if (ctx === 'galaxy') {
      const cov = streaming.catalogCoverage();
      const coverageFade = Math.max(0, Math.min(1, 1 - cov));
      if (ctrl) {
        const p = ctrl.state.position.local;
        const distFromCenterPc = Math.hypot(p[0], p[1], p[2]);
        const distanceFade = smoothstep(GAL_FADE_LO_PC, GAL_FADE_HI_PC, distFromCenterPc);
        procgenBlend = distanceFade;
      } else {
        procgenBlend = coverageFade;
      }
    }
    procgenOpacityHolder.current = procgenBlend;

    // drawFraction is the procgen LOD knob (how many of the cloud's points to draw),
    // capped to PROCGEN_MAX_DRAW_POINTS — a perf/budget LOD, NOT part of the visual fade.
    // It is DISTANCE-INDEPENDENT and FULL-OPACITY: opacity (= procgenBlend) remains the
    // sole visibility factor, shared by the cloud AND the nebula sprites so they fade
    // together. This is why it does not re-create P2 ("nebulas without stars"): P2 tied
    // the count to the BLEND, so at low blend the cloud was doubly dimmed (few points ×
    // low opacity) while the fixed-count sprites survived. Here the count cap is fixed
    // (~90k points, always lit at the layer's full opacity); below GAL_FADE_LO_PC the
    // whole layer is hidden (skipped below). The cap is applied per-mount from its own
    // point count, so a mount carrying ≤ the cap draws in full (fraction 1).
    // See docs/research/procgen-lod-near-sol.md.
    const procgenLayerOn = procgenBlend > 0.0001;
    const opacityBlend = flying ? Math.min(1, procgenBlend * 1.15) : procgenBlend;

    const streamingActive = ctx === 'universe' || ctx === 'galaxy';
    const visible = streaming.visible;
    if (streamingActive) {
      for (let i = 0; i < visible.length; i++) {
        const v = visible[i]!;
        const m = mounts.current.get(v.chunkId);
        if (m === undefined) continue;
        // Already-mounted octree tiles stay drawn during a goTo flight. An earlier guard
        // here (`if (flying && m.kind === 'octree') continue`) hid them while flying, which
        // blanked the real Gaia field for the WHOLE of every goto — the camera flew through
        // a black void and the catalog snapped back only on arrival (measured: max luma
        // 3/255, 0 visible px during a Sol→Betelgeuse goto). It saved no draw calls (the cut
        // is the same either way) and did NOT protect the flythrough4 §5.4 budget — that
        // probe replays the path directly and never sets goToActive, so the guard was inert
        // there. The NEW-tile mount throttle below (deferredOctree) still caps upload cost
        // mid-flight; we just no longer hide what is already on screen.
        // See docs/research/goto-galaxy-transit-black.md §6.
        m.seen = tick;
        posScratch.context = m.context;
        posScratch.local[0] = m.originPc[0];
        posScratch.local[1] = m.originPc[1];
        posScratch.local[2] = m.originPc[2];
        origin.toRenderSpace(posScratch, offScratch);
        if (m.kind === 'procgen') {
          // Near Sol (blend 0): hide the whole layer so the real catalog owns the view
          // with no procgen overdraw (R1, contract §6). Must hide() explicitly — m.seen
          // was already set to tick above, so the trailing hide pass would skip it and
          // the layer would keep its previous (visible) frame.
          if (!procgenLayerOn) {
            m.hide();
            continue;
          }
          const drawFraction = Math.min(1, PROCGEN_MAX_DRAW_POINTS / Math.max(1, m.batch.count));
          m.applyFrame(offScratch, v.opacity * opacityBlend, v.lod, drawFraction);
        } else {
          m.applyFrame(offScratch, v.opacity, v.lod);
        }
      }
    }
    // Hide any mount not on the visible cut this frame (or whole layer faded out).
    const list = mountList.current;
    for (let i = 0; i < list.length; i++) {
      if (list[i]!.seen !== tick) list[i]!.hide();
    }
    });
  }, PRIORITY_RENDER);

  return (
    <>
      {mountList.current.flatMap((m) =>
        m.objects.map((o, i) => <primitive key={`${m.chunkId}:${i}`} object={o} />),
      )}
    </>
  );
}
