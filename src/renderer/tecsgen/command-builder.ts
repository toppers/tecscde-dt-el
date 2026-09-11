// [[TECSCDE-DT-EL内部仕様]] 第9章9.5節・[[work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 08 CDL 連携|TECSCDE-DT外部仕様8.4.2節]]
// — tecsgenのコマンド組み立て（モジュールI、純粋な文字列処理）。
//
// 例: `tecsgen -I <base_dir> -D <macro> <参照専用ファイル…> <編集対象ファイル>`
// （外部仕様8.4.2の規定をそのまま踏襲。`import_path`はbase_dirと同じ`-I`を複数指定する
// 拡張として扱う。`cpp`は外部仕様の例に含まれないためコマンドラインには反映しない
// ——import_C解決時にのみ使う値であり、8.4.2が明示する範囲を超えて仕様を拡張しない）。
//
// `buildArgs`はexecFileへそのまま渡す配列（シェルを経由しないためクォート不要）。
// `buildCommandLine`は8.4.2が「実行に加えて残す」と定めるコピー用の表示文字列で、
// 空白を含む引数のみダブルクォートで囲む。

export interface TecsgenCommandInput {
  readonly baseDir?: string;
  readonly importPath?: readonly string[];
  readonly defineMacro?: readonly string[];
  /** 今回のセッションで参照専用として読み込んだファイルの実パス（8.1.2の`direct_import`相当）。 */
  readonly referenceFilePaths: readonly string[];
  /** 編集対象ファイルの実パス。 */
  readonly editingFilePath: string;
}

function quoteIfNeeded(arg: string): string {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

export class TecsgenCommandBuilder {
  /** サブプロセス起動の実引数（`execFile("tecsgen", args)`にそのまま渡す）。 */
  static buildArgs(input: TecsgenCommandInput): string[] {
    const args: string[] = [];
    if (input.baseDir) args.push("-I", input.baseDir);
    for (const path of input.importPath ?? []) args.push("-I", path);
    for (const macro of input.defineMacro ?? []) args.push("-D", macro);
    args.push(...input.referenceFilePaths, input.editingFilePath);
    return args;
  }

  /** 提示・コピー用の表示文字列（外部仕様8.4.2: 実行に加えて残す経路）。 */
  static buildCommandLine(input: TecsgenCommandInput): string {
    return ["tecsgen", ...TecsgenCommandBuilder.buildArgs(input).map(quoteIfNeeded)].join(" ");
  }
}
