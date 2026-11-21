// [[TECSCDE-TS内部仕様]] 第4章 / [[TECSCDE-DT-EL内部仕様]] 第4章4.1節: Copy/Cut/Pasteのクリップボード連携が使う
// CDL断片（`cell`定義ブロックのみの部分テキスト）のシリアライズ／パース。
//
// 外部仕様6.7節・内部仕様4.1節（三者監査#25、V0.3.2段3）:
//   - 単一セルでは`cell`ブロック（セルタイプ名・セル名・属性）のみを含め、結合（join）は含めない。
//   - 2個以上のセルをコピーする場合は、両端のセルがともに選択セル集合に含まれる結合代入も
//     `cell`ブロックへ含め、パース側も断片内で閉じた結合を保持する。
//   - 位置（x/y）・所属リージョンは含めない（貼り付け時にアプリ側で決める）。

import type { Cell } from "../model/cell";
import type { CellId } from "../model/ids";
import type { Join } from "../model/join";
import type { TecscdeDocument } from "../model/document";
import { CdlDocumentBuilder } from "./cst";

export interface CdlFragmentJoin {
  readonly cportName: string;
  readonly cportSubscript: number | null;
  readonly targetCellName: string;
  readonly eportName: string;
  readonly eportSubscript: number | null;
}

export interface CdlFragmentCell {
  readonly celltypeName: string;
  readonly cellName: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly joins?: readonly CdlFragmentJoin[];
}

function formatPortRef(name: string, subscript: number | null): string {
  return subscript !== null ? `${name}[${subscript}]` : name;
}

function serializeCellBlock(
  celltypeName: string,
  cellName: string,
  attrs: Readonly<Record<string, string>>,
  joins: readonly { readonly cportName: string; readonly cportSubscript: number | null; readonly targetCellName: string; readonly eportName: string; readonly eportSubscript: number | null }[],
): string {
  const attrLines = Object.entries(attrs).map(([name, expr]) => `  ${name} = ${expr};`);
  const joinLines = joins.map(
    (j) => `  ${formatPortRef(j.cportName, j.cportSubscript)} = ${j.targetCellName}.${formatPortRef(j.eportName, j.eportSubscript)};`,
  );
  // 末尾の `;` はCDL文法上必須（tecsgenの構文定義およびtree-sitter文法）。
  return [`cell ${celltypeName} ${cellName} {`, ...attrLines, ...joinLines, `};`].join("\n");
}

/** 4.1節: クリップボードスナップショット（セル群と選択セル間の内部結合）をCDL断片へシリアライズする。 */
export function serializeClipboardAsCdl(snapshot: { readonly cells: readonly Cell[]; readonly joins: readonly Join[] }): string {
  const nameById = new Map<CellId, string>();
  for (const cell of snapshot.cells) nameById.set(cell.id, cell.name);

  const includeJoins = snapshot.cells.length >= 2 && snapshot.joins.length > 0;
  const blocks: string[] = [];
  for (const cell of snapshot.cells) {
    const cellJoins = includeJoins
      ? snapshot.joins
          .filter((j) => j.cellId === cell.id && nameById.has(j.eportCellId))
          .map((j) => ({
            cportName: j.cportName,
            cportSubscript: j.cportSubscript,
            targetCellName: nameById.get(j.eportCellId)!,
            eportName: j.eportName,
            eportSubscript: j.eportSubscript,
          }))
      : [];
    blocks.push(serializeCellBlock(cell.celltypeName, cell.name, cell.attrs, cellJoins));
  }
  return blocks.join("\n\n");
}

/** 6.7節: 選択中のセルを`cell`ブロックのCDL断片としてシリアライズする（2個以上なら内部結合を含む）。 */
export function serializeCellsAsCdl(doc: TecscdeDocument, cellIds: readonly CellId[]): string {
  const seen = new Set<CellId>();
  const cells: Cell[] = [];
  for (const id of cellIds) {
    if (seen.has(id)) continue;
    const cell = doc.getCell(id);
    if (!cell) continue;
    seen.add(id);
    cells.push(cell);
  }
  const joins =
    cells.length >= 2
      ? doc.joinValues().filter((j) => seen.has(j.cellId) && seen.has(j.eportCellId))
      : [];
  return serializeClipboardAsCdl({ cells, joins });
}

/**
 * 6.7節: クリップボードのテキストをCDL断片として解析する。
 * 構文エラー（他アプリ由来のテキスト等）や`cell`ブロックが1つもない場合は`undefined`を返す
 * — 呼び出し側（PasteCommand）はこれを「何もしない」の合図として扱う。
 * 2個以上のセルが含まれる場合、断片内のセル同士を結ぶ結合代入も抽出する（断片外のセル参照は無視する）。
 */
export function tryParseCdlFragment(text: string): readonly CdlFragmentCell[] | undefined {
  if (!text.trim()) return undefined;
  const parsed = CdlDocumentBuilder.build(text);
  if (parsed.diagnostics.length > 0) return undefined;
  if (parsed.cells.length === 0) return undefined;
  const fragmentCellNames = new Set(parsed.cells.map((c) => c.cellName));
  const includeJoins = parsed.cells.length >= 2;
  return parsed.cells.map((c) => {
    const joins: CdlFragmentJoin[] = includeJoins
      ? c.joins
          .filter((j) => fragmentCellNames.has(j.targetCell))
          .map((j) => ({
            cportName: j.cport,
            cportSubscript: j.cportIndex ?? null,
            targetCellName: j.targetCell,
            eportName: j.eport,
            eportSubscript: j.eportIndex ?? null,
          }))
      : [];
    return {
      celltypeName: c.celltypeName,
      cellName: c.cellName,
      attrs: Object.fromEntries(c.attrs.map((a) => [a.name, a.expr] as const)),
      ...(joins.length > 0 ? { joins } : {}),
    };
  });
}
