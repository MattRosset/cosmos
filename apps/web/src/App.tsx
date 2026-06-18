import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BodyId } from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import {
  loadStarPack,
  loadSystemsPack,
  loadOctreePack,
  createCombinedSource,
  type StarDataSource,
  type SystemsSource,
  type CombinedSource,
  type OctreeSource,
} from '@cosmos/data';
import type { FlightController, ContextSwitchEvent } from '@cosmos/nav';
import { SceneHost, type QualityController } from '@cosmos/scene-host';
import type { StreamingPolicy } from '@cosmos/streaming';
import { useSelectionStore, useHistoryStore, useHudStore } from '@cosmos/app-state';
import { Icon } from '@cosmos/ui';
import { INITIAL_CAMERA, NavDriver } from './scene/NavDriver';
import { StarScene } from './scene/StarScene';
import { SystemScene } from './scene/SystemScene';
import { GalaxyScene } from './scene/GalaxyScene';
import { Hud } from './hud/Hud';
import { DebugHud } from './scene/DebugHud';
import { DebugMarkers } from './scene/DebugMarkers';
import { JitterProbe } from './scene/JitterProbe';
import { CtxSwitchProbe, CTX_START } from './scene/CtxSwitchProbe';
import { M3DescentProbe, M3_START } from './scene/M3DescentProbe';
import { Flythrough3Probe } from './scene/Flythrough3Probe';
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

/** TASK-041 memory-soak gate (`?debug=soak3`, §5.8); `?loops=N` overrides the count. */
const DEBUG_SOAK3 = new URLSearchParams(window.location.search).get('debug') === 'soak3';
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

interface Sources {
  readonly stars: StarDataSource;
  readonly sol: SystemsSource;
  readonly exo: SystemsSource;
  readonly combined: CombinedSource;
  /** HYG octree (M3 streaming tier); absent in debug modes that don't stream. */
  readonly octree?: OctreeSource;
}

type PackState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly sources: Sources };

export function App() {
  if (DEBUG_JITTER) return <JitterApp />;
  if (DEBUG_CTXSWITCH) return <CtxSwitchApp />;
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
        if (s.searchOpen || s.bookmarksOpen) {
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

  // All packs load in parallel at startup (§6 M3: no loading screen between scale
  // tiers AFTER ready). The octree decodes through the shared worker pool.
  useEffect(() => {
    let cancelled = false;
    setPack({ status: 'loading' });
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

  // M3 streaming policy — built once the octree pack is ready, sharing the module
  // worker pool. Published to the test hook holder for the ≤ 4 Hz stats mirror.
  const streaming = useMemo<StreamingPolicy | null>(() => {
    if (sources?.octree === undefined) return null;
    return createMilkyWayStreaming({ origin, octree: sources.octree, milkyWay });
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
        if (controllerHolder.current?.contextId === 'system') {
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
      <main id="main">
      {pack.status === 'ready' ? (
        <SceneHost
          onContextLost={handleContextLost}
          epochProvider={epochProvider}
          initialQualityTier="high"
          onQualityController={handleQc}
        >
          <color attach="background" args={['#02030a']} />
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
            onActivate={handleGoTo}
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
                M2 — {pack.sources.stars.batch.count.toLocaleString('en-US')} stars (HYG) ·
                Sol + {pack.sources.exo.systems.length} exoplanet systems
              </div>
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
            />
          ) : null}
        </div>
      </div>
      </main>
    </>
  );
}
