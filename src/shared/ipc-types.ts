// 型のみを含む共有モジュール。main・preload・rendererのいずれからも
// import してよい ——依存関係のルール（第10章10.1節、`renderer/`から`electron`への
// importを禁止）は、この型だけのファイルには適用されない。実体を持つコードは置かない。

/** [[TECSCDE-DT-EL内部仕様]] 第7章7.1節: FileService.openPath()/openPaths() の戻り値。 */
export interface OpenFileEntry {
  readonly path: string;
  readonly content: string;
}

export interface OpenResult {
  readonly primarySourceKey?: string | null;
  readonly sourceOrder?: readonly string[];
  readonly sources?: readonly OpenFileEntry[];
  readonly editable: OpenFileEntry;
  readonly references: readonly OpenFileEntry[];
  readonly extraImportPaths?: readonly string[];
  readonly optionsFilePath?: string;
  /** `.tecsgen-opts`の`-S`で指定されたシステム定義ディレクトリ（絶対パス）。第7C章7.7.4節。 */
  readonly systemDirs?: readonly string[];
}

export interface SessionSnapshot {
  readonly editablePath: string | null;
  readonly referencePaths: readonly string[];
  readonly extraImportPaths: readonly string[];
  readonly optionsFilePath?: string;
  readonly sourceOrder?: readonly string[];
}

export interface SourceWriteReceipt { readonly path: string; readonly writeSequence: number }

export type CloseStateResponse =
  | { readonly kind: "ready"; readonly queryId: string; readonly documentEpoch: number;
      readonly historyNodeId: number; readonly dirty: boolean; readonly pendingSaves: 0 }
  | { readonly kind: "unavailable"; readonly queryId: string };

/** [[TECSCDE-DT-EL内部仕様]] 第7章7.6.1節: FileService.listDirectory() が返す1エントリ。 */
export interface DirEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: "directory" | "file";
}

export type CdlFileListPlan =
  | { readonly kind: "planned"; readonly planId: string; readonly items: readonly { readonly path: string; readonly status: "new" | "same" | "differs" }[] }
  | { readonly kind: "empty" }
  | { readonly kind: "failed"; readonly path: string; readonly detail: string };
export type CdlFileListResult =
  | { readonly kind: "ok"; readonly rootListPath: string; readonly listCount: number; readonly skippedSame: number }
  | { readonly kind: "empty" }
  | { readonly kind: "changed"; readonly path: string }
  | { readonly kind: "failed"; readonly path: string; readonly detail: string; readonly writtenPaths: readonly string[] };

/** 第9章9.7節: tecsgenを起動できなかった（または異常終了させられた）理由の種類。 */
export type TecsgenLaunchFailureKind = "not-found" | "permission" | "timeout" | "output-overflow" | "launch-error";

/** 第9章9.7節: プロセスの終了コードでは表せない起動失敗。`TecsgenRunner.run()`が設定する。 */
export interface TecsgenLaunchFailure {
  readonly kind: TecsgenLaunchFailureKind;
  /** 起動しようとした実行ファイル（`TECSGEN_COMMAND`の先頭、無ければ`tecsgen`）。 */
  readonly command: string;
  /** Node.jsのエラーコードやメッセージ。利用者への文言の補足に使う。 */
  readonly detail: string;
}

/**
 * [[TECSCDE-DT-EL内部仕様]] 第9C章9C.2節: `tecsgen --version`の結果。tecsgenは版を標準エラー出力へ出す
 * ため、`text`は標準出力、空なら標準エラー出力（trim済み）。
 */
/**
 * 起動に使われたコマンド（環境変数 TECSGEN_COMMAND、無ければ既定の tecsgen）。バージョン情報
 * ダイアログ（外部仕様3.8）に出す。mainは常に付けるが、型は省略可（呼び出し側の既存の値のため）。
 */
export type TecsgenVersionResult =
  | { readonly kind: "ok"; readonly text: string; readonly command?: string }
  | { readonly kind: "not-found"; readonly command?: string }
  | { readonly kind: "failed"; readonly detail: string; readonly command?: string };

/** 外部仕様3.8: バージョン情報ダイアログに出す実行環境の版。preload が読み取り専用で公開する。 */
export interface RuntimeVersions {
  readonly electron: string;
  readonly chrome: string;
  readonly node: string;
  readonly platform: string;
}

/** [[TECSCDE-DT-EL内部仕様]] 第9章9.1節: TecsgenRunner.run() の戻り値。 */
export interface TecsgenResult {
  readonly settingsRevision?: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  /** 実行ファイルが見つからなかった（`ENOENT`）場合のみ`false`。 */
  readonly executableFound: boolean;
  /** 起動失敗（見つからない場合を含む）のとき設定される。無ければ起動はできた。 */
  readonly launchFailure?: TecsgenLaunchFailure;
}

export interface GeneratedCdlFile {
  readonly fileName: string;
  readonly content: string;
}

/** Transient tecsgen CDL supplies cells and types without changing the source document. */
export interface GeneratedCdlResult {
  readonly result: TecsgenResult;
  readonly sources: readonly GeneratedCdlFile[];
}

/** V0.2.1: Cプリプロセッサ実行ファイルの決定理由 */
export type CppOriginReason = "ユーザ直接指定" | "自動検出" | "フォールバック";
export type CppOrigin = "cdl" | "settings" | "path" | "default";

/** [[TECSCDE-DT-EL内部仕様]] 第9章9.1節: TecsgenRunner.preprocess() の戻り値。 */
export interface CppResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly executableFound: boolean;
  /** V0.2.1: 実行されたコマンド文字列 */
  readonly command?: string;
  /** V0.2.1: 実行ファイルの決定理由 */
  readonly originReason?: CppOriginReason;
  /** V0.2.1: 解決された実行ファイルへのフルパス（未解決の場合は "未検出 (PATH上)" 等） */
  readonly fullPath?: string;
  /** V0.2.1: 失敗の分類 */
  readonly failureKind?: "not-found" | "failed" | "timeout";
  /** V0.2.1: 失敗の具体的詳細（終了コード、stderrの抜粋、エラーメッセージ等） */
  readonly failureDetail?: string;
}

/** tree-sitterランタイムとCDL/cdecl文法のWASMバイト列。 */
export interface CdlGrammarAssetBytes {
  readonly runtimeWasm: Uint8Array;
  readonly cdlWasm: Uint8Array;
  /** [[work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 09B CdeclExtractor設計]] 9B.3 */
  readonly cdeclWasm: Uint8Array;
}

/**
 * [[TECSCDE-DT-EL内部仕様]] 第7D章7.5.2節: `FileService.resolveImports()`への1件の解決要求。
 * `kind: "manual"`は絶対パスが直接指定されている（第7C章7.7.2節、探索を経由しない）。
 */
export interface ImportRequest {
  readonly kind: "import" | "import_C" | "manual";
  readonly specifier: string;
}

/** 第7D章7.5.2節: 探索候補ディレクトリの構築に使う入力。 */
export interface ImportResolutionOptions {
  readonly baseDir?: string;
  readonly importPaths: readonly string[];
  readonly cpp?: string;
  /** 第7D章7.5.3節: 解決が進むごとにrendererが蓄積する追加の探索ディレクトリ。 */
  readonly extraSearchDirs?: readonly string[];
  /**
   * `.tecsgen-opts`の`-S`で指定されたディレクトリ（絶対パス、外部仕様5.3節）。このうち`_CDL_FILES.txt`を
   * 持つものは、ディレクトリを直接調べる代わりに、その一覧から`import`の参照先を探す。
   */
  readonly systemDirs?: readonly string[];
}

/** 第7D章7.5.2節: `resolveImports()`の1件あたりの結果。 */
export interface ResolvedImport {
  readonly request: ImportRequest;
  readonly canonicalPath?: string;
  readonly content?: string;
  readonly error?: "not-found" | "not-utf8" | "read-failed";
}

/** 第7C章7.7.4節（#10）: `.tecsgen-opts`ファイルを解析した結果。 */
export interface TecsgenOptionsFile {
  readonly cdlFiles: readonly string[]; // 列挙順。最後の要素が編集対象候補
  readonly importPaths: readonly string[]; // -I/--import-path の値
  readonly cpp?: string;
  /** `-D`/`--define`の値（記述順）。tecsgenの実行に引き継ぐ（外部仕様8.4.2）。 */
  readonly defineMacros: readonly string[];
  /** `-S`/`--system-dir`の値。オプションファイルのあるディレクトリ基点で絶対パスに解決済み。`importPaths`にも書かれた値のまま入る。 */
  readonly systemDirs: readonly string[];
}

/** rendererが読むアプリケーション設定（`settings.json`の一部）。 */
export interface AppSettingsView {
  /** `true`なら、システム定義CDLのセルも通常のCDLと同じく編集可能にする。既定は`false`。 */
  readonly allowEditSystemDefined: boolean;
}

export type TecsgenCommandSource = "environment" | "settings" | "tecspath" | "path" | "missing" | "invalid";
export type TecsgenCopyShell = "powershell7" | "powershell5" | "cmd";
export interface ResolvedTecsgenCommand {
  readonly revision?: number;
  readonly executable: string;
  readonly args: readonly string[];
  readonly source: TecsgenCommandSource;
}
export interface ToolSettings {
  readonly revision: number;
  readonly tecsgenPath: string;
  readonly tecspath: string;
  readonly effectiveSource: TecsgenCommandSource;
  readonly effectiveCommand: string;
  readonly executable: string;
  readonly prefixArgs: readonly string[];
  readonly override: boolean;
  /** V0.2.1: Cプリプロセッサ設定 */
  readonly cppPath?: string;
  readonly cppArgs?: string;
  readonly effectiveCppCommand?: string;
  readonly effectiveCppFullPath?: string;
  readonly cppOrigin?: CppOrigin;
  readonly cppOriginReason?: CppOriginReason;
}
export interface ToolSettingsUpdate {
  readonly tecsgenPath?: string;
  readonly cppPath?: string;
  readonly cppArgs?: string;
}
export type ToolSettingsUpdateResult = { readonly ok: true; readonly settings: ToolSettings }
  | { readonly ok: false; readonly error: string };
export interface AppInformation {
  readonly name: string;
  readonly version: string;
  readonly commit: string;
  readonly cdeFormatVersion: string;
  readonly electron: string;
  readonly chrome: string;
  readonly node: string;
  readonly platform: string;
  readonly arch: string;
}

export type ExportFormat = "svg" | "png" | "pdf";

export type PdfPage =
  | { readonly kind: "paper"; readonly size: "A4" | "A3" | "A2"; readonly orientation: "LANDSCAPE" | "PORTRAIT" }
  | { readonly kind: "custom"; readonly widthMm: number; readonly heightMm: number };

/** `log.append` の結果。`newFailure` は、ログを書けなくなった最初の一度だけ入る理由。 */
export interface LogAppendResult {
  readonly newFailure?: string;
}

/** preload が `window.tecscde` として公開する API 全体の型（第2章2.4節）。 */
export interface TecscdeApi {
  /** 外部仕様3.8: 実行環境の版（Electron・Chromium・Node・OS）。 */
  readonly versions: RuntimeVersions;
  readonly cdl: {
    loadGrammarAssets(): Promise<CdlGrammarAssetBytes>;
  };
  readonly file: {
    readDefinitionFile(path: string): Promise<OpenFileEntry>;
    planCdlFileLists(root: string): Promise<CdlFileListPlan>;
    applyCdlFileLists(planId: string): Promise<CdlFileListResult>;
    confirmCdlFileLists(paths: readonly string[]): Promise<boolean>;
    save(path: string, content: string): Promise<void | SourceWriteReceipt>;
    chooseSavePath?(suggestedName: string): Promise<string | null>;
    saveAs(content: string, suggestedName: string): Promise<string | null>;
    chooseExportPath(format: ExportFormat, suggestedName: string): Promise<string | null>;
    export(path: string, data: string | Uint8Array): Promise<void>;
    exportPdf(path: string, svg: string, page: PdfPage): Promise<void>;
    /** 第7章7.6.1節: ファイルブラウザのルートフォルダ選択。 */
    chooseFolder(): Promise<string | null>;
    /** 第7章7.6.1節: ディレクトリ直下のみを1階層返す（遅延展開）。 */
    listDirectory(dirPath: string): Promise<readonly DirEntry[]>;
    /** 第7章7.6.2節: ファイルブラウザのクリックから、ダイアログを介さず単一パスを開く。 */
    openPath(path: string): Promise<OpenResult>;
    openPaths?(paths: readonly string[]): Promise<OpenResult>;
    /** 第7B章7.6.4節: 未保存の変更がある状態から別ファイルを開く前の破棄確認。 */
    confirmDiscardChanges(): Promise<boolean>;
    /**
     * 第7C章7.7.1節: 前回終了時に開いていたファイル集合を永続化する。`editablePath`が
     * `null`の場合（消去後、7.7.3節）はreferencesのみ保存し復元対象から外す。
     */
    saveSession(
      editablePath: string | null | SessionSnapshot,
      referencePaths?: readonly string[],
      extraImportPaths?: readonly string[],
      optionsFilePath?: string,
    ): Promise<void>;
    /** 第7D章7.5.2節: import/import_C文の参照先をバッチで解決する。 */
    resolveImports(
      editablePath: string,
      requests: readonly ImportRequest[],
      options: ImportResolutionOptions,
    ): Promise<readonly ResolvedImport[]>;
    /** 第7C章7.7.4節（#10）: `.tecsgen-opts`ファイルを解析する。 */
    parseTecsgenOptionsFile(path: string): Promise<TecsgenOptionsFile>;
  };
  readonly tecsgen: {
    /** `cwd`は`.tecsgen-opts`のあるディレクトリ（外部仕様5.3節）。無ければ起動ディレクトリのまま。 */
    generate(args: readonly string[], cwd?: string): Promise<TecsgenResult>;
    generatedTypes(args: readonly string[], editingFilePath: string, optionsFilePath?: string): Promise<GeneratedCdlResult>;
    preprocess(headerPath: string, cppCommand?: string, includeDirs?: readonly string[]): Promise<CppResult>;
    version(): Promise<TecsgenVersionResult>;
    checkPath(path: string): Promise<TecsgenVersionResult>;
    commandLine(args: readonly string[], shell: TecsgenCopyShell, cwd?: string): Promise<string>;
  };
  readonly clipboard: {
    writeText(text: string): Promise<void>;
    readText(): Promise<string>;
  };
  /** 第7章7.9節: ウィンドウを閉じるときの未保存確認のため、未保存かどうかをmainへ知らせる。 */
  readonly window: {
    setDirty(dirty: boolean): void;
    onRequestCloseState(listener: (queryId: string) => void): () => void;
    onCancelCloseState(listener: (queryId: string) => void): () => void;
    replyCloseState(response: CloseStateResponse): void;
  };
  /** 第3章3.2節: アプリケーション設定のうち、rendererが読むもの。 */
  readonly settings: {
    get(): Promise<AppSettingsView>;
    getToolSettings(): Promise<ToolSettings>;
    updateToolSettings(patch: ToolSettingsUpdate): Promise<ToolSettingsUpdateResult>;
    chooseTecsgenPath(): Promise<string | null>;
    chooseCppPath(currentPath?: string): Promise<string | null>;
    getAppInformation(): Promise<AppInformation>;
    getCdlFilesRoot(): Promise<string>;
    setCdlFilesRoot(root: string): Promise<void>;
    chooseCdlFilesRoot(): Promise<string | null>;
  };
  /**
   * 診断パネルに表示した内容を、起動ごとのログファイル（テキスト）へ追記する。
   * 結果の `newFailure` は、書けなくなった最初の一度だけ入る理由（外部仕様9.5.2の規定13）。
   */
  readonly log: {
    append(lines: readonly string[]): Promise<LogAppendResult>;
  };
  /**
   * 第7章7.4節: 起動時に main が一度だけ送る初期ドキュメント。コマンドライン引数・
   * ファイル関連付けで開かれた場合はそのファイル、指定が無ければ samples。読み込み
   * 失敗時は null。renderer は受け取ったリスナへ一度だけ渡す。
   */
  readonly onBootstrap: (listener: (data: OpenResult | null) => void) => void;
  /**
   * 第7章7.6.6節: 起動時に main が一度だけ送る、記憶済みのファイルブラウザのルート
   * フォルダ。前回の選択が無ければ送られない（listenerは呼ばれない）。
   */
  readonly onRestoreFileBrowserRoot: (listener: (path: string) => void) => void;
}
