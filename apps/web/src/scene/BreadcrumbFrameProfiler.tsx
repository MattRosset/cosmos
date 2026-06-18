import { PRIORITY_NAV, PRIORITY_RENDER, useFrameContext } from '@cosmos/scene-host';
import { controllerHolder } from '../glue/test-hook';
import { profileBeginFrame, profileEndFrame } from '../glue/frame-profiler';

/** Bookends each frame for the breadcrumb main-thread profiler (?debug=breadcrumb-profile). */
export function BreadcrumbFrameProfiler(): null {
  useFrameContext(() => {
    const c = controllerHolder.current;
    const p = c?.state.position.local ?? [0, 0, 0];
    profileBeginFrame({
      goToActive: c?.goToActive ?? false,
      distPc: Math.hypot(p[0], p[1], p[2]),
    });
  }, PRIORITY_NAV - 2);

  useFrameContext(() => {
    profileEndFrame();
  }, PRIORITY_RENDER + 100);

  return null;
}
