import { describe, expect, it, vi } from "vitest";
import { DiagnosticsLogger } from "../../src/renderer/app/diagnostics-logger";
import { formatDiagnostic } from "../../src/renderer/diagnostics/format";
import type { Diagnostic } from "../../src/renderer/diagnostics/types";
import type { AppStore } from "../../src/renderer/app/store";

function diag(code: string, message: string, location?: Diagnostic["location"]): Diagnostic {
  return { severity: "warning", code, message, ...(location ? { location } : {}) } as Diagnostic;
}

function fakeStore(initial: { filePath: string | null; items: Diagnostic[] }) {
  const state = { ...initial };
  const store = {
    get filePath() {
      return state.filePath;
    },
    getReport: () => ({ items: state.items }),
  } as unknown as AppStore;
  return { store, state };
}

describe("formatDiagnostic", () => {
  it("renders [CODE] message, with file:line:column when a location is known", () => {
    expect(formatDiagnostic(diag("W-X", "msg"))).toBe("[W-X] msg");
    expect(formatDiagnostic(diag("W-X", "msg", { file: "a.cdl", line: 3, column: 5 }))).toBe("[W-X] a.cdl:3:5: msg");
  });
});

describe("DiagnosticsLogger", () => {
  it("writes a file header and the current diagnostics in panel format on the first sync", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { store } = fakeStore({ filePath: "/p/main.cdl", items: [diag("W-A", "one"), diag("W-B", "two")] });

    new DiagnosticsLogger(store, write).sync();

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(["--- /p/main.cdl ---", "[W-A] one", "[W-B] two"]);
  });

  it("writes only newly appeared diagnostics on later syncs, and nothing when unchanged", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { store, state } = fakeStore({ filePath: "/p/main.cdl", items: [diag("W-A", "one")] });
    const logger = new DiagnosticsLogger(store, write);
    logger.sync();
    write.mockClear();

    logger.sync();
    expect(write).not.toHaveBeenCalled();

    state.items = [diag("W-A", "one"), diag("W-C", "three")];
    logger.sync();
    expect(write).toHaveBeenCalledWith(["[W-C] three"]);
  });

  it("starts over with a separator line when the edited file changes", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { store, state } = fakeStore({ filePath: "/p/a.cdl", items: [diag("W-A", "one")] });
    const logger = new DiagnosticsLogger(store, write);
    logger.sync();
    write.mockClear();

    state.filePath = "/p/b.cdl";
    logger.sync();

    expect(write).toHaveBeenCalledWith(["--- /p/b.cdl ---", "[W-A] one"]);
  });

  it("does not write anything when there is no file and no diagnostics", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { store } = fakeStore({ filePath: null, items: [] });

    new DiagnosticsLogger(store, write).sync();

    expect(write).not.toHaveBeenCalled();
  });

  it("reports a failed write to the console without throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const write = vi.fn().mockRejectedValue(new Error("disk full"));
    const { store } = fakeStore({ filePath: "/p/a.cdl", items: [diag("W-A", "one")] });

    expect(() => new DiagnosticsLogger(store, write).sync()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
