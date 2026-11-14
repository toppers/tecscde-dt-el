import { describe, expect, it, vi } from "vitest";
import { DiagnosticsLogger } from "../../src/renderer/app/diagnostics-logger";
import { formatDiagnostic, escapeSingleLine, unescapeSingleLine } from "../../src/renderer/diagnostics/format";
import type { Diagnostic } from "../../src/renderer/diagnostics/types";
import type { AppStore } from "../../src/renderer/app/store";
import { W_CODES } from "../../src/renderer/cdl/messages";

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

describe("formatDiagnostic & escapeSingleLine", () => {
  it("renders [CODE] message, with file:line:column when a location is known", () => {
    expect(formatDiagnostic(diag("W-X", "msg"))).toBe("[W-X] msg");
    expect(formatDiagnostic(diag("W-X", "msg", { file: "a.cdl", line: 3, column: 5 }))).toBe("[W-X] a.cdl:3:5: msg");
  });

  it("escapes newlines and backslashes into single line and can be unescaped (audit #68)", () => {
    const multilineMsg = "line 1\nline 2\r\nline 3 \\ backslash";
    const escaped = escapeSingleLine(multilineMsg);
    expect(escaped).toBe("line 1\\nline 2\\r\\nline 3 \\\\ backslash");
    expect(unescapeSingleLine(escaped)).toBe(multilineMsg);

    const formatted = formatDiagnostic(diag("W-MULTI", multilineMsg));
    expect(formatted).not.toContain("\n");
    expect(formatted).not.toContain("\r");
    expect(formatted).toBe("[W-MULTI] line 1\\nline 2\\r\\nline 3 \\\\ backslash");
  });
});

describe("DiagnosticsLogger", () => {
  it("does not write anything when a file is open but has no diagnostics (audit #67)", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { store } = fakeStore({ filePath: "/p/main.cdl", items: [] });

    new DiagnosticsLogger(store, write).sync();

    // 区切り行だけのログを作らない
    expect(write).not.toHaveBeenCalled();
  });

  it("writes the pending file header together with diagnostics when diagnostics first appear (audit #67)", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { store, state } = fakeStore({ filePath: "/p/main.cdl", items: [] });
    const logger = new DiagnosticsLogger(store, write);

    logger.sync();
    expect(write).not.toHaveBeenCalled();

    state.items = [diag("W-A", "one"), diag("W-B", "two")];
    logger.sync();

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

  it("never writes the log-write-failed warning into the log (spec 9.5.2 rule 13)", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { store } = fakeStore({
      filePath: "/p/main.cdl",
      items: [diag("W-A", "one"), diag("W-LOG-WRITE-FAILED", "cannot write the log")],
    });

    new DiagnosticsLogger(store, write).sync();

    expect(write).toHaveBeenCalledWith(["--- /p/main.cdl ---", "[W-A] one"]);
  });

  it("starts over with a separator line when the edited file changes", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { store, state } = fakeStore({ filePath: "/p/a.cdl", items: [diag("W-A", "one")] });
    const logger = new DiagnosticsLogger(store, write);
    logger.sync();
    write.mockClear();

    // ファイルb.cdlに切り替えたが、診断がまだない場合は書き込まない
    state.filePath = "/p/b.cdl";
    state.items = [];
    logger.sync();
    expect(write).not.toHaveBeenCalled();

    // 診断が現れたら --- /p/b.cdl --- と一緒に書き込まれる
    state.items = [diag("W-A", "one")];
    logger.sync();
    expect(write).toHaveBeenCalledWith(["--- /p/b.cdl ---", "[W-A] one"]);
  });

  it("filters out W-LOG-WRITE-FAILED from being logged to prevent recursion (audit #66)", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { store, state } = fakeStore({
      filePath: "/p/main.cdl",
      items: [diag(W_CODES.LOG_WRITE_FAILED, "failed to write log")],
    });
    const logger = new DiagnosticsLogger(store, write);

    logger.sync();
    // ログ書き込み失敗警告単独なら書き込まない
    expect(write).not.toHaveBeenCalled();

    // 他の診断がある場合、W-LOG-WRITE-FAILED 以外だけが出力される
    state.items = [diag("W-A", "one"), diag(W_CODES.LOG_WRITE_FAILED, "failed to write log")];
    logger.sync();
    expect(write).toHaveBeenCalledWith(["--- /p/main.cdl ---", "[W-A] one"]);
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
