// 配列長・添字に書かれた整数定数式の評価（監査#24）。
//
// 対応: 10進・16進（0x）の整数リテラル、単項 + -、二項 + - * / %、括弧。識別子・関数呼び出し・
// ビット演算など、ここで評価できないものは `undefined` を返す（呼び出し側が警告にする）。
// 除算は0へ切り捨てる（C の整数除算）。ゼロ除算・結果が安全な整数でない場合も `undefined`。

type Token = { readonly kind: "num"; readonly value: number } | { readonly kind: "op"; readonly op: string };

function tokenize(text: string): Token[] | undefined {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      i += 1;
    } else if (/[0-9]/.test(ch)) {
      const hex = /^0[xX][0-9a-fA-F]+/.exec(text.slice(i));
      const dec = /^[0-9]+/.exec(text.slice(i));
      const match = hex ?? dec;
      if (!match) return undefined;
      // 数値の直後に識別子文字が続く（`12abc`・`3L` など）ものは評価しない。
      if (/[A-Za-z_]/.test(text[i + match[0].length] ?? "")) return undefined;
      tokens.push({ kind: "num", value: Number(match[0]) });
      i += match[0].length;
    } else if ("+-*/%()".includes(ch)) {
      tokens.push({ kind: "op", op: ch });
      i += 1;
    } else {
      return undefined;
    }
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  parse(): number | undefined {
    const value = this.expr();
    return value !== undefined && this.pos === this.tokens.length ? value : undefined;
  }

  private peekOp(): string | undefined {
    const t = this.tokens[this.pos];
    return t?.kind === "op" ? t.op : undefined;
  }

  private expr(): number | undefined {
    let left = this.term();
    while (left !== undefined && (this.peekOp() === "+" || this.peekOp() === "-")) {
      const op = this.peekOp();
      this.pos += 1;
      const right = this.term();
      if (right === undefined) return undefined;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  private term(): number | undefined {
    let left = this.unary();
    while (left !== undefined && (this.peekOp() === "*" || this.peekOp() === "/" || this.peekOp() === "%")) {
      const op = this.peekOp();
      this.pos += 1;
      const right = this.unary();
      if (right === undefined) return undefined;
      if (op === "*") left = left * right;
      else if (right === 0) return undefined;
      else left = op === "/" ? Math.trunc(left / right) : left % right;
    }
    return left;
  }

  private unary(): number | undefined {
    const op = this.peekOp();
    if (op === "+" || op === "-") {
      this.pos += 1;
      const value = this.unary();
      return value === undefined ? undefined : op === "-" ? -value : value;
    }
    if (op === "(") {
      this.pos += 1;
      const value = this.expr();
      if (value === undefined || this.peekOp() !== ")") return undefined;
      this.pos += 1;
      return value;
    }
    const t = this.tokens[this.pos];
    if (t?.kind !== "num") return undefined;
    this.pos += 1;
    return t.value;
  }
}

/** 整数定数式を評価する。評価できない場合は `undefined`。 */
export function evaluateConstInt(text: string): number | undefined {
  const tokens = tokenize(text);
  if (!tokens || tokens.length === 0) return undefined;
  const value = new Parser(tokens).parse();
  return value !== undefined && Number.isSafeInteger(value) ? value : undefined;
}
