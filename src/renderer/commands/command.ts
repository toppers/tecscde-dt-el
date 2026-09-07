// [[TECSCDE-DT-EL内部仕様]] 第4章4.2節 — Command 抽象クラス。
//
// invert() は持たない。[[TECSCDE Undo-Redo設計決定]]のとおり、逆操作の実装ミスが
// 逆方向にだけ壊れる非対称バグ（外部仕様6.6.1の現行版2件の既知バグと同種）の
// 発生源を、クラス階層のレベルでも作らない（サブクラスに invert() を書く余地自体を
// 与えない）。Undo/Redo は past コマンド列の再生でのみ実現する（history.ts 参照）。

import type { TecscdeDocument } from "../model/document";

export abstract class Command {
  abstract readonly kind: string;

  /** UIのステータス表示・履歴一覧向けの短い説明（任意、第4章4.2節）。 */
  readonly summary?: string;

  /**
   * ドキュメントに対して操作を適用し、新しいドキュメントを返す。
   * 適用条件を満たさない場合（対象が読み込み専用・存在しない等）は、
   * 外部仕様6.x.1の「静かにキャンセル」方針に従い doc をそのまま返す。
   */
  abstract apply(doc: TecscdeDocument): TecscdeDocument;
}
