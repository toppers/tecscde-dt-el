// [[TECSCDE-DT-EL内部仕様]] 07J.9: close waits for renderer checkpoint
// reflection and accepted main writes, then asks about the current dirty state.

export interface CloseGuardWindow {
  on(event: "close", listener: (event: { preventDefault(): void }) => void): unknown;
  close(): void;
}

export interface CloseGuardDependencies {
  /** The IPC bridge must also validate the responding webContents. */
  queryState(queryId: string): Promise<unknown>;
  /** Close admission before waiting; never time out accepted writes. */
  stopWrites(): Promise<void>;
  /** Reopen admission and send cancelCloseState for this transaction only. */
  resume(queryId: string): void;
  readonly queryTimeoutMs?: number;
}

function isIdentifier(value: unknown): boolean {
  return typeof value === "string" ? value.length > 0 : typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readyState(response: unknown, queryId: string): { dirty: boolean } | undefined {
  if (typeof response !== "object" || response === null || Array.isArray(response)) return;
  const state = response as Record<string, unknown>;
  if (state.kind !== "ready" || state.queryId !== queryId || typeof state.dirty !== "boolean" ||
      state.pendingSaves !== 0 || !isIdentifier(state.documentEpoch) || !isIdentifier(state.historyNodeId)) return;
  return { dirty: state.dirty };
}

let nextCloseQuery = 0;

export class CloseGuard {
  private permission = false;
  private checking = false;
  private disposed = false;

  constructor(
    private readonly win: CloseGuardWindow,
    private readonly confirmDiscard: (unknownState?: boolean) => Promise<boolean>,
    private readonly dependencies?: CloseGuardDependencies,
  ) {
    win.on("close", (event) => {
      if (this.permission) {
        this.permission = false; // one reentrant close only
        return;
      }
      event.preventDefault();
      if (!this.checking && !this.disposed) void this.checkAndClose();
    });
  }

  /** Compatibility notification; cached values never authorize close. */
  setDirty(_dirty: boolean): void {}

  dispose(): void {
    this.disposed = true;
    this.permission = false;
  }

  private async query(queryId: string): Promise<unknown> {
    if (!this.dependencies) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.dependencies.queryState(queryId),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), this.dependencies?.queryTimeoutMs ?? 5000);
        }),
      ]);
    } catch {
      return undefined;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async checkAndClose(): Promise<void> {
    this.checking = true;
    const queryId = `close-${++nextCloseQuery}`;
    let closing = false;
    try {
      const response = await this.query(queryId);
      // Timeout/unavailable does not shorten the accepted-write wait.
      await this.dependencies?.stopWrites();
      if (this.disposed) return;
      const state = readyState(response, queryId);
      if (state?.dirty === false || await this.confirmDiscard(state === undefined)) {
        if (this.disposed) return;
        this.permission = true;
        closing = true;
        this.win.close();
      }
    } catch {
      // A failed query/dialog/queue check never grants permission to close.
      this.permission = false;
      closing = false;
    } finally {
      try {
        if (!closing && !this.disposed) this.dependencies?.resume(queryId);
      } catch {
        // A destroyed renderer may reject the cancellation send. It cannot
        // grant close permission or leave the next close permanently blocked.
      } finally {
        this.checking = false;
      }
    }
  }
}
