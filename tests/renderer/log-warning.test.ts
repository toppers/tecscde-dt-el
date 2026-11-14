// 外部仕様9.5.2の規定13: ログを書けないときは、アプリを止めず、警告 W-LOG-WRITE-FAILED を一度だけ
// 診断の一覧（画面）に出す。ログには書かない。
import { describe, expect, it, vi } from "vitest";
import { AppStore } from "../../src/renderer/app/store";
import { LOG_WRITE_FAILED_CODE, createLogAppender, logWriteFailedDiagnostic } from "../../src/renderer/app/log-warning";

describe("logWriteFailedDiagnostic", () => {
  it("is a warning with code W-LOG-WRITE-FAILED, and says the reason", () => {
    const d = logWriteFailedDiagnostic("EACCES: permission denied");
    expect(LOG_WRITE_FAILED_CODE).toBe("W-LOG-WRITE-FAILED");
    expect(d.severity).toBe("warning");
    expect(d.code).toBe("W-LOG-WRITE-FAILED");
    expect(d.message).toContain("EACCES: permission denied");
  });
});

describe("AppStore log write warning", () => {
  const codes = (store: AppStore): string[] => store.getReport().items.map((d) => d.code);

  it("shows up in the diagnostics list, and survives document loads", () => {
    const store = new AppStore();
    expect(codes(store)).not.toContain("W-LOG-WRITE-FAILED");

    store.setLogWriteWarning(logWriteFailedDiagnostic("x"));
    expect(codes(store)).toContain("W-LOG-WRITE-FAILED");

    store.loadDocument(store.getDocument(), null);
    expect(codes(store).filter((c) => c === "W-LOG-WRITE-FAILED")).toHaveLength(1);
  });
});

describe("createLogAppender", () => {
  it("puts the warning into the store when the main process reports a new failure", async () => {
    const store = new AppStore();
    const gateway = { append: vi.fn().mockResolvedValue({ newFailure: "ENOENT" }) };

    await createLogAppender(gateway, store)(["[W-A] x"]);

    expect(gateway.append).toHaveBeenCalledWith(["[W-A] x"]);
    const warnings = store.getReport().items.filter((d) => d.code === "W-LOG-WRITE-FAILED");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("ENOENT");
  });

  it("adds nothing when the write succeeded", async () => {
    const store = new AppStore();
    const gateway = { append: vi.fn().mockResolvedValue({}) };

    await createLogAppender(gateway, store)(["[W-A] x"]);

    expect(store.getReport().items.map((d) => d.code)).not.toContain("W-LOG-WRITE-FAILED");
  });

  it("lets a rejection of the IPC call itself reach the caller (the caller already handles it)", async () => {
    const store = new AppStore();
    const gateway = { append: vi.fn().mockRejectedValue(new Error("ipc down")) };

    await expect(createLogAppender(gateway, store)(["x"])).rejects.toThrow("ipc down");
  });
});
