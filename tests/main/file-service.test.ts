// [[TECSCDE-DT-EL内部仕様]] 第7章 — FileService の単体テスト。
// dialog はモックし、fs は実際の一時ディレクトリに対して行う
// （atomic write を tmpファイル→renameという実際のファイルシステム操作として検証するため）。

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

  it("openPath normalizes the returned path (第7D章7.5節: resolveImportsとの重複排除に必要)", async () => {
    mkdirSync(join(dir, "editable"), { recursive: true });
    const cleanPath = join(dir, "editable", "main.cde");
    writeFileSync(cleanPath, "content");
    const messyPath = `${dir}/editable/./main.cde`; // path.joinを経由しない生文字列（正規化前）
    const service = new FileService({} as never);

    const result = await service.openPath(messyPath);

    expect(result.editable.path).toBe(resolve(messyPath));
    expect(result.editable.path).toBe(cleanPath);
  });

  describe("resolveImports (第7D章7.5.2節)", () => {
    let editablePath: string;

    beforeEach(() => {
      mkdirSync(join(dir, "editable"), { recursive: true });
      editablePath = join(dir, "editable", "main.cde"); // このファイル自体は存在しなくてよい（dirnameのみ使う）
    });

    it("resolves relative to the editable file's own directory (searchDirs[0])", async () => {
      writeFileSync(join(dir, "editable", "sibling.cdl"), "sibling-content");
      const service = new FileService({} as never);

      const [resolved] = await service.resolveImports(
        editablePath,
        [{ kind: "import", specifier: "sibling.cdl" }],
        { importPaths: ["."] },
      );

      expect(resolved).toEqual({
        request: { kind: "import", specifier: "sibling.cdl" },
        canonicalPath: join(dir, "editable", "sibling.cdl"),
        content: "sibling-content",
      });
    });

    it("falls back to baseDir when not found in the editable file's own directory", async () => {
      const baseDir = join(dir, "base");
      mkdirSync(baseDir);
      writeFileSync(join(baseDir, "fromBase.cdl"), "base-content");
      const service = new FileService({} as never);

      const [resolved] = await service.resolveImports(
        editablePath,
        [{ kind: "import", specifier: "fromBase.cdl" }],
        { importPaths: ["."], baseDir },
      );

      expect(resolved?.canonicalPath).toBe(join(baseDir, "fromBase.cdl"));
      expect(resolved?.content).toBe("base-content");
    });

    it("tries non-'.' importPaths entries within each search directory", async () => {
      mkdirSync(join(dir, "editable", "include"));
      writeFileSync(join(dir, "editable", "include", "header.cdl"), "include-content");
      const service = new FileService({} as never);

      const [resolved] = await service.resolveImports(
        editablePath,
        [{ kind: "import", specifier: "header.cdl" }],
        { importPaths: [".", "include"] }, // "." では見つからず、"include" で見つかる
      );

      expect(resolved?.canonicalPath).toBe(join(dir, "editable", "include", "header.cdl"));
      expect(resolved?.content).toBe("include-content");
    });

    it("falls back to extraSearchDirs (第7D章7.5.3節: tecsgenの$base_dir累積に相当)", async () => {
      const extraDir = join(dir, "extra");
      mkdirSync(extraDir);
      writeFileSync(join(extraDir, "fromExtra.cdl"), "extra-content");
      const service = new FileService({} as never);

      const [resolved] = await service.resolveImports(
        editablePath,
        [{ kind: "import", specifier: "fromExtra.cdl" }],
        { importPaths: ["."], extraSearchDirs: [extraDir] },
      );

      expect(resolved?.canonicalPath).toBe(join(extraDir, "fromExtra.cdl"));
      expect(resolved?.content).toBe("extra-content");
    });

    it("prefers the editable file's own directory over baseDir when both have a matching file", async () => {
      const baseDir = join(dir, "base");
      mkdirSync(baseDir);
      writeFileSync(join(dir, "editable", "dup.cdl"), "editable-version");
      writeFileSync(join(baseDir, "dup.cdl"), "base-version");
      const service = new FileService({} as never);

      const [resolved] = await service.resolveImports(editablePath, [{ kind: "import", specifier: "dup.cdl" }], {
        importPaths: ["."],
        baseDir,
      });

      expect(resolved?.content).toBe("editable-version");
    });

    it("kind:'manual' checks the absolute path directly, bypassing searchDirs/importPaths (第7C章7.7.2節)", async () => {
      const manualPath = join(dir, "manual.cdl");
      writeFileSync(manualPath, "manual-content");
      const service = new FileService({} as never);

      const [resolved] = await service.resolveImports(editablePath, [{ kind: "manual", specifier: manualPath }], {
        importPaths: [], // 探索を経由しないため空でよい
      });

      expect(resolved?.canonicalPath).toBe(manualPath);
      expect(resolved?.content).toBe("manual-content");
    });

    it("kind:'manual' returns 'not-found' for a non-existent absolute path without falling back to searchDirs", async () => {
      writeFileSync(join(dir, "editable", "same-name.cdl"), "should-not-be-used");
      const service = new FileService({} as never);

      const [resolved] = await service.resolveImports(
        editablePath,
        [{ kind: "manual", specifier: join(dir, "does-not-exist.cdl") }],
        { importPaths: ["."] },
      );

      expect(resolved?.error).toBe("not-found");
    });

    it("returns 'not-found' when no candidate exists in any search directory", async () => {
      const service = new FileService({} as never);

      const [resolved] = await service.resolveImports(editablePath, [{ kind: "import", specifier: "nope.cdl" }], {
        importPaths: ["."],
      });

      expect(resolved).toEqual({ request: { kind: "import", specifier: "nope.cdl" }, error: "not-found" });
    });

    it("returns 'not-utf8' for a file containing invalid UTF-8 byte sequences", async () => {
      writeFileSync(join(dir, "editable", "bad.cdl"), Buffer.from([0xff, 0xfe, 0x00, 0x41]));
      const service = new FileService({} as never);

      const [resolved] = await service.resolveImports(editablePath, [{ kind: "import", specifier: "bad.cdl" }], {
        importPaths: ["."],
      });

      expect(resolved?.error).toBe("not-utf8");
    });

    it("resolves multiple requests in one batched call, preserving order", async () => {
      writeFileSync(join(dir, "editable", "a.cdl"), "a-content");
      writeFileSync(join(dir, "editable", "b.cdl"), "b-content");
      const service = new FileService({} as never);

      const resolved = await service.resolveImports(
        editablePath,
        [
          { kind: "import", specifier: "a.cdl" },
          { kind: "import", specifier: "missing.cdl" },
          { kind: "import_C", specifier: "b.cdl" },
        ],
        { importPaths: ["."] },
      );

      expect(resolved[0]?.content).toBe("a-content");
      expect(resolved[1]?.error).toBe("not-found");
      expect(resolved[2]?.content).toBe("b-content");
    });
  });
});
