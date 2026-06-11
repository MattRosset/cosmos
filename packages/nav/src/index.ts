/**
 * @cosmos/nav public API — frozen at the end of Phase 0 (TASK-006).
 * See docs/architecture.md §5.3 and TASK-005.
 */
export type {
  FlightController,
  FlightControllerOptions,
  FlightState,
} from './controller.js';
export { createFlightController } from './controller.js';
export { useFlightController } from './useFlightController.js';
