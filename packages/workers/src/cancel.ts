let _nextId = 0;

export interface CancelToken {
  readonly id: number;
  readonly signal: AbortSignal;
  cancel(): void;
  readonly cancelled: boolean;
}

export function createCancelToken(): CancelToken {
  const id = _nextId++;
  const controller = new AbortController();
  let _cancelled = false;

  return {
    id,
    get signal() {
      return controller.signal;
    },
    cancel() {
      if (!_cancelled) {
        _cancelled = true;
        controller.abort();
      }
    },
    get cancelled() {
      return _cancelled;
    },
  };
}
