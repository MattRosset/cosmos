# Task: <short imperative title>

**ID:** TASK-XXX
**Target package:** `packages/<name>`
**Size:** S | M | L
**Phase:** 0–5
**Depends on:** TASK-YYY (if any)

## Goal

One paragraph: what exists when this task is done, from the user's or integrator's perspective.

## Frozen Interface

Exact TypeScript signatures this task must implement and/or consume. The agent may NOT modify these. API changes are separate, explicitly-reviewed tasks.

```ts
// Signatures here, copied from core-types / the package's public API.
```

## Inputs / Outputs

- **Inputs:** with example data (literal values or fixture file paths).
- **Outputs:** with example data and exact formats (buffer layouts, units in names).

## Constraints & Forbidden Actions

- Do not modify `packages/core-types`.
- Do not add dependencies without approval.
- Respect package dependency rules (see architecture.md §4).
- No `Math.random()` (use the seeded PRNG from core-types).
- No allocations inside frame-loop callbacks.
- <task-specific constraints>

## Common Mistakes (from architecture.md §5.x)

Copy the relevant "common mistakes" list for the target subsystem here verbatim.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. <test file / command + what it asserts>
2. <visual regression baseline, if a render package>
3. <performance assertion, if applicable>

## Context Files

The minimal set of files the agent should read before starting:

- `packages/<name>/README.md`
- `packages/core-types/src/<relevant>.ts`
- `docs/architecture.md` §5.x
