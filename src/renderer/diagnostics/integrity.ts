// [[TECSCDE-DT-EL内部仕様]] 第8章 — 利用者が任意のタイミングで実行できる整合性チェック
// （外部仕様8.3.2）。モジュールH は B・C への読み取り専用オブザーバであり、モデルを
// 一切変更しない。
//
// ロード時の一過性の診断（`CdlDocumentLoader.loadSources` の戻り）とは別に、
// ドキュメントの現在状態から再導出できる項目を再スキャンする:
//   1. セルタイプ未解決の残存（`Cell.celltypeUnresolved`）
//   2. `__tool_info__("tecsgen")` の `direct_import` に記録された参照ファイルの未読込
//      （8.3表で唯一モジュールH が生成する `W-UNRESOLVED-REF-FILE`）
//
// [[TECSCDE-JS-TS実装]] の `src/diagnostics/collector.ts::checkIntegrity`（関数版）を
// DT-EL の不変モデルAPI（`doc.cellValues()`）へ写したもの。

import type { Diagnostic } from "./types";
import { unresolvedCelltype, unresolvedReferenceFile } from "../cdl/messages";
import type { TecscdeDocument } from "../model/document";

export function checkIntegrity(doc: TecscdeDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const cell of doc.cellValues()) {
    if (cell.celltypeUnresolved) {
      diagnostics.push(unresolvedCelltype(cell.name, cell.id));
    }
  }

  const loaded = new Set(doc.referenceFiles);
  for (const name of doc.toolInfoTecsgen.directImport ?? []) {
    if (!loaded.has(name)) {
      diagnostics.push(unresolvedReferenceFile(name));
    }
  }

  return diagnostics;
}
