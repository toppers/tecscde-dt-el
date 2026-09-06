// TECSCDE-TS内部仕様 2.2 — cell/celltype/signature/import の再帰下降パーサ（CdlParser）。
// CdlLexerの出力（トークン列）のみに依存する構成にする（2.2節）。
//
// 注記（簡略化）: 実際のtecsgenが受理するCDL文法は本パーサよりも遥かに大きい。
// 本パーサは外部仕様5.3.2・8.1.2が確定した「TECSCDE-TSが読み書きする範囲」だけを
// 対象とするサブセット文法である（既存内部仕様4.1と同一の範囲）。

import { CdlLexer, type Token } from "./lexer";
import { syntaxError, unexpectedEof } from "./messages";
import type { Diagnostic } from "../diagnostics/types";

export interface PortDecl {
  readonly kind: "call" | "entry";
  readonly signature: string;
  readonly name: string;
  readonly arraySize?: number;
  readonly isRequire: boolean;
}

export interface CelltypeDecl {
  readonly name: string;
  readonly ports: readonly PortDecl[];
  readonly attributes: readonly string[];
}

export interface JoinAssignDecl {
  readonly cport: string;
  readonly cportIndex?: number;
  readonly targetCell: string;
  readonly eport: string;
}

export interface AttrAssignDecl {
  readonly name: string;
  readonly expr: string;
}

export interface CellDecl {
  readonly celltypeName: string;
  readonly cellName: string;
  readonly joins: readonly JoinAssignDecl[];
  readonly attrs: readonly AttrAssignDecl[];
  readonly line: number;
  readonly column: number;
}

export interface ImportDecl {
  readonly kind: "import" | "import_C";
  readonly path: string;
  readonly rawText: string;
}

export interface CompositeDecl {
  readonly name: string;
}

export interface ParsedCdl {
  readonly signatures: readonly string[];
  readonly celltypes: readonly CelltypeDecl[];
  readonly cells: readonly CellDecl[];
  readonly imports: readonly ImportDecl[];
  readonly composites: readonly CompositeDecl[];
  readonly diagnostics: Diagnostic[];
}

class TokenCursor {
  private pos = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  peek(offset = 0): Token {
    const t = this.tokens[this.pos + offset];
    return t ?? this.tokens[this.tokens.length - 1]!;
  }

  next(): Token {
    const t = this.peek();
    if (t.type !== "eof") this.pos += 1;
    return t;
  }

  atEof(): boolean {
    return this.peek().type === "eof";
  }

  is(type: Token["type"], text?: string): boolean {
    const t = this.peek();
    return t.type === type && (text === undefined || t.text === text);
  }
}

export class CdlParser {
  static parse(sourceWithBlanks: string): ParsedCdl {
    const tokens = CdlLexer.tokenize(sourceWithBlanks);
    const cur = new TokenCursor(tokens);
    const diagnostics: Diagnostic[] = [];
    const signatures: string[] = [];
    const celltypes: CelltypeDecl[] = [];
    const cells: CellDecl[] = [];
    const imports: ImportDecl[] = [];
    const composites: CompositeDecl[] = [];

    function skipBalancedBraceBody(): void {
      if (!cur.is("punct", "{")) return;
      cur.next();
      let depth = 1;
      while (depth > 0 && !cur.atEof()) {
        const t = cur.next();
        if (t.type === "punct" && t.text === "{") depth += 1;
        if (t.type === "punct" && t.text === "}") depth -= 1;
      }
    }

    function expect(type: Token["type"], text?: string): Token | undefined {
      if (cur.is(type, text)) return cur.next();
      const t = cur.peek();
      if (t.type === "eof") {
        diagnostics.push(unexpectedEof({ file: "", line: t.line, column: t.column }));
      } else {
        diagnostics.push(syntaxError({ file: "", line: t.line, column: t.column }, t.text));
      }
      return undefined;
    }

    function parseSignature(): void {
      cur.next(); // 'signature'
      const name = expect("ident");
      if (name) signatures.push(name.text);
      if (cur.is("punct", "{")) {
        skipBalancedBraceBody();
      } else {
        expect("punct", ";");
      }
    }

    function parsePortDecl(kind: "call" | "entry"): PortDecl | undefined {
      cur.next(); // call_port / entry_port
      const sig = expect("ident");
      const name = expect("ident");
      if (!sig || !name) {
        while (!cur.atEof() && !cur.is("punct", ";")) cur.next();
        if (cur.is("punct", ";")) cur.next();
        return undefined;
      }
      let arraySize: number | undefined;
      if (cur.is("punct", "[")) {
        cur.next();
        const size = cur.peek();
        if (size.type === "number") {
          cur.next();
          arraySize = Number(size.text);
        }
        expect("punct", "]");
      }
      let isRequire = false;
      if (cur.is("ident", "require")) {
        cur.next();
        isRequire = true;
      }
      expect("punct", ";");
      return { kind, signature: sig.text, name: name.text, arraySize, isRequire };
    }

    function parseCelltype(): void {
      cur.next(); // 'celltype'
      const name = expect("ident");
      if (!expect("punct", "{")) return;
      const ports: PortDecl[] = [];
      const attributes: string[] = [];
      while (!cur.atEof() && !cur.is("punct", "}")) {
        if (cur.is("ident", "call_port")) {
          const p = parsePortDecl("call");
          if (p) ports.push(p);
        } else if (cur.is("ident", "entry_port")) {
          const p = parsePortDecl("entry");
          if (p) ports.push(p);
        } else if (cur.is("ident", "attribute")) {
          cur.next();
          const attrName = expect("ident");
          if (attrName) attributes.push(attrName.text);
          while (!cur.atEof() && !cur.is("punct", ";")) cur.next();
          if (cur.is("punct", ";")) cur.next();
        } else {
          const t = cur.next();
          if (t.type === "punct" && t.text === "{") {
            let depth = 1;
            while (depth > 0 && !cur.atEof()) {
              const tt = cur.next();
              if (tt.type === "punct" && tt.text === "{") depth += 1;
              if (tt.type === "punct" && tt.text === "}") depth -= 1;
            }
          }
        }
      }
      expect("punct", "}");
      if (name) celltypes.push({ name: name.text, ports, attributes });
    }

    function parseCellBody(): { joins: JoinAssignDecl[]; attrs: AttrAssignDecl[] } {
      const joins: JoinAssignDecl[] = [];
      const attrs: AttrAssignDecl[] = [];
      while (!cur.atEof() && !cur.is("punct", "}")) {
        const lhs = expect("ident");
        if (!lhs) {
          cur.next();
          continue;
        }
        let index: number | undefined;
        if (cur.is("punct", "[")) {
          cur.next();
          const idx = cur.peek();
          if (idx.type === "number") {
            cur.next();
            index = Number(idx.text);
          }
          expect("punct", "]");
        }
        expect("punct", "=");
        if (cur.is("ident") && cur.peek(1).type === "punct" && cur.peek(1).text === ".") {
          const targetCell = cur.next().text;
          cur.next(); // '.'
          const eport = expect("ident");
          expect("punct", ";");
          if (eport) {
            joins.push({ cport: lhs.text, cportIndex: index, targetCell, eport: eport.text });
          }
        } else {
          let expr = "";
          while (!cur.atEof() && !cur.is("punct", ";")) {
            expr += (expr ? " " : "") + cur.next().text;
          }
          if (cur.is("punct", ";")) cur.next();
          attrs.push({ name: lhs.text, expr });
        }
      }
      return { joins, attrs };
    }

    function parseCell(): void {
      const startTok = cur.peek();
      cur.next(); // 'cell'
      const celltypeName = expect("ident");
      const cellName = expect("ident");
      if (!expect("punct", "{")) return;
      const { joins, attrs } = parseCellBody();
      expect("punct", "}");
      if (celltypeName && cellName) {
        cells.push({
          celltypeName: celltypeName.text,
          cellName: cellName.text,
          joins,
          attrs,
          line: startTok.line,
          column: startTok.column,
        });
      }
    }

    function parseImport(kind: "import" | "import_C"): void {
      cur.next();
      const path = expect("string");
      expect("punct", ";");
      if (path) {
        imports.push({ kind, path: path.text, rawText: `${kind} "${path.text}";` });
      }
    }

    function parseComposite(): void {
      cur.next(); // 'composite'
      const name = expect("ident");
      if (cur.is("punct", "{")) skipBalancedBraceBody();
      else expect("punct", ";");
      if (name) composites.push({ name: name.text });
    }

    while (!cur.atEof()) {
      if (cur.is("ident", "signature")) {
        parseSignature();
      } else if (cur.is("ident", "celltype")) {
        parseCelltype();
      } else if (cur.is("ident", "cell")) {
        parseCell();
      } else if (cur.is("ident", "import")) {
        parseImport("import");
      } else if (cur.is("ident", "import_C")) {
        parseImport("import_C");
      } else if (cur.is("ident", "composite")) {
        parseComposite();
      } else if (cur.is("eof")) {
        break;
      } else {
        const t = cur.next();
        diagnostics.push(syntaxError({ file: "", line: t.line, column: t.column }, t.text));
      }
    }

    return { signatures, celltypes, cells, imports, composites, diagnostics };
  }
}
