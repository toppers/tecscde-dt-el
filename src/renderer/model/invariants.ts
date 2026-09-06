// TECSCDE-TS内部仕様 3.3 — コンパイル時の型では表現しきれない不変条件。
// 開発ビルドでコマンド適用後に検証する（本番ビルドでは呼び出し側がno-op化してよい）。
// #2（呼び口の結合は最大1本）は型階層で構造的に保証されるため、ここでは残り(#1・#4・参照整合性)のみ検証する。

import { isAligned, ALIGN_MM } from "./align";
import { InvariantViolation } from "./errors";
import { isIdentifier } from "./identifier";
import type { TecscdeDocument } from "./document";

export { InvariantViolation };

/**
 * TecscdeDocumentが3.3の不変条件をすべて満たすか検証する。
 * 違反があれば最初の1件でInvariantViolationを投げる。
 */
export function assertInvariants(doc: TecscdeDocument): void {
  for (const cell of doc.cellValues()) {
    // #1 座標・寸法はALIGNの倍数
    for (const v of [cell.x, cell.y, cell.width, cell.height]) {
      if (!isAligned(v)) {
        throw new InvariantViolation(`cell ${cell.name}: 座標・寸法が${ALIGN_MM}mm格子に整列していません (${v})`);
      }
    }
    // #4 セル名は識別子構文
    if (!isIdentifier(cell.name)) {
      throw new InvariantViolation(`cell id=${cell.id}: セル名が識別子構文に違反 (${cell.name})`);
    }
    // #2の参照整合性（型上、CPortの結合先は単一joinIdなので構造的に保証されるが、
    // 参照先の結合が実際に存在することは別途確認する必要がある）
    for (const p of cell.cports) {
      if (p.joinId !== null && !doc.getJoin(p.joinId)) {
        throw new InvariantViolation(`cell ${cell.name} port ${p.name}: 参照する結合 ${p.joinId} が存在しません`);
      }
    }
    for (const p of cell.eports) {
      for (const jid of p.joinIds) {
        if (!doc.getJoin(jid)) {
          throw new InvariantViolation(`cell ${cell.name} port ${p.name}: 参照する結合 ${jid} が存在しません`);
        }
      }
    }
  }

  for (const join of doc.joinValues()) {
    if (!doc.getCell(join.cellId)) {
      throw new InvariantViolation(`join ${join.id}: 呼び口側のセルが存在しません`);
    }
    if (!doc.getCell(join.eportCellId)) {
      throw new InvariantViolation(`join ${join.id}: 受け口側のセルが存在しません`);
    }
  }
}

/** 開発時のみ検証し、違反はコンソール警告に留める（コマンド実行を止めない）。 */
export function checkInvariantsSoft(doc: TecscdeDocument): void {
  try {
    assertInvariants(doc);
  } catch (e) {
    if (e instanceof InvariantViolation) {
      // eslint-disable-next-line no-console
      console.warn("[invariant]", e.message);
    } else {
      throw e;
    }
  }
}
