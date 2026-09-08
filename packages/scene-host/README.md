# @cosmos/scene-host

Render-loop owner for cosmos (architecture §5.1). Owns the single R3F `<Canvas>`,
renderer configuration, and priority-ordered frame subscribers. **Public API
freezes at the end of Phase 0 (TASK-006).**

## Purpose

`apps/web` and future `render-*` / `nav` packages compose against a stable host
instead of each owning canvas setup. Phase 0 delivers:

- Logarithmic depth buffer + `antialias: false` (mandatory from day one).
- Shared `FrameContext` passed to subscribers without per-frame allocation.
- Priority-ordered frame callbacks matching the §3 data flow:
  `nav → coords rebase → streaming → render`.

## API

```tsx
import {
  SceneHost,
  useFrameContext,
  type EpochProvider,
  PRIORITY_NAV,
  PRIORITY_COORDS,
  PRIORITY_STREAMING,
  PRIORITY_RENDER,
} from '@cosmos/scene-host';

function App() {
  const epochProvider: EpochProvider = (dtMs) => {
    // Example: advance a simulation clock and return the epoch
    // clock.advance(dtMs);
    // return clock.epochJD;
    return 2451545.0; // J2000
  };

  return (
    <SceneHost onFrame={(ctx) => { /* app-level render hook */ }} epochProvider={epochProvider}>
      <Starfield />
    </SceneHost>
  );
}

// Inside the Canvas tree (e.g. packages/nav, packages/coords adapter):
function NavDriver() {
  useFrameContext((ctx) => {
    // ctx.camera, ctx.dtMs (clamped to 100 ms), ctx.epochJD (from provider or J2000)
  }, PRIORITY_NAV);
  return null;
}
```

## Frame priorities

| Constant | Value | Stage |
|---|---|---|
| `PRIORITY_NAV` | -200 | Camera / input |
| `PRIORITY_COORDS` | -100 | Floating-origin rebase |
| `PRIORITY_STREAMING` | -50 | Visible-set updates |
| `PRIORITY_RENDER` | 0 | Render packages + app hook |

Lower numbers run earlier within a frame.

## Boundaries

- **Glue package:** may import React, Three.js, R3F, `@cosmos/coords`.
- **No body rendering** — star/planet meshes live in `render-*` or app placeholders.
- **Canvas isolation:** HUD state must not force `<Canvas>` re-renders; pass scene
  content as stable children.

## Adaptive quality tiers (§9)

`SceneHost` uses drei's `<PerformanceMonitor>` to watch frame rate and step the
active `QualityTier` (`high → medium → low`) before frames drop. Tier changes
are debounced and never fire per-frame (§5.12).

```tsx
import { useQuality, type QualityController } from '@cosmos/scene-host';

// App shell — receive the controller once on mount:
function App() {
  const handleQc = useCallback((qc: QualityController) => {
    // qc.tier, qc.settings — wire to streaming / post chain
    qc.onChange((settings) => {
      streamingBudget.setMax(settings.maxRenderedPoints);
    });
  }, []);

  return (
    <SceneHost
      initialQualityTier="high"
      onQualityController={handleQc}
    >
      <Starfield />
    </SceneHost>
  );
}

// Any Canvas-tree component can read the tier — re-renders only on tier change.
// (The post-processing chain does this internally; see "Post chain" below.)
function Atmosphere() {
  const { atmosphereEnabled } = useQuality();
  return atmosphereEnabled ? <AtmosphereShell /> : null;
}
```

### Degradation order (§9)

| Tier | maxRenderedPoints | bloom | atmosphere | resolutionScale |
|---|---|---|---|---|
| `high` | 2,000,000 | on | on | 1.0 |
| `medium` | 1,000,000 | on | off | 0.75 |
| `low` | 500,000 | off | off | 0.5 |

`scene-host` drives `gl.setPixelRatio` for the resolution scale step on tier
change only (never per-frame). Bloom/atmosphere flags are exposed via
`useQuality()` for the post chain.

### Manual override

```ts
qc.setTier('low');   // freeze at low (settings UI / tests)
qc.setTier(null);    // resume automatic adaptation
```

Pass `disableAutoQuality` to `<SceneHost>` to ignore `PerformanceMonitor`
callbacks entirely (forced-tier demos and tests).

## Post chain (foundation — TASK-104)

`SceneHost` mounts a tier-gated `@react-three/postprocessing` `<EffectComposer>` via the
internal `PostChain` leaf. **Step 1 is an identity composite: it adds NO visible effect** —
antialiasing (TASK-105) and selective bloom (TASK-106) mount into this composer later.

- **Tier gate:** the composer mounts only when the current tier has `bloomEnabled` (high/medium),
  isolated in the `PostChain` leaf so a tier change re-renders only it, never the scene content.
- **`postProcessing?: boolean`** (SceneHostProps, default `true`): the one additive API field.
  An app that drives its own manual `gl.render` loop (the manual-render **probe apps**) MUST pass
  `postProcessing={false}` — a manual render pass and an `EffectComposer` are mutually-exclusive
  render owners.
- **Identity:** a single `<ToneMapping>` reproduces the renderer's tone-mapping operator
  (`ACESFilmicToneMapping` → `ACES_FILMIC`), and the composer uses `multisampling={0}` +
  `frameBufferType={UnsignedByteType}` (8-bit) so additive star sprites clamp exactly as the direct
  path — a true visual no-op. (TASK-106 switches to a HalfFloat HDR target when bloom needs
  headroom.) See `docs/research/post-chain-identity-hdr-target.md`.

## Extension points (later tasks)

- Coords rebase: subscribe at `PRIORITY_COORDS`, shift root render groups on
  `RebaseEvent`.
- Streaming: subscribe at `PRIORITY_STREAMING` for tile visibility.
- Post chain: `PostChain` mounts inside `SceneHost` (above); TASK-105/106 add AA + bloom effects.

## EpochProvider

`SceneHost` accepts an optional `epochProvider` prop that supplies the simulation
epoch (`FrameContext.epochJD`) each frame:

```typescript
export type EpochProvider = (dtMs: number) => number;

interface SceneHostProps {
  readonly epochProvider?: EpochProvider;
  // ... other props
}
```

- **Timing:** Called once per frame at `PRIORITY_FRAME_CONTEXT` (before all
  subscribers) with the clamped wall delta (≤ 100 ms).
- **Return value:** Becomes `FrameContext.epochJD` for all subscribers in that
  frame if finite. Non-finite values (NaN, Infinity) retain the previous epoch
  and, as of TASK-058, report `@cosmos/diagnostics` `kind:'invariant'` ONCE per
  session (latched — never per-frame on the hot path) so the broken provider is
  counted + overlay-visible instead of a console line that scrolls away.
- **Default:** Absent provider → epoch is constant `J2000_EPOCH_JD` (2451545.0).
- **Stability:** The function must be referentially stable or wrapped by the
  caller — changing the provider identity does not remount the `<Canvas>`.

Typical usage for a simulation clock:

```typescript
const epochProvider: EpochProvider = (dtMs) => {
  clock.advance(dtMs);
  return clock.epochJD;
};
```

## Testing

`pnpm --filter @cosmos/scene-host test` — priority ordering, dt clamp, epoch
stub, epoch provider, unmount cleanup, and the post-chain tier gate + no-leak +
Canvas-isolation + tone-mapping identity map (@react-three/test-renderer + Vitest).
The real WebGL composer can't run under the mock GL, so it is stubbed package-wide
(`test/setup-postprocessing.ts`); the real composer is covered by the web build + e2e.
