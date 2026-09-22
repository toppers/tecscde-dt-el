// [[TECSCDE-DT-EL内部仕様]] 第7B章「ファイルブラウザ設計」7.6.6節 — アプリケーション設定の
// 永続化の単体テスト。`app.getPath`はモックし、実際の一時ディレクトリに対して読み書きする。
// Windowsでは`LOCALAPPDATA`（`vi.stubEnv`で一時ディレクトリへ差し替え）を優先し、
// `app.getPath('userData')`（Roaming）へは書かない（2026-09-22、ローミング同期回避のため）。

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const getPath = vi.fn();

vi.mock("electron", () => ({
  app: { getPath: (...args: unknown[]) => getPath(...args) },
}));

const { loadAppSettings, saveAppSettings } = await import("../../src/main/app-settings.js");

describe("app-settings", () => {
  let userDataDir: string;
  let localAppDataDir: string;

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "tecscde-dt-el-userdata-"));
    localAppDataDir = mkdtempSync(join(tmpdir(), "tecscde-dt-el-localappdata-"));
    getPath.mockReturnValue(userDataDir);
    // このマシン自体がWindowsのため、LOCALAPPDATAを一時ディレクトリへ差し替えて分離する。
    vi.stubEnv("LOCALAPPDATA", localAppDataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(localAppDataDir, { recursive: true, force: true });
  });

  it("loadAppSettings returns {} when no settings file exists yet (初回起動)", async () => {
    await expect(loadAppSettings()).resolves.toEqual({});
  });

  it("saveAppSettings writes under LOCALAPPDATA/tecscde-dt-el, not app.getPath('userData') (2026-09-22)", async () => {
    await saveAppSettings({ fileBrowserRoot: "/root/project" });

    const saved = JSON.parse(readFileSync(join(localAppDataDir, "tecscde-dt-el", "settings.json"), "utf-8")) as {
      fileBrowserRoot?: string;
    };
    expect(saved.fileBrowserRoot).toBe("/root/project");
    expect(getPath).not.toHaveBeenCalled();
  });

  it("loadAppSettings returns {} when the settings file is corrupted, without throwing", async () => {
    writeFileSync(join(localAppDataDir, "settings.json"), "{not json"); // 誤った場所（サブディレクトリ無し）に置いても影響しないことの確認を兼ねる
    await expect(loadAppSettings()).resolves.toEqual({});
  });

  it("saveAppSettings then loadAppSettings round-trips the fileBrowserRoot", async () => {
    await saveAppSettings({ fileBrowserRoot: "/root/project" });
    await expect(loadAppSettings()).resolves.toEqual({ fileBrowserRoot: "/root/project" });
  });

  it("saveAppSettings overwrites the previous value", async () => {
    await saveAppSettings({ fileBrowserRoot: "/root/a" });
    await saveAppSettings({ fileBrowserRoot: "/root/b" });
    await expect(loadAppSettings()).resolves.toEqual({ fileBrowserRoot: "/root/b" });
  });

  it("saveAppSettings then loadAppSettings round-trips lastSession", async () => {
    await saveAppSettings({
      lastSession: { editablePath: "/root/main.cde", referencePaths: ["/root/celltypes.cdl"] },
    });
    await expect(loadAppSettings()).resolves.toEqual({
      lastSession: { editablePath: "/root/main.cde", referencePaths: ["/root/celltypes.cdl"] },
    });
  });

  it("saveAppSettings merges lastSession without clobbering a previously saved fileBrowserRoot (2026-09-22)", async () => {
    await saveAppSettings({ fileBrowserRoot: "/root/project" });
    await saveAppSettings({ lastSession: { editablePath: "/root/main.cde", referencePaths: [] } });

    await expect(loadAppSettings()).resolves.toEqual({
      fileBrowserRoot: "/root/project",
      lastSession: { editablePath: "/root/main.cde", referencePaths: [] },
    });
  });

  it("saveAppSettings merges fileBrowserRoot without clobbering a previously saved lastSession (2026-09-22)", async () => {
    await saveAppSettings({ lastSession: { editablePath: "/root/main.cde", referencePaths: [] } });
    await saveAppSettings({ fileBrowserRoot: "/root/project" });

    await expect(loadAppSettings()).resolves.toEqual({
      fileBrowserRoot: "/root/project",
      lastSession: { editablePath: "/root/main.cde", referencePaths: [] },
    });
  });

  it("falls back to app.getPath('userData') when LOCALAPPDATA is unset", async () => {
    vi.stubEnv("LOCALAPPDATA", "");

    await saveAppSettings({ fileBrowserRoot: "/root/project" });

    expect(getPath).toHaveBeenCalledWith("userData");
    const saved = JSON.parse(readFileSync(join(userDataDir, "settings.json"), "utf-8")) as { fileBrowserRoot?: string };
    expect(saved.fileBrowserRoot).toBe("/root/project");
  });
});
