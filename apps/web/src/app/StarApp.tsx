import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BodyId, UniversePosition } from '@cosmos/core-types';
import { CONTEXT_UNIT_METERS } from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import { loadStarPack, loadSystemsPack, loadOctreePack, loadConstellationPack, createCombinedSource } from '@cosmos/data';
import type { FlightController, ContextSwitchEvent } from '@cosmos/nav';
import { SceneHost, type QualityController } from '@cosmos/scene-host';
import type { StreamingPolicy } from '@cosmos/streaming';
import { useSelectionStore, useHistoryStore, useHudStore, useTourStore, useOverlayStore } from '@cosmos/app-state';
import { INITIAL_CAMERA, NavDriver } from '../scene/NavDriver';
import { StarScene } from '../scene/StarScene';
import { SystemScene } from '../scene/SystemScene';
import { GalaxyScene } from '../scene/GalaxyScene';
import { Overlays } from '../scene/Overlays';
import { BreadcrumbFrameProfiler } from '../scene/BreadcrumbFrameProfiler';
import { combineOctreeSources } from '../glue/octree-combined';
import { buildOverlayData } from '../glue/overlays';
import { GRAND_TOUR, TOUR_FRAMING_STANDOFF_PC, TOUR_ORBIT_RADIUS_M, buildFlyToSpline } from '../glue/tours';
import { reportError } from '@cosmos/diagnostics';
import { Hud } from '../hud/Hud';
import { ErrorBoundary, WebGLUnsupportedCard } from '../ErrorBoundary';
import { isWebGL2Available } from '../glue/report-error';
import { clock, epochProvider, installTimeGlue, syncClockToNow } from '../glue/time';
import { createGoToCoordinator } from '../glue/goto';
import { testHook, controllerHolder, mirrorControllerState, streamingHolder } from '../glue/test-hook';
import { makeLocalGroup, MILKY_WAY_STAR_COUNT } from '../glue/local-group';
import { getCosmosPool, createMilkyWayStreaming } from '../glue/streaming';
import { wireQuality } from '../glue/quality';
import { Crosshair } from '../hud/Crosshair';
import { Breadcrumb } from '../hud/Breadcrumb';
import { SpeedReadout } from '../hud/SpeedReadout';
import { ModeBadgeHost } from '../hud/ModeBadgeHost';
import { GalacticHint } from '../hud/GalacticHint';
import { ContextLostOverlay } from '../hud/ContextLostOverlay';
import { HYG_MANIFEST_URL, SOL_PACK_URL, EXO_PACK_URL, OCTREE_MANIFEST_URL, GAIA_OCTREE_MANIFEST_URL, CONSTELLATIONS_URL, type PackState } from './packs';
import { DEBUG_BREADCRUMB_PROFILE } from './flags';
import './dev-surface';

/**
 * M2 composition (TASK-029): load the HYG pack + Sol/exo systems packs in
 * parallel, merge into a combined source, and wire the full explorer — star
 * field, automatic galaxy⇄system descent, simulation time, picking, search,
 * bookmarks. React owns structure only; offsets/positions flow imperatively (§2.2).
 */
export function StarApp() {
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
          {pack.status === 'ready' ? <ModeBadgeHost /> : null}
          {pack.status === 'ready' ? <GalacticHint /> : null}
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
