// [[TECSCDE-DT-EL内部仕様]] 第7章 — FileService の単体テスト。
// dialog はモックし、fs は実際の一時ディレクトリに対して行う
// （atomic write を tmpファイル→renameという実際のファイルシステム操作として検証するため）。

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileService } from "../../src/main/file-service.js";

const showOpenDialog = vi.fn();
const showSaveDialog = vi.fn();

// vi.mock はvitestによりファイル先頭へホイストされるため、上の import より前に
// 評価される（electronモジュールへの実依存を持たずにFileServiceを検証できる）。
vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: (...args: unknown[]) => showOpenDialog(...args),
    showSaveDialog: (...args: unknown[]) => showSaveDialog(...args),
  },
}));

describe("FileService", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tecscde-dt-el-"));
    showOpenDialog.mockReset();
    showSaveDialog.mockReset();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("openDialog returns null when the user cancels", async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const service = new FileService({} as never);
    await expect(service.openDialog()).resolves.toBeNull();
  });

  it("openDialog treats the last selected path as editable, the rest as references", async () => {
    const refPath = join(dir, "celltypes.cdl");
    const mainPath = join(dir, "main.cde");
    writeFileSync(refPath, "ref-content");
    writeFileSync(mainPath, "main-content");
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [refPath, mainPath] });

    const service = new FileService({} as never);
    const result = await service.openDialog();

    expect(result?.editable).toEqual({ path: mainPath, content: "main-content" });
    expect(result?.references).toEqual([{ path: refPath, content: "ref-content" }]);
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
});
