import { describe, expect, it, vi } from "vitest";
import { createLogAppender } from "../../src/renderer/app/log-appender";
import { W_CODES } from "../../src/renderer/cdl/messages";
import type { Diagnostic } from "../../src/renderer/diagnostics/types";

describe("createLogAppender (audit #66)", () => {
  it("does not report warning when append succeeds", async () => {
    const diags: Diagnostic[] = [];
    const store = {
      addEnvironmentDiagnostic: vi.fn((d: Diagnostic) => diags.push(d)),
    };
    const gateway = {
      append: vi.fn(async () => ({ success: true, newFailure: false })),
    };

    const appender = createLogAppender(store, gateway);
    const res = await appender.append(["line 1"]);

    expect(res).toEqual({ success: true, newFailure: false });
    expect(store.addEnvironmentDiagnostic).not.toHaveBeenCalled();
  });

  it("adds W-LOG-WRITE-FAILED to store on new failure", async () => {
    const diags: Diagnostic[] = [];
    const store = {
      addEnvironmentDiagnostic: vi.fn((d: Diagnostic) => diags.push(d)),
    };
    const gateway = {
      append: vi.fn(async () => ({ success: false, newFailure: true, error: "write error" })),
    };

    const appender = createLogAppender(store, gateway);
    const res = await appender.append(["line 1"]);

    expect(res.success).toBe(false);
    expect(res.newFailure).toBe(true);
    expect(store.addEnvironmentDiagnostic).toHaveBeenCalledTimes(1);
    expect(diags[0]?.code).toBe(W_CODES.LOG_WRITE_FAILED);
  });

  it("does not add W-LOG-WRITE-FAILED on subsequent failures (newFailure: false)", async () => {
    const diags: Diagnostic[] = [];
    const store = {
      addEnvironmentDiagnostic: vi.fn((d: Diagnostic) => diags.push(d)),
    };
    const gateway = {
      append: vi.fn(async () => ({ success: false, newFailure: false, error: "subsequent error" })),
    };

    const appender = createLogAppender(store, gateway);
    const res = await appender.append(["line 2"]);

    expect(res.success).toBe(false);
    expect(res.newFailure).toBe(false);
    expect(store.addEnvironmentDiagnostic).not.toHaveBeenCalled();
  });

  it("catches thrown exceptions and adds W-LOG-WRITE-FAILED to store", async () => {
    const diags: Diagnostic[] = [];
    const store = {
      addEnvironmentDiagnostic: vi.fn((d: Diagnostic) => diags.push(d)),
    };
    const gateway = {
      append: vi.fn(async () => {
        throw new Error("IPC transport crash");
      }),
    };

    const appender = createLogAppender(store, gateway);
    const res = await appender.append(["line 1"]);

    expect(res.success).toBe(false);
    expect(res.newFailure).toBe(true);
    expect(res.error).toBe("IPC transport crash");
    expect(store.addEnvironmentDiagnostic).toHaveBeenCalledTimes(1);
    expect(diags[0]?.code).toBe(W_CODES.LOG_WRITE_FAILED);
  });
});
