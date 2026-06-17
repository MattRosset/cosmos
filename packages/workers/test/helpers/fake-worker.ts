import { serveWorker } from '../../src/serve.js';
import type { WorkerHandlers } from '../../src/serve.js';

/**
 * A fake Worker that delivers messages via queueMicrotask rather than
 * MessageChannel, avoiding Node.js/Windows libuv timer overhead (~15 ms per
 * hop) that caused the no-op round-trip test to exceed its 100 ms budget.
 * Buffer transfers are emulated with structuredClone so detachment semantics
 * are preserved.
 */
export class FakeWorker {
  private readonly mainListeners: Array<(e: MessageEvent) => void> = [];
  private dispatchToWorker!: (msg: unknown) => void;

  onTerminate?: () => void;
  skipTransfer = false;

  constructor(handlers: Partial<WorkerHandlers>) {
    const workerListeners: Array<(e: MessageEvent) => void> = [];

    serveWorker(handlers, {
      postMessage: (msg, transfer) => {
        // Worker → main: clone with optional transfer so StarBatch buffers arrive intact.
        const data = transfer && transfer.length > 0
          ? structuredClone(msg, { transfer: transfer as Transferable[] })
          : structuredClone(msg);
        queueMicrotask(() => {
          for (const l of this.mainListeners) l({ data } as MessageEvent);
        });
      },
      addEventListener: (_type, handler) => {
        workerListeners.push(handler);
      },
    });

    this.dispatchToWorker = (msg: unknown) => {
      queueMicrotask(() => {
        for (const l of workerListeners) l({ data: msg } as MessageEvent);
      });
    };
  }

  postMessage(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions): void {
    const transfer = Array.isArray(transferOrOptions)
      ? (transferOrOptions as Transferable[])
      : ((transferOrOptions as StructuredSerializeOptions | undefined)?.transfer ?? []);

    if (this.skipTransfer || transfer.length === 0) {
      // Clone without transferring — buffers stay intact on the main side.
      this.dispatchToWorker(structuredClone(message));
    } else {
      // Transfer buffers: structuredClone detaches them from main side, matching
      // real Worker.postMessage behaviour.
      const cloned = structuredClone(message, { transfer: transfer as Transferable[] });
      this.dispatchToWorker(cloned);
    }
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') {
      const fn = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener);
      this.mainListeners.push((e: MessageEvent) => fn({ data: e.data } as MessageEvent));
    }
  }

  removeEventListener(): void { /* pool does not remove worker listeners */ }
  dispatchEvent(): boolean { return false; }

  terminate(): void {
    this.onTerminate?.();
  }
}
