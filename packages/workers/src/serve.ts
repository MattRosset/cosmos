import type {
  WorkerRequest,
  WorkerResponse,
  WorkerErrorPayload,
  StarBatch,
  ProcgenGalaxyRequest,
  OctreeDecodeRequest,
} from '@cosmos/core-types';

export interface WorkerHandlers {
  readonly 'procgen.galaxy': (
    params: ProcgenGalaxyRequest,
    isCancelled: () => boolean,
  ) => { readonly batch: StarBatch; readonly transfer: readonly ArrayBuffer[] };
  readonly 'octree.decode': (
    params: OctreeDecodeRequest,
    isCancelled: () => boolean,
  ) => { readonly batch: StarBatch; readonly transfer: readonly ArrayBuffer[] };
}

/** Minimal subset of the worker global / MessagePort needed by serveWorker. */
export interface WorkerContext {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', handler: (e: MessageEvent) => void): void;
}

type AnyHandler = (
  params: unknown,
  isCancelled: () => boolean,
) => { readonly batch: StarBatch; readonly transfer: readonly ArrayBuffer[] };

/** Call ONCE at the top of a worker entry module: wires onmessage, request
 *  correlation, cancellation, and structured error → WorkerResponse. */
export function serveWorker(
  handlers: Partial<WorkerHandlers>,
  ctx: WorkerContext = self as unknown as WorkerContext,
): void {
  const cancelledIds = new Set<number>();

  ctx.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as Record<string, unknown>;

    if (typeof msg['cancel'] === 'number') {
      cancelledIds.add(msg['cancel']);
      return;
    }

    void handleRequest(msg as unknown as WorkerRequest<string, unknown>);
  });

  async function handleRequest(req: WorkerRequest<string, unknown>): Promise<void> {
    const { id, method, params } = req;
    const handler = handlers[method as keyof WorkerHandlers] as AnyHandler | undefined;

    if (!handler) {
      const response: WorkerResponse<StarBatch> = {
        id,
        ok: false,
        error: { name: 'Error', message: `Unknown worker method: ${method}` },
      };
      ctx.postMessage(response);
      return;
    }

    const isCancelled = (): boolean => cancelledIds.has(id);

    try {
      const result = await Promise.resolve(handler(params, isCancelled));

      if (isCancelled()) {
        cancelledIds.delete(id);
        const response: WorkerResponse<StarBatch> = { id, cancelled: true };
        ctx.postMessage(response);
        return;
      }

      cancelledIds.delete(id);
      const response: WorkerResponse<StarBatch> = { id, ok: true, result: result.batch };
      ctx.postMessage(response, [...result.transfer]);
    } catch (err) {
      cancelledIds.delete(id);
      const error: WorkerErrorPayload = {
        name: err instanceof Error ? err.name : 'Error',
        message: err instanceof Error ? err.message : String(err),
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      };
      const response: WorkerResponse<StarBatch> = { id, ok: false, error };
      ctx.postMessage(response);
    }
  }
}
