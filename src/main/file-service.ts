// [[TECSCDE-DT-EL内部仕様]] 第7章7.1節: FileService（mainプロセス）。
// dialog + fs を直接使う。FileIOStrategyインタフェース（TECSCDE-TS内部仕様7章）は
// Tauriとの両立が不要になったため本書では廃止し、Electron固有のAPIに置き換える。

import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import type {
  DirEntry,
  ImportRequest,
  ImportResolutionOptions,
  OpenResult,
  ResolvedImport,
  TecsgenOptionsFile,
} from "../shared/ipc-types.js";
import { saveAppSettings } from "./app-settings.js";
import { destinationKey, fileWrites, type WriteReceipt } from "./write-queue.js";

// 第7C章7.7.4節（#10）: tecsgenオプション形式ファイルもファイルブラウザに列挙する。
// `.tecsgen-opts`は拡張子すべて小文字・大文字小文字を区別する（外部仕様5.3）。`.cde`/`.cdl`は区別しない。
const CDL_EXTENSION = /\.(cde|cdl)$/i;
const OPTIONS_EXTENSION = /\.tecsgen-opts$/;
const isBrowsable = (name: string): boolean => CDL_EXTENSION.test(name) || OPTIONS_EXTENSION.test(name);

/** UTF-8を第一候補とし、レガシーCDL用にShift_JIS/EUC-JPへのフォールバックを試行する。 */
function decodeBuffer(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder("shift_jis", { fatal: true }).decode(buf);
    } catch {
      return new TextDecoder("euc-jp", { fatal: true }).decode(buf);
    }
  }
}

export class FileService {
  private acceptingWrites = true;
  private readonly pendingWrites = new Set<Promise<unknown>>();
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
   * 複数パスをダイアログを介さずに読み込む（全件編集可能、最後を主ファイルとする）。
   * 起動時の samples 読み込み（celltypes.cdl ＋ main.cde）で使う。
   */
  async openPaths(paths: readonly string[]): Promise<OpenResult> {
    return this.readPaths(paths);
  }

  /** 07I: primary role is independent of the actual source parsing order. */
  async openBatch(request: {
    readonly primaryPath: string | null;
    readonly referencePaths: readonly string[];
    readonly sourceOrder: readonly string[];
  }): Promise<OpenResult> {
    const primary = request.primaryPath === null ? null : resolve(request.primaryPath);
    const references = request.referencePaths.map((path) => resolve(path));
    const order = request.sourceOrder.map((path) => resolve(path));
    const roles = [...references, ...(primary === null ? [] : [primary])];
    const keys = new Set(roles.map(destinationKey));
    if (keys.size !== roles.length || new Set(order.map(destinationKey)).size !== order.length ||
        order.length !== keys.size || order.some((path) => !keys.has(destinationKey(path)))) {
      throw new Error("ソース順と主・参照ファイル集合が一致しません。");
    }
    const sources = await Promise.all(order.map(async (path) => {
      await fileWrites.waitForPath(path);
      return { path, content: decodeBuffer(await fs.readFile(path)) };
    }));
    const byKey = new Map(sources.map((source) => [destinationKey(source.path), source]));
    const primaryEntry = primary === null ? undefined : byKey.get(destinationKey(primary))!;
    return {
      editable: primaryEntry ?? { path: "", content: "" },
      references: references.map((path) => byKey.get(destinationKey(path))!),
      sources,
      primarySourceKey: primaryEntry?.path ?? null,
      sourceOrder: order,
    };
  }

  private async readPaths(paths: readonly string[]): Promise<OpenResult> {
    const last = paths[paths.length - 1];
    if (last === undefined) throw new Error("主ファイルを含まない読み込みにはopenBatchを指定してください。");
    // Derive the role from the original last input, then stable-deduplicate the
    // sources. Moving the primary to the end would change parsing precedence.
    const seen = new Map<string, string>();
    for (const path of paths) {
      const absolute = resolve(path);
      if (!seen.has(destinationKey(absolute))) seen.set(destinationKey(absolute), absolute);
    }
    const primary = seen.get(destinationKey(last))!;
    const sourceOrder = [...seen.values()];
    return this.openBatch({ primaryPath: primary,
      referencePaths: sourceOrder.filter((path) => destinationKey(path) !== destinationKey(primary)), sourceOrder });
  }

  async save(path: string, content: string): Promise<void> {
    await this.saveWithReceipt(path, content);
  }

  saveWithReceipt(path: string, content: string): Promise<WriteReceipt> {
    return this.acceptWrite(() => this.writeAtomic(path, content));
  }

  setWriteAcceptance(accept: boolean): void {
    this.acceptingWrites = accept;
  }

  async waitForWrites(): Promise<void> {
    // This is called after closing admission. Already admitted dialogs remain
    // tracked through their actual write and may therefore finish normally.
    await Promise.allSettled([...this.pendingWrites]);
  }

  private acceptWrite<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.acceptingWrites) return Promise.reject(new Error("終了確認中のため保存を受け付けられません。"));
    const pending = operation();
    this.pendingWrites.add(pending);
    void pending.then(() => this.pendingWrites.delete(pending), () => this.pendingWrites.delete(pending));
    return pending;
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
      .filter((e) => e.isDirectory() || isBrowsable(e.name))
      .map(
        (e): DirEntry => ({
          name: e.name,
          path: join(dirPath, e.name),
          kind: e.isDirectory() ? "directory" : "file",
        }),
      )
      .sort((a, b) => (a.kind !== b.kind ? (a.kind === "directory" ? -1 : 1) : a.name.localeCompare(b.name)));
  }

  /** Choose only: renderer validates its ticket again before submitting bytes. */
  chooseSavePath(suggestedName: string): Promise<string | null> {
    return this.acceptWrite(async () => {
      const result = await dialog.showSaveDialog(this.window, {
        defaultPath: suggestedName,
        filters: [{ name: "CDE files", extensions: ["cde"] }],
      });
      return result.canceled || !result.filePath ? null : result.filePath;
    });
  }

  async saveAsDialog(suggestedName: string, content: string): Promise<string | null> {
    return this.acceptWrite(async () => {
      const result = await dialog.showSaveDialog(this.window, {
        defaultPath: suggestedName,
        filters: [{ name: "CDE files", extensions: ["cde"] }],
      });
      if (result.canceled || !result.filePath) return null;
      await this.writeAtomic(result.filePath, content);
      return result.filePath;
    });
  }

  async exportFile(path: string, data: string): Promise<void> {
    await this.acceptWrite(() => this.writeAtomic(path, data));
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
            importPaths.map((p) => (isAbsolute(p) ? join(p, request.specifier) :
              p === "." ? join(dir, request.specifier) : join(dir, p, request.specifier))),
          );

    for (const candidate of candidates) {
      let buf: Buffer;
      try {
        await fileWrites.waitForPath(candidate);
        buf = await fs.readFile(candidate);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") continue; // このcandidateは無かった。次を試す
        return { request, error: "read-failed" };
      }
      try {
        // UTF-8を優先し、Shift_JIS / EUC-JP等のレガシーCDLにもフォールバックしてデコードする。
        const content = decodeBuffer(buf);
        return { request, canonicalPath: resolve(candidate), content };
      } catch {
        return { request, error: "not-utf8" };
      }
    }
    return { request, error: "not-found" };
  }

  /**
   * 第7C章7.7.4節（#10）: `.tecsgen-opts`ファイルのテキストを解析する。内容はtecsgenの
   * コマンドライン引数をそのまま記述したプレーンテキスト——`#`始まりの行はコメント、
   * `-I <path>`/`--import-path=<path>`は`importPaths`へ、`-c <cmd>`/`--cpp=<cmd>`
   * （[[tecsgen外部仕様]]第5章の実際のオプション表記）は`cpp`へ、CDL/CDE拡張子の
   * トークンのみ`cdlFiles`へ分類する。他の引数はPlugin実行時に元のオプションファイルから渡す。
   */
  async parseTecsgenOptionsFile(path: string): Promise<TecsgenOptionsFile> {
    await fileWrites.waitForPath(path);
    const buf = await fs.readFile(path);
    let text: string;
    try {
      text = decodeBuffer(buf);
    } catch {
      text = buf.toString("utf-8");
    }
    const tokens = text
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("#"))
      .join(" ")
      .split(/\s+/)
      .filter((t) => t.length > 0);

    const cdlFiles: string[] = [];
    const importPaths: string[] = [];
    let cpp: string | undefined;
    const defineMacros: string[] = [];
    const systemDirs: string[] = [];

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]!;
      if (token === "-I" || token === "--import-path") {
        const value = tokens[i + 1];
        if (value) {
          importPaths.push(value);
          i += 1;
        }
      } else if (token.startsWith("--import-path=")) {
        importPaths.push(token.slice("--import-path=".length));
      } else if (token.startsWith("-I") && token.length > 2) {
        importPaths.push(token.slice(2));
      } else if (token === "-S" || token === "--system-dir") {
        // システム定義ディレクトリ。判定用の`systemDirs`へ入れ、同時に探索パス`importPaths`にも
        // 書かれた値のまま、-Iとの記述順を保って入れる（外部仕様5.3節）。
        const value = tokens[i + 1];
        if (value) {
          systemDirs.push(value);
          importPaths.push(value);
          i += 1;
        }
      } else if (token.startsWith("--system-dir=")) {
        const value = token.slice("--system-dir=".length);
        systemDirs.push(value);
        importPaths.push(value);
      } else if (token.startsWith("-S") && token.length > 2) {
        systemDirs.push(token.slice(2));
        importPaths.push(token.slice(2));
      } else if (token === "-c" || token === "--cpp") {
        const value = tokens[i + 1];
        if (value) {
          cpp = value;
          i += 1;
        }
      } else if (token.startsWith("--cpp=")) {
        cpp = token.slice("--cpp=".length);
      } else if (token.startsWith("-c") && token.length > 2) {
        cpp = token.slice(2);
      } else if (token === "-D" || token === "--define") {
        // マクロ定義。値を消費しないとその値がCDLファイル名としてcdlFilesへ混入するため、
        // 値ごと読み取る（tecsgenの実行へ引き継ぐ。外部仕様8.4.2）。
        const value = tokens[i + 1];
        if (value) {
          defineMacros.push(value);
          i += 1;
        }
      } else if (token.startsWith("--define=")) {
        defineMacros.push(token.slice("--define=".length));
      } else if (token.startsWith("-D") && token.length > 2) {
        defineMacros.push(token.slice(2));
      } else if (/\.(?:cdl|cde)$/i.test(token)) {
        cdlFiles.push(token);
      }
      // token.startsWith("-")かつ上記いずれにも一致しないその他のオプションは、
      // 値を伴わない形として素通しし無視する。
    }
    // tecsgenの実際のコマンドライン呼び出しは.tecsgen-optsファイルのあるディレクトリから
    // 行われる想定のため、CDLファイルパスは相対ならそのディレクトリを基点に解決する
    // （絶対パスならresolveはそのまま返す）。これを省くと、editable/参照追加の呼び出し
    // （fs.readFile）がmainプロセスの起動ディレクトリを基点に相対解決してしまい、実際には
    // 存在しないパスになる。
    const optsDir = dirname(path);
    return {
      cdlFiles: cdlFiles.map((f) => resolve(optsDir, f)),
      importPaths,
      cpp,
      defineMacros,
      systemDirs: systemDirs.map((d) => resolve(optsDir, d)),
    };
  }

  /**
   * 7.1節: 「書き込み失敗時に既存データを失わない」（TECSCDE-DT外部仕様5.4節）を、
   * 一時ファイル書き込み＋リネームで実現する。fs.rename は同一ファイルシステム内であれば
   * OSレベルでアトミックであり、書き込み途中でプロセスが異常終了しても元のファイルは
   * 無傷のまま残る。
   */
  private writeAtomic(path: string, content: string): Promise<WriteReceipt> {
    return fileWrites.write(path, async (absolutePath) => {
      const tmpPath = `${absolutePath}.tmp-${process.pid}`;
      try {
        await fs.writeFile(tmpPath, content);
        await fs.rename(tmpPath, absolutePath);
      } catch (error) {
        await fs.unlink(tmpPath).catch(() => {});
        throw error;
      }
    });
  }
}
