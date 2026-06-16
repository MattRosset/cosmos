import type { WorkerErrorPayload } from '@cosmos/core-types';

export class WorkerTaskError extends Error {
  readonly payload: WorkerErrorPayload;
  constructor(payload: WorkerErrorPayload) {
    super(payload.message);
    this.name = payload.name ?? 'WorkerTaskError';
    this.payload = payload;
  }
}

export class WorkerCancelledError extends Error {
  constructor() {
    super('Worker task cancelled');
    this.name = 'WorkerCancelledError';
  }
}
