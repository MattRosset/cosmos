import type { GalaxyRecord } from '@cosmos/core-types';

/**
 * Module-scoped holder handing the rendered local-group galaxies to `StarScene`'s
 * pick (TASK-086, D4). Mirrors `system-feed.ts`'s `systemPickGroup` shape: set on
 * `LocalGroupScene` mount, cleared on unmount, read inside `pickAt`. `null` when no
 * local-group field is mounted (or the app hasn't reached universe context yet).
 */
export const localGroupPickHolder: { current: readonly GalaxyRecord[] | null } = {
  current: null,
};
