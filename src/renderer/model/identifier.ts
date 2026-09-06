// TECSCDE-TS内部仕様 3.3 #4 — セル名・ネームスペース識別子の構文検証（外部仕様4.8.1・6.5.1）。

import { InvariantViolation } from "./errors";

const IDENTIFIER_RE = /^[A-Za-z_][0-9A-Za-z_]*$/;

export function isIdentifier(name: string): boolean {
  return IDENTIFIER_RE.test(name);
}

/** Cell.create() 等のファクトリメソッド内でのみ呼ばれる想定（3.1節2点目）。 */
export function assertIdentifierSyntax(name: string): void {
  if (!isIdentifier(name)) {
    throw new InvariantViolation(`identifier syntax violation: "${name}"`);
  }
}
