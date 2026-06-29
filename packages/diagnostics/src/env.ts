/**
 * DEV-mode detection, computed once and injectable for tests.
 *
 * Order (construction note): prefer Vite's `import.meta.env.DEV`; fall back to
 * `process.env.NODE_ENV !== 'production'` so the same code works in Vitest/Node
 * and in a Vite browser bundle.
 */

function detectDev(): boolean {
  // Vite injects `import.meta.env.DEV` (a boolean) in the browser bundle.
  const meta = import.meta as unknown as { env?: { DEV?: boolean } };
  if (meta.env !== undefined && typeof meta.env.DEV === 'boolean') {
    return meta.env.DEV;
  }
  // Node / Vitest path. Access `process` via globalThis so this module typechecks
  // without `@types/node` ambient globals (it is a transitive dep of the web bundle,
  // whose tsconfig only pulls vite/client types).
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const nodeEnv = proc?.env !== undefined ? proc.env.NODE_ENV : undefined;
  return nodeEnv !== 'production';
}

const detected = detectDev();
let override: boolean | undefined;

/** True in development (loud throws + overlay), false in production (degrade). */
export function isDev(): boolean {
  return override ?? detected;
}

/** Test-only: force the DEV/PROD branch. Pass `undefined` to restore detection. */
export function __setDevForTests(value: boolean | undefined): void {
  override = value;
}
