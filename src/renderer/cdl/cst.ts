// TECSCDE-TS内部仕様 2.2 / [[TECSCDE-DT-EL内部仕様]] 04B — tree-sitterのCSTを走査して中間表現を組み立てる（CdlDocumentBuilder）。
//
// パーサはCDLの全構文を解析する（tecsgen自身の構文定義からの移植文法を用いるため
// 解析範囲を絞る理由がない）。図のモデルには cell・celltype・signature と
// namespace/region の入れ子を反映する。generate・typedef 等は原文を保持する。
//
// 本ファイルは旧 CdlLexer / CdlParser を置き換える。ParsedCdl は所属パスと
// 保存用の構文位置も返す。

import type { Node } from "web-tree-sitter";
import { CdlGrammar } from "./grammar";
import { syntaxError, unexpectedEof } from "./messages";
import type { Diagnostic } from "../diagnostics/types";
import type { CompositeInternalBinding, CompositeStructure } from "../model/composite";
import { evaluateConstInt } from "./const-expr";
import { localTypedefs, signatureFunctions, type LocalTypedefDecl, type SignatureFunctionDecl } from "./signature-types";

export interface PortDecl {
  readonly kind: "call" | "entry";
  readonly signature: string;
  readonly name: string;
  readonly arraySize?: number;
  /** 配列ポート（`[]` または `[N]`）。`[]`（可変長）は `arraySize` を持たないので、これで非配列と区別する。 */
  readonly isArray?: boolean;
  /** 評価できなかった長さの式（原文）。配列としては展開せず、警告の対象にする。 */
  readonly unresolvedSize?: string;
  /** 名前なしの`require`（図に出ない呼び口）。名前つきの`require`は通常の呼び口として`false`にする。 */
  readonly isRequire: boolean;
  /** 名前つき`require`（`require 名前 = 要求先.受け口;`）の要求先。ローダーがシグニチャを解決する。 */
  readonly requireTarget?: { readonly owner: string; readonly entry: string };
  readonly scopePath: string;
  readonly line: number;
  readonly column: number;
}

export interface CelltypeDecl {
  readonly name: string;
  readonly qualifiedName: string;
  readonly ports: readonly PortDecl[];
  readonly attributes: readonly string[];
  readonly attributeOptions?: ReadonlyMap<string, readonly string[]>;
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
  readonly regionPath: string;
  readonly startIndex: number;
  readonly endIndex: number;
}
export interface CdlScope {
  readonly path: string;
  readonly kind: "namespace" | "region";
  readonly bodyEndIndex: number;
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

export interface GenerateDecl {
  readonly pluginName: string;
  readonly signatureName: string;
  readonly argumentText: string;
  readonly scopePath: string;
  readonly rawText: string;
}

export interface SignatureDecl {
  readonly name: string;
  readonly hasFunctions: boolean;
  readonly functions: readonly SignatureFunctionDecl[];
  readonly line: number;
  readonly column: number;
}

export interface CompositeDecl {
  readonly name: string;
  readonly ports: readonly PortDecl[];
  readonly attributes: readonly string[];
  readonly attributeOptions?: ReadonlyMap<string, readonly string[]>;
  readonly structure: CompositeStructure;
  readonly hasUnsupportedSyntax: boolean;
}

export interface ParsedCdl {
  readonly signatures: readonly SignatureDecl[];
  readonly typedefs: readonly LocalTypedefDecl[];
  readonly celltypes: readonly CelltypeDecl[];
  readonly cells: readonly CellDecl[];
  readonly imports: readonly ImportDecl[];
  readonly generates: readonly GenerateDecl[];
  readonly composites: readonly CompositeDecl[];
  readonly diagnostics: Diagnostic[];
  readonly scopes: readonly CdlScope[];
}

/** 文字列リテラルやシステムインポートノードのテキストから囲みの引用符・山括弧を外す。 */
function unquote(text: string): string {
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("<") && text.endsWith(">")))
  ) {
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
    const signatures: SignatureDecl[] = [];
    const typedefs: LocalTypedefDecl[] = [];
    const celltypes: CelltypeDecl[] = [];
    const cells: CellDecl[] = [];
    const imports: ImportDecl[] = [];
    const generates: GenerateDecl[] = [];
    const composites: CompositeDecl[] = [];
    const scopes: CdlScope[] = [];

    const root = tree?.rootNode;
    if (!root) return { signatures, typedefs, celltypes, cells, imports, generates, composites, diagnostics, scopes };

    const visitNested = (node: Node, parentPath: string): void => {
      const statement = node.type === "specified_statement" ? node.childForFieldName("statement") :
        node.type === "region_cell" ? node.childForFieldName("cell") : node;
      if (!statement) return;
      if (statement.type === "namespace" || statement.type === "region") {
        const name = statement.childForFieldName("name");
        if (!name) return;
        const path = `${parentPath === "::" ? "" : parentPath}::${name.text}`;
        const bodyEndIndex = sourceWithBlanks.lastIndexOf("}", statement.endIndex - 1);
        scopes.push({ path, kind: statement.type, bodyEndIndex });
        if (statement.type === "namespace") {
          const body = statement.childForFieldName("body");
          if (body) for (const child of body.namedChildren) if (child) visitNested(child, path);
        } else {
          for (const child of statement.namedChildren) {
            if (child && (child.type === "region" || child.type === "region_cell")) visitNested(child, path);
          }
        }
        return;
      }
      switch (statement.type) {
        case "cell": {
          const cell = CdlDocumentBuilder.collectCell(statement, parentPath);
          if (cell) cells.push(cell);
          break;
        }
        case "celltype": {
          const celltype = CdlDocumentBuilder.collectCelltype(statement, parentPath);
          if (celltype) celltypes.push(celltype);
          break;
        }
        case "composite_celltype": {
          const composite = CdlDocumentBuilder.collectComposite(statement, parentPath);
          if (composite) composites.push(composite);
          break;
        }
        case "signature": {
          const name = statement.childForFieldName("name");
          if (name) signatures.push({
            name: parentPath === "::" ? name.text : `${parentPath.slice(2)}::${name.text}`,
            hasFunctions: Boolean(statement.childForFieldName("body")),
            functions: signatureFunctions(statement),
            line: statement.startPosition.row + 1,
            column: statement.startPosition.column + 1,
          });
          break;
        }
        case "typedef":
          typedefs.push(...localTypedefs(statement));
          break;
        case "generate_statement": {
          const generate = CdlDocumentBuilder.collectGenerate(statement, parentPath);
          if (generate) generates.push(generate);
          break;
        }
        case "import":
        case "import_c": {
          const path = statement.childForFieldName(statement.type === "import" ? "path" : "header");
          if (path) imports.push({ kind: statement.type === "import" ? "import" : "import_C", path: unquote(path.text), rawText: statement.text });
          break;
        }
      }
    };

    // トップレベルも入れ子と同じ処理（`visitNested`、親のパスは`::`）で走査する。以前は同じ分岐を
    // 別の`switch`で持っていた（第4B章4B.10節）。
    for (let i = 0; i < root.namedChildCount; i += 1) {
      const top = root.namedChild(i);
      if (top) visitNested(top, "::");
    }

    if (root.hasError) CdlDocumentBuilder.collectSyntaxDiagnostics(root, diagnostics);

    tree?.delete();
    return { signatures, typedefs, celltypes, cells, imports, generates, composites, diagnostics, scopes };
  }

  private static collectGenerate(node: Node, scopePath: string): GenerateDecl | undefined {
    const plugin = node.childForFieldName("plugin");
    const signature = node.childForFieldName("signature");
    const argument = node.childForFieldName("argument");
    if (!plugin || !signature || !argument) return undefined;
    return {
      pluginName: plugin.text,
      signatureName: signature.text,
      argumentText: argument.text,
      scopePath,
      rawText: node.text,
    };
  }

  /**
   * `require`文（第4B章4B.5節）。名前つき（`require 名前 = 要求先.受け口;`）は、利用者が結合できる
   * 通常の呼び口になる（シグニチャは要求先の受け口から、ローダーが解決する）。名前なし
   * （`require 要求先.受け口;`）は図に出ない呼び口で、`isRequire`として数え、警告の対象にする。
   */
  private static collectRequire(requireNode: Node, scopePath: string): PortDecl | undefined {
    const parts = requireNode.namedChildren.filter((child): child is Node => child !== null);
    const ownerIndex = parts.findIndex((child) => child.type === "namespace_identifier");
    const owner = parts[ownerIndex];
    const entry = parts[ownerIndex + 1];
    if (!owner || !entry) return undefined;
    const nameNode = ownerIndex === 1 ? parts[0] : undefined;
    const location = { line: requireNode.startPosition.row + 1, column: requireNode.startPosition.column + 1 };
    if (nameNode) {
      return {
        kind: "call", signature: "", name: nameNode.text, isRequire: false,
        requireTarget: { owner: owner.text, entry: entry.text }, scopePath, ...location,
      };
    }
    return { kind: "call", signature: "", name: "", isRequire: true, scopePath, ...location };
  }

  private static collectPort(portNode: Node, scopePath: string): PortDecl | undefined {
    const kindNode = portNode.childForFieldName("kind");
    const signature = portNode.childForFieldName("signature");
    const name = portNode.childForFieldName("name");
    if (!kindNode || !signature || !name) return undefined;
    const kind = kindNode.text === "entry" ? "entry" : "call";
    const sizeNode = portNode.childForFieldName("size");
    const parsedSize = sizeNode ? evaluateConstInt(sizeNode.text) : undefined;
    // 長さは1以上。式が評価できない・0以下のときは長さを決めず、呼び出し側が警告にする。
    const arraySize = parsedSize !== undefined && parsedSize >= 1 ? parsedSize : undefined;
    return {
      kind,
      signature: signature.text,
      name: name.text,
      arraySize,
      // `[]`（可変長）だけを配列として扱う。長さの式が評価できないものは、推測せず単一のポートのままにする。
      isArray: arraySize !== undefined || (sizeNode === null && portNode.children.some((child) => child?.type === "[")),
      ...(sizeNode && arraySize === undefined ? { unresolvedSize: sizeNode.text } : {}),
      // 実際のCDLでは require は独立した celltype_statement であり、ポート宣言の修飾子ではない。
      // `port`文から立てることはない（`require`は`collectRequire`が拾う）。
      isRequire: false,
      scopePath,
      line: portNode.startPosition.row + 1,
      column: portNode.startPosition.column + 1,
    };
  }

  private static collectAttributeNames(attributeNode: Node): string[] {
    return this.collectAttributes(attributeNode).names;
  }

  private static collectAttributes(attributeNode: Node): {
    names: string[];
    options: Map<string, readonly string[]>;
  } {
    const names: string[] = [];
    const options = new Map<string, readonly string[]>();
    const body = attributeNode.childForFieldName("body");
    if (!body) return { names, options };
    for (let i = 0; i < body.namedChildCount; i += 1) {
      const decl = body.namedChild(i);
      if (!decl || decl.type !== "attribute_declaration") continue;
      const declarator = decl.childForFieldName("declarator");
      const name = declarator ? innermostIdentifier(declarator) : innermostIdentifier(decl);
      if (name !== undefined) {
        names.push(name);
        const text = decl.text;
        if (/\bbool(_t)?\b/.test(text)) {
          options.set(name, ["true", "false"]);
        }
      }
    }
    return { names, options };
  }

  private static collectComposite(compositeNode: Node, parentPath: string): CompositeDecl | undefined {
    const name = compositeNode.childForFieldName("name");
    if (!name) return undefined;
    const ports: PortDecl[] = [];
    const attributes: string[] = [];
    const attributeOptions = new Map<string, readonly string[]>();
    const internalCells: CompositeStructure["internalCells"][number][] = [];
    const portExports: CompositeStructure["portExports"][number][] = [];
    let hasUnsupportedSyntax = compositeNode.hasError;
    const body = compositeNode.childForFieldName("body");
    if (body) {
      for (const child of body.namedChildren) {
        if (!child) continue;
        const statement = child.type === "specified_composite_celltype_statement"
          ? child.childForFieldName("statement")
          : child;
        if (!statement) {
          hasUnsupportedSyntax = true;
          continue;
        }
        for (const member of statement.namedChildren) {
          if (!member) continue;
          if (member.type === "port") {
            const port = CdlDocumentBuilder.collectPort(member, parentPath);
            if (port) ports.push(port);
            else hasUnsupportedSyntax = true;
          } else if (member.type === "composite_attribute") {
            const collected = CdlDocumentBuilder.collectAttributes(member);
            if (collected.names.length === 0) hasUnsupportedSyntax = true;
            attributes.push(...collected.names);
            for (const [k, v] of collected.options) {
              attributeOptions.set(k, v);
            }
          } else if (member.type === "internal_cell") {
            const type = member.childForFieldName("type");
            const cellName = member.childForFieldName("name");
            if (type && cellName) {
              const bindings: CompositeInternalBinding[] = [];
              const collectBindings = (node: Node): void => {
                if (node.type === "specified_join" || node.type === "external_join") {
                  const join = node.type === "specified_join" ? node.childForFieldName("join") : node;
                  if (!join) return;
                  const bindingName = join.childForFieldName("name");
                  const exportName = join.type === "external_join" ? join.childForFieldName("export_name") : null;
                  const assignedValue = join.type === "join" ? node.text.split("=").slice(1).join("=").trim().replace(/;$/, "") : null;
                  const target = exportName?.text ?? assignedValue;
                  if (bindingName && target) {
                    bindings.push({
                      kind: join.type === "external_join" ? "external" : "join",
                      name: bindingName.text,
                      target,
                      rawText: node.text,
                    });
                  }
                  return;
                }
                for (const child of node.namedChildren) if (child) collectBindings(child);
              };
              collectBindings(member);
              internalCells.push({ celltypeName: type.text, name: cellName.text, bindings, rawText: member.text });
            } else hasUnsupportedSyntax = true;
          } else if (member.type === "export_join") {
            const externalPort = member.childForFieldName("export_name");
            const cell = member.childForFieldName("cell");
            const port = member.childForFieldName("port");
            if (externalPort && cell && port) {
              portExports.push({
                externalPortName: externalPort.text,
                cellName: cell.text,
                portName: port.text,
                rawText: member.text,
              });
            } else hasUnsupportedSyntax = true;
          } else {
            hasUnsupportedSyntax = true;
          }
        }
      }
    }
    const qualifiedName = parentPath === "::" ? name.text : `${parentPath.slice(2)}::${name.text}`;
    return {
      name: qualifiedName,
      ports,
      attributes,
      attributeOptions,
      structure: { internalCells, portExports, rawText: compositeNode.text },
      hasUnsupportedSyntax,
    };
  }

  private static collectCelltype(celltypeNode: Node, parentPath: string): CelltypeDecl | undefined {
    const name = celltypeNode.childForFieldName("name");
    if (!name) return undefined;
    const ports: PortDecl[] = [];
    const attributes: string[] = [];
    const attributeOptions = new Map<string, readonly string[]>();
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
            const port = CdlDocumentBuilder.collectPort(member, parentPath);
            if (port) ports.push(port);
          } else if (member.type === "attribute") {
            const collected = CdlDocumentBuilder.collectAttributes(member);
            attributes.push(...collected.names);
            for (const [k, v] of collected.options) {
              attributeOptions.set(k, v);
            }
          } else if (member.type === "require") {
            const required = CdlDocumentBuilder.collectRequire(member, parentPath);
            if (required) ports.push(required);
          }
          // var / factory はモデルに反映しない
        }
      }
    }
    const qualifiedName = parentPath === "::" ? name.text : `${parentPath.slice(2)}::${name.text}`;
    return { name: name.text, qualifiedName, ports, attributes, attributeOptions };
  }

  private static collectCell(cellNode: Node, regionPath = "::"): CellDecl | undefined {
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
      const parsedIndex = indexNode ? evaluateConstInt(indexNode.text) : undefined;
      const cportIndex = parsedIndex !== undefined && parsedIndex >= 0 ? parsedIndex : undefined;

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
      regionPath,
      startIndex: cellNode.startIndex,
      endIndex: cellNode.endIndex,
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
