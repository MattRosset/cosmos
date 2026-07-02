import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BodyId, UniversePosition } from '@cosmos/core-types';
import { CONTEXT_UNIT_METERS } from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import {
  loadStarPack,
  loadSystemsPack,
  loadOctreePack,
  loadConstellationPack,
  createCombinedSource,
  type StarDataSource,
  type SystemsSource,
  type CombinedSource,
  type OctreeSource,
} from '@cosmos/data';
import type { FlightController, ContextSwitchEvent } from '@cosmos/nav';
import { SceneHost, type QualityController } from '@cosmos/scene-host';
import type { StreamingPolicy } from '@cosmos/streaming';
import { reportError } from '@cosmos/diagnostics';
import {
  useSelectionStore,
  useHistoryStore,
  useHudStore,
  useTourStore,
  useOverlayStore,
} from '@cosmos/app-state';
import { Icon } from '@cosmos/ui';
import { INITIAL_CAMERA, NavDriver } from './scene/NavDriver';
import { StarScene } from './scene/StarScene';
import { SystemScene } from './scene/SystemScene';
import { GalaxyScene } from './scene/GalaxyScene';
import { Overlays } from './scene/Overlays';
import { combineOctreeSources } from './glue/octree-combined';
import { buildOverlayData, type OverlayData } from './glue/overlays';
import { GRAND_TOUR, TOUR_FRAMING_STANDOFF_PC, TOUR_ORBIT_RADIUS_M, buildFlyToSpline } from './glue/tours';
import { Hud } from './hud/Hud';
import { ErrorBoundary, WebGLUnsupportedCard } from './ErrorBoundary';
import { isWebGL2Available } from './glue/report-error';
import { DebugHud } from './scene/DebugHud';
import { DebugMarkers } from './scene/DebugMarkers';
import { JitterProbe } from './scene/JitterProbe';
import { CtxSwitchProbe, CTX_START } from './scene/CtxSwitchProbe';
import { M3DescentProbe, M3_START } from './scene/M3DescentProbe';
import { ErrorGateProbe, ERRORGATE_START } from './scene/ErrorGateProbe';
import { Flythrough3Probe } from './scene/Flythrough3Probe';
import { Flythrough4Probe } from './scene/Flythrough4Probe';
import { SoakProbe } from './scene/SoakProbe';
import {
  FLYTHROUGH3_START,
  FLYTHROUGH3_EPOCH_JD,
  FLYTHROUGH3_SOAK_LOOPS,
} from './scene/flythrough-descent';
import { clock, epochProvider, installTimeGlue, syncClockToNow } from './glue/time';
import { createGoToCoordinator } from './glue/goto';
import { testHook, controllerHolder, mirrorControllerState, streamingHolder } from './glue/test-hook';
import { makeLocalGroup, MILKY_WAY_STAR_COUNT } from './glue/local-group';
import { getCosmosPool, createMilkyWayStreaming } from './glue/streaming';
import { wireQuality } from './glue/quality';
import { BreadcrumbFrameProfiler } from './scene/BreadcrumbFrameProfiler';
import './glue/frame-profiler';

/** TASK-006 debug flythrough scene, behind the query flag only. */
const DEBUG_MARKERS =
  new URLSearchParams(window.location.search).get('debug') === 'markers';

/** TASK-017 rendered jitter gate (`?debug=jitter`): no pack, no HUD. */
const DEBUG_JITTER =
  new URLSearchParams(window.location.search).get('debug') === 'jitter';

/** TASK-030 context-switch gate (`?debug=ctxswitch`): full packs, scripted descent. */
const DEBUG_CTXSWITCH =
  new URLSearchParams(window.location.search).get('debug') === 'ctxswitch';

/** TASK-040 M3 gate (`?debug=m3`): full packs + streaming, scripted universe→Earth zoom. */
const DEBUG_M3 = new URLSearchParams(window.location.search).get('debug') === 'm3';

/** TASK-041 recorded-flythrough perf gate (`?debug=flythrough3`, §5.8). */
const DEBUG_FLYTHROUGH3 =
  new URLSearchParams(window.location.search).get('debug') === 'flythrough3';

/**
 * TASK-053 tier-unification budget gate (`?debug=flythrough4`, ADR-006 §5.4).
 * Replays the SAME committed path as flythrough3 against the M4a composition
 * (combined HYG+Gaia octree, coverage-faded procgen, gated monolith, overlays,
 * atmosphere). `?baseline=m3` records the HYG-only baseline composition instead,
 * so the near-Sol segment is a like-for-like M3↔M4a comparison. The span profiler
 * is active so the universe segment attributes its frame time (BUG-4).
 */
const DEBUG_FLYTHROUGH4 =
  new URLSearchParams(window.location.search).get('debug') === 'flythrough4';
const FLYTHROUGH4_BASELINE =
  new URLSearchParams(window.location.search).get('baseline') === 'm3';

/** TASK-041 memory-soak gate (`?debug=soak3`, §5.8); `?loops=N` overrides the count. */
const DEBUG_SOAK3 = new URLSearchParams(window.location.search).get('debug') === 'soak3';
/**
 * TASK-053 M4a memory-soak gate (`?debug=soak4`, §5.8). Same loop as soak3 but with
 * the M4a mounts (combined HYG+Gaia octree, constellation lines + nebula fields +
 * labels overlay, Earth atmosphere on the system leg) — the new mounts are the leak
 * suspects (must dispose on context exit). `?loops=N` overrides the count.
 */
const DEBUG_SOAK4 = new URLSearchParams(window.location.search).get('debug') === 'soak4';
const SOAK3_LOOPS = (() => {
  const raw = new URLSearchParams(window.location.search).get('loops');
  const n = raw !== null ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : FLYTHROUGH3_SOAK_LOOPS;
})();

/** Breadcrumb freeze profiler — span timings on `window.__breadcrumbProfile`. */
const DEBUG_BREADCRUMB_PROFILE =
  new URLSearchParams(window.location.search).get('debug') === 'breadcrumb-profile';

const M3_SOL_SYSTEM_ID: BodyId = 'sol';

const HYG_MANIFEST_URL = '/packs/manifest.json';
const SOL_PACK_URL = '/packs/systems-sol.json';
const EXO_PACK_URL = '/packs/systems-exo.json';
const OCTREE_MANIFEST_URL = '/packs/octree/octree.json';
/** Gaia DR3 octree sample (ADR-006); the full pack URL is a deploy-time config.
 *  BUG-10 measurement: local dense packs built out-of-band (gitignored) —
 *  octree-gaia (3M/884 tiles), octree-gaia-1m (~939k/395 tiles). Swap this line to
 *  the pack under test; the committed sample is '/packs/octree-gaia-sample/octree.json'. */
const GAIA_OCTREE_MANIFEST_URL = '/packs/octree-gaia-sample/octree.json';
const CONSTELLATIONS_URL = '/packs/constellations.json';

/** TASK-052 M4a debug gate (`?debug=m4a`): scripted descent with the M4a composition. */
const DEBUG_M4A = new URLSearchParams(window.location.search).get('debug') === 'm4a';

/**
 * TASK-059 error gate (`?debug=errorgate`): scripted universe→galaxy→Sol→Earth
 * descent against the M4a composition, asserting the diagnostics counters TASK-058
 * exposed (`errorCounts`/`failedChunks`/`catalogCoverage`) read zero-error /
 * fully-loaded at the end. `?inject=1` deliberately fails the combined octree's
 * root tile — the gate's own red-on-regression self-test (the BUG-6 class it must
 * catch): every load attempt for that key rejects, so `errorCounts.total` and
 * `streaming.stats.failedChunks` both go non-zero and `catalogCoverage()` drops.
 */
const DEBUG_ERRORGATE =
  new URLSearchParams(window.location.search).get('debug') === 'errorgate';
const ERRORGATE_INJECT = new URLSearchParams(window.location.search).get('inject') === '1';

interface Sources {
  readonly stars: StarDataSource;
  readonly sol: SystemsSource;
  readonly exo: SystemsSource;
  readonly combined: CombinedSource;
  /** HYG octree (M3 streaming tier); absent in debug modes that don't stream. */
  readonly octree?: OctreeSource;
  /**
   * Combined HYG + Gaia octree (M4a, ADR-006 §5): the single source fed to the
   * streaming policy so both catalogs share one cut + `catalogCoverage()`. Absent in
   * M1/M2/M3 debug modes (which keep the HYG-only octree to preserve their baselines).
   */
  readonly octreeCombined?: OctreeSource;
  /** Constellation lines + label candidates (M4a overlays); absent in older modes. */
  readonly overlay?: OverlayData;
}

declare global {
  interface Window {
    /** Dev/E2E control surface (TASK-052): deterministic tier + tour control. */
    __cosmosDev?: {
      setTier(tier: 'high' | 'medium' | 'low' | null): void;
      startTour(): void;
      stopTour(): void;
      /**
       * Reorient the camera to face the brightest overlay label (galaxy context),
       * so a label is deterministically on-screen. The boot vantage points at an
       * arbitrary patch of sky where none of the labelled giants happen to fall in
       * the frustum; the e2e overlay gate uses this to assert the label DOM without
       * depending on the boot orientation. No-op until packs are ready.
       */
      focusFirstLabel(): void;
    };
  }
}

type PackState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly sources: Sources };

export function App() {
  if (DEBUG_JITTER) return <JitterApp />;
  if (DEBUG_CTXSWITCH) return <CtxSwitchApp />;
  if (DEBUG_ERRORGATE) return <ErrorGateApp inject={ERRORGATE_INJECT} />;
  if (DEBUG_M4A) return <M4aApp />;
  if (DEBUG_FLYTHROUGH4) return <Flythrough4ProbeApp baseline={FLYTHROUGH4_BASELINE} />;
  if (DEBUG_SOAK4) return <Soak4ProbeApp />;
  if (DEBUG_M3) return <M3App />;
  if (DEBUG_FLYTHROUGH3 || DEBUG_SOAK3) return <StreamingProbeApp kind={DEBUG_SOAK3 ? 'soak3' : 'flythrough3'} />;
  return DEBUG_MARKERS ? <DebugApp /> : <StarApp />;
}

/**
 * TASK-017 rendered jitter gate: a single bright marker 8 kpc out, the camera
 * scripted to orbit it at 1 AU. No pack load, no HUD — isolates the coordinate +
 * render pipeline. Results land on `window.__jitterResult`.
 */
function JitterApp() {
  return (
    <SceneHost>
      <color attach="background" args={['#02030a']} />
      <JitterProbe />
    </SceneHost>
  );
}

/**
 * TASK-030 Phase 2 gate (`?debug=ctxswitch`): loads the full M2 packs exactly
 * like StarApp, but replaces the user-driven NavDriver with CtxSwitchProbe — a
 * scripted galaxy⇄system descent that measures the rendered transition. The
 * star field + system scene mount identically to production (the gate measures
 * the SHIPPED pipeline); only navigation is scripted and the clock is paused so
 * orbital motion cannot contaminate the frame deltas.
 */
function CtxSwitchApp() {
  const [pack, setPack] = useState<PackState>({ status: 'loading' });
  const [mountedSystemId, setMountedSystemId] = useState<BodyId | null>(null);

  useEffect(() => {
    installTimeGlue();
    clock.setPaused(true); // freeze orbits — the probe tests CAMERA transitions.
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadStarPack(HYG_MANIFEST_URL),
      loadSystemsPack(SOL_PACK_URL),
      loadSystemsPack(EXO_PACK_URL),
    ]).then(
      ([stars, sol, exo]) => {
        if (cancelled) return;
        const combined = createCombinedSource(stars, [sol, exo]);
        setPack({ status: 'ready', sources: { stars, sol, exo, combined } });
      },
      (err: unknown) => {
        if (!cancelled) {
          setPack({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    testHook.ready = pack.status === 'ready';
  }, [pack]);

  const tree = useMemo(() => createScaleFrameTree(), []);
  const origin = useMemo(() => createOriginManager(tree, CTX_START), [tree]);

  const handleController = useCallback((controller: FlightController) => {
    controllerHolder.current = controller;
    mirrorControllerState();
  }, []);

  const handleContextSwitch = useCallback((e: ContextSwitchEvent) => {
    setMountedSystemId(e.to === 'system' ? e.anchorId : null);
    mirrorControllerState();
  }, []);

  const sources = pack.status === 'ready' ? pack.sources : null;
  const mountedSystem = useMemo(() => {
    if (sources === null || mountedSystemId === null) return null;
    const system = sources.sol.getSystem(mountedSystemId) ?? sources.exo.getSystem(mountedSystemId);
    if (system === undefined) return null;
    const packUrl = sources.sol.getSystem(mountedSystemId) !== undefined ? SOL_PACK_URL : EXO_PACK_URL;
    return { system, packUrl };
  }, [sources, mountedSystemId]);

  if (pack.status !== 'ready') return null;

  return (
    <SceneHost epochProvider={epochProvider}>
      <color attach="background" args={['#02030a']} />
      <CtxSwitchProbe
        origin={origin}
        tree={tree}
        combined={pack.sources.combined}
        onController={handleController}
        onContextSwitch={handleContextSwitch}
      />
      <StarScene
        stars={pack.sources.stars}
        combined={pack.sources.combined}
        origin={origin}
        controllerRef={controllerHolder}
      />
      {mountedSystem ? (
        <SystemScene
          system={mountedSystem.system}
          origin={origin}
          packUrl={mountedSystem.packUrl}
          controllerRef={controllerHolder}
        />
      ) : null}
    </SceneHost>
  );
}

/**
 * TASK-040 M3 gate (`?debug=m3`): the signature continuous-zoom acceptance run.
 * Loads the full M2 packs PLUS the HYG octree, builds the streaming tier + the
 * procedural Milky Way, and replaces user input with M3DescentProbe — a scripted
 * universe→galaxy→system descent to an Earth approach. The shipped scenes (star
 * field, galaxy/streaming tier, system) mount identically to production; only
 * navigation is scripted and the clock is paused so orbital motion cannot
 * contaminate the per-frame transition deltas.
 */
function M3App() {
  const [pack, setPack] = useState<PackState>({ status: 'loading' });
  const [mountedSystemId, setMountedSystemId] = useState<BodyId | null>(null);

  useEffect(() => {
    installTimeGlue();
    clock.setPaused(true); // freeze orbits — the probe tests CAMERA transitions.
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadStarPack(HYG_MANIFEST_URL),
      loadSystemsPack(SOL_PACK_URL),
      loadSystemsPack(EXO_PACK_URL),
      loadOctreePack(OCTREE_MANIFEST_URL, { pool: getCosmosPool() }),
    ]).then(
      ([stars, sol, exo, octree]) => {
        if (cancelled) return;
        const combined = createCombinedSource(stars, [sol, exo]);
        setPack({ status: 'ready', sources: { stars, sol, exo, combined, octree } });
      },
      (err: unknown) => {
        if (!cancelled) {
          setPack({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    testHook.ready = pack.status === 'ready';
  }, [pack]);

  const tree = useMemo(() => createScaleFrameTree(), []);
  const origin = useMemo(() => createOriginManager(tree, M3_START), [tree]);
  const { milkyWay } = useMemo(() => makeLocalGroup(), []);

  const handleController = useCallback((controller: FlightController) => {
    controllerHolder.current = controller;
    mirrorControllerState();
  }, []);

  const handleContextSwitch = useCallback((e: ContextSwitchEvent) => {
    setMountedSystemId(e.to === 'system' ? e.anchorId : null);
    mirrorControllerState();
  }, []);

  const sources = pack.status === 'ready' ? pack.sources : null;

  const streaming = useMemo<StreamingPolicy | null>(() => {
    if (sources?.octree === undefined) return null;
    return createMilkyWayStreaming({ origin, octree: sources.octree, milkyWay });
  }, [origin, sources, milkyWay]);

  useEffect(() => {
    streamingHolder.current = streaming;
    return () => {
      if (streamingHolder.current === streaming) streamingHolder.current = null;
    };
  }, [streaming]);

  const handleQc = useCallback(
    (qc: QualityController) => {
      if (streaming === null) return;
      wireQuality(streaming, (tier) => {
        testHook.qualityTier = tier;
      })(qc);
    },
    [streaming],
  );

  const mountedSystem = useMemo(() => {
    if (sources === null) return null;
    const id = mountedSystemId ?? M3_SOL_SYSTEM_ID;
    const system = sources.sol.getSystem(id) ?? sources.exo.getSystem(id);
    if (system === undefined) return null;
    const packUrl =
      sources.sol.getSystem(id) !== undefined ? SOL_PACK_URL : EXO_PACK_URL;
    return { system, packUrl };
  }, [sources, mountedSystemId]);

  if (pack.status !== 'ready' || streaming === null) return null;

  return (
    <SceneHost
      epochProvider={epochProvider}
      initialQualityTier="high"
      onQualityController={handleQc}
    >
      <color attach="background" args={['#02030a']} />
      <M3DescentProbe
        origin={origin}
        tree={tree}
        combined={pack.sources.combined}
        milkyWay={milkyWay}
        onController={handleController}
        onContextSwitch={handleContextSwitch}
      />
      <GalaxyScene
        streaming={streaming}
        origin={origin}
        controllerRef={controllerHolder}
        milkyWayRadiusPc={milkyWay.radiusKpc * 1000}
      />
      <StarScene
        stars={pack.sources.stars}
        combined={pack.sources.combined}
        origin={origin}
        controllerRef={controllerHolder}
      />
      {mountedSystem ? (
        <SystemScene
          system={mountedSystem.system}
          origin={origin}
          packUrl={mountedSystem.packUrl}
          controllerRef={controllerHolder}
        />
      ) : null}
    </SceneHost>
  );
}

/**
 * TASK-052 M4a gate (`?debug=m4a`): the M3 scripted descent (M3DescentProbe) run
 * against the M4a composition — the COMBINED HYG + Gaia octree streamed through one
 * policy, the coverage-driven procgen fade + monolith gate (GalaxyScene/StarScene),
 * the educational overlays, and the Earth atmosphere (quality-gated in SystemScene).
 * It exists separately from `?debug=m3` so the M3 baselines stay frozen; the e2e
 * (m4a.spec.ts) drives tier (via `window.__cosmosDev.setTier`) + overlay/tour stores
 * against the SHIPPED pipeline. The clock is paused so orbital motion cannot
 * contaminate the descent.
 */
function M4aApp() {
  const [pack, setPack] = useState<PackState>({ status: 'loading' });
  const [mountedSystemId, setMountedSystemId] = useState<BodyId | null>(null);

  useEffect(() => {
    installTimeGlue();
    clock.setPaused(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadStarPack(HYG_MANIFEST_URL),
      loadSystemsPack(SOL_PACK_URL),
      loadSystemsPack(EXO_PACK_URL),
      loadOctreePack(OCTREE_MANIFEST_URL, { pool: getCosmosPool() }),
      loadOctreePack(GAIA_OCTREE_MANIFEST_URL, { pool: getCosmosPool() }),
      loadConstellationPack(CONSTELLATIONS_URL),
    ]).then(
      ([stars, sol, exo, octree, gaiaOctree, constellationPack]) => {
        if (cancelled) return;
        const combined = createCombinedSource(stars, [sol, exo]);
        const octreeCombined = combineOctreeSources([octree, gaiaOctree]);
        const overlay = buildOverlayData(constellationPack, stars);
        setPack({
          status: 'ready',
          sources: { stars, sol, exo, combined, octree, octreeCombined, overlay },
        });
      },
      (err: unknown) => {
        if (!cancelled) {
          setPack({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    testHook.ready = pack.status === 'ready';
  }, [pack]);

  const tree = useMemo(() => createScaleFrameTree(), []);
  const origin = useMemo(() => createOriginManager(tree, M3_START), [tree]);
  const { milkyWay } = useMemo(() => makeLocalGroup(), []);

  const handleController = useCallback((controller: FlightController) => {
    controllerHolder.current = controller;
    mirrorControllerState();
  }, []);

  const handleContextSwitch = useCallback((e: ContextSwitchEvent) => {
    setMountedSystemId(e.to === 'system' ? e.anchorId : null);
    mirrorControllerState();
  }, []);

  const sources = pack.status === 'ready' ? pack.sources : null;

  const streaming = useMemo<StreamingPolicy | null>(() => {
    if (sources?.octreeCombined === undefined) return null;
    return createMilkyWayStreaming({ origin, octree: sources.octreeCombined, milkyWay });
  }, [origin, sources, milkyWay]);

  useEffect(() => {
    streamingHolder.current = streaming;
    return () => {
      if (streamingHolder.current === streaming) streamingHolder.current = null;
    };
  }, [streaming]);

  const qcRef = useRef<QualityController | null>(null);
  useEffect(() => {
    window.__cosmosDev = {
      setTier: (tier) => qcRef.current?.setTier(tier),
      startTour: () => useTourStore.getState().start(GRAND_TOUR),
      stopTour: () => useTourStore.getState().stop(),
      focusFirstLabel: () => {
        const ctrl = controllerHolder.current;
        const label = sources?.overlay?.labels[0];
        if (ctrl === null || label === undefined) return;
        const p = label.positionPc;
        const target: UniversePosition = { context: 'galaxy', local: [p[0], p[1], p[2]] };
        ctrl.goTo({ target, lookAtTarget: target, arrivalDistanceM: CONTEXT_UNIT_METERS.galaxy, durationMs: 1500 });
      },
    };
    return () => {
      delete window.__cosmosDev;
    };
  }, [sources]);

  const handleQc = useCallback(
    (qc: QualityController) => {
      qcRef.current = qc;
      if (streaming === null) return;
      wireQuality(streaming, (tier) => {
        testHook.qualityTier = tier;
      })(qc);
    },
    [streaming],
  );

  const mountedSystem = useMemo(() => {
    if (sources === null) return null;
    const id = mountedSystemId ?? M3_SOL_SYSTEM_ID;
    const system = sources.sol.getSystem(id) ?? sources.exo.getSystem(id);
    if (system === undefined) return null;
    const packUrl =
      sources.sol.getSystem(id) !== undefined ? SOL_PACK_URL : EXO_PACK_URL;
    return { system, packUrl };
  }, [sources, mountedSystemId]);

  if (pack.status !== 'ready' || streaming === null) return null;

  return (
    <SceneHost
      epochProvider={epochProvider}
      initialQualityTier="high"
      onQualityController={handleQc}
    >
      <color attach="background" args={['#02030a']} />
      <M3DescentProbe
        origin={origin}
        tree={tree}
        combined={pack.sources.combined}
        milkyWay={milkyWay}
        onController={handleController}
        onContextSwitch={handleContextSwitch}
      />
      <GalaxyScene
        streaming={streaming}
        origin={origin}
        controllerRef={controllerHolder}
        milkyWayRadiusPc={milkyWay.radiusKpc * 1000}
      />
      <StarScene
        stars={pack.sources.stars}
        combined={pack.sources.combined}
        origin={origin}
        controllerRef={controllerHolder}
        streaming={streaming}
      />
      {pack.sources.overlay ? (
        <Overlays
          origin={origin}
          overlay={pack.sources.overlay}
          controllerRef={controllerHolder}
        />
      ) : null}
      {mountedSystem ? (
        <SystemScene
          system={mountedSystem.system}
          origin={origin}
          packUrl={mountedSystem.packUrl}
          controllerRef={controllerHolder}
        />
      ) : null}
    </SceneHost>
  );
}

/**
 * TASK-059 fault injector (`?inject=1`): wraps the combined octree so every
 * `loadTile` for the root key rejects with a real (non-abort) error, forever. The
 * root tile is the very first dispatch in any descent, so this reproduces the BUG-6
 * class deterministically — the gate's own self-test that it goes red, not always
 * green. Debug-only; never wired outside `?debug=errorgate&inject=1`.
 */
function injectOctreeFault(source: OctreeSource): OctreeSource {
  const failKey = source.root.key;
  return {
    root: source.root,
    context: source.context,
    rootHalfExtentUnits: source.rootHalfExtentUnits,
    idPrefix: source.idPrefix,
    getNode: (key) => source.getNode(key),
    loadTile(key, opts) {
      if (key === failKey) {
        return Promise.reject(new Error('TASK-059 injected fault (?inject=1)'));
      }
      return source.loadTile(key, opts);
    },
  };
}

/**
 * TASK-059 error gate (`?debug=errorgate`): the M4a composition driven by
 * `ErrorGateProbe` instead of the user-facing `NavDriver` — same packs, same
 * scenes, same streaming policy as production, per the gate doctrine (measure the
 * shipped pipeline, docs/architecture.md §6). `inject` deliberately breaks the
 * combined octree's root tile so the gate proves it goes red (see
 * `injectOctreeFault`).
 */
function ErrorGateApp({ inject }: { inject: boolean }): React.JSX.Element | null {
  const [pack, setPack] = useState<PackState>({ status: 'loading' });
  const [mountedSystemId, setMountedSystemId] = useState<BodyId | null>(null);

  useEffect(() => {
    installTimeGlue();
    clock.setPaused(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadStarPack(HYG_MANIFEST_URL),
      loadSystemsPack(SOL_PACK_URL),
      loadSystemsPack(EXO_PACK_URL),
      loadOctreePack(OCTREE_MANIFEST_URL, { pool: getCosmosPool() }),
      loadOctreePack(GAIA_OCTREE_MANIFEST_URL, { pool: getCosmosPool() }),
      loadConstellationPack(CONSTELLATIONS_URL),
    ]).then(
      ([stars, sol, exo, octree, gaiaOctree, constellationPack]) => {
        if (cancelled) return;
        const combined = createCombinedSource(stars, [sol, exo]);
        let octreeCombined = combineOctreeSources([octree, gaiaOctree]);
        if (inject) octreeCombined = injectOctreeFault(octreeCombined);
        const overlay = buildOverlayData(constellationPack, stars);
        setPack({
          status: 'ready',
          sources: { stars, sol, exo, combined, octree, octreeCombined, overlay },
        });
      },
      (err: unknown) => {
        if (!cancelled) {
          setPack({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [inject]);

  useEffect(() => {
    testHook.ready = pack.status === 'ready';
  }, [pack]);

  const tree = useMemo(() => createScaleFrameTree(), []);
  const origin = useMemo(() => createOriginManager(tree, ERRORGATE_START), [tree]);
  const { milkyWay } = useMemo(() => makeLocalGroup(), []);

  const handleController = useCallback((controller: FlightController) => {
    controllerHolder.current = controller;
    mirrorControllerState();
  }, []);

  const handleContextSwitch = useCallback((e: ContextSwitchEvent) => {
    setMountedSystemId(e.to === 'system' ? e.anchorId : null);
    mirrorControllerState();
  }, []);

  const sources = pack.status === 'ready' ? pack.sources : null;

  const streaming = useMemo<StreamingPolicy | null>(() => {
    if (sources?.octreeCombined === undefined) return null;
    return createMilkyWayStreaming({ origin, octree: sources.octreeCombined, milkyWay });
  }, [origin, sources, milkyWay]);

  useEffect(() => {
    streamingHolder.current = streaming;
    return () => {
      if (streamingHolder.current === streaming) streamingHolder.current = null;
    };
  }, [streaming]);

  const handleQc = useCallback(
    (qc: QualityController) => {
      if (streaming === null) return;
      wireQuality(streaming, (tier) => {
        testHook.qualityTier = tier;
      })(qc);
    },
    [streaming],
  );

  const mountedSystem = useMemo(() => {
    if (sources === null) return null;
    const id = mountedSystemId ?? M3_SOL_SYSTEM_ID;
    const system = sources.sol.getSystem(id) ?? sources.exo.getSystem(id);
    if (system === undefined) return null;
    const packUrl =
      sources.sol.getSystem(id) !== undefined ? SOL_PACK_URL : EXO_PACK_URL;
    return { system, packUrl };
  }, [sources, mountedSystemId]);

  if (pack.status !== 'ready' || streaming === null) return null;

  return (
    <SceneHost
      epochProvider={epochProvider}
      initialQualityTier="high"
      onQualityController={handleQc}
    >
      <color attach="background" args={['#02030a']} />
      <ErrorGateProbe
        origin={origin}
        tree={tree}
        combined={pack.sources.combined}
        milkyWay={milkyWay}
        streaming={streaming}
        onController={handleController}
        onContextSwitch={handleContextSwitch}
      />
      <GalaxyScene
        streaming={streaming}
        origin={origin}
        controllerRef={controllerHolder}
        milkyWayRadiusPc={milkyWay.radiusKpc * 1000}
      />
      <StarScene
        stars={pack.sources.stars}
        combined={pack.sources.combined}
        origin={origin}
        controllerRef={controllerHolder}
        streaming={streaming}
      />
      {pack.sources.overlay ? (
        <Overlays
          origin={origin}
          overlay={pack.sources.overlay}
          controllerRef={controllerHolder}
        />
      ) : null}
      {mountedSystem ? (
        <SystemScene
          system={mountedSystem.system}
          origin={origin}
          packUrl={mountedSystem.packUrl}
          controllerRef={controllerHolder}
        />
      ) : null}
    </SceneHost>
  );
}

/**
 * TASK-053 tier-unification budget gate (`?debug=flythrough4`, ADR-006 §5.4). Loads
 * the full M4a packs (HYG octree + Gaia octree + constellations) and the M4a
 * composition (coverage-faded procgen, gated HYG monolith, overlays, Earth
 * atmosphere) and replays the SAME committed flythrough path through a self-measuring
 * probe. The default run streams the COMBINED HYG+Gaia octree (the M4a tier); the
 * `baseline=m3` run streams the HYG-only octree through the same scenes (the M3 tier)
 * so the near-Sol segment is a like-for-like comparison on the identical path. The
 * frozen clock + epoch are shared with flythrough3 so Earth's waypoint is identical.
 */
function Flythrough4ProbeApp({ baseline }: { baseline: boolean }): React.JSX.Element | null {
  const [pack, setPack] = useState<PackState>({ status: 'loading' });
  const [mountedSystemId, setMountedSystemId] = useState<BodyId | null>(null);

  useEffect(() => {
    installTimeGlue();
    clock.setEpochJD(FLYTHROUGH3_EPOCH_JD); // frozen epoch → deterministic Earth waypoint.
    clock.setPaused(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadStarPack(HYG_MANIFEST_URL),
      loadSystemsPack(SOL_PACK_URL),
      loadSystemsPack(EXO_PACK_URL),
      loadOctreePack(OCTREE_MANIFEST_URL, { pool: getCosmosPool() }),
      loadOctreePack(GAIA_OCTREE_MANIFEST_URL, { pool: getCosmosPool() }),
      loadConstellationPack(CONSTELLATIONS_URL),
    ]).then(
      ([stars, sol, exo, octree, gaiaOctree, constellationPack]) => {
        if (cancelled) return;
        const combined = createCombinedSource(stars, [sol, exo]);
        const octreeCombined = combineOctreeSources([octree, gaiaOctree]);
        const overlay = buildOverlayData(constellationPack, stars);
        setPack({
          status: 'ready',
          sources: { stars, sol, exo, combined, octree, octreeCombined, overlay },
        });
      },
      (err: unknown) => {
        if (!cancelled) {
          setPack({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    testHook.ready = pack.status === 'ready';
  }, [pack]);

  const tree = useMemo(() => createScaleFrameTree(), []);
  const origin = useMemo(() => createOriginManager(tree, FLYTHROUGH3_START), [tree]);
  const { milkyWay } = useMemo(() => makeLocalGroup(), []);

  const handleController = useCallback((controller: FlightController) => {
    controllerHolder.current = controller;
    mirrorControllerState();
  }, []);

  const handleContextSwitch = useCallback((e: ContextSwitchEvent) => {
    setMountedSystemId(e.to === 'system' ? e.anchorId : null);
    mirrorControllerState();
  }, []);

  const sources = pack.status === 'ready' ? pack.sources : null;

  // baseline=m3 streams the HYG-only octree (the M3 tier); the default streams the
  // combined HYG+Gaia octree (the M4a tier). Same scenes either way → like-for-like.
  const streaming = useMemo<StreamingPolicy | null>(() => {
    if (sources === null) return null;
    const octree = baseline ? sources.octree : sources.octreeCombined;
    if (octree === undefined) return null;
    return createMilkyWayStreaming({ origin, octree, milkyWay });
  }, [origin, sources, milkyWay, baseline]);

  useEffect(() => {
    streamingHolder.current = streaming;
    return () => {
      if (streamingHolder.current === streaming) streamingHolder.current = null;
    };
  }, [streaming]);

  const handleQc = useCallback(
    (qc: QualityController) => {
      if (streaming === null) return;
      wireQuality(streaming, (tier) => {
        testHook.qualityTier = tier;
      })(qc);
    },
    [streaming],
  );

  const mountedSystem = useMemo(() => {
    if (sources === null) return null;
    const id = mountedSystemId ?? M3_SOL_SYSTEM_ID;
    const system = sources.sol.getSystem(id) ?? sources.exo.getSystem(id);
    if (system === undefined) return null;
    const packUrl =
      sources.sol.getSystem(id) !== undefined ? SOL_PACK_URL : EXO_PACK_URL;
    return { system, packUrl };
  }, [sources, mountedSystemId]);

  if (pack.status !== 'ready' || streaming === null) return null;

  return (
    <SceneHost
      epochProvider={epochProvider}
      initialQualityTier="high"
      onQualityController={handleQc}
    >
      <color attach="background" args={['#02030a']} />
      <BreadcrumbFrameProfiler />
      <Flythrough4Probe
        origin={origin}
        tree={tree}
        combined={pack.sources.combined}
        milkyWay={milkyWay}
        streaming={streaming}
        variant={baseline ? 'm3' : 'm4a'}
        profileActive={DEBUG_BREADCRUMB_PROFILE || DEBUG_FLYTHROUGH4}
        onController={handleController}
        onContextSwitch={handleContextSwitch}
      />
      <GalaxyScene
        streaming={streaming}
        origin={origin}
        controllerRef={controllerHolder}
        milkyWayRadiusPc={milkyWay.radiusKpc * 1000}
      />
      <StarScene
        stars={pack.sources.stars}
        combined={pack.sources.combined}
        origin={origin}
        controllerRef={controllerHolder}
        // baseline=m3 reproduces the M3 tier: NO streaming prop ⇒ the HYG monolith
        // is always drawn (the redundant near-Sol layer the unification removes). The
        // default (m4a) passes streaming ⇒ the monolith is coverage-gated off.
        streaming={baseline ? undefined : streaming}
      />
      {pack.sources.overlay ? (
        <Overlays
          origin={origin}
          overlay={pack.sources.overlay}
          controllerRef={controllerHolder}
        />
      ) : null}
      {mountedSystem ? (
        <SystemScene
          system={mountedSystem.system}
          origin={origin}
          packUrl={mountedSystem.packUrl}
          controllerRef={controllerHolder}
        />
      ) : null}
    </SceneHost>
  );
}

/**
 * TASK-053 M4a memory-soak gate (`?debug=soak4`, §5.8 / §6). Loops the committed
 * flythrough path back and forth (SoakProbe) against the M4a composition — the
 * combined HYG+Gaia octree, the constellation/nebula/label overlays (toggled ON so
 * the new mounts actually exist), and the Earth atmosphere on the system leg. Each
 * down-and-back cycle mounts these on entry and must dispose them on context exit;
 * a leak compounds over the loop. Publishes the same `window.__soak3Result` shape so
 * the soak3 spec can assert the heap plateau + churn for the M4a mounts too.
 */
function Soak4ProbeApp(): React.JSX.Element | null {
  const [pack, setPack] = useState<PackState>({ status: 'loading' });
  const [mountedSystemId, setMountedSystemId] = useState<BodyId | null>(null);

  useEffect(() => {
    installTimeGlue();
    clock.setEpochJD(FLYTHROUGH3_EPOCH_JD);
    clock.setPaused(true);
    // Turn the overlays ON so the nebula/line-set/label mounts exist across the soak
    // (they are the M4a leak suspects). Restore on unmount.
    const o = useOverlayStore.getState();
    const prev = { constellations: o.constellations, labels: o.labels };
    o.setConstellations(true);
    o.setLabels(true);
    return () => {
      const s = useOverlayStore.getState();
      s.setConstellations(prev.constellations);
      s.setLabels(prev.labels);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadStarPack(HYG_MANIFEST_URL),
      loadSystemsPack(SOL_PACK_URL),
      loadSystemsPack(EXO_PACK_URL),
      loadOctreePack(OCTREE_MANIFEST_URL, { pool: getCosmosPool() }),
      loadOctreePack(GAIA_OCTREE_MANIFEST_URL, { pool: getCosmosPool() }),
      loadConstellationPack(CONSTELLATIONS_URL),
    ]).then(
      ([stars, sol, exo, octree, gaiaOctree, constellationPack]) => {
        if (cancelled) return;
        const combined = createCombinedSource(stars, [sol, exo]);
        const octreeCombined = combineOctreeSources([octree, gaiaOctree]);
        const overlay = buildOverlayData(constellationPack, stars);
        setPack({
          status: 'ready',
          sources: { stars, sol, exo, combined, octree, octreeCombined, overlay },
        });
      },
      (err: unknown) => {
        if (!cancelled) {
          setPack({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    testHook.ready = pack.status === 'ready';
  }, [pack]);

  const tree = useMemo(() => createScaleFrameTree(), []);
  const origin = useMemo(() => createOriginManager(tree, FLYTHROUGH3_START), [tree]);
  const { milkyWay } = useMemo(() => makeLocalGroup(), []);

  const handleController = useCallback((controller: FlightController) => {
    controllerHolder.current = controller;
    mirrorControllerState();
  }, []);

  const handleContextSwitch = useCallback((e: ContextSwitchEvent) => {
    setMountedSystemId(e.to === 'system' ? e.anchorId : null);
    mirrorControllerState();
  }, []);

  const sources = pack.status === 'ready' ? pack.sources : null;

  const streaming = useMemo<StreamingPolicy | null>(() => {
    if (sources?.octreeCombined === undefined) return null;
    return createMilkyWayStreaming({ origin, octree: sources.octreeCombined, milkyWay });
  }, [origin, sources, milkyWay]);

  useEffect(() => {
    streamingHolder.current = streaming;
    return () => {
      if (streamingHolder.current === streaming) streamingHolder.current = null;
    };
  }, [streaming]);

  const handleQc = useCallback(
    (qc: QualityController) => {
      if (streaming === null) return;
      wireQuality(streaming, (tier) => {
        testHook.qualityTier = tier;
      })(qc);
    },
    [streaming],
  );

  const mountedSystem = useMemo(() => {
    if (sources === null) return null;
    const id = mountedSystemId ?? M3_SOL_SYSTEM_ID;
    const system = sources.sol.getSystem(id) ?? sources.exo.getSystem(id);
    if (system === undefined) return null;
    const packUrl =
      sources.sol.getSystem(id) !== undefined ? SOL_PACK_URL : EXO_PACK_URL;
    return { system, packUrl };
  }, [sources, mountedSystemId]);

  if (pack.status !== 'ready' || streaming === null) return null;

  return (
    <SceneHost
      epochProvider={epochProvider}
      initialQualityTier="high"
      onQualityController={handleQc}
    >
      <color attach="background" args={['#02030a']} />
      <SoakProbe
        origin={origin}
        tree={tree}
        combined={pack.sources.combined}
        milkyWay={milkyWay}
        streaming={streaming}
        loops={SOAK3_LOOPS}
        onController={handleController}
        onContextSwitch={handleContextSwitch}
      />
      <GalaxyScene
        streaming={streaming}
        origin={origin}
        controllerRef={controllerHolder}
        milkyWayRadiusPc={milkyWay.radiusKpc * 1000}
      />
      <StarScene
        stars={pack.sources.stars}
        combined={pack.sources.combined}
        origin={origin}
        controllerRef={controllerHolder}
        streaming={streaming}
      />
      {pack.sources.overlay ? (
        <Overlays
          origin={origin}
          overlay={pack.sources.overlay}
          controllerRef={controllerHolder}
        />
      ) : null}
      {mountedSystem ? (
        <SystemScene
          system={mountedSystem.system}
          origin={origin}
          packUrl={mountedSystem.packUrl}
          controllerRef={controllerHolder}
        />
      ) : null}
    </SceneHost>
  );
}

/**
 * TASK-041 Phase 3 gate (`?debug=flythrough3` / `?debug=soak3`, §5.8). Loads the
 * exact M3 composition (full packs + HYG octree + streaming tier + procedural
 * Milky Way) and replaces user input with a self-measuring probe that replays the
 * committed recorded camera path. flythrough3 measures a single descent's frame
 * times + heap + streaming peak; soak3 loops the path back and forth, sampling
 * heap + loadedChunks to prove the memory plateau. Both pin the (paused) clock to
 * the frozen flythrough epoch so the path is deterministic and orbits cannot
 * contaminate frame deltas. Shares M3App's structure exactly — the gate measures
 * the SHIPPED pipeline (TASK-030/040 doctrine).
 */
function StreamingProbeApp({ kind }: { kind: 'flythrough3' | 'soak3' }): React.JSX.Element | null {
  const [pack, setPack] = useState<PackState>({ status: 'loading' });
  const [mountedSystemId, setMountedSystemId] = useState<BodyId | null>(null);

  useEffect(() => {
    installTimeGlue();
    clock.setEpochJD(FLYTHROUGH3_EPOCH_JD); // frozen epoch → deterministic Earth waypoint.
    clock.setPaused(true); // freeze orbits — the probe tests CAMERA + streaming.
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadStarPack(HYG_MANIFEST_URL),
      loadSystemsPack(SOL_PACK_URL),
      loadSystemsPack(EXO_PACK_URL),
      loadOctreePack(OCTREE_MANIFEST_URL, { pool: getCosmosPool() }),
    ]).then(
      ([stars, sol, exo, octree]) => {
        if (cancelled) return;
        const combined = createCombinedSource(stars, [sol, exo]);
        setPack({ status: 'ready', sources: { stars, sol, exo, combined, octree } });
      },
      (err: unknown) => {
        if (!cancelled) {
          setPack({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    testHook.ready = pack.status === 'ready';
  }, [pack]);

  const tree = useMemo(() => createScaleFrameTree(), []);
  const origin = useMemo(() => createOriginManager(tree, FLYTHROUGH3_START), [tree]);
  const { milkyWay } = useMemo(() => makeLocalGroup(), []);

  const handleController = useCallback((controller: FlightController) => {
    controllerHolder.current = controller;
    mirrorControllerState();
  }, []);

  const handleContextSwitch = useCallback((e: ContextSwitchEvent) => {
    setMountedSystemId(e.to === 'system' ? e.anchorId : null);
    mirrorControllerState();
  }, []);

  const sources = pack.status === 'ready' ? pack.sources : null;

  const streaming = useMemo<StreamingPolicy | null>(() => {
    if (sources?.octree === undefined) return null;
    return createMilkyWayStreaming({ origin, octree: sources.octree, milkyWay });
  }, [origin, sources, milkyWay]);

  useEffect(() => {
    streamingHolder.current = streaming;
    return () => {
      if (streamingHolder.current === streaming) streamingHolder.current = null;
    };
  }, [streaming]);

  const handleQc = useCallback(
    (qc: QualityController) => {
      if (streaming === null) return;
      wireQuality(streaming, (tier) => {
        testHook.qualityTier = tier;
      })(qc);
    },
    [streaming],
  );

  const mountedSystem = useMemo(() => {
    if (sources === null) return null;
    const id = mountedSystemId ?? M3_SOL_SYSTEM_ID;
    const system = sources.sol.getSystem(id) ?? sources.exo.getSystem(id);
    if (system === undefined) return null;
    const packUrl =
      sources.sol.getSystem(id) !== undefined ? SOL_PACK_URL : EXO_PACK_URL;
    return { system, packUrl };
  }, [sources, mountedSystemId]);

  if (pack.status !== 'ready' || streaming === null) return null;

  return (
    <SceneHost
      epochProvider={epochProvider}
      initialQualityTier="high"
      onQualityController={handleQc}
    >
      <color attach="background" args={['#02030a']} />
      {kind === 'soak3' ? (
        <SoakProbe
          origin={origin}
          tree={tree}
          combined={pack.sources.combined}
          milkyWay={milkyWay}
          streaming={streaming}
          loops={SOAK3_LOOPS}
          onController={handleController}
          onContextSwitch={handleContextSwitch}
        />
      ) : (
        <Flythrough3Probe
          origin={origin}
          tree={tree}
          combined={pack.sources.combined}
          milkyWay={milkyWay}
          streaming={streaming}
          onController={handleController}
          onContextSwitch={handleContextSwitch}
        />
      )}
      <GalaxyScene
        streaming={streaming}
        origin={origin}
        controllerRef={controllerHolder}
        milkyWayRadiusPc={milkyWay.radiusKpc * 1000}
      />
      <StarScene
        stars={pack.sources.stars}
        combined={pack.sources.combined}
        origin={origin}
        controllerRef={controllerHolder}
      />
      {mountedSystem ? (
        <SystemScene
          system={mountedSystem.system}
          origin={origin}
          packUrl={mountedSystem.packUrl}
          controllerRef={controllerHolder}
        />
      ) : null}
    </SceneHost>
  );
}

/**
 * Persistent aiming reticle — small and dim so it anchors "what am I pointing
 * at" without competing with the field. Part of the always-on HUD layer: stays
 * visible in clean view (it's the reference point for click/double-click-to-enter).
 */
function Crosshair(): React.JSX.Element {
  return (
    <div className="hud-crosshair" aria-hidden="true">
      <span className="hud-crosshair-h" />
      <span className="hud-crosshair-v" />
      <span className="hud-crosshair-dot" />
    </div>
  );
}

/**
 * Persistent location breadcrumb: `Galaxy › <System> › <Body>`. Always visible
 * (stays in clean view) so the user knows where they are and can pop back up a
 * level. The "Galaxy" segment is the simple, discoverable exit while inside a
 * system; it mirrors the Esc key. Subscribes to the selection store directly so
 * it never re-renders the Canvas.
 */
function Breadcrumb({
  systemName,
  combined,
  galaxyNavReady,
  onExit,
  onViewGalaxy,
  onEnterGalaxy,
}: {
  systemName: string | null;
  combined: CombinedSource;
  /** False while the procgen Milky Way worker is still loading (§5.8). */
  galaxyNavReady: boolean;
  onExit(): void;
  onViewGalaxy(): void;
  onEnterGalaxy(): void;
}): React.JSX.Element {
  const selectedId = useSelectionStore((s) => s.selectedId);
  const inSystem = systemName !== null;
  const selectedName =
    selectedId !== null ? combined.getBody(selectedId)?.name ?? selectedId : null;
  const bodyCrumb =
    selectedName !== null && selectedName !== systemName ? selectedName : null;

  const segs: ReadonlyArray<{
    key: string;
    label: string;
    onClick?: () => void;
    title?: string;
  }> = [
    {
      key: 'milkyway',
      label: 'Milky Way',
      onClick: onViewGalaxy,
      title: 'Fly out to see the whole Milky Way',
    },
    {
      key: 'galaxy',
      label: 'Galaxy',
      onClick: inSystem ? onExit : onEnterGalaxy,
      title: inSystem ? 'Exit to the galaxy (Esc)' : 'Descend into the Sol star field',
    },
    ...(inSystem ? [{ key: 'system', label: systemName }] : []),
    ...(bodyCrumb !== null ? [{ key: 'body', label: bodyCrumb }] : []),
  ];

  return (
    <nav className="hud-breadcrumb" aria-label="Location">
      {segs.map((seg, i) => (
        <Fragment key={seg.key}>
          {i > 0 ? (
            <span className="hud-breadcrumb-sep" aria-hidden="true">
              ›
            </span>
          ) : null}
          {seg.onClick ? (
            (() => {
              const scaleNav =
                !galaxyNavReady &&
                (seg.key === 'milkyway' || (seg.key === 'galaxy' && !inSystem));
              return (
            <button
              type="button"
              className="hud-breadcrumb-seg hud-breadcrumb-exit"
              disabled={scaleNav}
              onClick={scaleNav ? undefined : seg.onClick}
              title={
                scaleNav ? 'Preparing Milky Way view…' : (seg.title ?? '')
              }
            >
              ◂ {seg.label}
            </button>
              );
            })()
          ) : (
            <span
              className={`hud-breadcrumb-seg${
                i === segs.length - 1 ? ' hud-breadcrumb-current' : ''
              }`}
            >
              {seg.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

function fmtSpeed(v: number): string {
  if (v >= 100) return Math.round(v).toLocaleString('en-US');
  if (v >= 1) return v.toFixed(1);
  if (v >= 0.01) return v.toFixed(2);
  return v.toPrecision(2);
}

/**
 * Speed/scale readout (bottom-left). Reads the live controller on a rAF loop and
 * writes to the DOM imperatively — never React state — so per-frame speed changes
 * cost zero renders (§5.12). Hidden while stationary to keep the view clean; the
 * unit tracks the scale context (pc/s in the galaxy, AU/s inside a system).
 */
function SpeedReadout(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = (): void => {
      const c = controllerHolder.current;
      const container = containerRef.current;
      const value = valueRef.current;
      if (c && container && value) {
        const v = c.state.speedUnitsPerS;
        if (v < 1e-6) {
          container.style.visibility = 'hidden';
        } else {
          container.style.visibility = 'visible';
          const txt = `${fmtSpeed(v)} ${c.contextId === 'system' ? 'AU/s' : 'pc/s'}`;
          if (txt !== last) {
            value.textContent = txt;
            last = txt;
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="hud-speed" ref={containerRef} aria-hidden="true">
      <Icon name="gauge" size={14} />
      <span ref={valueRef} className="hud-speed-value" />
    </div>
  );
}

function ContextLostOverlay(): React.JSX.Element {
  return (
    <div className="context-lost-overlay">
      <div className="context-lost-box">
        <p>Graphics context lost — reload to continue</p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    </div>
  );
}

/** TASK-006 debug scene, unchanged: the no-pack fallback and CI flythrough target. */
function DebugApp() {
  return (
    <>
      <SceneHost>
        <color attach="background" args={['#02030a']} />
        <DebugMarkers />
      </SceneHost>

      <div className="hud">
        <div className="hud-panel hud-panel--info">
          <h1>cosmos</h1>
          <div className="dim">Phase 0 — debug markers (12+ OOM)</div>
          <div className="dim">WASD move · R/F up/down · drag to look · Shift/Ctrl speed</div>
        </div>
        <DebugHud />
      </div>
    </>
  );
}

/**
 * M2 composition (TASK-029): load the HYG pack + Sol/exo systems packs in
 * parallel, merge into a combined source, and wire the full explorer — star
 * field, automatic galaxy⇄system descent, simulation time, picking, search,
 * bookmarks. React owns structure only; offsets/positions flow imperatively (§2.2).
 */
function StarApp() {
  const [pack, setPack] = useState<PackState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  /** WebGL2 is required by the renderer; probed once so we show a clear message instead of
   *  a blank/broken canvas on a browser/device without it (error-handling-audit.md §3.2). */
  const webgl2 = useMemo(() => isWebGL2Available(), []);
  /** System mounted in the Canvas while `contextId === 'system'` (rare React state). */
  const [mountedSystemId, setMountedSystemId] = useState<BodyId | null>(null);
  /** Procgen Milky Way on the visible cut — gates scale breadcrumbs (§5.8 / M3 waitReady). */
  const [galaxyNavReady, setGalaxyNavReady] = useState(false);
  const handleContextLost = useCallback(() => setContextLost(true), []);
  const cleanView = useHudStore((s) => s.cleanView);
  /** Chrome auto-hides after a few seconds of no input, for an unobstructed view. */
  const [idle, setIdle] = useState(false);
  const idleRef = useRef(false);
  const chromeHidden = cleanView || idle;

  // Install the time glue and start the clock once.
  useEffect(() => {
    installTimeGlue();
  }, []);

  // Auto-hide on inactivity. A ref gates the state write so routine pointer moves
  // (which only reschedule the timer) never re-render — only idle transitions do.
  // Held back while a panel is open so it can't vanish mid-interaction.
  useEffect(() => {
    const IDLE_MS = 4000;
    let timer: ReturnType<typeof setTimeout>;
    const setIdleTo = (next: boolean): void => {
      if (idleRef.current === next) return;
      idleRef.current = next;
      setIdle(next);
    };
    const schedule = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const s = useHudStore.getState();
        // Keep the chrome up while a panel is open OR a guided tour is running, so the
        // tour card + cinematic letterbox don't vanish mid-tour with no pointer input.
        if (s.searchOpen || s.bookmarksOpen || useTourStore.getState().active !== null) {
          schedule();
          return;
        }
        setIdleTo(true);
      }, IDLE_MS);
    };
    const onActivity = (): void => {
      setIdleTo(false);
      schedule();
    };
    const events: readonly string[] = ['pointermove', 'pointerdown', 'keydown', 'wheel'];
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });
    schedule();
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, onActivity);
    };
  }, []);

  // Clean view (H): collapse all chrome to bare crosshair. Ignored while typing
  // in an input so it never fights the search palette / bookmark fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'h' && e.key !== 'H') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      useHudStore.getState().toggleCleanView();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // All packs load in parallel at startup (§6 M3/M4a: no loading screen between scale
  // tiers AFTER ready). Both octrees decode through the shared worker pool; the Gaia
  // pack is loaded alongside HYG (ADR-006 §4) — same loader, no parallel path.
  useEffect(() => {
    let cancelled = false;
    setPack({ status: 'loading' });
    Promise.all([
      loadStarPack(HYG_MANIFEST_URL),
      loadSystemsPack(SOL_PACK_URL),
      loadSystemsPack(EXO_PACK_URL),
      loadOctreePack(OCTREE_MANIFEST_URL, { pool: getCosmosPool() }),
      loadOctreePack(GAIA_OCTREE_MANIFEST_URL, { pool: getCosmosPool() }),
      loadConstellationPack(CONSTELLATIONS_URL),
    ]).then(
      ([stars, sol, exo, octree, gaiaOctree, constellationPack]) => {
        if (cancelled) return;
        const combined = createCombinedSource(stars, [sol, exo]);
        // ADR-006 §5: HYG + Gaia stream through ONE policy (one cut, one coverage).
        const octreeCombined = combineOctreeSources([octree, gaiaOctree]);
        const overlay = buildOverlayData(constellationPack, stars);
        setPack({
          status: 'ready',
          sources: { stars, sol, exo, combined, octree, octreeCombined, overlay },
        });
      },
      (err: unknown) => {
        if (!cancelled) {
          setPack({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    testHook.ready = pack.status === 'ready';
  }, [pack]);

  // Selection → test hook + exploration history (every successful selection).
  useEffect(() => {
    const apply = (id: BodyId | null): void => {
      testHook.selectedId = id;
      if (id !== null) useHistoryStore.getState().push(id, new Date().toISOString());
    };
    apply(useSelectionStore.getState().selectedId);
    return useSelectionStore.subscribe((s) => apply(s.selectedId));
  }, []);

  // The frame tree + origin manager outlive the Canvas: the anchor scan, goTo
  // targets, and the star render offset all resolve through them.
  const tree = useMemo(() => createScaleFrameTree(), []);
  const origin = useMemo(() => createOriginManager(tree, INITIAL_CAMERA), [tree]);

  // M3: deterministic local group; the Milky Way is index 0 at the universe origin
  // and its seed drives the procedural star cloud (§5.6/§5.8).
  const { milkyWay } = useMemo(() => makeLocalGroup(), []);

  // The flight controller is created inside the Canvas (it needs the R3F frame
  // loop); the HUD and glue reach it through the shared holder at event time only.
  const handleController = useCallback((controller: FlightController) => {
    controllerHolder.current = controller;
    mirrorControllerState();
  }, []);

  const handleContextSwitch = useCallback((e: ContextSwitchEvent) => {
    setMountedSystemId(e.to === 'system' ? e.anchorId : null);
    mirrorControllerState();
  }, []);

  // The goto coordinator (two-leg planet chaining + bookmark restore) needs the
  // combined source; rebuild it when the packs (re)load.
  const sources = pack.status === 'ready' ? pack.sources : null;

  // M4a streaming policy — built once the octree packs are ready, sharing the module
  // worker pool. Fed the COMBINED HYG + Gaia octree (ADR-006 §5) so one cut +
  // catalogCoverage() drives the procgen fade and the monolith gate. Published to the
  // test hook holder for the ≤ 4 Hz stats mirror.
  const streaming = useMemo<StreamingPolicy | null>(() => {
    if (sources?.octreeCombined === undefined) return null;
    return createMilkyWayStreaming({ origin, octree: sources.octreeCombined, milkyWay });
  }, [origin, sources, milkyWay]);

  // Publish to the test-hook holder for the ≤ 4 Hz stats mirror. The policy lives
  // for the app session (like the module worker pool) — StarApp is the root and
  // never truly unmounts, so we do NOT dispose on a (StrictMode/HMR) fake unmount,
  // which would tear down the memoized policy and leave a dead reference behind.
  useEffect(() => {
    streamingHolder.current = streaming;
    return () => {
      if (streamingHolder.current === streaming) streamingHolder.current = null;
    };
  }, [streaming]);

  // Same gate as e2e `waitReady`: do not start Milky Way ↔ Galaxy flights until
  // the procgen chunk is drawable. GalaxyScene stays mounted; only breadcrumbs wait.
  useEffect(() => {
    if (streaming === null) {
      setGalaxyNavReady(false);
      return;
    }
    let raf = 0;
    let cancelled = false;
    const tick = (): void => {
      if (cancelled) return;
      if (streaming.stats.renderedPoints >= MILKY_WAY_STAR_COUNT) {
        setGalaxyNavReady(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    setGalaxyNavReady(false);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [streaming]);

  // Adaptive quality: relay the SceneHost tier to the streaming point cap + test
  // hook (§9). Stable across renders for the same streaming policy.
  const handleQc = useCallback(
    (qc: QualityController) => {
      qcRef.current = qc; // dev/E2E tier override reaches it via window.__cosmosDev
      if (streaming === null) return;
      wireQuality(streaming, (tier) => {
        testHook.qualityTier = tier;
      })(qc);
    },
    [streaming],
  );
  const goto = useMemo(
    () =>
      sources
        ? createGoToCoordinator({
            controllerRef: controllerHolder,
            tree,
            combined: sources.combined,
            sources: [sources.sol, sources.exo],
            clock,
          })
        : null,
    [sources, tree],
  );
  useEffect(() => goto?.start(), [goto]);

  const handleGoTo = useCallback(
    (id: BodyId) => {
      useSelectionStore.getState().select(id);
      goto?.goTo(id);
    },
    [goto],
  );

  // ── Guided tour (TASK-052, §5.12; BUG-2 dwell auto-advance + galaxy framing) ───
  const tourDwellRef = useRef<{
    timer: ReturnType<typeof setTimeout> | undefined;
    deadlineMs: number;
    stepIndex: number;
  }>({ timer: undefined, deadlineMs: 0, stepIndex: -1 });

  const clearTourDwell = useCallback((): void => {
    const d = tourDwellRef.current;
    if (d.timer !== undefined) {
      clearTimeout(d.timer);
      d.timer = undefined;
    }
    d.stepIndex = -1;
    d.deadlineMs = 0;
  }, []);

  // Resolve a tour step target to a galaxy-context world position the spline flies to.
  const resolveTargetUP = useCallback(
    (id: BodyId): UniversePosition | null => {
      if (sources === null) return null;
      const body = sources.combined.getBody(id);
      if (body !== undefined && body.kind === 'star') {
        const p = body.positionPc;
        return { context: 'galaxy', local: [p[0], p[1], p[2]] };
      }
      // A planet target ⇒ fly to its host system's galaxy position.
      const sys = sources.sol.systemOfBody(id) ?? sources.exo.systemOfBody(id);
      const hostId = sys?.star.id ?? id;
      const hp = sources.combined.hostPositionPc(hostId);
      if (hp !== undefined) return { context: 'galaxy', local: [hp[0], hp[1], hp[2]] };
      return null;
    },
    [sources],
  );

  const flyToStepRef = useRef<(stepIndex: number) => boolean>(() => false);

  const scheduleTourDwell = useCallback(
    (stepIndex: number, dwellMs?: number): void => {
      const tour = useTourStore.getState().active;
      if (tour === null || !useTourStore.getState().playing) return;
      const step = tour.steps[stepIndex];
      if (step === undefined) return;

      const d = tourDwellRef.current;
      if (d.timer !== undefined) clearTimeout(d.timer);

      const ms = dwellMs ?? step.dwellMs;
      d.stepIndex = stepIndex;
      d.deadlineMs = performance.now() + ms;
      d.timer = setTimeout(() => {
        d.timer = undefined;
        const state = useTourStore.getState();
        if (state.active === null || !state.playing || state.stepIndex !== stepIndex) return;
        if (stepIndex >= state.active.steps.length - 1) return;
        state.next();
        flyToStepRef.current(stepIndex + 1);
      }, ms);
    },
    [],
  );

  // Fly the camera to a tour step: a cinematic spline frames the target, then (if the
  // step requests it) auto-orbits during the dwell (nav v5, §5.3). Splines carry
  // UniversePositions so the path survives a context switch.
  // Returns true once the cinematic flight was actually started. Callers that fire on the
  // tour's inactive→active transition retry on false: the flight controller mounts inside
  // the R3F Canvas (handleController) asynchronously and is NOT gated by `ready` (data pack
  // only), so under CI SwiftShader contention a tour can go active a beat before the
  // controller exists. A single fire-and-drop then silently skipped the whole cinematic —
  // the m4a flake. See docs/research/m4a-tour-cinematic-flake-rootcause.md.
  const flyToStep = useCallback(
    (stepIndex: number): boolean => {
      clearTourDwell();
      const ctrl = controllerHolder.current;
      const tour = useTourStore.getState().active;
      if (ctrl === null || tour === null || stepIndex < 0 || stepIndex >= tour.steps.length) {
        return false;
      }
      const step = tour.steps[stepIndex]!;
      const target = resolveTargetUP(step.targetId);
      if (target === null) return false;
      const pos = ctrl.state.position;
      if (pos.context !== target.context) return false; // tour flies at galaxy scale
      const from: UniversePosition = {
        context: pos.context,
        local: [pos.local[0], pos.local[1], pos.local[2]],
      };
      const spline = buildFlyToSpline(`tour-${tour.id}-${stepIndex}`, from, target, {
        letterbox: true,
        minStandoffPc: TOUR_FRAMING_STANDOFF_PC,
      });
      ctrl.playSpline(spline, {
        onEnd: (completed) => {
          if (completed && step.orbit === true) {
            ctrl.orbitBody({ center: target, radiusM: TOUR_ORBIT_RADIUS_M });
          }
          if (completed) scheduleTourDwell(stepIndex);
        },
      });
      return true;
    },
    [clearTourDwell, resolveTargetUP, scheduleTourDwell],
  );

  flyToStepRef.current = flyToStep;

  const handleTourExit = useCallback(() => {
    clearTourDwell();
    controllerHolder.current?.cancelCinematic();
  }, [clearTourDwell]);

  // Pause/resume gates the dwell timer and the cinematic orbit (BUG-2 §2a).
  useEffect(() => {
    let wasPlaying = useTourStore.getState().playing;
    const unsub = useTourStore.subscribe((s) => {
      if (s.active === null) {
        clearTourDwell();
        wasPlaying = false;
        return;
      }
      if (s.playing === wasPlaying) return;
      const ctrl = controllerHolder.current;
      if (s.playing) {
        ctrl?.resumeCinematic();
        const d = tourDwellRef.current;
        if (d.stepIndex >= 0 && d.timer === undefined) {
          const remaining = d.deadlineMs - performance.now();
          if (remaining > 0) scheduleTourDwell(d.stepIndex, remaining);
        }
      } else {
        ctrl?.pauseCinematic();
        const d = tourDwellRef.current;
        if (d.timer !== undefined) {
          clearTimeout(d.timer);
          d.timer = undefined;
        }
      }
      wasPlaying = s.playing;
    });
    return unsub;
  }, [clearTourDwell, scheduleTourDwell]);

  // Drive step-0 flight when the tour STARTS (next/prev flights come from TourChrome's
  // onStepChange → flyToStep, so we only act on the inactive→active transition here to
  // avoid double-firing). The flight is RETRIED until it engages: the controller mounts
  // async (handleController, inside the Canvas) and isn't gated by `ready`, so on a slow
  // (contended CI SwiftShader) boot the tour can go active before the controller exists.
  // Retrying until flyToStep succeeds — instead of firing once and dropping the cinematic
  // silently — is the root-cause fix for the m4a tour flake; a true failure (controller
  // never mounts within the budget) is surfaced via reportError, not swallowed.
  useEffect(() => {
    const START_TIMEOUT_MS = 10_000;
    const RETRY_MS = 50;
    let wasActive = useTourStore.getState().active !== null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const startStepFlight = (stepIndex: number): void => {
      const deadline = performance.now() + START_TIMEOUT_MS;
      const attempt = (): void => {
        if (useTourStore.getState().active === null) return; // tour exited before it engaged
        if (flyToStep(stepIndex)) return; // cinematic started
        if (performance.now() > deadline) {
          reportError(
            new Error(`tour flight to step ${stepIndex} never engaged (controller/target not ready)`),
            'invariant',
            { where: 'App.startStepFlight' },
          );
          return;
        }
        timer = setTimeout(attempt, RETRY_MS);
      };
      attempt();
    };

    const unsub = useTourStore.subscribe((s) => {
      const isActive = s.active !== null;
      if (isActive && !wasActive) startStepFlight(s.stepIndex);
      wasActive = isActive;
    });
    return () => {
      unsub();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [flyToStep]);

  // Dev/E2E control surface: deterministic tier override + tour start/stop. `qcRef` is
  // populated when SceneHost hands us the quality controller.
  const qcRef = useRef<QualityController | null>(null);
  useEffect(() => {
    window.__cosmosDev = {
      setTier: (tier) => qcRef.current?.setTier(tier),
      startTour: () => useTourStore.getState().start(GRAND_TOUR),
      stopTour: () => useTourStore.getState().stop(),
      focusFirstLabel: () => {
        const ctrl = controllerHolder.current;
        const label = sources?.overlay?.labels[0];
        if (ctrl === null || label === undefined) return;
        const p = label.positionPc;
        const target: UniversePosition = { context: 'galaxy', local: [p[0], p[1], p[2]] };
        // Stop ~1 pc short (the galaxy⇄system enter threshold is ≪ 1 pc) so we
        // reorient toward the star and stay in galaxy context instead of descending.
        ctrl.goTo({ target, lookAtTarget: target, arrivalDistanceM: CONTEXT_UNIT_METERS.galaxy, durationMs: 1500 });
      },
    };
    return () => {
      delete window.__cosmosDev;
    };
  }, [sources]);

  // Esc: pop up one level — exit the system if inside, else clear the selection.
  // G: frame (zoom-to-fit) the current system. (Not F — KeyF is "move down" in the
  // flight controller.) Both skipped while typing so they never steal keys from
  // the search/bookmark fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape') {
        // Cinematic letterbox is a modal-ish view; Esc exits it first so it is never
        // a dead-end if the toggle is hard to reach (BUG-3, TASK-052).
        if (useOverlayStore.getState().cinematic) {
          useOverlayStore.getState().setCinematic(false);
        } else if (controllerHolder.current?.contextId === 'system') {
          goto?.exitSystem();
        } else if (useSelectionStore.getState().selectedId !== null) {
          useSelectionStore.getState().select(null);
        }
      } else if (e.key === 'g' || e.key === 'G') {
        goto?.frameSystem();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goto]);

  const mountedSystem = useMemo(() => {
    if (sources === null || mountedSystemId === null) return null;
    const system = sources.sol.getSystem(mountedSystemId) ?? sources.exo.getSystem(mountedSystemId);
    if (system === undefined) return null;
    const packUrl = sources.sol.getSystem(mountedSystemId) !== undefined ? SOL_PACK_URL : EXO_PACK_URL;
    return { system, packUrl };
  }, [sources, mountedSystemId]);

  return (
    <>
      {contextLost ? <ContextLostOverlay /> : null}
      {!webgl2 ? <WebGLUnsupportedCard /> : null}
      <main id="main">
      {pack.status === 'ready' && webgl2 ? (
        <SceneHost
          onContextLost={handleContextLost}
          epochProvider={epochProvider}
          initialQualityTier="high"
          onQualityController={handleQc}
        >
          <color attach="background" args={['#02030a']} />
          {/* A throw while mounting/rendering a scene component renders an empty scene
              (fallback null) instead of crashing the whole app; the HUD (a sibling outside
              the Canvas) keeps working. Frame-loop throws are not caught here — see ErrorBoundary. */}
          <ErrorBoundary context="scene" fallback={() => null}>
            <NavDriver
              origin={origin}
              tree={tree}
              stars={pack.sources.stars}
              combined={pack.sources.combined}
              streaming={streaming ?? undefined}
              milkyWay={milkyWay}
              onController={handleController}
              onContextSwitch={handleContextSwitch}
            />
            {DEBUG_BREADCRUMB_PROFILE ? <BreadcrumbFrameProfiler /> : null}
            {streaming ? (
              <GalaxyScene
                streaming={streaming}
                origin={origin}
                controllerRef={controllerHolder}
                milkyWayRadiusPc={milkyWay.radiusKpc * 1000}
              />
            ) : null}
            <StarScene
              stars={pack.sources.stars}
              combined={pack.sources.combined}
              origin={origin}
              controllerRef={controllerHolder}
              streaming={streaming ?? undefined}
              onActivate={handleGoTo}
            />
            {pack.sources.overlay ? (
              <Overlays
                origin={origin}
                overlay={pack.sources.overlay}
                controllerRef={controllerHolder}
              />
            ) : null}
            {mountedSystem ? (
              <SystemScene
                system={mountedSystem.system}
                origin={origin}
                packUrl={mountedSystem.packUrl}
                controllerRef={controllerHolder}
              />
            ) : null}
          </ErrorBoundary>
        </SceneHost>
      ) : null}

      <div className="hud">
        {pack.status === 'ready' ? <Crosshair /> : null}
        {pack.status === 'ready' ? (
          <Breadcrumb
            systemName={mountedSystem?.system.name ?? null}
            combined={pack.sources.combined}
            galaxyNavReady={galaxyNavReady}
            onExit={() => goto?.exitSystem()}
            onViewGalaxy={() => goto?.viewGalaxy()}
            onEnterGalaxy={() => goto?.enterGalaxy()}
          />
        ) : null}
        <div className={`hud-chrome${chromeHidden ? ' hud-chrome--hidden' : ''}`}>
          {pack.status === 'ready' ? <SpeedReadout /> : null}
          <div className="hud-panel hud-panel--info">
            <h1>cosmos</h1>
            {pack.status === 'loading' ? (
              <div className="dim">loading catalog…</div>
            ) : null}
            {pack.status === 'error' ? (
              <>
                <div className="dim">catalog failed to load: {pack.message}</div>
                <button
                  className="hud-retry"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  Retry
                </button>
              </>
            ) : null}
            {pack.status === 'ready' && streaming !== null && !galaxyNavReady ? (
              <div className="dim">preparing Milky Way view…</div>
            ) : null}
            <div className="dim">
              WASD move · R/F up·down · drag to look · double-click to fly · Ctrl+K search · G frame · H clean
            </div>
            {pack.status === 'ready' ? (
              <div className="dim">
                M4a — {pack.sources.stars.batch.count.toLocaleString('en-US')} stars (HYG) +
                Gaia field · Sol + {pack.sources.exo.systems.length} exoplanet systems
              </div>
            ) : null}
            {pack.status === 'ready' ? (
              <button
                type="button"
                className="hud-tour-start"
                onClick={() => useTourStore.getState().start(GRAND_TOUR)}
              >
                ▶ Guided tour
              </button>
            ) : null}
          </div>
          {pack.status === 'ready' && goto ? (
            <Hud
              source={pack.sources.combined}
              currentSystemId={mountedSystemId}
              onExitSystem={() => goto.exitSystem()}
              onGoTo={handleGoTo}
              onSyncToNow={syncClockToNow}
              onCapture={goto.capture}
              onGoToBookmark={goto.goToBookmark}
              onTourStepChange={flyToStep}
              onTourExit={handleTourExit}
            />
          ) : null}
        </div>
      </div>
      </main>
    </>
  );
}
