// [[TECSCDE-DT-EL内部仕様]] 第9C章 — tecsgenの版の確認（解釈・比較・診断・保持）。

import { describe, expect, it, vi } from "vitest";
import {
  MIN_TECSGEN_VERSION,
  TECSGEN_VERSION_CODES,
  checkTecsgenVersion,
  compareVersions,
  evaluateTecsgenVersion,
  parseTecsgenVersion,
} from "../../src/renderer/app/tecsgen-version";
import { AppStore } from "../../src/renderer/app/store";
import type { TecsgenVersionResult } from "../../src/shared/ipc-types";

describe("parseTecsgenVersion", () => {
  it("reads the version from the tecsgen banner", () => {
    expect(parseTecsgenVersion("tecsgen  version 1.9.1  ")).toEqual([1, 9, 1]);
  });
  it("accepts a leading V and four components", () => {
    expect(parseTecsgenVersion("tecsgen version V1.3.1.0")).toEqual([1, 3, 1, 0]);
  });
  it("falls back to the first dotted number", () => {
    expect(parseTecsgenVersion("tecsgen-python3 1.10.0 (python)")).toEqual([1, 10, 0]);
  });
  it("returns undefined when there is no version", () => {
    expect(parseTecsgenVersion("")).toBeUndefined();
    expect(parseTecsgenVersion("no digits here")).toBeUndefined();
  });
});

describe("compareVersions", () => {
  it("compares numerically, so 1.10 is newer than 1.9", () => {
    expect(compareVersions([1, 10], [1, 9])).toBe(1);
  });
  it("treats missing components as zero", () => {
    expect(compareVersions([1, 9, 1], [1, 9, 1, 0])).toBe(0);
  });
  it("orders 1.3.0.9 before 1.3.1.0", () => {
    expect(compareVersions([1, 3, 0, 9], MIN_TECSGEN_VERSION)).toBe(-1);
  });
});

describe("evaluateTecsgenVersion", () => {
  const ok = (text: string): TecsgenVersionResult => ({ kind: "ok", text });

  it("warns when the version is older than the minimum", () => {
    const { diagnostics, logLine } = evaluateTecsgenVersion(ok("tecsgen  version 1.2.0"));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: "warning", code: TECSGEN_VERSION_CODES.OLD });
    expect(diagnostics[0]!.location).toBeUndefined();
    expect(diagnostics[0]!.message).toContain("1.2.0");
    expect(logLine).toBe("tecsgen version: 1.2.0");
  });

  it("is silent for a supported version but still logs it", () => {
    expect(evaluateTecsgenVersion(ok("tecsgen  version 1.9.1  "))).toEqual({
      diagnostics: [], logLine: "tecsgen version: 1.9.1",
    });
    expect(evaluateTecsgenVersion(ok("version 1.3.1.0")).diagnostics).toEqual([]);
  });

  it("warns that the version is unknown when the output cannot be read", () => {
    for (const result of [ok(""), ok("garbage"), { kind: "failed", detail: "終了コード 2" } as const]) {
      const { diagnostics, logLine } = evaluateTecsgenVersion(result);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ severity: "warning", code: TECSGEN_VERSION_CODES.UNKNOWN });
      expect(logLine).toBeUndefined();
    }
  });

  it("says nothing when tecsgen is not found", () => {
    expect(evaluateTecsgenVersion({ kind: "not-found" })).toEqual({ diagnostics: [] });
  });
});

describe("checkTecsgenVersion — information for the version dialog (3.8)", () => {
  const log = { append: vi.fn().mockResolvedValue(undefined) };
  it("keeps the confirmed version and the command that was used", async () => {
    const store = new AppStore();
    await checkTecsgenVersion(store, { version: async () => ({ kind: "ok", text: "tecsgen  version 1.9.1", command: "tecsgen" }) }, log);
    expect(store.getTecsgenInfo()).toEqual({ version: [1, 9, 1], command: "tecsgen" });
  });
  it("keeps only the command when tecsgen was not found", async () => {
    const store = new AppStore();
    await checkTecsgenVersion(store, { version: async () => ({ kind: "not-found", command: "tecsgen" }) }, log);
    expect(store.getTecsgenInfo()).toEqual({ command: "tecsgen" });
  });
  it("keeps only the command when the version could not be read", async () => {
    const store = new AppStore();
    await checkTecsgenVersion(store, { version: async () => ({ kind: "failed", detail: "x", command: "ruby t.rb" }) }, log);
    expect(store.getTecsgenInfo()).toEqual({ command: "ruby t.rb" });
  });
  it("has no information before the check runs", () => {
    expect(new AppStore().getTecsgenInfo()).toBeUndefined();
  });
});

describe("checkTecsgenVersion", () => {
  it("stores the warning so that it survives document loads and Generate results", async () => {
    const store = new AppStore();
    const log = { append: vi.fn().mockResolvedValue(undefined) };
    await checkTecsgenVersion(store, { version: async () => ({ kind: "ok", text: "tecsgen  version 1.2.0" }) }, log);
    const codes = () => store.getReport().items.map((d) => d.code);
    expect(codes()).toContain(TECSGEN_VERSION_CODES.OLD);

    store.setTecsgenDiagnostics([]);
    expect(codes()).toContain(TECSGEN_VERSION_CODES.OLD);
    store.loadDocument(store.getDocument(), null);
    expect(codes()).toContain(TECSGEN_VERSION_CODES.OLD);
    expect(log.append).toHaveBeenCalledWith(["tecsgen version: 1.2.0"]);
  });

  it("adds nothing when the version is supported, and logs the version", async () => {
    const store = new AppStore();
    const log = { append: vi.fn().mockResolvedValue(undefined) };
    await checkTecsgenVersion(store, { version: async () => ({ kind: "ok", text: "tecsgen  version 1.9.1" }) }, log);
    expect(store.getReport().items.map((d) => d.code)).not.toContain(TECSGEN_VERSION_CODES.OLD);
    expect(log.append).toHaveBeenCalledWith(["tecsgen version: 1.9.1"]);
  });

  it("treats a rejected IPC call as an unknown version", async () => {
    const store = new AppStore();
    const log = { append: vi.fn().mockResolvedValue(undefined) };
    await checkTecsgenVersion(store, { version: async () => { throw new Error("ipc failed"); } }, log);
    expect(store.getReport().items.map((d) => d.code)).toContain(TECSGEN_VERSION_CODES.UNKNOWN);
  });

  it("calls onWarning (to open the diagnostics panel) only when a warning was stored", async () => {
    const log = { append: vi.fn().mockResolvedValue(undefined) };
    const warn = vi.fn();
    await checkTecsgenVersion(new AppStore(), { version: async () => ({ kind: "ok", text: "version 1.2.0" }) }, log, warn);
    expect(warn).toHaveBeenCalledTimes(1);

    const quiet = vi.fn();
    await checkTecsgenVersion(new AppStore(), { version: async () => ({ kind: "ok", text: "version 1.9.1" }) }, log, quiet);
    await checkTecsgenVersion(new AppStore(), { version: async () => ({ kind: "not-found" }) }, log, quiet);
    expect(quiet).not.toHaveBeenCalled();
  });
});
