// 診断(Diagnostic)の型そのものはB(パーサ)・H(整合性チェック)の両方から生成されるため、
// どちらのモジュールにも属さない共有語彙として独立させる（ロジックを持たない純粋な型定義）。
// TECSCDE-TS内部仕様 9.2（既存内部仕様と共通）。

import type { CellId, JoinId } from "../model/ids";

export type Severity = "error" | "warning";

export interface SourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export interface Diagnostic {
  readonly severity: Severity;
  /** tecsgenのG-code/S-code、または新規警告コード（9.3表のW-*） */
  readonly code: string;
  readonly message: string;
  readonly location?: SourceLocation;
  readonly relatedCellId?: CellId;
  readonly relatedJoinId?: JoinId;
  readonly relatedPortName?: string;
}
