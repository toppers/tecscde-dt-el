// 型のみを含む共有モジュール。main・preload・rendererのいずれからも
// import してよい ——依存関係のルール（第10章10.1節、`renderer/`から`electron`への
// importを禁止）は、この型だけのファイルには適用されない。実体を持つコードは置かない。

/** [[TECSCDE-DT-EL内部仕様]] 第7章7.1節: FileService.openPath()/openPaths() の戻り値。 */
export interface OpenFileEntry {
  readonly path: string;
  readonly content: string;
}

export interface OpenResult {
  readonly editable: OpenFileEntry;
  readonly references: readonly OpenFileEntry[];
}

/** [[TECSCDE-DT-EL内部仕様]] 第7章7.6.1節: FileService.listDirectory() が返す1エントリ。 */
export interface DirEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: "directory" | "file";
}

/** [[TECSCDE-DT-EL内部仕様]] 第9章9.1節: TecsgenRunner.run() の戻り値。 */
export interface TecsgenResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly executableFound: boolean;
}

/** [[TECSCDE-DT-EL内部仕様]] 第9章9.1節: TecsgenRunner.preprocess() の戻り値。 */
export interface CppResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly executableFound: boolean;
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
}

/** preload が `window.tecscde` として公開する API 全体の型（第2章2.4節）。 */
export interface TecscdeApi {
  readonly cdl: {
    loadGrammarAssets(): Promise<CdlGrammarAssetBytes>;
  };
  readonly file: {
    save(path: string, content: string): Promise<void>;
    saveAs(content: string, suggestedName: string): Promise<string | null>;
    export(path: string, data: string): Promise<void>;
    /** 第7章7.6.1節: ファイルブラウザのルートフォルダ選択。 */
    chooseFolder(): Promise<string | null>;
    /** 第7章7.6.1節: ディレクトリ直下のみを1階層返す（遅延展開）。 */
    listDirectory(dirPath: string): Promise<readonly DirEntry[]>;
    /** 第7章7.6.2節: ファイルブラウザのクリックから、ダイアログを介さず単一パスを開く。 */
    openPath(path: string): Promise<OpenResult>;
    /** 第7B章7.6.4節: 未保存の変更がある状態から別ファイルを開く前の破棄確認。 */
    confirmDiscardChanges(): Promise<boolean>;
    /**
     * 第7C章7.7.1節: 前回終了時に開いていたファイル集合を永続化する。`editablePath`が
     * `null`の場合（消去後、7.7.3節）はreferencesのみ保存し復元対象から外す。
     */
    saveSession(editablePath: string | null, referencePaths: readonly string[]): Promise<void>;
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
    generate(args: readonly string[]): Promise<TecsgenResult>;
    preprocess(headerPath: string, cppCommand?: string): Promise<CppResult>;
    version(): Promise<string | null>;
  };
  readonly clipboard: {
    writeText(text: string): Promise<void>;
    readText(): Promise<string>;
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
