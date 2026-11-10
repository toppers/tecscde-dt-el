// 07J.9: close is a transaction; cached dirty notifications cannot authorize it.
import { describe, expect, it, vi } from "vitest";
import { CloseGuard, type CloseGuardWindow } from "../../src/main/close-guard.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const ready = (queryId: string, dirty = false) => ({
  kind: "ready", queryId, documentEpoch: 1, historyNodeId: "node-1", dirty, pendingSaves: 0,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(options: {
  queryState?: (queryId: string) => Promise<unknown>;
  stopWrites?: () => Promise<void>;
  confirm?: (unknownState?: boolean) => Promise<boolean>;
  timeout?: number;
} = {}) {
  let listener!: (event: { preventDefault(): void }) => void;
  const win: CloseGuardWindow = { on: (_event, fn) => { listener = fn; }, close: vi.fn() };
  const queryState = vi.fn(options.queryState ?? (async (id) => ready(id)));
  const stopWrites = vi.fn(options.stopWrites ?? (async () => {}));
  const resume = vi.fn();
  const confirm = vi.fn(options.confirm ?? (async () => false));
  const guard = new CloseGuard(win, confirm, { queryState, stopWrites, resume, queryTimeoutMs: options.timeout ?? 1000 });
  const fire = () => { const event = { preventDefault: vi.fn() }; listener(event); return event; };
  return { win, guard, fire, queryState, stopWrites, resume, confirm };
}

describe("CloseGuard transaction", () => {
  it("always interrupts close, including cached false/no notification, and uses fresh clean state", async () => {
    const { win, guard, fire, confirm, queryState, stopWrites } = setup();
    guard.setDirty(false);
    expect(fire().preventDefault).toHaveBeenCalledOnce();
    await flush();
    expect(queryState).toHaveBeenCalledOnce();
    expect(stopWrites).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    expect(win.close).toHaveBeenCalledOnce();
    expect(fire().preventDefault).not.toHaveBeenCalled();
  });

  it("waits for renderer checkpoint reflection and main accepted writes before deciding", async () => {
    const response = deferred<unknown>();
    const writes = deferred<void>();
    const { win, fire, confirm, stopWrites, queryState } = setup({ queryState: () => response.promise, stopWrites: () => writes.promise });
    fire();
    expect(stopWrites).not.toHaveBeenCalled();
    const id = queryState.mock.calls[0]![0];
    response.resolve(ready(id));
    await flush();
    expect(stopWrites).toHaveBeenCalledOnce();
    expect(win.close).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    writes.resolve();
    await flush();
    expect(win.close).toHaveBeenCalledOnce();
  });

  it("coalesces repeated close, cancels and retries with a different query ID", async () => {
    const decision = deferred<boolean>();
    const { guard, fire, queryState, confirm, resume, win } = setup({
      queryState: async (id) => ready(id, true), confirm: () => decision.promise,
    });
    guard.setDirty(false);
    fire(); fire();
    await flush();
    expect(queryState).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledExactlyOnceWith(false);
    decision.resolve(false);
    await flush();
    expect(resume).toHaveBeenCalledExactlyOnceWith(queryState.mock.calls[0]![0]);
    expect(win.close).not.toHaveBeenCalled();
    fire();
    await flush();
    expect(queryState).toHaveBeenCalledTimes(2);
    expect(queryState.mock.calls[1]![0]).not.toBe(queryState.mock.calls[0]![0]);
  });

  it.each([
    { kind: "ready", queryId: "wrong", dirty: false, pendingSaves: 0, documentEpoch: 1, historyNodeId: "n" },
    { kind: "ready", dirty: false, pendingSaves: 1 },
    { kind: "ready", dirty: "false", pendingSaves: 0 },
    null,
  ])("does not treat an invalid response as clean: %j", async (response) => {
    const { fire, confirm, win, stopWrites } = setup({ queryState: async () => response });
    fire();
    await flush();
    expect(stopWrites).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledExactlyOnceWith(true);
    expect(win.close).not.toHaveBeenCalled();
  });

  it("a renderer timeout still waits for main writes and ignores the late clean response", async () => {
    const response = deferred<unknown>();
    const writes = deferred<void>();
    const { fire, queryState, stopWrites, confirm, win, resume } = setup({
      queryState: () => response.promise, stopWrites: () => writes.promise, timeout: 1,
    });
    fire();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stopWrites).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    writes.resolve();
    await flush();
    expect(confirm).toHaveBeenCalledExactlyOnceWith(true);
    expect(resume).toHaveBeenCalledOnce();
    response.resolve(ready(queryState.mock.calls[0]![0]));
    await flush();
    expect(win.close).not.toHaveBeenCalled();
  });

  it("uses discard permission once, then rechecks any later close", async () => {
    const { fire, win, queryState } = setup({ queryState: async (id) => ready(id, true), confirm: async () => true });
    fire(); await flush();
    expect(win.close).toHaveBeenCalledOnce();
    expect(fire().preventDefault).not.toHaveBeenCalled();
    expect(fire().preventDefault).toHaveBeenCalledOnce();
    await flush();
    expect(queryState).toHaveBeenCalledTimes(2);
  });

  it("resumes after a confirmation error and never grants close permission", async () => {
    const { fire, win, resume } = setup({ queryState: async (id) => ready(id, true), confirm: async () => { throw new Error("dialog"); } });
    fire(); await flush();
    expect(resume).toHaveBeenCalledOnce();
    expect(win.close).not.toHaveBeenCalled();
  });

  it("a query failure is unknown and admission failure cannot authorize close", async () => {
    const { fire, win, confirm, resume, stopWrites } = setup({
      queryState: async () => { throw new Error("renderer crashed"); },
      stopWrites: async () => { throw new Error("cannot prove writes settled"); },
    });
    fire(); await flush();
    expect(stopWrites).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    expect(resume).toHaveBeenCalledOnce();
    expect(win.close).not.toHaveBeenCalled();
  });

  it("clears checking even when resuming a cancelled close throws", async () => {
    const { fire, queryState, resume, win } = setup({ queryState: async (id) => ready(id, true) });
    resume.mockImplementation(() => { throw new Error("webContents disappeared"); });
    fire(); await flush();
    fire(); await flush();
    expect(queryState).toHaveBeenCalledTimes(2);
    expect(win.close).not.toHaveBeenCalled();
  });
});
