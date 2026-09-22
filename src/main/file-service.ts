// [[TECSCDE-DT-EL内部仕様]] 第7章7.1節: FileService（mainプロセス）。
// dialog + fs を直接使う。FileIOStrategyインタフェース（TECSCDE-TS内部仕様7章）は
// Tauriとの両立が不要になったため本書では廃止し、Electron固有のAPIに置き換える。

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import type {
  DirEntry,
  ImportRequest,
  ImportResolutionOptions,
  OpenResult,
  ResolvedImport,
} from "../shared/ipc-types.js";
import { saveAppSettings } from "./app-settings.js";

const BROWSABLE_EXTENSION = /\.(cde|cdl)$/i;

export class FileService {
  /**
   * 実機確認で判明（2026-09-21）: 毎回同じ既定ディレクトリが出るのは不便なため、
   * 直前に選んだフォルダを`chooseFolder()`の`defaultPath`として渡し、次回の初期位置にする。
   */
  private lastChosenFolder: string | undefined;

  constructor(private readonly window: BrowserWindow) {}

  /**
   * 7.6.6節: 起動時にmainが`loadAppSettings()`で復元したルートフォルダを、
   * `chooseFolder()`が使う`defaultPath`へ先に反映する。これを呼ばないと、再起動直後に
   * 一度も`chooseFolder()`を呼んでいない状態でダイアログを開いた際、ファイルブラウザ自体は
   * 前回のルートを正しく表示しているにもかかわらず、ダイアログの初期位置だけOS既定の
   * ディレクトリに戻ってしまう（実機確認で発見、2026-09-21）。
   */
  primeLastChosenFolder(path: string): void {
    this.lastChosenFolder = path;
  }

  /**
   * 7.4節: コマンドライン引数・ファイル関連付け・macOSのopen-fileから渡された
   * 単一パスを、ダイアログを介さずに読み込む。
   */
  async openPath(path: string): Promise<OpenResult> {
    return this.readPaths([path]);
  }

  /**
   * 複数パスをダイアログを介さずに読み込む（8.1.2: 最後が編集対象、他は参照専用）。
   * 起動時の samples 読み込み（celltypes.cdl ＋ main.cde）で使う。
   */
  async openPaths(paths: readonly string[]): Promise<OpenResult> {
    return this.readPaths(paths);
  }

  private async readPaths(paths: readonly string[]): Promise<OpenResult> {
    const contents = await Promise.all(paths.map((p) => fs.readFile(p, "utf-8")));
    // 第7D章7.5節: renderer側でresolveImportsが返す正規化済み絶対パスと文字列比較で
    // 重複排除できるよう、ここで返すパスも正規化する（renderer はNode APIを持たないため
    // 正規化は必ずmain側で行う）。
    const resolvedPaths = paths.map((p) => resolve(p));
    const editablePath = resolvedPaths[resolvedPaths.length - 1]!; // 最後に選択したファイルを編集対象とする
    return {
      editable: { path: editablePath, content: contents[contents.length - 1]! },
      references: resolvedPaths.slice(0, -1).map((p, i) => ({ path: p, content: contents[i]! })),
    };
  }

  async save(path: string, content: string): Promise<void> {
    await this.writeAtomic(path, content);
  }

  /**
   * 7.6.1節: ファイルブラウザのルートフォルダ選択。編集対象を選ぶ唯一のツールバー操作。
   * 7.6.6節: 選んだフォルダは終了後も復元できるよう都度永続化する（異常終了でも
   * 直前の選択が残るよう、終了時にまとめてではなく選択のたびに保存する）。
   */
  async chooseFolder(): Promise<string | null> {
    const result = await dialog.showOpenDialog(this.window, {
      properties: ["openDirectory"],
      defaultPath: this.lastChosenFolder,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    this.lastChosenFolder = result.filePaths[0]!;
    await saveAppSettings({ fileBrowserRoot: this.lastChosenFolder });
    return this.lastChosenFolder;
  }

  /**
   * 7.6.1節: ディレクトリ直下のみを1階層返す。ツリー展開のたびにrendererから呼ばれる想定
   * （tecsgenプロジェクトは本アプリに関係のない大きなサブディレクトリを含みうるため、
   * 全体を先読みする設計は採らない）。`.cde`/`.cdl`ファイルとサブディレクトリのみを列挙する。
   */
  async listDirectory(dirPath: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() || BROWSABLE_EXTENSION.test(e.name))
      .map(
        (e): DirEntry => ({
          name: e.name,
          path: join(dirPath, e.name),
          kind: e.isDirectory() ? "directory" : "file",
        }),
      )
      .sort((a, b) => (a.kind !== b.kind ? (a.kind === "directory" ? -1 : 1) : a.name.localeCompare(b.name)));
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
   * 7B章7.6.4節: ファイルブラウザ経由で未保存の変更がある状態から別ファイルを開く前の
   * 破棄確認（TECSCDE-DT外部仕様5.7節）。OSネイティブダイアログを使う——3.6.2節が禁じる
   * ブラウザ標準`confirm`とは異なり、表示内容を制御できる。
   */
  async confirmDiscardChanges(): Promise<boolean> {
    const result = await dialog.showMessageBox(this.window, {
      type: "warning",
      buttons: ["保存せずに開く", "キャンセル"],
      defaultId: 1,
      cancelId: 1,
      message: "未保存の変更があります",
      detail: "保存せずに別のファイルを開くと、現在の変更内容は失われます。",
    });
    return result.response === 0;
  }

  /**
   * 第7D章7.5.2節: `import`/`import_C`文の参照先をバッチで解決する。編集対象ファイルの
   * ディレクトリ・`baseDir`・`extraSearchDirs`（renderer側が解決の進行に応じて蓄積する、
   * 7.5.3節）の順に候補ディレクトリとし、各ディレクトリで`importPaths`を順に試す。
   * `kind:"manual"`は絶対パスが直接指定されているため探索を経由しない（第7C章7.7.2節）。
   */
  async resolveImports(
    editablePath: string,
    requests: readonly ImportRequest[],
    options: ImportResolutionOptions,
  ): Promise<readonly ResolvedImport[]> {
    const searchDirs = [
      dirname(editablePath), // 7.5.3節: tecsgen本体には無い、実務上の追加候補
      ...(options.baseDir ? [options.baseDir] : []),
      ...(options.extraSearchDirs ?? []),
    ];
    return Promise.all(requests.map((request) => this.resolveOne(request, searchDirs, options.importPaths)));
  }

  private async resolveOne(
    request: ImportRequest,
    searchDirs: readonly string[],
    importPaths: readonly string[],
  ): Promise<ResolvedImport> {
    const candidates =
      request.kind === "manual"
        ? [request.specifier]
        : searchDirs.flatMap((dir) =>
            importPaths.map((p) => (p === "." ? join(dir, request.specifier) : join(dir, p, request.specifier))),
          );

    for (const candidate of candidates) {
      let buf: Buffer;
      try {
        buf = await fs.readFile(candidate);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") continue; // このcandidateは無かった。次を試す
        return { request, error: "read-failed" };
      }
      try {
        // TextDecoderのfatalオプションで、不正なUTF-8バイト列を無音でU+FFFDへ置換せず
        // 例外として検出する（第7D章7.5.2節が「実装時に確定」としていた点）。
        const content = new TextDecoder("utf-8", { fatal: true }).decode(buf);
        return { request, canonicalPath: resolve(candidate), content };
      } catch {
        return { request, error: "not-utf8" };
      }
    }
    return { request, error: "not-found" };
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
