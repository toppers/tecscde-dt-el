// 外部仕様3.8: バージョン情報ダイアログに出す項目と、「コピー」するテキスト。
// DOM にも store にも触れない純関数。表示（about-dialog.ts）と分けて、テストしやすくしている。

import type { RuntimeVersions } from "../../shared/ipc-types.js";

/** 起動時の tecsgen の確認（第9C章）で分かったこと。確認が終わるまでは未設定。 */
export interface TecsgenInfo {
  /** 読み取れた版。見つからない・読めなかったときは無い。 */
  readonly version?: readonly number[];
  /** 起動に使われたコマンド（環境変数 TECSGEN_COMMAND、無ければ既定の tecsgen）。 */
  readonly command?: string;
}

export interface AboutInput {
  /** アプリケーションの版（外部仕様2.5.5。package.json の version）。 */
  readonly appVersion: string;
  /** ビルドしたコミットの短縮ハッシュ。取得できなかったときは "unknown"。 */
  readonly commit: string;
  /** .cde の形式の版（アプリケーションの版とは別立て）。 */
  readonly formatVersion: string;
  readonly tecsgen?: TecsgenInfo;
  readonly runtime?: RuntimeVersions;
}

export interface AboutRow {
  readonly label: string;
  readonly value: string;
}

function tecsgenValue(info: TecsgenInfo | undefined): string {
  if (!info) return "未確認";
  const command = info.command ? `（${info.command}）` : "";
  return info.version ? `${info.version.join(".")}${command}` : `未確認${command}`;
}

function runtimeValue(runtime: RuntimeVersions | undefined): string {
  if (!runtime) return "不明";
  return `Electron ${runtime.electron} / Chromium ${runtime.chrome} / Node ${runtime.node} / ${runtime.platform}`;
}

export function buildAboutRows(input: AboutInput): readonly AboutRow[] {
  return [
    { label: "アプリケーションの版", value: input.appVersion },
    { label: "ビルド", value: input.commit },
    { label: "形式の版", value: input.formatVersion },
    { label: "tecsgen", value: tecsgenValue(input.tecsgen) },
    { label: "実行環境", value: runtimeValue(input.runtime) },
  ];
}

/** 「コピー」するテキスト。1項目1行の `項目名: 値`。貼り先を選ばないよう、Markdown にはしない。 */
export function formatAboutText(rows: readonly AboutRow[]): string {
  return rows.map((row) => `${row.label}: ${row.value}`).join("\n");
}
