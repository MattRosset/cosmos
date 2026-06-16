import { serveWorker } from '../../src/serve.js';
import type { WorkerHandlers } from '../../src/serve.js';

/**
 * A fake Worker backed by a MessageChannel so serveWorker and the pool can be
 * tested in Node without a real browser Worker.  Buffers in the transfer list
 * are transferred (detached) just like a real Worker because MessagePort.postMessage
 * honours the transfer list in Node 17+.
 */
export class FakeWorker {
  private readonly mainPort: MessagePort;
  private readonly workerPort: MessagePort;

  /** Optional spy called when terminate() is invoked. */
  onTerminate?: () => void;

  /** Set true to make postMessage clone instead of transfer (simulates a
   *  broken channel — used to test the DEV transfer assertion). */
  skipTransfer = false;

  constructor(handlers: Partial<WorkerHandlers>) {
    const channel = new MessageChannel();
    this.mainPort = channel.port1;
    this.workerPort = channel.port2;

    serveWorker(handlers, {
      postMessage: (msg, transfer) => {
        this.workerPort.postMessage(msg, (transfer ?? []) as Transferable[]);
      },
      addEventListener: (_type: string, handler: (e: MessageEvent) => void) => {
        this.workerPort.addEventListener('message', handler);
        this.workerPort.start();
      },
    });

    this.mainPort.start();
  }

  postMessage(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions): void {
    const transfer = Array.isArray(transferOrOptions)
      ? (transferOrOptions as Transferable[])
      : ((transferOrOptions as StructuredSerializeOptions | undefined)?.transfer ?? []);

    if (this.skipTransfer) {
      // Clone only — do NOT pass the transfer list so buffers stay accessible
      this.mainPort.postMessage(message);
    } else {
      this.mainPort.postMessage(message, transfer);
    }
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
    if (type === 'message') {
      const fn = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener);
      this.mainPort.addEventListener(
        'message',
        (e: MessageEvent) => fn({ data: e.data } as MessageEvent),
        options,
      );
    }
  }

  removeEventListener(): void { /* no-op — pool does not remove worker listeners */ }
  dispatchEvent(): boolean { return false; }

  terminate(): void {
    this.onTerminate?.();
    this.mainPort.close();
    this.workerPort.close();
  }
}
