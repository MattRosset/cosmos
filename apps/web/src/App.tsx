import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BodyId } from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import { loadStarPack, type StarDataSource } from '@cosmos/data';
import type { FlightController } from '@cosmos/nav';
import { SceneHost } from '@cosmos/scene-host';
import { useSelectionStore } from '@cosmos/app-state';
import { INITIAL_CAMERA, NavDriver } from './scene/NavDriver';
import { StarScene } from './scene/StarScene';
import { Hud } from './hud/Hud';
import { DebugHud } from './scene/DebugHud';
import { DebugMarkers } from './scene/DebugMarkers';
import { JitterProbe } from './scene/JitterProbe';

/** TASK-006 debug flythrough scene, behind the query flag only. */
const DEBUG_MARKERS =
  new URLSearchParams(window.location.search).get('debug') === 'markers';

/** TASK-017 rendered jitter gate (`?debug=jitter`): no pack, no HUD. */
const DEBUG_JITTER =
  new URLSearchParams(window.location.search).get('debug') === 'jitter';

/** Camera-to-target distance at which a goTo flight stops: 10^13 m ≈ 67 AU. */
const ARRIVAL_DISTANCE_M = 1e13;

/**
 * E2E/dev test hook (TASK-015): event-driven mirrors of app state — written
 * only from store subscriptions and goTo lifecycle events, never from a frame
 * callback. Read by e2e/tests/m1.spec.ts; harmless in production.
 */
interface CosmosTestHook {
  ready: boolean;
  goToActive: boolean;
  selectedId: string | null;
}

declare global {
  interface Window {
    __cosmos?: CosmosTestHook;
  }
}

const testHook: CosmosTestHook = { ready: false, goToActive: false, selectedId: null };
window.__cosmos = testHook;
useSelectionStore.subscribe((s) => {
  testHook.selectedId = s.selectedId;
});

type PackState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly source: StarDataSource };

export function App() {
  if (DEBUG_JITTER) return <JitterApp />;
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
 * M1 composition (TASK-015): load the HYG pack, render it through
 * render-stars, wire picking/search/go-to. React owns structure only —
 * offsets and distances flow imperatively through the frame loop (§2.2).
 */
function StarApp() {
  const [pack, setPack] = useState<PackState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const handleContextLost = useCallback(() => setContextLost(true), []);

  useEffect(() => {
    let cancelled = false;
    setPack({ status: 'loading' });
    loadStarPack('/packs/manifest.json').then(
      (source) => {
        if (!cancelled) setPack({ status: 'ready', source });
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

  // The origin manager outlives the Canvas: HUD goTo targets and the star
  // render offset both resolve through it.
  const origin = useMemo(
    () => createOriginManager(createScaleFrameTree(), INITIAL_CAMERA),
    [],
  );

  // The flight controller is created inside the Canvas (it needs the R3F frame
  // loop); the HUD reaches it through this ref at event time only.
  const controllerRef = useRef<FlightController | null>(null);
  const handleController = useCallback((controller: FlightController) => {
    controllerRef.current = controller;
  }, []);

  const handleGoTo = useCallback(
    (id: BodyId) => {
      if (pack.status !== 'ready') return;
      useSelectionStore.getState().select(id);
      const star = pack.source.getBody(id);
      const controller = controllerRef.current;
      if (!star || !controller) return;
      controller.goTo({
        target: { context: 'galaxy', local: star.positionPc },
        arrivalDistanceM: ARRIVAL_DISTANCE_M,
      });
      testHook.goToActive = controller.goToActive;
      controller.onGoToEnd(() => {
        testHook.goToActive = false;
      });
    },
    [pack],
  );

  return (
    <>
      {contextLost ? <ContextLostOverlay /> : null}
      {pack.status === 'ready' ? (
        <SceneHost onContextLost={handleContextLost}>
          <color attach="background" args={['#02030a']} />
          <NavDriver
            origin={origin}
            source={pack.source}
            onController={handleController}
          />
          <StarScene
            source={pack.source}
            origin={origin}
            controllerRef={controllerRef}
          />
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
                M1 — the real night sky ({pack.source.batch.count.toLocaleString('en-US')}{' '}
                stars, HYG)
              </div>
              <div className="dim">
                WASD move · drag to look · Ctrl+K search · click a star
              </div>
            </>
          ) : null}
        </div>
        {pack.status === 'ready' ? (
          <Hud source={pack.source} onGoTo={handleGoTo} />
        ) : null}
      </div>
    </>
  );
}
