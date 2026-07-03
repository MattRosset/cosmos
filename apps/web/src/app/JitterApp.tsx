import { SceneHost } from '@cosmos/scene-host';
import { JitterProbe } from '../scene/JitterProbe';

/**
 * TASK-017 rendered jitter gate: a single bright marker 8 kpc out, the camera
 * scripted to orbit it at 1 AU. No pack load, no HUD — isolates the coordinate +
 * render pipeline. Results land on `window.__jitterResult`.
 */
export function JitterApp() {
  return (
    <SceneHost>
      <color attach="background" args={['#02030a']} />
      <JitterProbe />
    </SceneHost>
  );
}
