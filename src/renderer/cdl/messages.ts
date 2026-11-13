// TECSCDE-TS内部仕様 4.4, 9.1.2, 9.2.2 / [[TECSCDE-DT-EL内部仕様]] 04B・08 — エラー・警告のメッセージカタログ（警告コードは`W_CODES`に集約する）。
//
// 注記（実装上の簡略化）: 本実装は tecsgen 本体のソースを持たないため、コード体系（G1xxx/S1xxx）と
// 代表的なメッセージ文言のみを外部仕様が引用する範囲で再現し、網羅はしていない。

import type { Diagnostic, SourceLocation } from "../diagnostics/types";
import type { CellId } from "../model/ids";
import type { CppOriginReason } from "../../shared/ipc-types.js";

export interface CppFallbackOptions {
  readonly command?: string;
  readonly originReason?: CppOriginReason;
  readonly fullPath?: string;
  readonly failureKind?: "not-found" | "failed" | "timeout";
  readonly failureDetail?: string;
}

export const G_CODES = {
  UNEXPECTED_EOF: "G1015",
  SYNTAX_ERROR: "G1016",
} as const;

export const W_CODES = {
  DUP_CELL: "W-DUP-CELL",
  UNRESOLVED_CELLTYPE: "W-UNRESOLVED-CELLTYPE",
  MISSING_JOIN_TARGET: "W-MISSING-JOIN-TARGET",
  JOIN_INDEX_INCONSISTENT: "W-JOIN-INDEX-INCONSISTENT",
  AUTO_LAYOUT_OVERFLOW: "W-AUTO-LAYOUT-OVERFLOW",
  /** DT-ELでは出さない（複合セルタイプの存在は警告にしない）。「出ない」ことを確かめるテストが参照する。 */
  COMPOSITE_UNSUPPORTED: "W-COMPOSITE-UNSUPPORTED",
  LAYOUT_DISCARDED: "W-LAYOUT-DISCARDED",
  REQUIRE_PORT_HIDDEN: "W-REQUIRE-PORT-HIDDEN",
  LAYOUT_PARSE_ERROR: "W-LAYOUT-PARSE-ERROR",
  NEWER_FORMAT: "W-NEWER-FORMAT",
  UNRESOLVED_REF_FILE: "W-UNRESOLVED-REF-FILE",
  CPP_FALLBACK: "W-CPP-FALLBACK",
  CDECL_PARSE_ERROR: "W-CDECL-PARSE",
  C_TYPE_UNRESOLVED: "W-C-TYPE-UNRESOLVED",
  PORT_SIGNATURE_UNRESOLVED: "W-PORT-SIGNATURE-UNRESOLVED",
  ARRAY_SIZE_UNRESOLVED: "W-ARRAY-SIZE-UNRESOLVED",
  REGION_MISMATCH: "W-REGION-MISMATCH",
  ACTIVE_TOP_OVERFLOW: "W-ACTIVE-TOP-OVERFLOW",
  ACTIVE_TOP_FAILED: "W-ACTIVE-TOP-FAILED",
  LOG_WRITE_FAILED: "W-LOG-WRITE-FAILED",
} as const;

export function syntaxError(location: SourceLocation, near: string): Diagnostic {
  return { severity: "error", code: G_CODES.SYNTAX_ERROR, message: `syntax error near '${near}'`, location };
}

export function unexpectedEof(location: SourceLocation): Diagnostic {
  return { severity: "error", code: G_CODES.UNEXPECTED_EOF, message: "Unexpected EOF", location };
}

export function duplicateCell(name: string, location?: SourceLocation): Diagnostic {
  return {
    severity: "warning",
    code: W_CODES.DUP_CELL,
    message: `セル \`${name}\` は名前が重複しています（2件目以降は読み飛ばしました）`,
    location,
  };
}

export function unresolvedCelltype(cellName: string, cellId: CellId): Diagnostic {
  return {
    severity: "warning",
    code: W_CODES.UNRESOLVED_CELLTYPE,
    message: `セル \`${cellName}\` はセルタイプが解決できません`,
    relatedCellId: cellId,
  };
}

export function missingJoinTarget(cellName: string, portName: string, cellId: CellId): Diagnostic {
  return {
    severity: "warning",
    code: W_CODES.MISSING_JOIN_TARGET,
    message: `結合 \`${cellName}.${portName}\` は結合先のセルが見つかりません`,
    relatedCellId: cellId,
    relatedPortName: portName,
  };
}

/** 外部仕様5.3.x: 自動配置したセルのうち、用紙の内に収まらず、ずらして重ねて置いたものがある。 */
export function autoLayoutOverflow(count: number): Diagnostic {
  return {
    severity: "warning",
    code: W_CODES.AUTO_LAYOUT_OVERFLOW,
    message: `自動配置したセルのうち ${count} 個が用紙に収まらず、位置をずらして重ねて置きました。用紙を大きくしたあと、「全体再配置」を実行してください`,
  };
}

/** 外部仕様4.6.x: 同じ呼び口の結合で、添字を書いた形と省いた形が混ざっている。 */
export function joinIndexInconsistent(cellName: string, portName: string, cellId: CellId): Diagnostic {
  return {
    severity: "warning",
    code: W_CODES.JOIN_INDEX_INCONSISTENT,
    message: `セル \`${cellName}\` の呼び口 \`${portName}\` の結合で、添字を書いた形と省いた形が混ざっています`,
    relatedCellId: cellId,
    relatedPortName: portName,
  };
}

export function requirePortHidden(cellName: string, count: number, cellId: CellId): Diagnostic {
  return {
    severity: "warning",
    code: W_CODES.REQUIRE_PORT_HIDDEN,
    message: `セル \`${cellName}\` には require 指定で図に表示されない呼び口が ${count} 個あります`,
    relatedCellId: cellId,
  };
}

/**
 * 8.3表で唯一モジュールH（整合性チェック実行時）が生成する警告。
 * `__tool_info__("tecsgen")` の `direct_import` に記録されている参照ファイルが、
 * 今回のセッションで読み込まれていない場合に出る。
 */
export function unresolvedReferenceFile(fileName: string): Diagnostic {
  return {
    severity: "warning",
    code: W_CODES.UNRESOLVED_REF_FILE,
    message: `参照専用ファイル \`${fileName}\` は未解決です（再度ファイル選択してください）`,
  };
}

/**
 * [[TECSCDE-DT外部仕様 - Cプリプロセッサ設定と失敗詳細(V0.2.1用)#2.1]],
 * [[TECSCDE-DT-EL内部仕様 - 09E V0.2.1 Cプリプロセッサ設定と失敗詳細#9E.4]]:
 * import_CのCヘッダに対しCプリプロセッサの実行が見つからない・失敗したため、未展開の
 * 生ヘッダテキストへフォールバックしたことを利用者に提示する。
 */
export function cppFallback(headerPath: string, options?: CppFallbackOptions): Diagnostic {
  const command = options?.command?.trim() || "gcc";
  const metaParts: string[] = [];
  if (options?.fullPath) metaParts.push(`フルパス: ${options.fullPath}`);
  if (options?.originReason) metaParts.push(`決定理由: ${options.originReason}`);
  const metaLabel = metaParts.length > 0 ? `（${metaParts.join("、")}）` : "";

  let body: string;
  if (options?.failureKind === "not-found") {
    body = `Cプリプロセッサ '${command}'${metaLabel}が見つからないため、'${headerPath}' は未展開のまま型を抽出しました（パス設定またはインストールを確認してください）`;
  } else if (options?.failureKind === "failed") {
    const detail = options.failureDetail ? `（${options.failureDetail}）` : "";
    body = `Cプリプロセッサ '${command}'${metaLabel}の実行が失敗したため${detail}、'${headerPath}' は未展開のまま型を抽出しました`;
  } else {
    const detail = options?.failureDetail ? `（${options?.failureDetail}）` : "";
    body = `Cプリプロセッサ '${command}'${metaLabel}を起動・実行できなかったため${detail}、'${headerPath}' は未展開のまま型を抽出しました`;
  }

  return {
    severity: "warning",
    code: W_CODES.CPP_FALLBACK,
    message: body,
  };
}

/**
 * [[work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 09B CdeclExtractor設計#9B.5]]:
 * CdeclExtractorがCヘッダの一部を解析できなかった（tree-sitterのERROR/MISSINGノード）。
 * 走査自体は継続し、捕捉できた範囲のtypedef/structは反映されている。
 */
export function cdeclParseError(headerPath: string): Diagnostic {
  return {
    severity: "warning",
    code: W_CODES.CDECL_PARSE_ERROR,
    message: `\`${headerPath}\` の一部を解析できませんでした（構文エラー）。捕捉できた範囲のtypedef/structのみ反映しています`,
  };
}

/**
 * [[TECSCDE-DT-EL内部仕様 - 06C V0.2.0表示と配置#6C.4]], [[TECSCDE-DT-EL内部仕様 - 08 整合性チェックとメッセージ設計#8.5]]:
 * activeセルの最上段配置で最上段以外の行へ送った対象セル数を通知する。
 */
export function activeTopOverflow(count: number): Diagnostic {
  return {
    severity: "warning",
    code: W_CODES.ACTIVE_TOP_OVERFLOW,
    message: `対象のうち ${count} 個が、最上段に置ききれず、次の行以降へ送られました。`,
  };
}

/**
 * [[TECSCDE-DT-EL内部仕様 - 06C V0.2.0表示と配置#6C.4]], [[TECSCDE-DT-EL内部仕様 - 08 整合性チェックとメッセージ設計#8.5]]:
 * 用紙内に重ならずに配置できないため操作全体を拒否したことを通知する。
 */
export function activeTopFailed(): Diagnostic {
  return {
    severity: "warning",
    code: W_CODES.ACTIVE_TOP_FAILED,
    message: "現在の用紙内に重ならずに配置できないため、最上段への移動を行いませんでした。",
  };
}

/**
 * [[TECSCDE-DT外部仕様 - 09 エラーと警告#9.5]], 監査#66:
 * 診断ログの作成・追記・保存先ディレクトリ作成が失敗した際に一度だけ画面へ出す警告。
 */
export function logWriteFailed(): Diagnostic {
  return {
    severity: "warning",
    code: W_CODES.LOG_WRITE_FAILED,
    message: "診断ログを作れない、または追記できない。診断パネルの内容は、このファイルに残らない",
  };
}

export function layoutDiscarded(target: string): string {
  return `${target} の保存済みレイアウトは形式が不正なため破棄しました`;
}

export const MESSAGES = {
  layoutDiscarded,
} as const;
