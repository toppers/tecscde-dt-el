// [[TECSCDE-DT-EL内部仕様]] 第4章4.5節 — ポート位置に関するコマンドクラス（外部仕様4.3.2踏襲）。
//
// MovePort/ChangePortEdge を分離するのは、モデル層 不変条件#3「ポートは所属辺上のオフセットのみ
// 変更可能（辺の変更は別操作）」に対応するため。MovePort は辺を保ったままオフセットだけを
// クランプ・変更し、ChangePortEdge は辺そのものの変更を明示的な操作として扱う（移動先の辺の
// 長さでオフセットを再クランプするため別バリデーションが要る）。

import { Command } from "./command";
import { rerouteJoin } from "./support";
import { alignRound } from "../model/align";
import type { Cell } from "../model/cell";
import type { CellId, JoinId } from "../model/ids";
import type { CPort, EPort, EdgeSide } from "../model/port";
import type { TecscdeDocument } from "../model/document";

export type PortKind = "CPort" | "EPort";

function edgeLength(cell: Cell, edge: EdgeSide): number {
  return edge === "TOP" || edge === "BOTTOM" ? cell.width : cell.height;
}

/** 辺の範囲内（0〜辺の長さ）にオフセットを収め、ALIGN格子へ丸める。 */
function clampOffset(cell: Cell, edge: EdgeSide, offset: number): number {
  return Math.max(0, Math.min(edgeLength(cell, edge), alignRound(offset)));
}

function joinIdsOfCPort(port: CPort): readonly JoinId[] {
  return port.joinId ? [port.joinId] : [];
}

function reroutePortJoins(doc: TecscdeDocument, joinIds: readonly JoinId[]): TecscdeDocument {
  let next = doc;
  for (const jid of joinIds) next = rerouteJoin(next, jid);
  return next;
}

/**
 * 外部仕様4.3.2: ポートは所属辺内のオフセットのみ変更する（辺をまたぐ移動は ChangePortEdge）。
 * 読み込み専用セル・存在しないポートに対しては何もしない。接続済みの結合は経路を再計算する。
 */
export class MovePortCommand extends Command {
  readonly kind = "MovePort";
  override readonly summary: string;

  constructor(
    private readonly cellId: CellId,
    private readonly portKind: PortKind,
    private readonly portName: string,
    private readonly newOffset: number,
  ) {
    super();
    this.summary = `move port ${portName}`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const cell = doc.getCell(this.cellId);
    if (!cell || !cell.editable) return doc;

    if (this.portKind === "CPort") {
      const port = cell.findCPort(this.portName);
      if (!port) return doc;
      const moved = port.withEdge(port.edgeSide, clampOffset(cell, port.edgeSide, this.newOffset));
      const next = doc.withCell(cell.withCPort(moved));
      return reroutePortJoins(next, joinIdsOfCPort(port));
    }

    const port = cell.findEPort(this.portName);
    if (!port) return doc;
    const moved = port.withEdge(port.edgeSide, clampOffset(cell, port.edgeSide, this.newOffset));
    const next = doc.withCell(cell.withEPort(moved));
    return reroutePortJoins(next, port.joinIds);
  }
}

/**
 * 外部仕様4.3.2: 辺をまたぐ変更を明示的な操作として分離する。移動先の辺と、その辺上での
 * 新オフセットを同時に確定する。接続済みの結合は経路を再計算する。
 */
export class ChangePortEdgeCommand extends Command {
  readonly kind = "ChangePortEdge";
  override readonly summary: string;

  constructor(
    private readonly cellId: CellId,
    private readonly portKind: PortKind,
    private readonly portName: string,
    private readonly newEdge: EdgeSide,
    private readonly newOffset: number,
  ) {
    super();
    this.summary = `move port ${portName} to ${newEdge}`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const cell = doc.getCell(this.cellId);
    if (!cell || !cell.editable) return doc;
    const offset = clampOffset(cell, this.newEdge, this.newOffset);

    if (this.portKind === "CPort") {
      const port = cell.findCPort(this.portName);
      if (!port) return doc;
      const next = doc.withCell(cell.withCPort(port.withEdge(this.newEdge, offset)));
      return reroutePortJoins(next, joinIdsOfCPort(port));
    }

    const port = cell.findEPort(this.portName);
    if (!port) return doc;
    const next = doc.withCell(cell.withEPort(port.withEdge(this.newEdge, offset)));
    return reroutePortJoins(next, port.joinIds);
  }
}
