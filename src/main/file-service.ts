// [[TECSCDE-DT-EL内部仕様]] 第7章7.1節: FileService（mainプロセス）。
// dialog + fs を直接使う。FileIOStrategyインタフェース（TECSCDE-TS内部仕様7章）は
// Tauriとの両立が不要になったため本書では廃止し、Electron固有のAPIに置き換える。

import { promises as fs } from "node:fs";
import { dialog, type BrowserWindow } from "electron";
import type { OpenResult } from "../shared/ipc-types.js";

export class FileService {
  constructor(private readonly window: BrowserWindow) {}

  async openDialog(): Promise<OpenResult | null> {
    const result = await dialog.showOpenDialog(this.window, {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "CDE files", extensions: ["cde", "cdl"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return this.readPaths(result.filePaths);
  }

  /**
   * 7.4節: コマンドライン引数・ファイル関連付け・macOSのopen-fileから渡された
   * 単一パスを、ダイアログを介さずに読み込む。
   */
  async openPath(path: string): Promise<OpenResult> {
    return this.readPaths([path]);
  }

  private async readPaths(paths: readonly string[]): Promise<OpenResult> {
    const contents = await Promise.all(paths.map((p) => fs.readFile(p, "utf-8")));
    const editablePath = paths[paths.length - 1]!; // 最後に選択したファイルを編集対象とする
    return {
      editable: { path: editablePath, content: contents[contents.length - 1]! },
      references: paths.slice(0, -1).map((p, i) => ({ path: p, content: contents[i]! })),
    };
  }

  async save(path: string, content: string): Promise<void> {
    await this.writeAtomic(path, content);
  }

  async saveAsDialog(suggestedName: string, content: string): Promise<string | null> {
    const result = await dialog.showSaveDialog(this.window, {
      defaultPath: suggestedName,
      filters: [{ name: "CDE files", extensions: ["cde"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await this.writeAtomic(result.filePath, content);
    return result.filePath;
  }

  async exportFile(path: string, data: string): Promise<void> {
    await this.writeAtomic(path, data);
  }

  /**
   * 7.1節: 「書き込み失敗時に既存データを失わない」（TECSCDE-DT外部仕様5.4節）を、
   * 一時ファイル書き込み＋リネームで実現する。fs.rename は同一ファイルシステム内であれば
   * OSレベルでアトミックであり、書き込み途中でプロセスが異常終了しても元のファイルは
   * 無傷のまま残る。
   */
  private async writeAtomic(path: string, content: string): Promise<void> {
    const tmpPath = `${path}.tmp-${process.pid}`;
    await fs.writeFile(tmpPath, content);
    await fs.rename(tmpPath, path);
  }
}
