// 07J.9: constrain close-state replies to the queried window and transaction.
// Response payload validation belongs to CloseGuard, after this transport boundary.

interface CloseStateEvent {
  readonly sender: unknown;
}

type CloseStateListener = (event: CloseStateEvent, response: unknown) => void;

export interface CloseStateIpc {
  on(channel: "window:closeState", listener: CloseStateListener): unknown;
  removeListener(channel: "window:closeState", listener: CloseStateListener): unknown;
}

export interface CloseStateWebContents {
  send(channel: string, payload: { readonly queryId: string }): void;
  isDestroyed?(): boolean;
}

interface PendingQuery {
  readonly promise: Promise<unknown>;
  readonly finish: (response: unknown) => void;
}

export interface CloseStateQuery {
  queryState(queryId: string): Promise<unknown>;
  /** Also releases renderer's close freeze if its answer has already arrived. */
  cancel(queryId: string): void;
  dispose(): void;
}

/** The caller must cancel timed-out queries; CloseGuard owns the timeout. */
export function createCloseStateQuery(ipc: CloseStateIpc, webContents: CloseStateWebContents): CloseStateQuery {
  const pending = new Map<string, PendingQuery>();
  let disposed = false;
  const unavailable = (queryId: string) => ({ kind: "unavailable", queryId });
  const destroyed = () => webContents.isDestroyed?.() === true;

  return {
    queryState(queryId) {
      if (disposed || destroyed()) return Promise.resolve(unavailable(queryId));
      const existing = pending.get(queryId);
      if (existing) return existing.promise;
      let resolve!: (response: unknown) => void;
      const promise = new Promise<unknown>((done) => { resolve = done; });
      const finish = (response: unknown) => {
        ipc.removeListener("window:closeState", listener);
        pending.delete(queryId);
        resolve(response);
      };
      const listener: CloseStateListener = (event, response) => {
        if (event.sender !== webContents || response === null || typeof response !== "object" ||
          Array.isArray(response) || (response as { queryId?: unknown }).queryId !== queryId) return;
        finish(response);
      };
      pending.set(queryId, { promise, finish });
      try {
        ipc.on("window:closeState", listener);
        webContents.send("window:requestCloseState", { queryId });
      } catch {
        finish(unavailable(queryId));
      }
      return promise;
    },
    cancel(queryId) {
      pending.get(queryId)?.finish(unavailable(queryId));
      if (disposed || destroyed()) return;
      try {
        webContents.send("window:cancelCloseState", { queryId });
      } catch {
        // A window destroyed during cancellation cannot be resumed.
      }
    },
    dispose() {
      disposed = true;
      for (const [queryId, query] of pending) query.finish(unavailable(queryId));
    },
  };
}
