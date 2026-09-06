// TECSCDE-TS内部仕様 2.2 — 手書きの再帰下降パーサ用トークナイザ（CdlLexer）。
//
// 対象文法サブセット（外部仕様5.3.2, 8.1.2で確定した範囲）:
//   signature / celltype / cell / import / import_C / __tool_info__("name"){...JSON...}
// フルCDL文法（複合セルタイプの内部構造・型検査等）は対象としない。

export type TokenType = "ident" | "string" | "number" | "punct" | "eof";

export interface Token {
  readonly type: TokenType;
  readonly text: string;
  readonly line: number;
  readonly column: number;
}

const PUNCTUATION = new Set(["{", "}", "(", ")", "[", "]", ";", "=", ".", ","]);

export class LexError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(message);
  }
}

/** CdlParserの出力（トークン列）のみを提供する。CdlParserはこのクラスのみに依存する（2.2節）。 */
export class CdlLexer {
  static tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    let line = 1;
    let column = 1;
    const n = source.length;

    function advance(count = 1): void {
      for (let k = 0; k < count; k += 1) {
        if (source[i] === "\n") {
          line += 1;
          column = 1;
        } else {
          column += 1;
        }
        i += 1;
      }
    }

    while (i < n) {
      const ch = source[i] ?? "";

      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        advance();
        continue;
      }

      if (ch === "/" && source[i + 1] === "/") {
        while (i < n && source[i] !== "\n") advance();
        continue;
      }

      if (ch === "/" && source[i + 1] === "*") {
        advance(2);
        while (i < n && !(source[i] === "*" && source[i + 1] === "/")) advance();
        advance(2);
        continue;
      }

      const startLine = line;
      const startCol = column;

      if (ch === '"') {
        let text = "";
        advance();
        while (i < n && source[i] !== '"') {
          if (source[i] === "\\" && i + 1 < n) {
            text += (source[i] ?? "") + (source[i + 1] ?? "");
            advance(2);
          } else {
            text += source[i] ?? "";
            advance();
          }
        }
        if (i >= n) {
          throw new LexError("unterminated string literal", startLine, startCol);
        }
        advance(); // closing quote
        tokens.push({ type: "string", text, line: startLine, column: startCol });
        continue;
      }

      if (/[A-Za-z_]/.test(ch)) {
        let text = "";
        while (i < n && /[A-Za-z0-9_]/.test(source[i] ?? "")) {
          text += source[i] ?? "";
          advance();
        }
        tokens.push({ type: "ident", text, line: startLine, column: startCol });
        continue;
      }

      if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(source[i + 1] ?? ""))) {
        let text = "";
        if (ch === "-") {
          text += "-";
          advance();
        }
        while (i < n && /[0-9.]/.test(source[i] ?? "")) {
          text += source[i] ?? "";
          advance();
        }
        tokens.push({ type: "number", text, line: startLine, column: startCol });
        continue;
      }

      if (PUNCTUATION.has(ch)) {
        advance();
        tokens.push({ type: "punct", text: ch, line: startLine, column: startCol });
        continue;
      }

      // 未知の文字は読み飛ばす（9.1.2: エラーで中断しない）
      advance();
    }

    tokens.push({ type: "eof", text: "", line, column });
    return tokens;
  }
}
