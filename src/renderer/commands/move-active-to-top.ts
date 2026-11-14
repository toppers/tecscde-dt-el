// [[TECSCDE-DT-EL内部仕様]] 第6C章6C.4節 — activeセルの最上段への移動（監査#58）。
//
// 対象は active かつ編集可能なセル。第0行（y=10mm）の左から重ならない最初の候補へ配置し、
// 収まらない場合は次の行（y+=30mm）へ送る。用紙内に収まらない場合は操作全体を配置不能とする。

import { Command } from "./command";
import { rerouteJoinsTouching } from "./support";
import type { TecscdeDocument } from "../model/document";
import type { CellId } from "../model/ids";
import type { Point } from "../model/geometry";
import { isActiveCell } from "../model/active-cell";

export interface ActiveTopPlan {
  readonly success: boolean;
  readonly orderedCellIds: readonly CellId[];
  readonly moves: ReadonlyMap<CellId, Point>;
  readonly topRowCellIds: readonly CellId[];
  readonly spilledCellIds: readonly CellId[];
  readonly failureReason?: "NO_FIT" | "NO_TARGETS";
}

export function canMoveActiveToTop(doc: TecscdeDocument): boolean {
  for (const cell of doc.cellValues()) {
    if (cell.editable && isActiveCell(doc, cell)) return true;
  }
  return false;
}

const START_X = 10;
const START_Y = 10;
const STEP_X = 55;
const STEP_Y = 30;

function overlaps(
  x: number,
  y: number,
  w: number,
  h: number,
  ox: number,
  oy: number,
  ow: number,
  oh: number,
): boolean {
  return !(x + w <= ox || ox + ow <= x || y + h <= oy || oy + oh <= y);
}

export function prepareMoveActiveToTop(doc: TecscdeDocument): ActiveTopPlan {
  const targets = [...doc.cellValues()].filter((c) => c.editable && isActiveCell(doc, c));
  if (targets.length === 0) {
    return {
      success: false,
      orderedCellIds: [],
      moves: new Map(),
      topRowCellIds: [],
      spilledCellIds: [],
      failureReason: "NO_TARGETS",
    };
  }

  const targetIds = new Set(targets.map((c) => c.id));
  const obstacles = [...doc.cellValues()].filter((c) => !targetIds.has(c.id));

  const { width: paperW, height: paperH } = doc.paper.contentSize();
  const maxX = paperW - 30;
  const maxY = paperH - 20;

  const moves = new Map<CellId, Point>();
  const topRowCellIds: CellId[] = [];
  const spilledCellIds: CellId[] = [];

  // 各対象セルが配置された後の位置を記録して後続セルの障害物とする
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];

  let curY = START_Y;
  let curX = START_X;

  for (const target of targets) {
    let fitted = false;
    while (curY <= maxY) {
      while (curX <= maxX) {
        // 重なり検査（固定障害物 + 既に配置済みの対象セル）
        const hasCollision =
          obstacles.some((obs) => overlaps(curX, curY, target.width, target.height, obs.x, obs.y, obs.width, obs.height)) ||
          placed.some((p) => overlaps(curX, curY, target.width, target.height, p.x, p.y, p.w, p.h));

        if (!hasCollision) {
          moves.set(target.id, { x: curX, y: curY });
          placed.push({ x: curX, y: curY, w: target.width, h: target.height });
          if (curY === START_Y) topRowCellIds.push(target.id);
          else spilledCellIds.push(target.id);

          curX += STEP_X;
          fitted = true;
          break;
        }
        curX += STEP_X;
      }
      if (fitted) break;
      // 次の行へ
      curX = START_X;
      curY += STEP_Y;
    }

    if (!fitted) {
      // 1つでも配置不能なら全体を配置不能とする
      return {
        success: false,
        orderedCellIds: targets.map((c) => c.id),
        moves: new Map(),
        topRowCellIds: [],
        spilledCellIds: [],
        failureReason: "NO_FIT",
      };
    }
  }

  return {
    success: true,
    orderedCellIds: targets.map((c) => c.id),
    moves,
    topRowCellIds,
    spilledCellIds,
  };
}

export class MoveActiveCellsToTopCommand extends Command {
  readonly kind = "MoveActiveCellsToTop";
  override readonly summary: string;

  constructor(private readonly plan: ActiveTopPlan) {
    super();
    this.summary = `move active cells to top (${plan.moves.size} cells)`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    if (!this.plan.success || this.plan.moves.size === 0) return doc;

    let next = doc;
    const movedIds: CellId[] = [];
    for (const [id, pos] of this.plan.moves) {
      const cell = next.getCell(id);
      if (!cell || !cell.editable) continue;
      if (cell.x !== pos.x || cell.y !== pos.y) {
        next = next.withCell(cell.moveTo(pos.x, pos.y));
        movedIds.push(id);
      }
    }

    if (movedIds.length === 0) return doc;
    return rerouteJoinsTouching(next, movedIds);
  }
}
