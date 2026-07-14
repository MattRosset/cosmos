import { useEffect, useState } from 'react';
import { SceneHost } from '@cosmos/scene-host';
import { ShaderJitterProbe, MAX_DEVIATION_PX } from '../scene/ShaderJitterProbe';
import type { ShaderJitterResult } from '../scene/ShaderJitterProbe';

/**
 * TASK-077 compiled-shader jitter gate: mounts the REAL render-stars shader on one
 * synthetic star, orbits it at 1 AU, and reads back the on-screen centroid. Results
 * land on `window.__shaderJitterResult` (the e2e gate) AND on a fixed DOM overlay, so
 * the A/B bench on an M1/phone is readable without DevTools. No pack, no HUD.
 */
export function ShaderJitterApp() {
  return (
    <>
      <SceneHost>
        <color attach="background" args={['#02030a']} />
        <ShaderJitterProbe />
      </SceneHost>
      <ResultOverlay />
    </>
  );
}

/** Fixed overlay that polls the published result and shows PASS/FAIL + the numbers. */
function ResultOverlay() {
  const [result, setResult] = useState<ShaderJitterResult | undefined>(undefined);

  useEffect(() => {
    if (window.__shaderJitterResult) {
      setResult(window.__shaderJitterResult);
      return;
    }
    const id = window.setInterval(() => {
      if (window.__shaderJitterResult) {
        setResult(window.__shaderJitterResult);
        window.clearInterval(id);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  const pass =
    result !== undefined && result.lostFrames === 0 && result.maxDeviationPx < MAX_DEVIATION_PX;

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        left: 12,
        padding: '10px 14px',
        borderRadius: 8,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 14,
        lineHeight: 1.5,
        color: '#fff',
        background: result === undefined ? '#333' : pass ? '#0a6b2f' : '#8b1a1a',
        pointerEvents: 'none',
        zIndex: 10,
        maxWidth: '90vw',
        wordBreak: 'break-word',
      }}
    >
      {result === undefined ? (
        <strong>shader-jitter: measuring…</strong>
      ) : (
        <>
          <strong>shader-jitter: {pass ? 'PASS' : 'FAIL'}</strong>
          <div>maxDeviationPx: {result.maxDeviationPx.toFixed(3)} (&lt; {MAX_DEVIATION_PX})</div>
          <div>
            frames: {result.frames} · lostFrames: {result.lostFrames}
          </div>
          <div>renderer: {result.renderer}</div>
        </>
      )}
    </div>
  );
}
