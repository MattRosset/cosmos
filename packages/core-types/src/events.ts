import type { ContextId } from './coords';
import type { BodyId } from './bodies';

/** All cross-package events. Names follow `domain/action` (architecture §15). */
export interface CosmosEventMap {
  'coords/rebased': {
    readonly context: ContextId;
    /** Offset subtracted from all root render groups, in context units (f64). */
    readonly offsetUnits: readonly [number, number, number];
  };
  'coords/contextChanged': { readonly from: ContextId; readonly to: ContextId };
  'nav/contextSwitchRequested': {
    readonly target: ContextId;
    readonly anchorId: BodyId | null;
  };
  'selection/changed': { readonly id: BodyId | null };
  'time/changed': {
    readonly epochJD: number;
    readonly accel: number;
    readonly paused: boolean;
  };
}

export type CosmosEventName = keyof CosmosEventMap;
export type CosmosEventHandler<E extends CosmosEventName> = (
  payload: CosmosEventMap[E],
) => void;

export interface EventBus {
  /** Subscribe; returns an unsubscribe function. */
  on<E extends CosmosEventName>(event: E, handler: CosmosEventHandler<E>): () => void;
  emit<E extends CosmosEventName>(event: E, payload: CosmosEventMap[E]): void;
}

/** Synchronous fan-out. A throwing handler must not prevent later handlers. */
export function createEventBus(): EventBus {
  const listeners = new Map<CosmosEventName, Set<CosmosEventHandler<CosmosEventName>>>();

  return {
    on<E extends CosmosEventName>(event: E, handler: CosmosEventHandler<E>): () => void {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler as CosmosEventHandler<CosmosEventName>);
      return () => {
        set!.delete(handler as CosmosEventHandler<CosmosEventName>);
      };
    },

    emit<E extends CosmosEventName>(event: E, payload: CosmosEventMap[E]): void {
      const set = listeners.get(event);
      if (!set) return;
      for (const handler of set) {
        try {
          handler(payload);
        } catch {
          // A throwing handler must not prevent later handlers.
        }
      }
    },
  };
}
