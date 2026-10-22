// [[TECSCDE-DT-EL内部仕様]] 第9章9.5節 — 「実行(Generate)」操作の入口。
// [[work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 08 CDL 連携|TECSCDE-DT外部仕様8.4.2節]]の規定:
//   - 利用者が明示的にトリガーする操作に限る（保存やインポートのたびに自動実行しない）
//   - 実行結果を解析し、9章の警告・エラー形式に変換して提示する
//   - 実行ファイルが見つからない／起動に失敗した場合はエラーとして提示する
//     （↑ TecsgenResultParser.parse が executableFound=false を専用の診断に変換する）
//
// tecsgenは実引数としてファイル「パス」を受け取る（IPC越しの実プロセス実行のため、
// ドキュメントの内容そのものではなくディスク上のファイルを読む）。したがって編集中の
// 未保存の変更はGenerateに反映されない——生成の直前に自動保存し、常に画面と同じ内容を
// tecsgenへ渡す。保存先が無い（一度も保存/読込していない）場合は生成しようがないため
// 静かにキャンセルする（本コードベース全体の「前提を満たさない操作は無変更で返す」方針、
// 第4章4.5節のコマンド群と同じ）。

import { save } from "./file-actions";
import { TecsgenCommandBuilder, type TecsgenCommandInput } from "../tecsgen/command-builder";
import { dirnameOf } from "../../shared/path-under";
import { TecsgenResultParser } from "../diagnostics";
import type { AppStore } from "./store";
import type { FileGateway } from "../gateways/file-gateway";
import type { TecsgenGateway } from "../gateways/tecsgen-gateway";

/**
 * 第7C章7.7.4節（7.）・外部仕様8.4.2: tecsgenに渡す入力を、`__tool_info__`と`.tecsgen-opts`から合成する。
 * `.tecsgen-opts`は呼ぶたびに再解析する（前回セッションの復元では`optionsFilePath`しか覚えていないため）。
 * 解析に失敗したとき、またはオプションファイルが無いときは、`__tool_info__`の値だけを使う。
 */
async function resolveCommandInput(
  store: AppStore,
  fileGateway: Pick<FileGateway, "parseTecsgenOptionsFile">,
  editingFilePath: string,
): Promise<{ readonly input: TecsgenCommandInput; readonly cwd: string | undefined }> {
  const info = store.getDocument().toolInfoTecsgen;
  const optionsFilePath = store.getOptionsFilePath();
  const options = optionsFilePath
    ? await fileGateway.parseTecsgenOptionsFile(optionsFilePath).catch(() => undefined)
    : undefined;
  return {
    // `.tecsgen-opts`を開いているときは、そのあるディレクトリでtecsgenを起動する（外部仕様5.3節。
    // 相対パスの`-I`・`-S`の基点を変えないため）。
    cwd: optionsFilePath ? dirnameOf(optionsFilePath) : undefined,
    input: {
      baseDir: info.baseDir,
      importPath: [...(info.importPath ?? []), ...(options?.importPaths ?? [])],
      defineMacro: [...(info.defineMacro ?? []), ...(options?.defineMacros ?? [])],
      cpp: options?.cpp ?? info.cpp,
      referenceFilePaths: store.getReferenceFilePaths(),
      editingFilePath,
    },
  };
}

export async function generate(store: AppStore, fileGateway: FileGateway, tecsgenGateway: TecsgenGateway): Promise<void> {
  if (!store.filePath) return;
  if (store.isGenerating) return;
  if (store.isDirty()) await save(store, fileGateway);
  // save()が失敗（キャンセル等）してパスが確定しないままだと、古いファイル内容を
  // tecsgenへ渡すことになるため、依然dirtyなら生成しない。
  if (store.isDirty() || !store.filePath) return;

  store.setGenerating(true);
  try {
    const { input, cwd } = await resolveCommandInput(store, fileGateway, store.filePath);
    const result = await tecsgenGateway.generate(TecsgenCommandBuilder.buildArgs(input), cwd);
    store.setTecsgenDiagnostics(TecsgenResultParser.parse(result));
  } finally {
    store.setGenerating(false);
  }
}

/** 外部仕様8.4.2: 実行に加えて、提示・コピー経路も残す。`generate()`と同じ入力から組み立てる。 */
export async function tecsgenCommandLine(
  store: AppStore,
  fileGateway: Pick<FileGateway, "parseTecsgenOptionsFile">,
): Promise<string | undefined> {
  if (!store.filePath) return undefined;
  return TecsgenCommandBuilder.buildCommandLine((await resolveCommandInput(store, fileGateway, store.filePath)).input);
}
