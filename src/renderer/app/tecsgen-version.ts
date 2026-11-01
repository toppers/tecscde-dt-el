// [[TECSCDE-DT-EL内部仕様]] 第9C章: 起動時にtecsgenの版を確認し、古い場合や読めない場合に警告する。
// 外部仕様8.4.2。確認は起動時に1回だけで、結果は`AppStore.environmentDiagnostics`に保持する
// （ドキュメントの読み込みやGenerateでは消えない）。tecsgenが見つからないときは何も出さない
// （「実行(Generate)」などで必要になったときに、エラーとして提示される）。

import type { TecsgenVersionResult } from "../../shared/ipc-types.js";
import type { Diagnostic } from "../diagnostics";
import type { AppStore } from "./store";
import type { TecsgenGateway } from "../gateways/tecsgen-gateway";
import type { LogGateway } from "../gateways/log-gateway";

/** 本アプリが対象とするtecsgenの最低版（外部仕様2.2節: V1.3.1.0以降）。定義はここ1か所。 */
export const MIN_TECSGEN_VERSION: readonly number[] = [1, 3, 1, 0];

export const TECSGEN_VERSION_CODES = {
  OLD: "W-TECSGEN-VERSION-OLD",
  UNKNOWN: "W-TECSGEN-VERSION-UNKNOWN",
} as const;

const LABELLED_VERSION = /version\s+v?(\d+(?:\.\d+)*)/i;
const DOTTED_NUMBER = /(\d+(?:\.\d+)+)/;

/** "tecsgen  version 1.9.1" → [1, 9, 1]。読めなければ undefined。 */
export function parseTecsgenVersion(text: string): readonly number[] | undefined {
  const match = LABELLED_VERSION.exec(text) ?? DOTTED_NUMBER.exec(text);
  if (!match) return undefined;
  return match[1]!.split(".").map(Number);
}

/** 数値の列として辞書式に比べる。足りない桁は0（1.9.1 は 1.9.1.0 と同じ）。 */
export function compareVersions(a: readonly number[], b: readonly number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function formatVersion(version: readonly number[]): string {
  return version.join(".");
}

/** 結果から、出すべき診断（無ければ空）と、診断ログに書く1行（取得できたとき）を決める。 */
export function evaluateTecsgenVersion(result: TecsgenVersionResult): {
  readonly diagnostics: readonly Diagnostic[];
  readonly logLine?: string;
} {
  if (result.kind === "not-found") return { diagnostics: [] };
  if (result.kind === "failed") return { diagnostics: [unknown(result.detail)] };
  const version = parseTecsgenVersion(result.text);
  if (!version) return { diagnostics: [unknown(result.text === "" ? "出力が空です" : `読み取れない出力: ${result.text}`)] };
  const logLine = `tecsgen version: ${formatVersion(version)}`;
  if (compareVersions(version, MIN_TECSGEN_VERSION) < 0) {
    return {
      diagnostics: [{
        severity: "warning",
        code: TECSGEN_VERSION_CODES.OLD,
        message: `tecsgen の版 ${formatVersion(version)} は、本アプリが対象とする V${formatVersion(MIN_TECSGEN_VERSION)} 以降より古いため、CDL を正しく扱えない場合があります。`,
      }],
      logLine,
    };
  }
  return { diagnostics: [], logLine };
}

function unknown(reason: string): Diagnostic {
  return {
    severity: "warning",
    code: TECSGEN_VERSION_CODES.UNKNOWN,
    message: `tecsgen の版を確認できませんでした（${reason}）。`,
  };
}

/**
 * 起動時に1回呼ぶ。UIをブロックしないよう、呼び出し側は`void`で待たずに起動する。
 * 警告を出したときは`onWarning`を呼ぶ（診断一覧を自動で開くため。外部仕様8.4.2）。
 */
export async function checkTecsgenVersion(
  store: Pick<AppStore, "setEnvironmentDiagnostics" | "setTecsgenInfo">,
  tecsgen: Pick<TecsgenGateway, "version">,
  log: Pick<LogGateway, "append">,
  onWarning?: () => void,
): Promise<void> {
  let result: TecsgenVersionResult;
  try {
    result = await tecsgen.version();
  } catch (error) {
    result = { kind: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
  // 外部仕様3.8: 版（読み取れたとき）と使われた起動コマンドを、バージョン情報ダイアログ用に保持する。
  const version = result.kind === "ok" ? parseTecsgenVersion(result.text) : undefined;
  store.setTecsgenInfo({
    ...(version ? { version } : {}),
    ...(result.command !== undefined ? { command: result.command } : {}),
  });
  const { diagnostics, logLine } = evaluateTecsgenVersion(result);
  if (diagnostics.length > 0) {
    store.setEnvironmentDiagnostics(diagnostics);
    onWarning?.();
  }
  if (logLine) await log.append([logLine]).catch(() => undefined);
}
