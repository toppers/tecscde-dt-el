// [[TECSCDE-DT-EL内部仕様 - 09D V0.2.0tecsgen設定と内部処理]] 9D.6 — tecsgen の構文解析の順序を、内部処理用に再現する。
//
// tecsgen（1.9.1）は CDL を先頭から読み、`import` はその場で読み込み（同じファイルは1回だけ）、
// `generate` はその場でプラグインを作り、生成した CDL もその場で読む。プラグインの生成物は、
// この順序（署名・セルタイプ・セルの定義順、`generate` の処理順）で決まるため、ここで同じ順に
// 文を処理し、プラグインへ通知する。図のモデル（cdl/cst.ts）とは目的が違うため、別に持つ。
//
// 扱うのは、プラグインの生成物を決めるのに要る範囲（namespace・region・signature・celltype・cell・
// generate・import）だけである。tecsgen 全体との互換は保証しない（外部仕様8.5 の5.5）。

import type { Node } from "web-tree-sitter";
import { CdlGrammar } from "../../cdl/grammar";
import { signatureFunctions, type SignatureFunctionDecl } from "../../cdl/signature-types";

export interface SignatureSymbol {
  readonly kind: "signature";
  readonly name: string;
  /** 名前空間の経路（ルートは空配列）。 */
  readonly scope: readonly string[];
  readonly context?: string;
  readonly functions: readonly SignatureFunctionDecl[];
  readonly hasBody: boolean;
}

export interface PortSymbol {
  readonly kind: "call" | "entry";
  readonly name: string;
  readonly signature?: SignatureSymbol;
}

export interface CelltypeSymbol {
  readonly kind: "celltype";
  readonly name: string;
  readonly scope: readonly string[];
  readonly ports: readonly PortSymbol[];
  readonly cells: CellSymbol[];
  /** このセルタイプを生成したプラグイン（生成された CDL の中で定義されたとき）。 */
  readonly owner?: PluginInstance;
  /** `generate( プラグイン, このセルタイプ, ... )` で付いたセルタイププラグイン。 */
  readonly celltypePlugins: PluginInstance[];
}

export interface CellSymbol {
  readonly kind: "cell";
  readonly name: string;
  /** region・namespace の経路。 */
  readonly scope: readonly string[];
  readonly celltype?: CelltypeSymbol;
  /** 結合・属性の右辺（原文）。 */
  readonly joins: ReadonlyMap<string, string>;
}

export type ProgramSymbol = SignatureSymbol | CelltypeSymbol | CellSymbol | { readonly kind: "scope" };

/** プラグインのインスタンス。生成されたセルタイプにセルが定義されると `newCell` が呼ばれる。 */
export interface PluginInstance {
  newCell?(cell: CellSymbol): void;
}

export interface ResolvedSource {
  /** 同じファイルを2回読まないための鍵（正規化したパス）。 */
  readonly path: string;
  readonly text: string;
}

/** `import` の解決。見つからなければ undefined。 */
export interface CdlSourceProvider {
  resolveImport(spec: string, isSystem: boolean, fromPath: string | undefined): ResolvedSource | undefined;
}

export interface GenerateRequest {
  readonly pluginName: string;
  readonly target: SignatureSymbol | CelltypeSymbol | CellSymbol;
  readonly targetText: string;
  /** 引数の文字列（前後の `"` を外したもの）。 */
  readonly option: string;
}

/** `generate` の処理を受け持つ側（プロセッサ）。 */
export interface GenerateHandler {
  generate(request: GenerateRequest, program: CdlProgram): void;
}

export class CdlProgramError extends Error {}

export const absoluteName = (scope: readonly string[], name: string): string => `::${[...scope, name].join("::")}`;

export function stripQuotes(text: string): string {
  const parts = [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? "");
  return parts.length > 0 ? parts.join("") : text;
}

export class CdlProgram {
  private readonly symbols = new Map<string, ProgramSymbol>();
  private readonly imported = new Set<string>();
  private readonly currentOwner: PluginInstance[] = [];
  private postCoded = false;

  constructor(private readonly provider: CdlSourceProvider, private readonly handler: GenerateHandler) {}

  get isPostCoded(): boolean {
    return this.postCoded;
  }

  markPostCoded(): void {
    this.postCoded = true;
  }

  /** 入力の CDL を読む（`import` と同じく、同じパスは1回だけ）。 */
  importSource(source: ResolvedSource): void {
    if (this.imported.has(source.path)) return;
    this.imported.add(source.path);
    this.parseText(source.text, source.path);
  }

  /** プラグインが生成した CDL を、その場で読む。`owner` はその CDL で定義されたセルタイプの持ち主。 */
  parseGenerated(text: string, path: string, owner?: PluginInstance): void {
    if (owner) this.currentOwner.push(owner);
    try {
      this.parseText(text, path);
    } finally {
      if (owner) this.currentOwner.pop();
    }
  }

  lookup(text: string, scope: readonly string[]): ProgramSymbol | undefined {
    const compact = text.replace(/\s+/g, "");
    if (compact.startsWith("::")) return this.symbols.get(compact);
    for (let depth = scope.length; depth >= 0; depth -= 1) {
      const key = `::${[...scope.slice(0, depth), compact].join("::")}`;
      const found = this.symbols.get(key);
      if (found) return found;
    }
    return undefined;
  }

  private parseText(text: string, path: string): void {
    const tree = CdlGrammar.parserInstance.parse(text);
    if (!tree) throw new CdlProgramError(`${path}: CDL を解析できません`);
    try {
      for (const top of tree.rootNode.namedChildren) if (top) this.visit(top, [], path);
    } finally {
      tree.delete();
    }
  }

  private visit(node: Node, scope: readonly string[], path: string): void {
    const statement = node.type === "specified_statement" ? node.childForFieldName("statement")
      : node.type === "region_cell" ? node.childForFieldName("cell") : node;
    if (!statement) return;
    const specifiers = node.type === "specified_statement" ? statementSpecifiers(node) : [];
    switch (statement.type) {
      case "namespace":
      case "region": {
        const name = statement.childForFieldName("name")?.text;
        if (!name) return;
        const inner = [...scope, name];
        if (!this.symbols.has(absoluteName(scope, name))) this.symbols.set(absoluteName(scope, name), { kind: "scope" });
        const children = statement.type === "namespace"
          ? (statement.childForFieldName("body")?.namedChildren ?? [])
          : statement.namedChildren.filter((child) => child && (child.type === "region" || child.type === "region_cell" || child.type === "specified_statement"));
        for (const child of children) if (child) this.visit(child, inner, path);
        return;
      }
      case "import": {
        const spec = statement.childForFieldName("path")?.text ?? "";
        const isSystem = spec.startsWith("<");
        const name = spec.replace(/^[<"]|[>"]$/g, "");
        const resolved = this.provider.resolveImport(name, isSystem, path);
        if (!resolved) throw new CdlProgramError(`${path}: import "${name}" が見つかりません`);
        this.importSource(resolved);
        return;
      }
      case "signature":
        this.defineSignature(statement, scope, specifiers);
        return;
      case "celltype":
      case "composite_celltype":
        // composite の外側の呼び口・受け口だけを持つ。内側のセル（tecsgen では複製される）は
        // セルタイププラグインが既定で除外する（include_inner_cell）ため、ここでは定義しない。
        this.defineCelltype(statement, scope);
        return;
      case "cell":
        this.defineCell(statement, scope, specifiers);
        return;
      case "generate_statement":
        this.runGenerate(statement, scope);
        return;
      default:
        return;
    }
  }

  private defineSignature(node: Node, scope: readonly string[], specifiers: readonly string[]): void {
    const name = node.childForFieldName("name")?.text;
    if (!name) return;
    const context = specifiers.map((s) => /^context\s*\((.*)\)$/s.exec(s)?.[1]).find((v) => v !== undefined);
    const symbol: SignatureSymbol = {
      kind: "signature", name, scope,
      ...(context !== undefined ? { context: stripQuotes(context) } : {}),
      functions: signatureFunctions(node),
      hasBody: node.childForFieldName("body") !== null,
    };
    this.symbols.set(absoluteName(scope, name), symbol);
  }

  private defineCelltype(node: Node, scope: readonly string[]): void {
    const name = node.childForFieldName("name")?.text;
    if (!name) return;
    const ports: PortSymbol[] = [];
    for (const item of node.childrenForFieldName("body")) {
      if (!item) continue;
      for (const port of descendants(item, "port")) {
        const kindText = port.childForFieldName("kind")?.text;
        const portName = port.childForFieldName("name")?.text;
        const signatureText = port.childForFieldName("signature")?.text;
        if (!portName || !signatureText || (kindText !== "call" && kindText !== "entry")) continue;
        const signature = this.lookup(signatureText, scope);
        ports.push({ kind: kindText, name: portName, ...(signature?.kind === "signature" ? { signature } : {}) });
      }
    }
    const owner = this.currentOwner[this.currentOwner.length - 1];
    this.symbols.set(absoluteName(scope, name), {
      kind: "celltype", name, scope, ports, cells: [], celltypePlugins: [], ...(owner ? { owner } : {}),
    });
  }

  private defineCell(node: Node, scope: readonly string[], _specifiers: readonly string[]): void {
    const name = node.childForFieldName("name")?.text;
    const typeText = node.childForFieldName("type")?.text;
    if (!name || !typeText) return;
    const isDefinition = node.children.some((child) => child?.type === "{");
    const joins = new Map<string, string>();
    for (const body of node.childrenForFieldName("body")) {
      const join = body?.type === "specified_join" ? body.childForFieldName("join") : body;
      const joinName = join?.childForFieldName("name")?.text;
      const value = join?.childForFieldName("value")?.text;
      if (joinName && value !== undefined && !joins.has(joinName)) joins.set(joinName, value);
    }
    const found = this.lookup(typeText, scope);
    const celltype = found?.kind === "celltype" ? found : undefined;
    const key = absoluteName(scope, name);
    const existing = this.symbols.get(key);
    const cell: CellSymbol = existing?.kind === "cell" && !isDefinition ? existing
      : { kind: "cell", name, scope, ...(celltype ? { celltype } : {}), joins };
    this.symbols.set(key, cell);
    if (!isDefinition || !celltype) return;
    // tecsgen の Celltype#new_cell と同じ順: セルを加え、生成元のプラグイン、セルタイププラグインの順に通知する。
    celltype.cells.push(cell);
    celltype.owner?.newCell?.(cell);
    for (const plugin of [...celltype.celltypePlugins]) plugin.newCell?.(cell);
  }

  private runGenerate(node: Node, scope: readonly string[]): void {
    const pluginName = node.childForFieldName("plugin")?.text;
    const targetText = node.childForFieldName("signature")?.text;
    const argument = node.childForFieldName("argument")?.text ?? "";
    if (!pluginName || !targetText) return;
    const target = this.lookup(targetText, scope);
    if (!target || target.kind === "scope") {
      throw new CdlProgramError(`generate: '${targetText}' が見つかりません`);
    }
    this.handler.generate({ pluginName, target, targetText, option: stripQuotes(argument) }, this);
  }
}

function statementSpecifiers(node: Node): string[] {
  const list = node.childForFieldName("specifiers");
  if (!list) return [];
  return descendants(list, "statement_specifier").map((s) => s.text.trim());
}

function descendants(node: Node, type: string): Node[] {
  const out: Node[] = [];
  const visit = (n: Node): void => {
    if (n.type === type) {
      out.push(n);
      return;
    }
    for (const child of n.namedChildren) if (child) visit(child);
  };
  visit(node);
  return out;
}
