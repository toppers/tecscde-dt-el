// [[TECSCDE-DT-EL内部仕様]] 第4章4.5節 — 結合の作成・削除・経路変更に関するコマンドクラス。

import { Command } from "./command";
import { disconnectJoin, nextJoinId } from "./support";
import { autoRouteBars, portPosition } from "../model/geometry";
import { Join } from "../model/join";
import type { CellId, JoinId } from "../model/ids";
import type { TecscdeDocument } from "../model/document";

/**
 * 結合の作成（外部仕様6.4.2）。以下のいずれかに該当する場合は静かにキャンセルする（6.4.1踏襲）:
 *  - 呼び口が既に結合済み（4.3.1: 最大1本）
 *  - シグニチャが一致しない（4.6.1の結合可否判定）
 *  - 呼び口／受け口が見つからない
 */
export class CreateJoinCommand extends Command {
  readonly kind = "CreateJoin";
  override readonly summary: string;

  constructor(
    private readonly sourceCellId: CellId,
    private readonly cportName: string,
    private readonly cportSubscript: number | null,
    private readonly targetCellId: CellId,
    private readonly eportName: string,
  ) {
    super();
    this.summary = `join ${cportName} -> ${eportName}`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const source = doc.getCell(this.sourceCellId);
    const target = doc.getCell(this.targetCellId);
    if (!source || !target) return doc;

    const cport = source.cports.find(
      (p) => p.name === this.cportName && p.subscript === this.cportSubscript,
    );
    const eport = target.eports.find((p) => p.name === this.eportName);
    if (!cport || !eport) return doc;
    if (cport.joinId !== null) return doc;
    if (cport.signature !== eport.signature) return doc;

    const id = nextJoinId(doc);
    const bars = autoRouteBars(
      portPosition(source, cport),
      cport.edgeSide,
      portPosition(target, eport),
      eport.edgeSide,
    );
    const join = Join.create(id, this.sourceCellId, cport, this.targetCellId, eport, bars);

    let next = doc.withJoin(join);
    next = next.withCell(source.withCPort(cport.withJoin(id)));

    // source === target の自己結合に備え、更新後のセルを取り直してから受け口を更新する。
    const updatedTarget = next.getCell(this.targetCellId);
    const updatedEport = updatedTarget?.eports.find((p) => p.name === this.eportName);
    if (updatedTarget && updatedEport) {
      next = next.withCell(updatedTarget.withEPort(updatedEport.withJoin(id)));
    }
    return next;
  }
}

/** 結合の削除（外部仕様6.4.2）。呼び口側セルが読み込み専用なら静かに拒否する。 */
export class DeleteJoinCommand extends Command {
  readonly kind = "DeleteJoin";

  constructor(private readonly joinId: JoinId) {
    super();
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const join = doc.getJoin(this.joinId);
    if (!join) return doc;
    const source = doc.getCell(join.cellId);
    if (!source?.editable) return doc;
    return disconnectJoin(doc, this.joinId);
  }
}

/**
 * 結合バーの移動（外部仕様6.2.2、内部仕様4.5）。ドラッグしたバー自身を直接動かし、
 * 隣接バーは直交を保つよう自動調整する（Join.moveBar / geometry.moveBarBars）。
 * 先頭・末尾のバー（ポート直結区間）が対象の場合、または結合が存在しない場合は何もしない。
 */
export class MoveJoinBarCommand extends Command {
  readonly kind = "MoveJoinBar";
  override readonly summary = "move join bar";

  constructor(
    private readonly joinId: JoinId,
    private readonly barIndex: number,
    private readonly newFixed: number,
  ) {
    super();
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const join = doc.getJoin(this.joinId);
    if (!join) return doc;
    return doc.withJoin(join.moveBar(this.barIndex, this.newFixed));
  }
}
