// [[TECSCDE-DT-EL内部仕様]] 第7章7.3節: FileGateway（renderer）。
// preloadが公開する window.tecscde.file を薄くラップする。プロセス境界があるという
// 事実はこのクラスの内部に閉じ込め、呼び出し側（UIシェル）はPromiseを返す通常の
// メソッド呼び出しとしてしか扱わない（第2章2.4節）。

import type {
  DirEntry,
  ImportRequest,
  ImportResolutionOptions,
  OpenResult,
  ResolvedImport,
} from "../../shared/ipc-types.js";

export class FileGateway {
  save(path: string, content: string): Promise<void> {
    return window.tecscde.file.save(path, content);
  }

  saveAs(content: string, suggestedName: string): Promise<string | null> {
    return window.tecscde.file.saveAs(content, suggestedName);
  }

  export(path: string, data: string): Promise<void> {
    return window.tecscde.file.export(path, data);
  }

  /** 7.6.1節: ファイルブラウザのルートフォルダ選択。 */
  chooseFolder(): Promise<string | null> {
    return window.tecscde.file.chooseFolder();
  }

  /** 7.6.1節: ディレクトリ直下のみを1階層返す。 */
  listDirectory(dirPath: string): Promise<readonly DirEntry[]> {
    return window.tecscde.file.listDirectory(dirPath);
  }

  /** 7.6.2節: ファイルブラウザのクリックから、ダイアログを介さず単一パスを開く。 */
  openPath(path: string): Promise<OpenResult> {
    return window.tecscde.file.openPath(path);
  }

  /** 7B章7.6.4節: 未保存の変更がある状態から別ファイルを開く前の破棄確認。 */
  confirmDiscardChanges(): Promise<boolean> {
    return window.tecscde.file.confirmDiscardChanges();
  }

  /** 7C章7.7.1節: 前回終了時に開いていたファイル集合の永続化。 */
  saveSession(editablePath: string | null, referencePaths: readonly string[]): Promise<void> {
    return window.tecscde.file.saveSession(editablePath, referencePaths);
  }

  /** 第7D章7.5.2節: import/import_C文の参照先をバッチで解決する。 */
  resolveImports(
    editablePath: string,
    requests: readonly ImportRequest[],
    options: ImportResolutionOptions,
  ): Promise<readonly ResolvedImport[]> {
    return window.tecscde.file.resolveImports(editablePath, requests, options);
  }

  /** 7.6.6節: 起動時に一度だけ届く、記憶済みのファイルブラウザのルートフォルダ。 */
  onRestoreFileBrowserRoot(listener: (path: string) => void): void {
    window.tecscde.onRestoreFileBrowserRoot(listener);
  }
}
