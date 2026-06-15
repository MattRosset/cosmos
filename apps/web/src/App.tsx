import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BodyId } from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import {
  loadStarPack,
  loadSystemsPack,
  createCombinedSource,
  type StarDataSource,
  type SystemsSource,
  type CombinedSource,
} from '@cosmos/data';
import type { FlightController, ContextSwitchEvent } from '@cosmos/nav';
import { SceneHost } from '@cosmos/scene-host';
import { useSelectionStore, useHistoryStore } from '@cosmos/app-state';
import { INITIAL_CAMERA, NavDriver } from './scene/NavDriver';
import { StarScene } from './scene/StarScene';
import { SystemScene } from './scene/SystemScene';
import { Hud } from './hud/Hud';
import { DebugHud } from './scene/DebugHud';
import { DebugMarkers } from './scene/DebugMarkers';
import { JitterProbe } from './scene/JitterProbe';
import { CtxSwitchProbe, CTX_START } from './scene/CtxSwitchProbe';
import { clock, epochProvider, installTimeGlue, syncClockToNow } from './glue/time';
import { createGoToCoordinator } from './glue/goto';
import { testHook, controllerHolder, mirrorControllerState } from './glue/test-hook';

/** TASK-006 debug flythrough scene, behind the query flag only. */
const DEBUG_MARKERS =
  new URLSearchParams(window.location.search).get('debug') === 'markers';

/** TASK-017 rendered jitter gate (`?debug=jitter`): no pack, no HUD. */
const DEBUG_JITTER =
  new URLSearchParams(window.location.search).get('debug') === 'jitter';

/** TASK-030 context-switch gate (`?debug=ctxswitch`): full packs, scripted descent. */
const DEBUG_CTXSWITCH =
  new URLSearchParams(window.location.search).get('debug') === 'ctxswitch';

const HYG_MANIFEST_URL = '/packs/manifest.json';
const SOL_PACK_URL = '/packs/systems-sol.json';
const EXO_PACK_URL = '/packs/systems-exo.json';

interface Sources {
  readonly stars: StarDataSource;
  readonly sol: SystemsSource;
  readonly exo: SystemsSource;
  readonly combined: CombinedSource;
}

type PackState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly sources: Sources };

export function App() {
  if (DEBUG_JITTER) return <JitterApp />;
  if (DEBUG_CTXSWITCH) return <CtxSwitchApp />;
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
  const handleContextLost = useCallback(() => setContextLost(true), []);

  // Install the time glue and start the clock once.
  useEffect(() => {
    installTimeGlue();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPack({ status: 'loading' });
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
      {pack.status === 'ready' ? (
        <SceneHost onContextLost={handleContextLost} epochProvider={epochProvider}>
          <color attach="background" args={['#02030a']} />
          <NavDriver
            origin={origin}
            tree={tree}
            stars={pack.sources.stars}
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
      ) : null}

      <div className="hud">
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
          {pack.status === 'ready' ? (
            <>
              <div className="dim">
                M2 — {pack.sources.stars.batch.count.toLocaleString('en-US')} stars (HYG) ·
                Sol + {pack.sources.exo.systems.length} exoplanet systems
              </div>
              <div className="dim">
                WASD move · drag to look · Ctrl+K search · click a body
              </div>
            </>
          ) : null}
        </div>
        {pack.status === 'ready' && goto ? (
          <Hud
            source={pack.sources.combined}
            onGoTo={handleGoTo}
            onSyncToNow={syncClockToNow}
            onCapture={goto.capture}
            onGoToBookmark={goto.goToBookmark}
          />
        ) : null}
      </div>
    </>
  );
}
