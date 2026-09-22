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

/** tree-sitterランタイムとCDL文法のWASMバイト列。 */
export interface CdlGrammarAssetBytes {
  readonly runtimeWasm: Uint8Array;
  readonly cdlWasm: Uint8Array;
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
