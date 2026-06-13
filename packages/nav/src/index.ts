/**
 * @cosmos/nav public API — Phase 1 additions (TASK-013) + Phase 2 context
 * switching (TASK-027). See docs/architecture.md §5.3 and TASK-005/013/027.
 */
export type {
  FlightController,
  FlightControllerOptions,
  FlightState,
  GoToOptions,
} from './controller.js';
export { createFlightController } from './controller.js';
export { useFlightController } from './useFlightController.js';
export type {
  ContextSwitchEvent,
  ContextSwitchPolicy,
  SystemAnchor,
} from './context-switch.js';
export {
  DEFAULT_CONTEXT_SWITCH_POLICY,
  HYSTERESIS_MIN_RATIO,
} from './context-switch.js';
