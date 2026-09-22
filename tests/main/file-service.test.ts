// [[TECSCDE-DT-EL内部仕様]] 第7章 — FileService の単体テスト。
// dialog はモックし、fs は実際の一時ディレクトリに対して行う
// （atomic write を tmpファイル→renameという実際のファイルシステム操作として検証するため）。

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileService } from "../../src/main/file-service.js";

const showOpenDialog = vi.fn();
const showSaveDialog = vi.fn();
const showMessageBox = vi.fn();
const getPath = vi.fn();

// vi.mock はvitestによりファイル先頭へホイストされるため、上の import より前に
// 評価される（electronモジュールへの実依存を持たずにFileServiceを検証できる）。
// app.getPath('userData')は7.6.6節のsaveAppSettings()（chooseFolder経由）が使う。
vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: (...args: unknown[]) => showOpenDialog(...args),
    showSaveDialog: (...args: unknown[]) => showSaveDialog(...args),
    showMessageBox: (...args: unknown[]) => showMessageBox(...args),
  },
  app: {
    getPath: (...args: unknown[]) => getPath(...args),
  },
}));

describe("FileService", () => {
  let dir: string;
  let localAppDataDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tecscde-dt-el-"));
    localAppDataDir = mkdtempSync(join(tmpdir(), "tecscde-dt-el-localappdata-"));
    showOpenDialog.mockReset();
    showSaveDialog.mockReset();
    showMessageBox.mockReset();
    getPath.mockReset().mockReturnValue(dir);
    // このマシン自体がWindowsのため、app-settings.tsのLOCALAPPDATA分岐（2026-09-22）が
    // 実際のユーザーのAppDataへ書き込まないよう、一時ディレクトリへ差し替えて分離する。
    vi.stubEnv("LOCALAPPDATA", localAppDataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
    rmSync(localAppDataDir, { recursive: true, force: true });
  });

  it("save() writes via a temp file then renames it (atomic write)", async () => {
    const target = join(dir, "out.cde");
    const service = new FileService({} as never);

    await service.save(target, "hello");

    expect(readFileSync(target, "utf-8")).toBe("hello");
    // 一時ファイルが残っていないこと（renameで消費された）
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });

  it("saveAsDialog returns null when the user cancels, without writing anything", async () => {
    showSaveDialog.mockResolvedValue({ canceled: true });
    const service = new FileService({} as never);

    const result = await service.saveAsDialog("untitled.cde", "content");

    expect(result).toBeNull();
  });

  it("saveAsDialog writes to the chosen path and returns it", async () => {
    const target = join(dir, "chosen.cde");
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    const service = new FileService({} as never);

    const result = await service.saveAsDialog("untitled.cde", "content");

    expect(result).toBe(target);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("content");
  });

  it("openPath (7.4節: コマンドライン引数由来) reads a single path without a dialog", async () => {
    const path = join(dir, "argv.cde");
    writeFileSync(path, "from-argv");
    const service = new FileService({} as never);

    const result = await service.openPath(path);

    expect(result.editable).toEqual({ path, content: "from-argv" });
    expect(result.references).toEqual([]);
    expect(showOpenDialog).not.toHaveBeenCalled();
  });

  it("chooseFolder returns null when the user cancels", async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const service = new FileService({} as never);
    await expect(service.chooseFolder()).resolves.toBeNull();
  });

  it("chooseFolder returns the chosen directory path", async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [dir] });
    const service = new FileService({} as never);
    await expect(service.chooseFolder()).resolves.toBe(dir);
  });

  it("chooseFolder persists the chosen folder to settings.json (7.6.6節)", async () => {
    const chosen = join(dir, "project");
    mkdirSync(chosen);
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [chosen] });
    const service = new FileService({} as never);

    await service.chooseFolder();

    const saved = JSON.parse(
      readFileSync(join(localAppDataDir, "tecscde-dt-el", "settings.json"), "utf-8"),
    ) as { fileBrowserRoot?: string };
    expect(saved.fileBrowserRoot).toBe(chosen);
  });

  it("primeLastChosenFolder makes chooseFolder use it as defaultPath before any chooseFolder() call (実機確認で発見、2026-09-21)", async () => {
    const service = new FileService({} as never);
    service.primeLastChosenFolder(dir);

    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await service.chooseFolder();

    expect(showOpenDialog).toHaveBeenCalledWith({}, { properties: ["openDirectory"], defaultPath: dir });
  });

  it("chooseFolder passes the previously chosen folder as defaultPath on the next call (実機確認で判明、2026-09-21)", async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [dir] });
    const service = new FileService({} as never);

    await service.chooseFolder();
    expect(showOpenDialog).toHaveBeenNthCalledWith(1, {}, { properties: ["openDirectory"], defaultPath: undefined });

    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await service.chooseFolder();
    expect(showOpenDialog).toHaveBeenNthCalledWith(2, {}, { properties: ["openDirectory"], defaultPath: dir });
  });

  it("confirmDiscardChanges (7B章7.6.4節) returns true when the user picks the first button", async () => {
    showMessageBox.mockResolvedValue({ response: 0 });
    const service = new FileService({} as never);

    await expect(service.confirmDiscardChanges()).resolves.toBe(true);
    expect(showMessageBox).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        type: "warning",
        buttons: ["保存せずに開く", "キャンセル"],
        defaultId: 1,
        cancelId: 1,
      }),
    );
  });

  it("confirmDiscardChanges returns false when the user cancels (response 1)", async () => {
    showMessageBox.mockResolvedValue({ response: 1 });
    const service = new FileService({} as never);

    await expect(service.confirmDiscardChanges()).resolves.toBe(false);
  });

  it("listDirectory (7.6.1節) returns only subdirectories and .cde/.cdl files, sorted directories first", async () => {
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "b.cde"), "");
    writeFileSync(join(dir, "a.cdl"), "");
    writeFileSync(join(dir, "ignore.txt"), "");
    const service = new FileService({} as never);

    const entries = await service.listDirectory(dir);

    expect(entries).toEqual([
      { name: "sub", path: join(dir, "sub"), kind: "directory" },
      { name: "a.cdl", path: join(dir, "a.cdl"), kind: "file" },
      { name: "b.cde", path: join(dir, "b.cde"), kind: "file" },
    ]);
  });
});
