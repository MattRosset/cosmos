/**
 * @cosmos/nav public API — Phase 1 additions (TASK-013).
 * See docs/architecture.md §5.3 and TASK-005/TASK-013.
 */
export type {
  FlightController,
  FlightControllerOptions,
  FlightState,
  GoToOptions,
} from './controller.js';
export { createFlightController } from './controller.js';
export { useFlightController } from './useFlightController.js';
