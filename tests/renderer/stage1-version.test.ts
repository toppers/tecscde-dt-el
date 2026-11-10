import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { TECSCDE_TS_VERSION } from "../../src/renderer/model/tool-info-types";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { TecscdeDocument } from "../../src/renderer/model/document";
import { AppStore } from "../../src/renderer/app/store";
import { checkTecsgenVersion } from "../../src/renderer/app/tecsgen-version";
import type { TecsgenVersionResult } from "../../src/shared/ipc-types";

describe("stage1 application version", () => {
  it("uses the build-injected package version for persisted metadata", () => {
    const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    const expected = process.env.TECSCDE_TEST_APP_VERSION ?? version;
    expect(TECSCDE_TS_VERSION).toBe(expected);
    expect(CdlSerializer.serialize(TecscdeDocument.empty())).toContain(`"tecscde_version": "${expected}"`);
  });
  it("replaces old tool diagnostics after reconfiguration while retaining unrelated diagnostics", async () => {
    const store = new AppStore(); const log = { append: vi.fn(async () => {}) };
    store.setEnvironmentDiagnostics([{ severity: "warning", code: "W-OTHER", message: "retain" }]);
    store.setTecsgenDiagnostics([{ severity: "error", code: "E-TECSGEN-NOT-FOUND", message: "old config" },
      { severity: "error", code: "G1001", message: "source error" }]);
    await checkTecsgenVersion(store, { version: async () => ({ kind: "ok", text: "version 1.0" }) }, log);
    await checkTecsgenVersion(store, { version: async () => ({ kind: "ok", text: "version 1.9.1" }) }, log);
    expect(store.getReport().items.map((entry) => entry.code)).toEqual(["G1001", "W-OTHER"]);
  });
  it("ignores an old version result that finishes after the latest check", async () => {
    const store = new AppStore(); const log = { append: vi.fn(async () => {}) };
    let resolve!: (result: TecsgenVersionResult) => void;
    const pending = checkTecsgenVersion(store, { version: () => new Promise((r) => { resolve = r; }) }, log);
    await checkTecsgenVersion(store, { version: async () => ({ kind: "ok", text: "version 1.9.1" }) }, log);
    resolve({ kind: "ok", text: "version 1.0" }); await pending;
    expect(store.getReport().warningCount).toBe(0);
    expect(log.append).toHaveBeenCalledTimes(1);
  });
  it("does not start a delayed startup check from an older settings revision", async () => {
    const store = new AppStore(); const log = { append: vi.fn(async () => {}) };
    await checkTecsgenVersion(store, { version: async () => ({ kind: "ok", text: "version 1.9.1" }) }, log,
      undefined, "new-command", 2);
    const version = vi.fn(async () => ({ kind: "ok" as const, text: "obsolete" }));
    await checkTecsgenVersion(store, { version }, log, undefined, "old-command", 1);
    expect(version).not.toHaveBeenCalled(); expect(store.getTecsgenStatus().command).toBe("new-command");
  });
  it("rejects a late Generate failure from a previous tool setting", async () => {
    const store = new AppStore(); const log = { append: vi.fn(async () => {}) };
    await checkTecsgenVersion(store, { version: async () => ({ kind: "ok", text: "version 1.9.1" }) }, log,
      undefined, "new-command", 2);
    store.setTecsgenDiagnostics([{ severity: "error", code: "E-TECSGEN-LAUNCH-FAILED", message: "old" }], 1);
    expect(store.getReport().errorCount).toBe(0);
  });
  it("retains a newer Generate failure under the same settings during startup version checking", async () => {
    const store = new AppStore(); const log = { append: vi.fn(async () => {}) };
    let resolve!: (result: TecsgenVersionResult) => void;
    const pending = checkTecsgenVersion(store, { version: () => new Promise((r) => { resolve = r; }) }, log,
      undefined, "same-command", 1);
    store.setTecsgenDiagnostics([{ severity: "error", code: "E-TECSGEN-LAUNCH-FAILED", message: "new failure" }], 1);
    resolve({ kind: "ok", text: "version 1.9.1" }); await pending;
    expect(store.getReport().items.map((entry) => entry.code)).toContain("E-TECSGEN-LAUNCH-FAILED");
  });
});
