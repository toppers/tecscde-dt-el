// TECSCDE-TS内部仕様 2.2 — tree-sitterのCSTを走査して中間表現を組み立てる（CdlDocumentBuilder）。
//
// パーサはCDLの全構文を解析する（tecsgen自身の構文定義からの移植文法を用いるため
// 解析範囲を絞る理由がない）。ただし図のモデルへ反映する対象は cell定義・
// __tool_info__・ポート構成の解決に必要な celltype/signature 定義に限る。
// それ以外の構文（composite・region・generate・typedef等）は解析はするが
// モデルには反映しない。
//
// 本ファイルは旧 CdlLexer / CdlParser を置き換える。中間表現（ParsedCdl）の形は
// 旧実装と同一に保っている——CdlDocumentLoader に手を入れずに済ませ、round-trip
// テストが「パーサだけを入れ替えた」ことの検証として機能するようにするため。

import type { Node } from "web-tree-sitter";
import { CdlGrammar } from "./grammar";
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
  /**
   * 入力テキスト上の該当区間をそのまま複写したもの。モデルに反映しない構文を
   * 保存時に原文のまま書き戻すために使う（内部仕様3章 preservedImports）。
   */
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

/** 文字列リテラルノードのテキストから囲みの引用符を外す。 */
function unquote(text: string): string {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1);
  }
  return text;
}

/** tree-sitterは0始まり、診断は1始まり。 */
function locationOf(node: Node): { file: string; line: number; column: number } {
  return { file: "", line: node.startPosition.row + 1, column: node.startPosition.column + 1 };
}

/** `initializer` は値を1枚包むだけなので剥がす。中身が本来の式。 */
function unwrapInitializer(node: Node): Node {
  if (node.type === "initializer" && node.namedChildCount === 1) {
    return node.namedChild(0) ?? node;
  }
  return node;
}

/** 宣言子の最も内側の identifier（属性名・変数名）を取り出す。 */
function innermostIdentifier(node: Node): string | undefined {
  if (node.type === "identifier") return node.text;
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (!child) continue;
    const found = innermostIdentifier(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

export class CdlDocumentBuilder {
  private constructor() {}

  /**
   * CDLテキストを解析して中間表現を返す。
   *
   * 旧 CdlParser.parse(sourceWithBlanks) と同じ契約——`__tool_info__` ブロックを
   * 空白で潰したテキストを受け取り（ToolInfoValidator.extractBlocks）、行番号が
   * 元テキストと一致した状態で解析する。
   */
  static build(sourceWithBlanks: string): ParsedCdl {
    const parser = CdlGrammar.parserInstance;
    const tree = parser.parse(sourceWithBlanks);
    const diagnostics: Diagnostic[] = [];
    const signatures: string[] = [];
    const celltypes: CelltypeDecl[] = [];
    const cells: CellDecl[] = [];
    const imports: ImportDecl[] = [];
    const composites: CompositeDecl[] = [];

    const root = tree?.rootNode;
    if (!root) return { signatures, celltypes, cells, imports, composites, diagnostics };

    for (let i = 0; i < root.namedChildCount; i += 1) {
      const top = root.namedChild(i);
      if (!top) continue;
      // トップレベルのみを対象とする（namespace/region に入れ子のセルは
      // 現行のシリアライザが平坦に書き出すため、収集すると保存時に失う）。
      const statement =
        top.type === "specified_statement" ? top.childForFieldName("statement") : top;
      if (!statement) continue;

      switch (statement.type) {
        case "signature": {
          const name = statement.childForFieldName("name");
          if (name) signatures.push(name.text);
          break;
        }
        case "celltype": {
          const celltype = CdlDocumentBuilder.collectCelltype(statement);
          if (celltype) celltypes.push(celltype);
          break;
        }
        case "cell": {
          const cell = CdlDocumentBuilder.collectCell(statement);
          if (cell) cells.push(cell);
          break;
        }
        case "import": {
          const path = statement.childForFieldName("path");
          if (path) {
            imports.push({ kind: "import", path: unquote(path.text), rawText: statement.text });
          }
          break;
        }
        case "import_c": {
          const header = statement.childForFieldName("header");
          if (header) {
            imports.push({ kind: "import_C", path: unquote(header.text), rawText: statement.text });
          }
          break;
        }
        case "composite_celltype": {
          const name = statement.childForFieldName("name");
          if (name) composites.push({ name: name.text });
          break;
        }
        default:
          // モデルに反映しない構文（namespace/region/generate/typedef等）。
          break;
      }
    }

    if (root.hasError) CdlDocumentBuilder.collectSyntaxDiagnostics(root, diagnostics);

    tree?.delete();
    return { signatures, celltypes, cells, imports, composites, diagnostics };
  }

  private static collectPort(portNode: Node): PortDecl | undefined {
    const kindNode = portNode.childForFieldName("kind");
    const signature = portNode.childForFieldName("signature");
    const name = portNode.childForFieldName("name");
    if (!kindNode || !signature || !name) return undefined;
    const kind = kindNode.text === "entry" ? "entry" : "call";
    const sizeNode = portNode.childForFieldName("size");
    const parsedSize = sizeNode ? Number(sizeNode.text) : Number.NaN;
    return {
      kind,
      signature: signature.text,
      name: name.text,
      arraySize: Number.isFinite(parsedSize) ? parsedSize : undefined,
      // 実際のCDLでは require は独立した celltype_statement であり、
      // ポート宣言の修飾子ではない。ポート側からは立てない。
      isRequire: false,
    };
  }

  private static collectAttributeNames(attributeNode: Node): string[] {
    const names: string[] = [];
    const body = attributeNode.childForFieldName("body");
    if (!body) return names;
    for (let i = 0; i < body.namedChildCount; i += 1) {
      const decl = body.namedChild(i);
      if (!decl || decl.type !== "attribute_declaration") continue;
      const name = innermostIdentifier(decl);
      if (name !== undefined) names.push(name);
    }
    return names;
  }

  private static collectCelltype(celltypeNode: Node): CelltypeDecl | undefined {
    const name = celltypeNode.childForFieldName("name");
    if (!name) return undefined;
    const ports: PortDecl[] = [];
    const attributes: string[] = [];
    const body = celltypeNode.childForFieldName("body");
    if (body) {
      for (let i = 0; i < body.namedChildCount; i += 1) {
        const specified = body.namedChild(i);
        if (!specified) continue;
        const statement = specified.childForFieldName("statement");
        if (!statement) continue;
        for (let j = 0; j < statement.namedChildCount; j += 1) {
          const member = statement.namedChild(j);
          if (!member) continue;
          if (member.type === "port") {
            const port = CdlDocumentBuilder.collectPort(member);
            if (port) ports.push(port);
          } else if (member.type === "attribute") {
            attributes.push(...CdlDocumentBuilder.collectAttributeNames(member));
          }
          // var / require / factory はモデルに反映しない
        }
      }
    }
    return { name: name.text, ports, attributes };
  }

  private static collectCell(cellNode: Node): CellDecl | undefined {
    const type = cellNode.childForFieldName("type");
    const name = cellNode.childForFieldName("name");
    if (!type || !name) return undefined;

    const joins: JoinAssignDecl[] = [];
    const attrs: AttrAssignDecl[] = [];

    for (let i = 0; i < cellNode.namedChildCount; i += 1) {
      const child = cellNode.namedChild(i);
      if (!child || child.type !== "specified_join") continue;
      const join = child.childForFieldName("join");
      if (!join) continue;

      const lhs = join.childForFieldName("name");
      const rawValue = join.childForFieldName("value");
      if (!lhs || !rawValue) continue;

      const indexNode = join.childForFieldName("index");
      const parsedIndex = indexNode ? Number(indexNode.text) : Number.NaN;
      const cportIndex = Number.isFinite(parsedIndex) ? parsedIndex : undefined;

      const value = unwrapInitializer(rawValue);
      if (value.type === "field_expression") {
        // `cPort = targetCell.ePort;` — 結合
        const argument = value.childForFieldName("argument");
        const field = value.childForFieldName("field");
        if (argument && field) {
          joins.push({ cport: lhs.text, cportIndex, targetCell: argument.text, eport: field.text });
          continue;
        }
      }
      // それ以外は属性代入。値は元テキストのまま保持する。
      attrs.push({ name: lhs.text, expr: value.text });
    }

    return {
      celltypeName: type.text,
      cellName: name.text,
      joins,
      attrs,
      line: cellNode.startPosition.row + 1,
      column: cellNode.startPosition.column + 1,
    };
  }

  /**
   * 構文エラーを診断へ対応付ける。
   *
   * tree-sitterが返すのは誤りの位置と構造だけで、メッセージ文言を持たない
   * （移植したのは構文定義のみでメッセージカタログは含まれない）。対応先が
   * 定まらない場合は G1016（syntax error near）へ倒す——tecsgen自身も構文エラーの
   * 大半をこの1コードで報告しているため、利用者から見て不自然にならない。
   */
  private static collectSyntaxDiagnostics(root: Node, diagnostics: Diagnostic[]): void {
    const visit = (node: Node): void => {
      if (node.isMissing) {
        diagnostics.push(syntaxError(locationOf(node), node.type));
        return;
      }
      if (node.type === "ERROR") {
        const firstToken = node.namedChild(0) ?? node.child(0);
        const near = (firstToken?.text ?? node.text).split(/\s+/)[0] ?? "";
        if (near === "") {
          diagnostics.push(unexpectedEof(locationOf(node)));
        } else {
          diagnostics.push(syntaxError(locationOf(node), near));
        }
        return;
      }
      if (!node.hasError) return;
      for (let i = 0; i < node.childCount; i += 1) {
        const child = node.child(i);
        if (child) visit(child);
      }
    };
    visit(root);
  }
}
