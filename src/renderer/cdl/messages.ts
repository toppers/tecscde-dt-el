// TECSCDE-TS内部仕様 4.4, 9.1.2, 9.2.2 — エラー・警告のメッセージカタログ。
//
// 注記（実装上の簡略化）: 本実装は tecsgen 本体のソースを持たないため、コード体系（G1xxx/S1xxx）と
// 代表的なメッセージ文言のみを外部仕様が引用する範囲で再現し、網羅はしていない。

import type { Diagnostic, SourceLocation } from "../diagnostics/types";
import type { CellId } from "../model/ids";

export const G_CODES = {
  UNEXPECTED_EOF: "G1015",
  SYNTAX_ERROR: "G1016",
} as const;

export const W_CODES = {
  DUP_CELL: "W-DUP-CELL",
  UNRESOLVED_CELLTYPE: "W-UNRESOLVED-CELLTYPE",
  MISSING_JOIN_TARGET: "W-MISSING-JOIN-TARGET",
  COMPOSITE_UNSUPPORTED: "W-COMPOSITE-UNSUPPORTED",
  LAYOUT_DISCARDED: "W-LAYOUT-DISCARDED",
  REQUIRE_PORT_HIDDEN: "W-REQUIRE-PORT-HIDDEN",
  LAYOUT_PARSE_ERROR: "W-LAYOUT-PARSE-ERROR",
  NEWER_FORMAT: "W-NEWER-FORMAT",
  UNRESOLVED_REF_FILE: "W-UNRESOLVED-REF-FILE",
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

export function compositeUnsupported(name: string): Diagnostic {
  return {
    severity: "warning",
    code: W_CODES.COMPOSITE_UNSUPPORTED,
    message: `複合セルタイプ \`${name}\` は本ツールでは対応していません`,
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
