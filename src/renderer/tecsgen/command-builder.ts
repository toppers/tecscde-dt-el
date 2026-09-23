// [[TECSCDE-DT-EL内部仕様]] 第9章9.5節・[[work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 08 CDL 連携|TECSCDE-DT外部仕様8.4.2節]]
// — tecsgenのコマンド組み立て（モジュールI、純粋な文字列処理）。
//
// 例: `tecsgen -I <import_path> -D <macro> -c <cpp> <参照専用ファイル…> <編集対象ファイル>`
// （外部仕様8.4.2の規定どおり、`import_path`・`define_macro`・`cpp`から組み立てる。
// `base_dir`はコマンドラインには一切出さない——tecsgen内部仕様10章のとおり`$base_dir`は
// 「過去にimportが見つかった基点ディレクトリ」としてtecsgen自身が実行中に蓄積する内部状態で
// あり、利用者が渡す入力に対応するCLIオプションが存在しないため。文脈情報として利用者に
// 提示する場合も、あくまで補足テキストに留め、CLI引数としては渡さない。
// 2026-09-14訂正: 旧版は`-I <base_dir>`としており、`-I`を`--import-path`ではなく
// `base_dir`用のオプションと誤って扱っていた。
//
// `buildArgs`はexecFileへそのまま渡す配列（シェルを経由しないためクォート不要）。
// `buildCommandLine`は8.4.2が「実行に加えて残す」と定めるコピー用の表示文字列で、
// 空白を含む引数のみダブルクォートで囲む。
//
// 2026-09-24追加: `-k utf8`（文字コード指定）を常に付与する。CDLファイルはUTF-8前提
// （[[TECSCDE外部仕様]]5.1.2節）だが、tecsgen外部仕様第5章の`-k, --kcode`は既定`euc`のため、
// 明示しないとtecsgenが文字コードを取り違える可能性がある（内部仕様11.2節#6）。

export interface TecsgenCommandInput {
  /** CLI引数には出さない。文脈情報としての表示にのみ使う（8.4.2）。 */
  readonly baseDir?: string;
  readonly importPath?: readonly string[];
  readonly defineMacro?: readonly string[];
  readonly cpp?: string;
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
    const args: string[] = ["-k", "utf8"];
    for (const path of input.importPath ?? []) args.push("-I", path);
    for (const macro of input.defineMacro ?? []) args.push("-D", macro);
    if (input.cpp) args.push("-c", input.cpp);
    args.push(...input.referenceFilePaths, input.editingFilePath);
    return args;
  }

  /** 提示・コピー用の表示文字列（外部仕様8.4.2: 実行に加えて残す経路）。 */
  static buildCommandLine(input: TecsgenCommandInput): string {
    return ["tecsgen", ...TecsgenCommandBuilder.buildArgs(input).map(quoteIfNeeded)].join(" ");
  }
}
