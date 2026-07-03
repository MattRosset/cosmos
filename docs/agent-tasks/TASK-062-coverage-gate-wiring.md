# Task: Wire the configured-but-unplugged coverage gates + dedupe the CI pack-octree step

**ID:** TASK-062
**Target package:** `packages/core-types`, `tools/pack-*` (5 tools), `.github/workflows/ci.yml`
**Size:** S
**Phase:** Maintenance track (post-4a)
**Depends on:** TASK-053

## Goal

Every package the plan requires a coverage gate for actually enforces one in CI.
Today two gaps exist (source: `docs/research/project-state-architecture-testing-review.md`
§3.2 items 1 and 3): (a) `packages/core-types` runs `vitest run` with no coverage config
at all, and (b) the five `tools/pack-*` tools HAVE vitest configs with thresholds but
their `test` scripts omit `--coverage`, so the thresholds never execute. Additionally,
`ci.yml` runs `pnpm --filter @cosmos/pack-octree test` twice in the same job (once as the
Phase 3 gate, once re-listed for Gaia mode) — the same command both times, so the second
run adds wall-clock for zero extra signal. This task flips the switches; it writes no
new tests.

## Frozen Interface

None. No source code changes at all — only `package.json` scripts, one new
`vitest.config.ts`, and `ci.yml`.

## Deliverables

1. **CREATE `packages/core-types/vitest.config.ts`:**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        statements: 90,
      },
    },
  },
});
```

2. **EDIT `packages/core-types/package.json`** — change the test script from
   `"test": "vitest run"` to `"test": "vitest run --coverage"`.

3. **EDIT the five tool `package.json` files** — same one-word change
   (`"vitest run"` → `"vitest run --coverage"`) in:
   - `tools/pack-stars/package.json`
   - `tools/pack-exoplanets/package.json`
   - `tools/pack-solar/package.json`
   - `tools/pack-octree/package.json`
   - `tools/pack-constellations/package.json`

   (`tools/check-bundle-size` has no tests and is out of scope.)

4. **Threshold calibration rule (apply mechanically, no judgment calls):** after steps
   1–3, run `pnpm test` from the repo root. For each package that now FAILS its
   statements threshold, look at the "% Stmts" value vitest printed for the package
   total, and lower that package's `coverage.thresholds.statements` in its
   `vitest.config.ts` to that value rounded DOWN to the nearest multiple of 5
   (e.g. measured 83.4 → set 80). Never raise a threshold. Never set below 60 — if a
   package measures under 60, leave its script at plain `vitest run`, revert its config
   edit, and record it in the Notes column as "coverage below wiring floor: NN%".
   Add a one-line comment above any lowered threshold:
   `// TASK-062: measured NN.N% at wiring time; ratchet up, never down.`

5. **EDIT `.github/workflows/ci.yml`** — merge the two identical pack-octree steps into
   one. Delete the step named `Octree pack Gaia-mode determinism gate (ADR-006 §1–§4)`
   (the one that appears in the Phase 4a block) and rename the surviving Phase 3 step +
   comment so the gate listing stays honest:

```yaml
      # Also the Phase 4a Gaia-ingest gate (ADR-006 §1–§4): the pack-octree suite
      # covers both the ADR-003 tiling determinism and the Gaia ingest mode, so one
      # run asserts both milestone gates (deduped in TASK-062).
      - name: Octree pack determinism gate (§5.7 + ADR-006 §1–§4)
        run: pnpm --filter @cosmos/pack-octree test
```

   Do not touch any other step, the job structure, or the e2e invocation.

## Inputs / Outputs

- **Input:** `pnpm test` green; thresholds dormant in 5 tool configs; none in core-types.
- **Output:** `pnpm test` green WITH coverage enforcement in all 6 packages; CI runs
  pack-octree once.

## Constraints & Forbidden Actions

- Do NOT write, modify, or delete any test or source file. If a threshold can't be met,
  the calibration rule in Deliverable 4 is the complete decision procedure.
- Do NOT change coverage `include` globs in the existing tool configs.
- Do NOT touch `e2e/`, `apps/web`, or any other package's config/scripts.
- Do NOT reorder or rename other `ci.yml` steps.

## Common Mistakes

- Setting thresholds aspirationally high and "fixing" coverage by writing quick tests —
  out of scope; wire the gate at measured reality, ratchet later.
- Forgetting that thresholds only run under `--coverage` — the whole point of this task.
- Deleting the ADR-006 comment when deduping the CI step — the gate listing comments
  are part of the milestone-audit trail; merge them, don't drop them.

## Acceptance Tests

The task is DONE only when all pass:

1. `pnpm verify` exits 0.
2. `pnpm --filter @cosmos/core-types test` prints a coverage table and exits 0.
3. Each of the five `pnpm --filter @cosmos/pack-<name> test` commands prints a coverage
   table and exits 0.
4. `.github/workflows/ci.yml` contains exactly ONE step whose `run` is
   `pnpm --filter @cosmos/pack-octree test` (verify:
   `Select-String -Path .github/workflows/ci.yml -Pattern 'pack-octree test'` → 1 hit).
5. Sanity: temporarily set core-types' threshold to `99` and confirm
   `pnpm --filter @cosmos/core-types test` FAILS, then restore — proves the gate is live.

## Notes

- `pack-solar`: coverage below wiring floor: 57.7% statements (measured at wiring time).
  Left at plain `vitest run`, per Deliverable 4 — not wired to `--coverage`, threshold
  config untouched. Needs a real test-writing pass (`cli.ts` is at 0% coverage; `convert.ts`
  is already at 91%) before it can clear the 60% floor and be wired in a future task.

## Context Files

- `packages/core-types/package.json`
- `tools/pack-octree/vitest.config.ts` (reference for the existing tool config shape)
- `.github/workflows/ci.yml` (the two pack-octree steps)
- `docs/research/project-state-architecture-testing-review.md` §3.2
