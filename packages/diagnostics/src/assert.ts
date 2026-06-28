import type { AppError } from '@cosmos/core-types';
import { isDev } from './env';
import { reportError } from './sink';

/** Invariant check. If `condition` is false:
 *   - DEV: reportError(kind:'invariant') AND throw (loud — surfaces in the
 *     ErrorBoundary / test).
 *   - PROD: reportError(kind:'invariant') and RETURN (degrade, don't crash the app).
 *  `message` describes the expected post-condition ("octree tiles should have loaded").
 *
 *  CAVEAT (see task §Common Mistakes): the `asserts condition` signature is only
 *  sound in DEV, where we throw. In PROD this function returns even when the
 *  condition is false, so callers on the prod path MUST still handle the degraded
 *  case explicitly — do NOT rely on TS narrowing to skip a null-check that must
 *  survive production. */
export function assertInvariant(
  condition: boolean,
  message: string,
  context?: AppError['context'],
): asserts condition {
  if (condition) return;
  reportError(new Error(message), 'invariant', context);
  if (isDev()) {
    throw new Error(`Invariant failed: ${message}`);
  }
}
