// 外部仕様7.3.x（2026-11-03）— 選択したセル／編集できるすべてのセルの自動配置し直し。
// 読み込み時の配置（外部仕様5.3.x）と同じ規則（`placeAutoCells`）で、対象のセルを置き直す。
import { Command } from "./command";
import { rerouteJoinsTouching } from "./support";
import { placeAutoCells, type Rect } from "../cdl/auto-placement";
import type { TecscdeDocument } from "../model/document";
import type { CellId } from "../model/ids";

export interface AutoPlacementPlan {
  /** 実際に動かすセルのID（編集できるセルだけ。文書の並びの順）。 */
  readonly targetIds: readonly CellId[];
  readonly positions: readonly { readonly x: number; readonly y: number }[];
  /** 用紙の内に収まらず、ずらして重ねて置くセルの数。 */
  readonly overflow: number;
}

/** 対象のセルを、動かさないセル（対象外・読み取り専用）と重ならない位置へ置く計画を立てる。 */
export function planAutoPlacement(doc: TecscdeDocument, cellIds: readonly CellId[]): AutoPlacementPlan {
  const wanted = new Set<CellId>(cellIds);
  const targetIds: CellId[] = [];
  const occupied: Rect[] = [];
  for (const cell of doc.cellValues()) {
    if (wanted.has(cell.id) && cell.editable) targetIds.push(cell.id);
    else occupied.push({ x: cell.x, y: cell.y, width: cell.width, height: cell.height });
  }
  const { width, height } = doc.paper.contentSize();
  const { positions, overflow } = placeAutoCells(targetIds.length, occupied, width, height);
  return { targetIds, positions, overflow };
}

export class AutoPlaceCellsCommand extends Command {
  readonly kind = "AutoPlaceCells";
  override readonly summary: string;

  constructor(private readonly cellIds: readonly CellId[]) {
    super();
    this.summary = `auto place ${cellIds.length} cell(s)`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const { targetIds, positions } = planAutoPlacement(doc, this.cellIds);
    let next = doc;
    targetIds.forEach((id, index) => {
      const cell = next.getCell(id);
      const position = positions[index];
      if (cell && position) next = next.withCell(cell.moveTo(position.x, position.y));
    });
    return rerouteJoinsTouching(next, targetIds);
  }
}
