// TECSCDE-TS内部仕様 3.3 #1 — 座標・寸法はALIGNの倍数（外部仕様4.1.1・7.2.2）。

/** グリッド単位。外部仕様7.2.2: 変更不可の定数。 */
export const ALIGN_MM = 1.0;

/** mmの値をALIGNの倍数に丸める（外部仕様4.1.1 / TECSModel.round_length_val相当）。 */
export function alignRound(value: number): number {
  return Math.round(value / ALIGN_MM) * ALIGN_MM;
}

/** 浮動小数点誤差を許容してALIGN格子上にあるかを判定する。 */
export function isAligned(value: number): boolean {
  const remainder = Math.abs(value / ALIGN_MM - Math.round(value / ALIGN_MM));
  return remainder < 1e-6;
}
