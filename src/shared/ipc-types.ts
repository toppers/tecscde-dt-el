// 型のみを含む共有モジュール。main・preload・rendererのいずれからも
// import してよい ——依存関係のルール（第10章10.1節、`renderer/`から`electron`への
// importを禁止）は、この型だけのファイルには適用されない。実体を持つコードは置かない。

/** [[TECSCDE-DT-EL内部仕様]] 第7章7.1節: FileService.openDialog() の戻り値。 */
export interface OpenFileEntry {
  readonly path: string;
  readonly content: string;
}

export interface OpenResult {
  readonly editable: OpenFileEntry;
  readonly references: readonly OpenFileEntry[];
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
    open(): Promise<OpenResult | null>;
    save(path: string, content: string): Promise<void>;
    saveAs(content: string, suggestedName: string): Promise<string | null>;
    export(path: string, data: string): Promise<void>;
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
}
