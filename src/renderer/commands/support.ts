// [[TECSCDE-DT-EL内部仕様]] 第4章 — コマンド層が共有する純粋なドキュメント操作ヘルパー。
//
// モデル層（第3章）の公開メソッド（getCell/withCell/withJoin/withoutJoin・Cell.withCPort 等）
// だけを経由してドキュメントを不変更新する。カスケード削除・結合の経路再計算・セル名の
// 自動導出といった「複数のモデル要素にまたがる操作」をここに集約し、個々のコマンドクラスの
// apply() を短く保つ。検証責務（ALIGN丸め・識別子構文）はモデル層に一本化されており、
// ここでは重複して行わない（第4章4.5節）。

import { autoRouteBars, portPosition } from "../model/geometry";
import { Cell, type CellCreateParams } from "../model/cell";
import { asJoinId, type CellId, type JoinId } from "../model/ids";
import type { TecscdeDocument } from "../model/document";

/** 既存セルの一部フィールドだけを差し替えた新しい Cell を、モデルのファクトリ越しに作り直す。 */
export function rebuildCell(cell: Cell, overrides: Partial<CellCreateParams>): Cell {
  return Cell.create({
    id: cell.id,
    name: cell.name,
    celltypeName: cell.celltypeName,
    x: cell.x,
    y: cell.y,
    width: cell.width,
    height: cell.height,
    regionId: cell.regionId,
    editable: cell.editable,
    cports: cell.cports,
    eports: cell.eports,
    attrs: cell.attrs,
    celltypeUnresolved: cell.celltypeUnresolved,
    locale: cell.locale,
    ...overrides,
  });
}

/**
 * 結合を1件切断する: 結合本体の削除に加え、両端のセルが持つポートの参照
 * （CPort.joinId / EPort.joinIds）も併せてクリアする。
 */
export function disconnectJoin(doc: TecscdeDocument, id: JoinId): TecscdeDocument {
  const join = doc.getJoin(id);
  if (!join) return doc;

  let next = doc.withoutJoin(id);

  const source = next.getCell(join.cellId);
  if (source) {
    const cport = source.cports.find((p) => p.joinId === id);
    if (cport) next = next.withCell(source.withCPort(cport.withoutJoin()));
  }

  const target = next.getCell(join.eportCellId);
  if (target) {
    const eport = target.eports.find((p) => p.joinIds.includes(id));
    if (eport) next = next.withCell(target.withEPort(eport.withoutJoin(id)));
  }

  return next;
}

/**
 * セル削除のカスケード（外部仕様6.3.2）: 所属する結合を先に切断してから本体を削除する。
 * 読み込み専用（editable=false）のガードは呼び出し側（コマンド層）の責務。
 */
export function cascadeDeleteCell(doc: TecscdeDocument, id: CellId): TecscdeDocument {
  if (!doc.getCell(id)) return doc;
  let next = doc;
  for (const join of doc.joinValues()) {
    if (join.cellId === id || join.eportCellId === id) {
      next = disconnectJoin(next, join.id);
    }
  }
  return next.withoutCell(id);
}

/** 結合が接続する両端の現在のポート位置から経路を再計算する（外部仕様4.6.2）。 */
export function rerouteJoin(doc: TecscdeDocument, id: JoinId): TecscdeDocument {
  const join = doc.getJoin(id);
  if (!join) return doc;
  const source = doc.getCell(join.cellId);
  const target = doc.getCell(join.eportCellId);
  if (!source || !target) return doc;
  const cport = source.findCPort(join.cportName);
  const eport = target.findEPort(join.eportName);
  if (!cport || !eport) return doc;
  const bars = autoRouteBars(
    portPosition(source, cport),
    cport.edgeSide,
    portPosition(target, eport),
    eport.edgeSide,
  );
  return doc.withJoin(join.withBars(bars));
}

/** 与えたセル群に接続するすべての結合の経路を再計算する。 */
export function rerouteJoinsTouching(doc: TecscdeDocument, cellIds: Iterable<CellId>): TecscdeDocument {
  const ids = new Set(cellIds);
  let next = doc;
  for (const join of doc.joinValues()) {
    if (ids.has(join.cellId) || ids.has(join.eportCellId)) {
      next = rerouteJoin(next, join.id);
    }
  }
  return next;
}

export function nextJoinId(doc: TecscdeDocument): JoinId {
  let n = doc.joinCount;
  let id = asJoinId(`j${n}`);
  while (doc.getJoin(id)) {
    n += 1;
    id = asJoinId(`j${n}`);
  }
  return id;
}

/**
 * セル名の自動導出（外部仕様4.2.2・6.1.1踏襲）: セルタイプ名の先頭 't' を除去し、
 * 重複する場合は連番を付す。
 */
export function deriveCellName(doc: TecscdeDocument, celltypeName: string): string {
  const base = celltypeName.startsWith("t") ? celltypeName.slice(1) : celltypeName;
  const existing = new Set(doc.cellValues().map((c) => c.name));
  if (!existing.has(base)) return base;
  let i = 1;
  while (existing.has(`${base}${i}`)) i += 1;
  return `${base}${i}`;
}

export function isCellNameTaken(doc: TecscdeDocument, name: string, excluding?: CellId): boolean {
  return doc.cellValues().some((c) => c.id !== excluding && c.name === name);
}
