// TECSCDE-TS内部仕様 3.2 — Joinクラス。
// 注記: 3.2節のスケッチはcportId/eportIdのみを持ちどちらのセルの所属かを示さないが、
// ポートはセル単位で名前空間化され（cellName.portNameで参照される）グローバルに一意ではないため、
// 実際に解決可能にするにはセルへの参照が必要。本実装ではこの欠落を補い、cellId/eportCellIdを保持する
// （3.3節が既に認めている「型だけでは表現しきれない」設計上の欠落の一種として扱う）。

import { InvariantViolation } from "./errors";
import type { CellId, JoinId } from "./ids";
import { moveBarBars } from "./geometry";
import type { CPort, EPort } from "./port";

export type BarDirection = "H" | "V";

export interface Bar {
  readonly direction: BarDirection;
  /** H: y座標(mm)を固定してx1→x2に引く。V: x座標を固定してy1→y2。 */
  readonly fixed: number;
  readonly from: number;
  readonly to: number;
}

/** 結合。呼び口1・受け口1を結ぶ（外部仕様4.6.1）。水平・垂直線分のみ（10.3 #4）。 */
export class Join {
  private constructor(
    readonly id: JoinId,
    readonly cellId: CellId,
    readonly cportName: string,
    readonly eportCellId: CellId,
    readonly eportName: string,
    readonly bars: readonly Bar[],
  ) {}

  static create(id: JoinId, cellId: CellId, cport: CPort, eportCellId: CellId, eport: EPort, bars: readonly Bar[]): Join {
    if (cport.joinId !== null) {
      throw new InvariantViolation(`CPort ${cport.name} already has a join`); // 4.3.1
    }
    return new Join(id, cellId, cport.name, eportCellId, eport.name, bars);
  }

  /** 内部仕様5.5 MoveJoinBarCommand。移動不可な区間なら自身をそのまま返す。 */
  moveBar(barIndex: number, newFixed: number): Join {
    const next = moveBarBars(this.bars, barIndex, newFixed);
    if (!next) return this;
    return new Join(this.id, this.cellId, this.cportName, this.eportCellId, this.eportName, next);
  }
}
