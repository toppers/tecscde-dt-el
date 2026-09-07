// [[TECSCDE-DT-EL内部仕様]] 第4章4.3節 — History クラス。
//
// 現在のドキュメントを求める計算（past を initial へ再生）と、Undo/Redo 時の
// past/future 配列操作を History の内側にカプセル化する。呼び出し側（UIシェル・
// アプリ層）は canUndo/canRedo/current/commit/undo/redo という意図の明確な
// API だけを使い、「past.length > 0 かどうか」の判定ロジックを複数箇所に
// 散らばらせない（既存 plain interface 設計との実質的な差分、4.3節）。

import { InvariantViolation } from "../model/errors";
import type { TecscdeDocument } from "../model/document";
import type { Command } from "./command";

export class History {
  private constructor(
    private readonly initial: TecscdeDocument,
    /** 適用済み（Undoで巻き戻せる）。履歴一覧UIが列挙できるよう直接公開する（4.3節）。 */
    readonly past: readonly Command[],
    /** Undoされた分（Redoで進められる）。 */
    readonly future: readonly Command[],
  ) {}

  static begin(initial: TecscdeDocument): History {
    return new History(initial, [], []);
  }

  /**
   * 現在のドキュメント。past を initial へ再生して求める。
   * コストは O(履歴長)（4.3節のトレードオフ）。単一セッションの編集規模では実用上問題にならない。
   */
  get current(): TecscdeDocument {
    return this.past.reduce((doc, cmd) => cmd.apply(doc), this.initial);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** 新しいコマンドを確定する。future は破棄する（一般的な線形履歴、4.3節）。 */
  commit(command: Command): History {
    return new History(this.initial, [...this.past, command], []);
  }

  undo(): History {
    if (!this.canUndo) throw new InvariantViolation("cannot undo: past is empty");
    const last = this.past[this.past.length - 1]!;
    return new History(this.initial, this.past.slice(0, -1), [last, ...this.future]);
  }

  redo(): History {
    if (!this.canRedo) throw new InvariantViolation("cannot redo: future is empty");
    const [next, ...rest] = this.future;
    return new History(this.initial, [...this.past, next!], rest);
  }
}
