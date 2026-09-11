// [[TECSCDE-DT-EL内部仕様]] 第4章4.5節 — セル本体・属性・配置に関するコマンドクラス。
// 各 apply() は、既に不変条件を保証済みのモデル層メソッド（Cell.create / Cell.moveTo /
// TecscdeDocument.withCell 等）と support.ts のヘルパーだけを呼ぶ。座標の丸めや
// 識別子検証をコマンド側で重複して行わない（検証責務はモデル層に一本化）。

import { Command } from "./command";
import {
  cascadeDeleteCell,
  deriveCellName,
  disconnectJoin,
  isCellNameTaken,
  rebuildCell,
  rerouteJoinsTouching,
} from "./support";
import { Cell } from "../model/cell";
import { CPort, EPort } from "../model/port";
import { isIdentifier } from "../model/identifier";
import { asCellId, ROOT_REGION_ID, type CellId, type JoinId, type RegionId } from "../model/ids";
import type { PortTemplate } from "../model/celltype";
import type { TecscdeDocument } from "../model/document";

export const DEFAULT_CELL_WIDTH_MM = 25;
export const DEFAULT_CELL_HEIGHT_MM = 15;

function templateParams(t: PortTemplate) {
  return {
    name: t.name,
    signature: t.signature,
    edgeSide: t.edgeSide,
    offset: t.offset,
    subscript: t.subscript,
    arraySize: t.arraySize,
  };
}

/** セルタイプのポートテンプレートから、結合先を持たない新規ポート一式を生成する。 */
export function instantiateCPorts(templates: readonly PortTemplate[]): CPort[] {
  return templates.map((t) => CPort.create(templateParams(t)));
}

export function instantiateEPorts(templates: readonly PortTemplate[]): EPort[] {
  return templates.map((t) => EPort.create(templateParams(t)));
}

/** 外部仕様6.1.2: セルタイプ未選択（解決できない）時は何も生成しない。 */
export class AddCellCommand extends Command {
  readonly kind = "AddCell";
  override readonly summary: string;

  constructor(
    private readonly celltypeName: string,
    private readonly x: number,
    private readonly y: number,
  ) {
    super();
    this.summary = `add ${celltypeName}`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const celltype = doc.getCelltype(this.celltypeName);
    if (!celltype) return doc;

    const name = deriveCellName(doc, this.celltypeName);
    const id = asCellId(name);
    const cell = Cell.create({
      id,
      name,
      celltypeName: this.celltypeName,
      x: this.x,
      y: this.y,
      width: DEFAULT_CELL_WIDTH_MM,
      height: DEFAULT_CELL_HEIGHT_MM,
      regionId: ROOT_REGION_ID,
      editable: true,
      cports: instantiateCPorts(celltype.cportTemplates),
      eports: instantiateEPorts(celltype.eportTemplates),
      attrs: {},
      celltypeUnresolved: false,
      locale: doc.editingFileName,
    });
    return doc.withCell(cell);
  }
}

/** 外部仕様6.2.2: 単一セルの移動（矢印キー入力など、絶対座標指定）。第4章4.5節の例に対応。 */
export class MoveCellCommand extends Command {
  readonly kind = "MoveCell";

  constructor(
    private readonly cellId: CellId,
    private readonly toX: number,
    private readonly toY: number,
  ) {
    super();
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const cell = doc.getCell(this.cellId);
    if (!cell || !cell.editable) return doc;
    const next = doc.withCell(cell.moveTo(this.toX, this.toY));
    return rerouteJoinsTouching(next, [this.cellId]);
  }
}

/**
 * 外部仕様6.2.2: 複数セルの一括移動（ドラッグ完了で1アンドゥ単位、相対変位で指定）。
 * 読み込み専用セルは動かさない。移動に伴い接続する結合の経路を再計算する。
 */
export class MoveCellsCommand extends Command {
  readonly kind = "MoveCells";
  override readonly summary: string;

  constructor(
    private readonly cellIds: readonly CellId[],
    private readonly dx: number,
    private readonly dy: number,
  ) {
    super();
    this.summary = `move ${cellIds.length} cell(s)`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    let next = doc;
    for (const id of this.cellIds) {
      const cell = next.getCell(id);
      if (!cell || !cell.editable) continue;
      next = next.withCell(cell.moveTo(cell.x + this.dx, cell.y + this.dy));
    }
    return rerouteJoinsTouching(next, this.cellIds);
  }
}

/**
 * カスケード削除（外部仕様6.3.2）: 結合バー・呼び口・受け口いずれの選択からも呼べるよう、
 * cellIds・joinIds を独立に受け取る。読み込み専用は静かに拒否する。
 */
export class DeleteCommand extends Command {
  readonly kind = "Delete";
  override readonly summary: string;

  constructor(
    private readonly cellIds: readonly CellId[],
    private readonly joinIds: readonly JoinId[] = [],
  ) {
    super();
    this.summary = `delete ${cellIds.length} cell(s), ${joinIds.length} join(s)`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    let next = doc;
    for (const jid of this.joinIds) {
      const join = next.getJoin(jid);
      if (!join) continue;
      const source = next.getCell(join.cellId);
      if (!source?.editable) continue;
      next = disconnectJoin(next, jid);
    }
    for (const id of this.cellIds) {
      const cell = next.getCell(id);
      if (!cell?.editable) continue;
      next = cascadeDeleteCell(next, id);
    }
    return next;
  }
}

/** 外部仕様6.5.2: 識別子構文・重複禁止の検証に失敗した場合は変更しない。 */
export class RenameCellCommand extends Command {
  readonly kind = "RenameCell";
  override readonly summary: string;

  constructor(
    private readonly cellId: CellId,
    private readonly newName: string,
  ) {
    super();
    this.summary = `rename to ${newName}`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const cell = doc.getCell(this.cellId);
    if (!cell || !cell.editable) return doc;
    if (!isIdentifier(this.newName)) return doc; // Cell.create の assert が投げる前に静かにキャンセル
    if (isCellNameTaken(doc, this.newName, this.cellId)) return doc;
    return doc.withCell(rebuildCell(cell, { name: this.newName }));
  }
}

export class EditAttrCommand extends Command {
  readonly kind = "EditAttr";
  override readonly summary: string;

  constructor(
    private readonly cellId: CellId,
    private readonly attrName: string,
    private readonly value: string,
  ) {
    super();
    this.summary = `${attrName} = ${value}`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const cell = doc.getCell(this.cellId);
    if (!cell || !cell.editable) return doc;
    return doc.withCell(rebuildCell(cell, { attrs: { ...cell.attrs, [this.attrName]: this.value } }));
  }
}

export class ChangeRegionCommand extends Command {
  readonly kind = "ChangeRegion";

  constructor(
    private readonly cellId: CellId,
    private readonly regionId: RegionId,
  ) {
    super();
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const cell = doc.getCell(this.cellId);
    if (!cell || !cell.editable) return doc;
    return doc.withCell(rebuildCell(cell, { regionId: this.regionId }));
  }
}

type AlignAxis = "top" | "left";

function applyAlign(
  doc: TecscdeDocument,
  cellIds: readonly CellId[],
  referenceId: CellId,
  axis: AlignAxis,
): TecscdeDocument {
  const ref = doc.getCell(referenceId);
  if (!ref) return doc;
  let next = doc;
  for (const id of cellIds) {
    if (id === referenceId) continue;
    const cell = next.getCell(id);
    if (!cell || !cell.editable) continue;
    next = next.withCell(axis === "top" ? cell.moveTo(cell.x, ref.y) : cell.moveTo(ref.x, cell.y));
  }
  return rerouteJoinsTouching(next, cellIds);
}

/** 外部仕様7.3.2: 複数選択の上端揃え。基準は選択順で最初のセル（referenceId）。 */
export class AlignTopCommand extends Command {
  readonly kind = "AlignTop";
  override readonly summary = "align top";

  constructor(
    private readonly cellIds: readonly CellId[],
    private readonly referenceId: CellId,
  ) {
    super();
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    return applyAlign(doc, this.cellIds, this.referenceId, "top");
  }
}

/** 外部仕様7.3.2: 複数選択の左端揃え。 */
export class AlignLeftCommand extends Command {
  readonly kind = "AlignLeft";
  override readonly summary = "align left";

  constructor(
    private readonly cellIds: readonly CellId[],
    private readonly referenceId: CellId,
  ) {
    super();
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    return applyAlign(doc, this.cellIds, this.referenceId, "left");
  }
}
