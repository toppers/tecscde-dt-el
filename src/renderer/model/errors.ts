// TECSCDE-TS内部仕様 3.3 — コンパイル時の型では表現しきれない不変条件の違反を表す。
// static create() / ファクトリメソッド内で投げられる（3.1節2点目）。

export class InvariantViolation extends Error {}
