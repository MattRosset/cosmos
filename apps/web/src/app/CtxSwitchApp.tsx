import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BodyId } from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import { loadStarPack, loadSystemsPack, createCombinedSource } from '@cosmos/data';
import type { FlightController, ContextSwitchEvent } from '@cosmos/nav';
import { SceneHost } from '@cosmos/scene-host';
import { StarScene } from '../scene/StarScene';
import { SystemScene } from '../scene/SystemScene';
import { CtxSwitchProbe, CTX_START } from '../scene/CtxSwitchProbe';
import { clock, epochProvider, installTimeGlue } from '../glue/time';
import { testHook, controllerHolder, mirrorControllerState } from '../glue/test-hook';
import { HYG_MANIFEST_URL, SOL_PACK_URL, EXO_PACK_URL, type PackState } from './packs';

/**
 * TASK-030 Phase 2 gate (`?debug=ctxswitch`): loads the full M2 packs exactly
 * like StarApp, but replaces the user-driven NavDriver with CtxSwitchProbe — a
 * scripted galaxy⇄system descent that measures the rendered transition. The
 * star field + system scene mount identically to production (the gate measures
 * the SHIPPED pipeline); only navigation is scripted and the clock is paused so
 * orbital motion cannot contaminate the frame deltas.
 */
export function CtxSwitchApp() {
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
