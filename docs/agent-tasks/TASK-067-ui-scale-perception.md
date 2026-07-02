# Task: `ui` perception v2 — scale ruler, unified Jump HUD, letterbox kit

**ID:** TASK-067
**Target package:** `packages/ui` (+ HUD wiring in `apps/web`)
**Size:** M
**Phase:** Perception track (post-4a; not a roadmap phase)
**Depends on:** TASK-066 (strings module, `SCALE_JUMP_THRESHOLD_PC`, format helpers).
Exclusive with other `apps/web` tasks while in progress.

Source research: [`../research/ui-ux-perception-and-polish.md`](../research/ui-ux-perception-and-polish.md)
§4, §5 — **Phase 2 items: D3, D4 (letterbox+copy only), W1, W2 (unified Jump HUD,
absorbs S4+D5), W2a (repetition dampening).**

## Goal

Scale jumps *feel* like scale jumps. During any `goTo` beyond the scale-jump threshold the
user sees: letterbox framing (first large jump only, by default), a Jump HUD showing
distance remaining in ly and the @ c equivalent, and — on arrival — the same component
morphing into a short summary card ("Jumped ~160,000 ly in 5 s — at c: ~160,000 years",
field-of-view line). A persistent scale ruler answers "what scale am I at?" at a glance.
Repetition is dampened: the full arrival card shows on the first 2–3 large jumps, then a
one-line readout. Breadcrumb tooltips name the mechanism ("scale link").

## Frozen Interface

Read-only against nav/core-types (same surface as TASK-066: `goToActive`, `onGoToEnd`,
`state.position`, `contextId`, `CONTEXT_UNIT_METERS`). Consumes from TASK-066:

```ts
// @cosmos/ui (added by TASK-066 — do not modify signatures)
export const SCALE_JUMP_THRESHOLD_PC: number; // shared S2/D4/W2 gate
export const STRINGS: Readonly<Record<string, string>>;
export function formatEtaAtC(distanceLy: number): string;
```

New additive `@cosmos/ui` surface (sanctioned by this task):

```ts
// Pure mapping for the scale ruler — unit-tested, no DOM. Segments are a function of
// ONLY (contextId, cameraDistanceFromAnchorM); no other inputs. This is the research
// doc's pinned D3 mapping — do NOT invent segments the engine cannot report.
export type ScaleRulerSegment = 'planet' | 'system' | 'starfield' | 'galactic-survey' | 'universe';
export function scaleRulerSegment(contextId: ContextId, cameraDistanceM: number): ScaleRulerSegment;
export const GALACTIC_SURVEY_MIN_PC: number; // starfield → galactic-survey split, named constant

// Jump HUD model — pure state machine, DOM component consumes it
export interface JumpHudModel {
  phase: 'idle' | 'jumping' | 'arrived';
  distanceTotalLy: number;      // |target − start| snapshotted at goTo start
  distanceRemainingLy: number;
  etaAtC: string;               // formatEtaAtC(distanceTotalLy)
  showFullArrivalCard: boolean; // W2a dampening decision
  letterbox: boolean;           // W2a: first large jump only (default)
}
```

The letterbox reuses the existing `.hud-letterbox` CSS (`apps/web/src/styles.css`,
`Hud.tsx`) — a second activation *source*, not a new mechanism. `packages/nav`'s
cinematic letterbox flag is untouched.

## Inputs / Outputs

- **Inputs:** `goTo` start/target positions snapshotted by app glue at `goTo()` call sites
  (`apps/web/src/glue/goto.ts` callers — the glue already owns these; snapshot d₀ there
  and pass it down, do NOT reconstruct from mid-flight camera state); `onGoToEnd` for the
  arrival transition; `localStorage` counters for dampening.
- **Outputs (behavioral):**
  - **Jump HUD (W2):** mounts only when `goToActive` AND jump distance ≥
    `SCALE_JUMP_THRESHOLD_PC`. While jumping: distance remaining (ly), @ c equivalent.
    On completed arrival (`onGoToEnd(true)`): arrival summary for 3–5 s (or dismiss),
    non-blocking. On cancel (`onGoToEnd(false)`): unmount, no summary.
  - **Dampening (W2a):** `localStorage` `cosmos.jumps.large.count`. Count < 3 → full
    arrival card; ≥ 3 → single-line summary. Letterbox: first large jump only
    (`cosmos.jumps.letterboxShown`).
  - **Scale ruler (D3):** persistent slim HUD bar; highlighted segment =
    `scaleRulerSegment(...)` driven at ≤10 Hz or on context/segment change only.
  - **Breadcrumb copy (W1):** tooltips via `STRINGS` — "Jump to Milky Way view (scale
    link)" / "Return to star field".
  - **No new post-processing** (integrated-GPU floor; research §10). Letterbox + copy is
    the entire visual kit.

## Constraints & Forbidden Actions

- Zero nav changes: no `GoToOptions`, durations, thresholds, hysteresis edits.
- Do not modify `packages/core-types`, `packages/nav`, `packages/scene-host`.
- No new dependencies; no Three.js in `packages/ui`.
- Jump HUD + ruler updates: imperative DOM on rAF or ≤10 Hz store — no per-frame React
  re-renders of `SceneHost` (research §11 criterion 8).
- `scaleRulerSegment` must stay a pure function of its two arguments (the e2e test
  cross-checks it against `__cosmos` state — hidden inputs make that impossible).
- Distance snapshots at `goTo` start only — never re-derive totals from the exponential
  mid-flight (conventions rule 1: query real state, don't reimplement the motion law).

## Common Mistakes (architecture §5.12 — HUD)

- Per-frame React state for HUD values (see TASK-066 list — same rules).
- Inferring jump completion from elapsed time instead of `onGoToEnd`.
- Hard-coding arrival numbers ("160,000 ly") in components instead of computing from the
  snapshot — the copy must be correct for bookmark/double-click jumps too, not just the
  Milky Way breadcrumb.

## Acceptance Tests

DONE only when these pass in CI (`pnpm verify` + `pnpm test:e2e`):

1. **Vitest** — `scaleRulerSegment` table tests across all contexts + boundary distances
   (invariants: monotone in distance within a context; every context maps to ≥1 segment).
   Jump HUD model tests: threshold gating, dampening counter transitions, cancel path
   (no arrival card on `onGoToEnd(false)`).
2. **E2E — jump HUD lifecycle:** clear storage; drive breadcrumb `viewGalaxy`. Assert:
   HUD visible with an `ly` distance and an `at c` phrase while `__cosmos.goToActive`;
   letterbox CSS class active (class toggle assertion, NOT pixel diff); on end, arrival
   card visible with `ly` + `years`-order copy. Log start/end distance + displayed strings.
3. **E2E — dampening:** repeat the jump 3×; assert letterbox class absent from jump 2 on,
   and arrival card is the one-line variant from jump 4 on (storage-driven, deterministic).
4. **E2E — threshold:** short in-system fly → jump HUD and letterbox never mount.
5. **E2E — ruler:** at Sol vantage vs. post-`viewGalaxy` vantage, assert highlighted
   segment matches `scaleRulerSegment(__cosmos.contextId, distance-from-hook)` — DOM
   presence + segment identity only, no pixel positions.
6. Reference-machine screenshot of letterbox+card is `!process.env.CI` only.

## Deliverables

- `packages/ui/src/scale-ruler.ts` + component + tests
- `packages/ui/src/JumpHud.tsx` + model + tests; `strings.ts` additions
- `apps/web` glue: d₀ snapshot in `goto.ts` call path, Jump HUD + ruler mounts,
  letterbox source wiring, `localStorage` counters; breadcrumb tooltip copy
- e2e spec `e2e/tests/perception-scale.spec.ts`

## Context Files

- `docs/research/ui-ux-perception-and-polish.md` (§4, §5, §9–§12)
- `apps/web/src/glue/goto.ts` (constants + call sites), `apps/web/src/hud/Hud.tsx` +
  `styles.css` `.hud-letterbox`
- `packages/nav/src/controller.ts` `onGoToEnd` semantics (completed vs. cancel)
- TASK-066 deliverables (`format.ts`, `strings.ts`, threshold constant)
- `docs/testing-conventions.md`, `apps/web/src/glue/test-hook.ts`
