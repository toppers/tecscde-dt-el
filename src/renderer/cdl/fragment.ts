// [[TECSCDE-TS内部仕様]] 第4章 / [[TECSCDE-DT-EL内部仕様]] 第4章4.1節: Copy/Cut/Pasteのクリップボード連携が使う
// CDL断片（`cell`定義ブロックのみの部分テキスト）のシリアライズ／パース。
//
// 外部仕様6.7節の規定どおり、断片には`cell`ブロック（セルタイプ名・セル名・属性）のみを含め、
// 位置（x/y）・所属リージョン・結合（join）は含めない。理由:
//   - 位置・リージョン・ポート配置は `__tool_info__("tecscde")` 側のJSONにしかなく、
//     `cell`ブロック単体では表現できない（serializer.ts参照）。貼り付け時の配置は
//     アプリ側で新たに決める（commands/clipboard-commands.ts）。
//   - 結合は選択範囲外のセルを指す可能性があり、断片単体では意味を持たない参照になりうる。
//     既存のアプリ内クリップボード（旧TECSCDE実装のclipboardOps.ts）も結合を扱わないため、
//     OSクリップボード経路もこれに合わせる。

import type { CellId } from "../model/ids";
import type { TecscdeDocument } from "../model/document";
import { CdlDocumentBuilder } from "./cst";

function serializeCellBlock(celltypeName: string, cellName: string, attrs: Readonly<Record<string, string>>): string {
  const body = Object.entries(attrs).map(([name, expr]) => `  ${name} = ${expr};`);
  // 末尾の `;` はCDL文法上必須（tecsgenの構文定義およびtree-sitter文法）。
  return [`cell ${celltypeName} ${cellName} {`, ...body, `};`].join("\n");
}

/** 6.7節: 選択中のセルを`cell`ブロックのみのCDL断片としてシリアライズする。 */
export function serializeCellsAsCdl(doc: TecscdeDocument, cellIds: readonly CellId[]): string {
  const blocks: string[] = [];
  for (const id of cellIds) {
    const cell = doc.getCell(id);
    if (!cell) continue;
    blocks.push(serializeCellBlock(cell.celltypeName, cell.name, cell.attrs));
  }
  return blocks.join("\n\n");
}

export interface CdlFragmentCell {
  readonly celltypeName: string;
  readonly cellName: string;
  readonly attrs: Readonly<Record<string, string>>;
}

/**
 * 6.7節: クリップボードのテキストをCDL断片として解析する。
 * 構文エラー（他アプリ由来のテキスト等）や`cell`ブロックが1つもない場合は`undefined`を返す
 * — 呼び出し側（PasteCommand）はこれを「何もしない」の合図として扱う。
 */
export function tryParseCdlFragment(text: string): readonly CdlFragmentCell[] | undefined {
  if (!text.trim()) return undefined;
  const parsed = CdlDocumentBuilder.build(text);
  if (parsed.diagnostics.length > 0) return undefined;
  if (parsed.cells.length === 0) return undefined;
  return parsed.cells.map((c) => ({
    celltypeName: c.celltypeName,
    cellName: c.cellName,
    attrs: Object.fromEntries(c.attrs.map((a) => [a.name, a.expr] as const)),
  }));
}
