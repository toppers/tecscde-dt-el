import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createCloseStateQuery } from "../../src/main/close-state-bridge.js";

function setup() {
  const ipc = new EventEmitter();
  const webContents = { send: vi.fn(), isDestroyed: vi.fn(() => false) };
  const query = createCloseStateQuery(ipc, webContents);
  return { ipc, webContents, query };
}

describe("close state IPC bridge", () => {
  it("registers before sending and resolves only the matching sender and query", async () => {
    const { ipc, webContents, query } = setup();
    webContents.send.mockImplementation(() => {
      expect(ipc.listenerCount("window:closeState")).toBe(1);
    });
    const pending = query.queryState("close-1");
    let settled = false;
    void pending.then(() => { settled = true; });
    expect(webContents.send).toHaveBeenCalledExactlyOnceWith("window:requestCloseState", { queryId: "close-1" });
    ipc.emit("window:closeState", { sender: {} }, { queryId: "close-1", kind: "ready" });
    ipc.emit("window:closeState", { sender: webContents }, { queryId: "wrong", kind: "ready" });
    ipc.emit("window:closeState", { sender: webContents }, null);
    await Promise.resolve();
    expect(settled).toBe(false);
    const response = { queryId: "close-1", kind: "ready", dirty: false };
    ipc.emit("window:closeState", { sender: webContents }, response);
    await expect(pending).resolves.toBe(response);
    expect(ipc.listenerCount("window:closeState")).toBe(0);
  });

  it("passes malformed matching responses to CloseGuard validation", async () => {
    const { ipc, webContents, query } = setup();
    const pending = query.queryState("close-1");
    const malformed = { queryId: "close-1", kind: "ready", dirty: "false" };
    ipc.emit("window:closeState", { sender: webContents }, malformed);
    await expect(pending).resolves.toBe(malformed);
    expect(ipc.listenerCount("window:closeState")).toBe(0);
  });

  it("cancels a timed-out query, releases the listener and ignores its late answer", async () => {
    const { ipc, webContents, query } = setup();
    const pending = query.queryState("close-1");
    query.cancel("close-1");
    await expect(pending).resolves.toEqual({ kind: "unavailable", queryId: "close-1" });
    expect(webContents.send).toHaveBeenLastCalledWith("window:cancelCloseState", { queryId: "close-1" });
    expect(ipc.listenerCount("window:closeState")).toBe(0);
    const next = query.queryState("close-2");
    ipc.emit("window:closeState", { sender: webContents }, { queryId: "close-1", kind: "ready" });
    const response = { queryId: "close-2", kind: "unavailable" };
    ipc.emit("window:closeState", { sender: webContents }, response);
    await expect(next).resolves.toBe(response);
  });

  it("sends cancellation even after the state answer has already arrived", async () => {
    const { ipc, webContents, query } = setup();
    const pending = query.queryState("close-1");
    ipc.emit("window:closeState", { sender: webContents }, { queryId: "close-1", kind: "ready" });
    await pending;
    query.cancel("close-1");
    expect(webContents.send).toHaveBeenLastCalledWith("window:cancelCloseState", { queryId: "close-1" });
  });

  it("disposes all listeners, settles outstanding queries and refuses later queries", async () => {
    const { ipc, webContents, query } = setup();
    const first = query.queryState("close-1");
    const second = query.queryState("close-2");
    query.dispose();
    await expect(first).resolves.toEqual({ kind: "unavailable", queryId: "close-1" });
    await expect(second).resolves.toEqual({ kind: "unavailable", queryId: "close-2" });
    expect(ipc.listenerCount("window:closeState")).toBe(0);
    await expect(query.queryState("close-3")).resolves.toEqual({ kind: "unavailable", queryId: "close-3" });
    expect(webContents.send).toHaveBeenCalledTimes(2);
    query.cancel("close-3");
    expect(webContents.send).toHaveBeenCalledTimes(2);
  });

  it("settles destroyed targets and send failures conservatively without leaking listeners", async () => {
    const { ipc, webContents, query } = setup();
    webContents.isDestroyed.mockReturnValue(true);
    await expect(query.queryState("destroyed")).resolves.toEqual({ kind: "unavailable", queryId: "destroyed" });
    expect(webContents.send).not.toHaveBeenCalled();
    webContents.isDestroyed.mockReturnValue(false);
    webContents.send.mockImplementation(() => { throw new Error("destroyed during send"); });
    await expect(query.queryState("failed")).resolves.toEqual({ kind: "unavailable", queryId: "failed" });
    expect(ipc.listenerCount("window:closeState")).toBe(0);
    expect(() => query.cancel("failed")).not.toThrow();
  });
});
