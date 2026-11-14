// TECSCDE-TS内部仕様 11.3 / [[TECSCDE-DT-EL内部仕様]] 04B — CdlDocumentBuilder + ToolInfoValidator の結果を TecscdeDocument へ組み立てる（CdlDocumentLoader）
// （CdlDocumentLoader）。外部仕様5.3.2（読み込み時の未解決要素の扱い）・5.5.2（要素単位のレイアウト適用）・
// 8.1.2（複数ファイル読み込み時、最後の1つが編集対象・他は参照専用）を実装する。

import { alignRound } from "../model/align";
import { Cell } from "../model/cell";
import { CelltypeRef, type PortTemplate } from "../model/celltype";
import { asCellId, asJoinId, asRegionId, type CellId, type JoinId } from "../model/ids";
import { autoRouteBars, portPosition } from "../model/geometry";
import { Join, type Bar } from "../model/join";
import { PaperSpec } from "../model/paper";
import { CPort, EPort, portLayoutKey, type EdgeSide } from "../model/port";
import { emptyToolInfoTecsgen, type ToolInfoTecsgen } from "../model/tool-info-types";
import { TecscdeDocument, type CdlSourceTemplate } from "../model/document";
import { Region, RegionTree } from "../model/region";
import { CTypeRegistry, type TypeDefinition, type TypeResolution } from "../cdecl/type-registry";
import type { CdeclResult } from "../cdecl/extractor";
import { CdlDocumentBuilder, type CellDecl, type CelltypeDecl, type CompositeDecl, type GenerateDecl, type PortDecl, type SignatureDecl } from "./cst";
import { portTypeKey, type PortTypeIndex, type ResolvedPortType, type ResolvedSignatureType } from "./port-type-index";
import type { TypeUse } from "./signature-types";
import { ToolInfoValidator, type ArrayElementRecord, type ToolInfoTecscdeParsed } from "./tool-info";
import { autoLayoutOverflow, duplicateCell, joinIndexInconsistent, missingJoinTarget, requirePortHidden, unresolvedCelltype, W_CODES } from "./messages";
import type { Diagnostic } from "../diagnostics/types";
import { AUTO_CELL_HEIGHT, AUTO_CELL_WIDTH, chooseAutoPaperSize, placeAutoCells, type Rect } from "./auto-placement";
import { isUnderAny } from "../../shared/path-under";

/** 配列ポートの隣り合う要素の間隔（mm）。要素の挿入（InsertPortElementCommand）と同じ値。 */
const ARRAY_ELEMENT_GAP_MM = 3;

export interface CdlSource {
  readonly text: string;
  readonly fileName: string;
  readonly sourcePath?: string;
  /** 読み込んだCDLは編集可能。Plugin生成CDLは参照専用。 */
  readonly editable: boolean;
  /** Plugin-generated cells and types are read-only and are not saved or added to reference paths. */
  readonly generated?: boolean;
  /** ローダーが`systemDirs`から決める。`-S`のディレクトリ配下から読み込まれたCDLか（第3章3.2節）。 */
  readonly systemDefined?: boolean;
}

function isOrdinaryCelltype(decl: CelltypeDecl | CompositeDecl): decl is CelltypeDecl {
  return "qualifiedName" in decl;
}

export interface LoadResult {
  readonly document: TecscdeDocument;
  readonly diagnostics: readonly Diagnostic[];
  readonly portTypeIndex: PortTypeIndex;
}

export interface LoadOptions {
  /** undefinedのみ旧呼び出しの主推定を使う。nullは主ファイルなし。 */
  readonly primarySourceKey?: string | null;
  readonly sourceOrder?: readonly string[];
  readonly cdeclResults?: ReadonlyMap<string, CdeclResult>;
  /** `-S`で指定されたディレクトリ（絶対パス）。配下から読み込んだCDLを`systemDefined`とする（第3章3.2節）。 */
  readonly systemDirs?: readonly string[];
  /** `true`なら、`systemDefined`のセルも通常のCDLと同じく編集可能にする（既定は`false`）。 */
  readonly allowEditSystemDefined?: boolean;
}

function withLocation(d: Diagnostic, file: string): Diagnostic {
  return d.location ? { ...d, location: { ...d.location, file } } : d;
}

/**
 * セルタイプのポートに既定の辺・オフセットを割り当てる。
 * 「呼び口=左辺、受け口=右辺、辺の長さに均等配置」を既定方針とする
 * （外部仕様4.3.1のCPGap/EPGap=10mmという間隔の趣旨を、ポート数に応じて均等割りする形で踏襲）。
 */
function assignDefaultPortLayout(
  decls: readonly { readonly name: string; readonly signature: string; readonly arraySize?: number; readonly variableArray?: boolean }[],
  edge: EdgeSide,
  edgeLength: number,
): PortTemplate[] {
  const count = decls.length;
  return decls.map((p, i) => ({
    name: p.name,
    signature: p.signature,
    edgeSide: edge,
    offset: alignRound((edgeLength * (i + 1)) / (count + 1)),
    subscript: null,
    arraySize: p.arraySize ?? null,
    ...(p.variableArray ? { variableArray: true } : {}),
  }));
}

/** generate のスコープから、既に読んだ署名の完全修飾名を探す。 */
function resolveGenerateSignature(
  declaration: GenerateDecl,
  signatures: ReadonlySet<string>,
): string | undefined {
  const name = declaration.signatureName.replace(/^::/, "");
  if (declaration.signatureName.startsWith("::")) return signatures.has(name) ? name : undefined;
  let scope = declaration.scopePath;
  while (scope !== "::") {
    const candidate = `${scope.slice(2)}::${name}`;
    if (signatures.has(candidate)) return candidate;
    const separator = scope.lastIndexOf("::");
    scope = separator === 0 ? "::" : scope.slice(0, separator);
  }
  return signatures.has(name) ? name : undefined;
}

function resolveSignatureInScope(name: string, scopePath: string, signatures: ReadonlySet<string>): string | undefined {
  const normalized = name.replace(/^::/, "");
  if (name.startsWith("::")) return signatures.has(normalized) ? normalized : undefined;
  let scope = scopePath;
  while (scope !== "::") {
    const candidate = `${scope.slice(2)}::${normalized}`;
    if (signatures.has(candidate)) return candidate;
    const separator = scope.lastIndexOf("::");
    scope = separator === 0 ? "::" : scope.slice(0, separator);
  }
  return signatures.has(normalized) ? normalized : undefined;
}

/** MrubyBridgeSignaturePlugin の外部インターフェースだけを表示モデルに反映する。 */
function registerMrubyBridgeCelltypes(
  celltypes: Map<string, CelltypeRef>,
  signatures: ReadonlySet<string>,
  declarations: readonly { readonly generate: GenerateDecl; readonly fileName: string }[],
): void {
  for (const { generate, fileName } of declarations) {
    if (generate.pluginName !== "MrubyBridgePlugin") continue;
    const signature = resolveGenerateSignature(generate, signatures);
    if (!signature) continue;
    const typeName = `t${signature.replace(/::/g, "_")}`;
    const bridgeName = `nMruby::${typeName}`;
    if (!celltypes.has(bridgeName)) {
      celltypes.set(bridgeName, CelltypeRef.create({
        name: bridgeName,
        cportTemplates: assignDefaultPortLayout([{ name: "cTECS", signature: `::${signature}` }], "LEFT", 15),
        eportTemplates: [],
        attributeNames: ["VMname", "bridgeName"],
        hiddenRequirePortCount: 0,
        locale: fileName,
      }));
    }
    const initializerName = `${bridgeName}_Initializer`;
    if (!celltypes.has(initializerName)) {
      celltypes.set(initializerName, CelltypeRef.create({
        name: initializerName,
        cportTemplates: [],
        eportTemplates: assignDefaultPortLayout([
          { name: "eInitialize", signature: "sInitializeTECSBridge" },
        ], "RIGHT", 15),
        attributeNames: [],
        hiddenRequirePortCount: 0,
        locale: fileName,
      }));
    }
  }
}

function resolveCelltypeInScope(
  celltypes: ReadonlyMap<string, CelltypeRef>,
  name: string,
  scopePath: string,
): CelltypeRef | undefined {
  const normalized = name.replace(/^::/, "");
  if (name.startsWith("::")) return celltypes.get(normalized);
  let scope = scopePath;
  while (scope !== "::") {
    const scoped = celltypes.get(`${scope.slice(2)}::${normalized}`);
    if (scoped) return scoped;
    const separator = scope.lastIndexOf("::");
    scope = separator === 0 ? "::" : scope.slice(0, separator);
  }
  return celltypes.get(normalized);
}

interface ParsedSource {
  readonly fileName: string;
  readonly sourcePath?: string;
  readonly editable: boolean;
  readonly generated?: boolean;
  /** `-S`のディレクトリ配下から読み込まれたCDLか（セルの`systemDefined`と編集可否の元）。 */
  readonly systemDefined: boolean;
  readonly cells: readonly CellDecl[];
}

function buildRegionTree(paths: ReadonlySet<string>, cells: ReadonlyMap<CellId, Cell>): RegionTree {
  const childrenByPath = new Map<string, string[]>();
  for (const path of paths) {
    if (path === "::") continue;
    const lastSeparator = path.lastIndexOf("::");
    const parent = lastSeparator === 0 ? "::" : path.slice(0, lastSeparator);
    const children = childrenByPath.get(parent) ?? [];
    children.push(path);
    childrenByPath.set(parent, children);
  }
  const create = (path: string): Region => Region.create(
    asRegionId(path), path,
    (childrenByPath.get(path) ?? []).sort().map(create),
    [...cells.values()].filter((cell) => cell.regionId === path).map((cell) => cell.id),
  );
  return RegionTree.of(create("::"));
}

/** A comment immediately above a cell follows that cell when its region changes. */
function attachedCommentStart(source: string, cellStart: number): number {
  const cellLineStart = source.lastIndexOf("\n", cellStart - 1) + 1;
  let start = cellLineStart;
  while (start > 0) {
    const previousEnd = start - 1;
    const previousStart = source.lastIndexOf("\n", previousEnd - 1) + 1;
    const previousLine = source.slice(previousStart, previousEnd).trim();
    if (previousLine.startsWith("//")) {
      start = previousStart;
      continue;
    }
    if (previousLine.endsWith("*/")) {
      let blockStart = previousStart;
      while (blockStart > 0 && !source.slice(blockStart, previousEnd).trimStart().startsWith("/*")) {
        blockStart = source.lastIndexOf("\n", blockStart - 2) + 1;
      }
      if (source.slice(blockStart, previousEnd).trim().startsWith("/*")) {
        start = blockStart;
        continue;
      }
    }
    break;
  }
  return start === cellLineStart ? cellStart : start;
}

function cellFqn(regionPath: string, cellName: string): string {
  const segments = regionPath.split("::").filter(Boolean);
  return segments.length > 0 ? `::${[...segments, cellName].join("::")}` : `::${cellName}`;
}

function matchesCellRecord(recordCell: string, regionPath: string, cellName: string): boolean {
  const fqn = cellFqn(regionPath, cellName);
  const bareFqn = fqn.replace(/^::/, "");
  const normRecordCell = recordCell.trim();
  const bareRecordCell = normRecordCell.replace(/^::/, "");
  return normRecordCell === fqn || bareRecordCell === bareFqn || (regionPath === "::" && bareRecordCell === cellName);
}

interface PreCellMeta {
  readonly id: CellId;
  readonly name: string;
  readonly regionPath: string;
  readonly namespace: string;
  readonly celltypeName: string;
  readonly source: ParsedSource;
  readonly declaration: CellDecl;
}

export class CdlDocumentLoader {
  /**
   * 複数ファイルをまとめて読み込む（8.1.2）。各セルの`editable`は、呼び出し側が渡す`CdlSource.editable`で決まる
   * （通常のCDLは全て編集可能、Plugin生成CDLは不可）。ただし`options.systemDirs`配下のCDLは、
   * `allowEditSystemDefined`が真でない限り、ソースごと編集不可になる（第3章3.2節）。
   * セルタイプはどのファイルで定義されていても全ファイル分を解決対象として扱う。
   */
  static loadSources(inputSources: readonly CdlSource[], options: LoadOptions = {}): LoadResult {
    // 第3章3.2節: `-S`のディレクトリ配下のCDLは`systemDefined`とし、既定では**ソースごと**編集不可にする。
    // セル単位ではなくソース単位にするのは、編集可能なソースはテンプレートを持ち、保存時にテンプレートの
    // セルをすべて入れ替えるため（編集不可のセルだけが混ざると、そのセルが書き戻しで消える）。
    // 編集不可のソースはテンプレートを持たないので、書き戻しの対象にならない。
    const sources: readonly CdlSource[] = inputSources.map((source) => {
      const systemDefined =
        !source.generated && source.sourcePath !== undefined && isUnderAny(source.sourcePath, options.systemDirs ?? []);
      return systemDefined
        ? { ...source, systemDefined, editable: source.editable && options.allowEditSystemDefined === true }
        : source;
    });
    const sourceKey = (source: CdlSource): string => source.sourcePath ?? source.fileName;
    const primarySource = options.primarySourceKey === undefined
      ? sources.slice().reverse().find((source) => source.editable && !source.generated)
      : options.primarySourceKey === null ? undefined
        : sources.find((source) => sourceKey(source) === options.primarySourceKey && !source.generated);
    if (typeof options.primarySourceKey === "string" && !primarySource) {
      throw new Error(`Primary source not found among ordinary CDL sources: ${options.primarySourceKey}`);
    }
    const ordinaryOrder = sources.filter((source) => !source.generated).map(sourceKey);
    const sourceOrder = options.sourceOrder ?? ordinaryOrder;
    if (new Set(sourceOrder).size !== sourceOrder.length || sourceOrder.length !== ordinaryOrder.length
      || sourceOrder.some((key, index) => key !== ordinaryOrder[index])) {
      throw new Error("sourceOrder must match the ordinary sources in parsing order");
    }
    const diagnostics: Diagnostic[] = [];
    const celltypes = new Map<string, CelltypeRef>();
    const parsedSources: ParsedSource[] = [];
    const signatures = new Set<string>();
    const signatureDeclarations: Array<{ declaration: SignatureDecl; fileName: string }> = [];
    const localTypeDefinitions: TypeDefinition[] = [];
    const pendingCelltypes: Array<{ declaration: CelltypeDecl | CompositeDecl; source: CdlSource }> = [];
    const generates: Array<{ generate: GenerateDecl; fileName: string }> = [];
    let preservedImports: readonly string[] = [];
    let toolInfoTecsgen: ToolInfoTecsgen = emptyToolInfoTecsgen();
    let tecscdeParsed: ToolInfoTecscdeParsed = { cellList: {}, joinList: {}, unknownFields: {} };
    const layoutsBySource = new Map<string, ToolInfoTecscdeParsed>();
    let paper: PaperSpec = PaperSpec.default();
    let paperSpecified = false; // ファイルに用紙の指定があるか（無ければ、収まる用紙を選ぶ。外部仕様5.3.x）
    const regionPaths = new Set<string>(["::"]);
    const namespaceScopePaths = new Set<string>();
    const editableRegionPaths = new Set<string>(["::"]);
    let sourceTemplate: CdlSourceTemplate | undefined;
    const sourceTemplates = new Map<string, CdlSourceTemplate>();

    for (const source of sources) {
      const { blocks, sourceWithBlanks } = ToolInfoValidator.extractBlocks(source.text);
      const parsed = CdlDocumentBuilder.build(sourceWithBlanks);
      for (const signature of parsed.signatures) {
        if (signature.hasFunctions) signatures.add(signature.name);
        signatureDeclarations.push({ declaration: signature, fileName: source.fileName });
      }
      for (const definition of parsed.typedefs) {
        localTypeDefinitions.push({ ...definition, origin: source.fileName, fallback: false });
      }
      for (const generate of parsed.generates) generates.push({ generate, fileName: source.fileName });
      for (const scope of parsed.scopes) {
        if (scope.kind === "namespace") namespaceScopePaths.add(scope.path);
        let path = scope.path;
        while (path !== "::") {
          regionPaths.add(path);
          if (source.editable) editableRegionPaths.add(path);
          const separator = path.lastIndexOf("::");
          path = separator === 0 ? "::" : path.slice(0, separator);
        }
      }
      if (source.editable && !source.generated) {
        const template: CdlSourceTemplate = {
          text: source.text,
          cells: parsed.cells.map((cell) => {
            const startIndex = attachedCommentStart(source.text, cell.startIndex);
            return {
              cellName: cell.cellName, regionPath: cell.regionPath, startIndex, endIndex: cell.endIndex,
              leadingText: source.text.slice(startIndex, cell.startIndex),
              joins: cell.joins,
              sourceJoins: cell.joins,
            };
          }),
          composites: parsed.composites.map((composite) => ({ name: composite.name, rawText: composite.structure.rawText })),
          scopes: parsed.scopes.map((scope) => ({ path: scope.path, bodyEndIndex: scope.bodyEndIndex })),
          toolInfoBlocks: blocks.map((block) => ({ toolName: block.toolName, startIndex: block.startIndex, endIndex: block.endIndex })),
        };
        sourceTemplates.set(sourceKey(source), template);
        if (source === primarySource) sourceTemplate = template;
      }
      for (const d of parsed.diagnostics) diagnostics.push(withLocation(d, source.fileName));
      // 編集対象ファイルの import / import_C を原文のまま保持する（内部仕様3章）。
      if (source === primarySource) preservedImports = parsed.imports.map((i) => i.rawText);

      for (const block of source.generated ? [] : blocks) {
        if (block.toolName === "tecsgen") {
          const parsedTecsgen = ToolInfoValidator.parseTecsgen(block.json);
          if (source === primarySource) toolInfoTecsgen = parsedTecsgen;
          const versionDiag = ToolInfoValidator.checkFormatVersion(parsedTecsgen);
          if (versionDiag) diagnostics.push(versionDiag);
        } else if (block.toolName === "tecscde") {
          const { parsed: p, diagnostics: d } = ToolInfoValidator.parseTecscde(block.json);
          tecscdeParsed = p;
          layoutsBySource.set(source.sourcePath ?? source.fileName, p);
          diagnostics.push(...d);
          if (p.paper) {
            paper = PaperSpec.create(p.paper.size, p.paper.orientation ?? "LANDSCAPE");
            paperSpecified = true;
          }
        }
        // 5.1.1: 自分に向けられていないツール名のブロックは読み飛ばす。
      }

      for (const ct of [...parsed.celltypes, ...parsed.composites]) {
        pendingCelltypes.push({ declaration: ct, source });
      }

      parsedSources.push({
        fileName: source.fileName, sourcePath: source.sourcePath, editable: source.editable, generated: source.generated,
        systemDefined: source.systemDefined === true,
        cells: parsed.cells,
      });
    }

    const typeRegistry = new CTypeRegistry(options.cdeclResults, localTypeDefinitions);
    const signatureTypes = new Map<string, ResolvedSignatureType>();
    const resolveUse = (type: TypeUse, fileName: string): TypeResolution => {
      const resolved = type.type ? typeRegistry.resolve(type.type) : { origins: [], fallback: false, reason: "解釈できない C 型" };
      if (resolved.reason) diagnostics.push({
        severity: "warning", code: W_CODES.C_TYPE_UNRESOLVED, message: resolved.reason,
        location: { file: fileName, line: type.line, column: type.column },
      });
      return resolved;
    };
    for (const { declaration, fileName } of signatureDeclarations) {
      const functions = declaration.functions.map((fn) => ({
        name: fn.name,
        returns: resolveUse(fn.returns, fileName),
        parameters: fn.parameters.map((parameter) => resolveUse(parameter, fileName)),
      }));
      signatureTypes.set(declaration.name, {
        id: declaration.name,
        functions,
        valid: functions.every((fn) => Boolean(fn.returns.type) && fn.parameters.every((parameter) => Boolean(parameter.type))),
      });
    }
    const portTypes = new Map<string, ResolvedPortType>();
    const qualifiedCelltypes = new Map<string, CelltypeRef>();
    const portDeclaration = (celltypeName: string, port: PortDecl, fileName: string): { name: string; signature: string; arraySize?: number; variableArray?: boolean } => {
      const id = resolveSignatureInScope(port.signature, port.scopePath, signatures);
      const valid = id ? (signatureTypes.get(id)?.valid ?? false) : false;
      portTypes.set(portTypeKey(celltypeName, port.kind, port.name), { signatureId: id, valid });
      if (!id) diagnostics.push({
        severity: "warning", code: W_CODES.PORT_SIGNATURE_UNRESOLVED,
        message: `ポート ${port.name} のシグニチャ ${port.signature} を解決できません。`,
        location: { file: fileName, line: port.line, column: port.column },
        relatedPortName: port.name,
      });
      if (port.unresolvedSize !== undefined) diagnostics.push({
        severity: "warning", code: W_CODES.ARRAY_SIZE_UNRESOLVED,
        message: `ポート ${port.name} の配列長 [${port.unresolvedSize}] を評価できません（整数の定数式のみ対応）。配列として展開せず、単一のポートとして扱います。`,
        location: { file: fileName, line: port.line, column: port.column },
        relatedPortName: port.name,
      });
      return {
        name: port.name,
        signature: id ? `::${id}` : port.signature,
        arraySize: port.arraySize,
        ...(port.isArray && port.arraySize === undefined ? { variableArray: true } : {}),
      };
    };
    // 名前つき`require`（`require 名前 = 要求先.受け口;`）の呼び口は、要求先の受け口のシグニチャを持つ
    // （第4B章4B.5節）。要求先は、セルタイプ名、またはセル名（そのセルのセルタイプ）で指定される。
    const celltypeDeclarations = new Map<string, CelltypeDecl>();
    for (const { declaration } of pendingCelltypes) {
      if (!isOrdinaryCelltype(declaration)) continue;
      celltypeDeclarations.set(declaration.name, declaration);
      celltypeDeclarations.set(declaration.qualifiedName, declaration);
    }
    const celltypeNameOfCell = new Map<string, string>();
    for (const parsedSource of parsedSources) {
      for (const cellDecl of parsedSource.cells) {
        if (!celltypeNameOfCell.has(cellDecl.cellName)) celltypeNameOfCell.set(cellDecl.cellName, cellDecl.celltypeName);
      }
    }
    const withRequireSignature = (port: PortDecl): PortDecl => {
      if (!port.requireTarget) return port;
      const { owner, entry } = port.requireTarget;
      const declaration = celltypeDeclarations.get(owner) ?? celltypeDeclarations.get(celltypeNameOfCell.get(owner) ?? "");
      const target = declaration?.ports.find((candidate) => candidate.kind === "entry" && candidate.name === entry);
      // 見つからないときは要求先の表記をそのままシグニチャにし、解決できない警告で知らせる。
      return target ? { ...port, signature: target.signature, scopePath: target.scopePath } : { ...port, signature: `${owner}.${entry}` };
    };
    for (const { declaration: ct, source } of pendingCelltypes) {
      const composite = isOrdinaryCelltype(ct) ? undefined : ct.structure;
      const typeName = source.generated && isOrdinaryCelltype(ct) ? ct.qualifiedName : ct.name;
      const cportDecls = ct.ports.filter((p) => p.kind === "call" && !p.isRequire)
        .map((p) => portDeclaration(typeName, withRequireSignature(p), source.fileName));
      const eportDecls = ct.ports.filter((p) => p.kind === "entry")
        .map((p) => portDeclaration(typeName, p, source.fileName));
      const hiddenRequirePortCount = ct.ports.filter((p) => p.kind === "call" && p.isRequire).length;
      const celltype = CelltypeRef.create({
        name: typeName,
        cportTemplates: assignDefaultPortLayout(cportDecls, "LEFT", 15),
        eportTemplates: assignDefaultPortLayout(eportDecls, "RIGHT", 15),
        attributeNames: ct.attributes,
        attributeOptions: ct.attributeOptions,
        hiddenRequirePortCount,
        active: ct.active,
        locale: source.fileName,
        ...(source.sourcePath && !source.generated ? { sourcePath: source.sourcePath } : {}),
        generated: source.generated === true,
        ...(source.generated || source.sourcePath === undefined ? {} : { definitionPath: source.sourcePath }),
        composite,
        hasUnsupportedSyntax: isOrdinaryCelltype(ct) ? false : ct.hasUnsupportedSyntax,
      });
      celltypes.set(typeName, celltype);
      qualifiedCelltypes.set(isOrdinaryCelltype(ct) ? ct.qualifiedName : ct.name, celltype);
    }

    registerMrubyBridgeCelltypes(celltypes, signatures, generates);
    const celltypeLookup = new Map([...celltypes, ...qualifiedCelltypes]);


    // --- セル（1周目: 本体とポート。全ファイル分をまとめて処理する） ---
    const cells = new Map<CellId, Cell>();
    // 修飾名（`N::cell`）の解決用。リージョンはセル名の修飾に使われないので、namespace だけの経路を持つ。
    const cellNamespaces = new Map<CellId, string>();
    const namespaceOf = (regionPath: string): string => {
      const names: string[] = [];
      let path = "";
      for (const segment of regionPath.split("::").filter(Boolean)) {
        path += `::${segment}`;
        if (namespaceScopePaths.has(path)) names.push(segment);
      }
      return names.length > 0 ? `::${names.join("::")}` : "::";
    };
    // 同じ名前空間の同名セルだけが重複。異なる名前空間の同名セルは共存し、そのIDは修飾名になる（監査#25）。
    const duplicateKey = (cell: CellDecl): string => `${namespaceOf(cell.regionPath)}\0${cell.cellName}`;
    const selectedCells = new Map<string, { declaration: CellDecl; source: ParsedSource }>();
    for (const source of parsedSources) {
      for (const declaration of source.cells) {
        const key = duplicateKey(declaration);
        const previous = selectedCells.get(key);
        if (!previous) {
          selectedCells.set(key, { declaration, source });
        } else if (source.generated && previous.source.generated) {
          // tecsgen may emit a prototype before the populated cell definition.
          const details = (cell: CellDecl): number => cell.joins.length + cell.attrs.length;
          if (details(declaration) > details(previous.declaration)) {
            selectedCells.set(key, { declaration, source });
          }
        } else if (!source.generated) {
          diagnostics.push(duplicateCell(declaration.cellName, {
            file: source.fileName, line: declaration.line, column: declaration.column,
          }));
        }
      }
    }
    const selectedSources: ParsedSource[] = [...selectedCells.values()].map(({ declaration, source }) => ({
      ...source, cells: [declaration],
    }));
    // 名前が衝突するセルは、名前空間つきの修飾名（`::N::c1`）をIDにする。衝突しないセルのIDは名前のまま。
    const nameCounts = new Map<string, number>();
    for (const { declaration } of selectedCells.values()) {
      nameCounts.set(declaration.cellName, (nameCounts.get(declaration.cellName) ?? 0) + 1);
    }
    const idFor = (regionPath: string, name: string): CellId => {
      if ((nameCounts.get(name) ?? 0) < 2) return asCellId(name);
      const namespace = namespaceOf(regionPath);
      return asCellId(namespace === "::" ? `::${name}` : `${namespace}::${name}`);
    };

    // セルのメタデータを収集し、Pass 1 前の結合先解決および受け口添字集約を行う。
    const cellMetas: PreCellMeta[] = [];
    const cellMetasByName = new Map<string, PreCellMeta[]>();
    for (const { declaration, source } of selectedCells.values()) {
      const id = idFor(declaration.regionPath, declaration.cellName);
      const namespace = namespaceOf(declaration.regionPath);
      const meta: PreCellMeta = {
        id,
        name: declaration.cellName,
        regionPath: declaration.regionPath,
        namespace,
        celltypeName: declaration.celltypeName,
        source,
        declaration,
      };
      cellMetas.push(meta);
      cellMetasByName.set(meta.name, [...(cellMetasByName.get(meta.name) ?? []), meta]);
    }

    const resolveTargetMeta = (raw: string, fromNamespace: string): PreCellMeta | undefined => {
      const absolute = raw.startsWith("::");
      const parts = raw.replace(/^::/, "").split("::");
      const candidates = cellMetasByName.get(parts.pop()!) ?? [];
      if (candidates.length === 0) return undefined;
      const prefix = parts.length > 0 ? `::${parts.join("::")}` : "::";
      if (absolute) return candidates.find((c) => c.namespace === prefix);
      const within = (scope: string): string => (scope === "::" ? prefix : prefix === "::" ? scope : `${scope}${prefix}`);
      for (let scope = fromNamespace; ; ) {
        const found = candidates.find((c) => c.namespace === within(scope));
        if (found) return found;
        if (scope === "::") break;
        const separator = scope.lastIndexOf("::");
        scope = separator === 0 ? "::" : scope.slice(0, separator);
      }
      const only = candidates.length === 1 ? candidates[0]! : undefined;
      return only && (prefix === "::" || only.namespace.endsWith(prefix)) ? only : undefined;
    };

    // 各セルの受け口ポートに対して参照された最大添字を集約する（キー: `${targetCellId}\0${eportName}`）
    const maxEportIndices = new Map<string, number>();
    for (const src of selectedSources) {
      for (const decl of src.cells) {
        const fromNamespace = namespaceOf(decl.regionPath);
        for (const j of decl.joins) {
          if (j.eportIndex !== undefined) {
            const target = resolveTargetMeta(j.targetCell, fromNamespace);
            if (target) {
              const key = `${target.id}\0${j.eport}`;
              const current = maxEportIndices.get(key) ?? -1;
              if (j.eportIndex > current) {
                maxEportIndices.set(key, j.eportIndex);
              }
            }
          }
        }
      }
    }

    // 全ソースから array_elements の定義を集約・検証する（監査 #24）
    const allArrayElementRecords: ArrayElementRecord[] = [];
    const seenRecordKeys = new Set<string>();
    for (const layout of [...layoutsBySource.values(), tecscdeParsed]) {
      if (layout.arrayElements) {
        for (const rec of layout.arrayElements) {
          const k = `${rec.cell}\0${rec.direction}\0${rec.port}\0${rec.element_count}`;
          if (!seenRecordKeys.has(k)) {
            seenRecordKeys.add(k);
            allArrayElementRecords.push(rec);
          }
        }
      }
    }

    const savedElementCounts = new Map<string, number>();

    for (const rec of allArrayElementRecords) {
      const targetMeta = cellMetas.find((meta) => matchesCellRecord(rec.cell, meta.regionPath, meta.name));
      if (!targetMeta) {
        diagnostics.push({
          severity: "warning",
          code: W_CODES.LAYOUT_DISCARDED,
          message: `セル \`${rec.cell}\` が見つからないため、array_elements の要素数指定を破棄しました`,
        });
        continue;
      }
      const celltype = resolveCelltypeInScope(celltypeLookup, targetMeta.celltypeName, targetMeta.regionPath);
      if (!celltype) {
        diagnostics.push({
          severity: "warning",
          code: W_CODES.LAYOUT_DISCARDED,
          message: `セル \`${rec.cell}\` のセルタイプを解決できないため、array_elements の要素数指定を破棄しました`,
        });
        continue;
      }
      const templates = rec.direction === "call" ? celltype.cportTemplates : celltype.eportTemplates;
      const portTemplate = templates.find((t) => t.name === rec.port);
      if (!portTemplate) {
        diagnostics.push({
          severity: "warning",
          code: W_CODES.LAYOUT_DISCARDED,
          message: `セル \`${rec.cell}\` のポート \`${rec.port}\` (${rec.direction}) が見つからないため、array_elements の要素数指定を破棄しました`,
        });
        continue;
      }
      if (!portTemplate.variableArray) {
        diagnostics.push({
          severity: "warning",
          code: W_CODES.LAYOUT_DISCARDED,
          message: `セル \`${rec.cell}\` のポート \`${rec.port}\` (${rec.direction}) は可変長配列ではないため、array_elements の要素数指定を破棄しました`,
        });
        continue;
      }
      savedElementCounts.set(`${targetMeta.id}\0${rec.direction}\0${rec.port}`, rec.element_count);
    }

    // 外部仕様5.3.x: 位置を持たないセルは、保存済みの位置を持つセルと重ならない位置へ置く。
    // 先に全セルのレイアウトを調べ、位置を持つセルの矩形を埋まっている場所として渡す。
    const occupied: Rect[] = [];
    const autoCellIds: CellId[] = [];
    for (const src of selectedSources) {
      for (const decl of src.cells) {
        const id = idFor(decl.regionPath, decl.cellName);
        const saved = (layoutsBySource.get(src.sourcePath ?? src.fileName) ?? tecscdeParsed).cellList[id];
        if (saved) {
          const [sx, sy, sw, sh] = saved.location;
          occupied.push({ x: sx, y: sy, width: sw, height: sh });
        } else {
          autoCellIds.push(id);
        }
      }
    }
    // 外部仕様5.3.x: 用紙の指定がなければ、自動配置したセルがすべて収まる最小の用紙（横）を選ぶ。指定があれば尊重する。
    if (!paperSpecified) paper = PaperSpec.create(chooseAutoPaperSize(autoCellIds.length, occupied), "LANDSCAPE");
    const { width: paperW, height: paperH } = paper.contentSize();
    const autoPlacement = placeAutoCells(autoCellIds.length, occupied, paperW, paperH);
    const autoPositions = new Map(autoCellIds.map((id, index) => [id, autoPlacement.positions[index]!]));
    if (autoPlacement.overflow > 0) diagnostics.push(autoLayoutOverflow(autoPlacement.overflow));

    for (const src of selectedSources) {
      for (const decl of src.cells) {
        const id = idFor(decl.regionPath, decl.cellName);
        cellNamespaces.set(id, namespaceOf(decl.regionPath));
        const celltype = resolveCelltypeInScope(celltypeLookup, decl.celltypeName, decl.regionPath);
        const layout = (layoutsBySource.get(src.sourcePath ?? src.fileName) ?? tecscdeParsed).cellList[id];
        const savedRegion = layout?.region;
        const regionPath = decl.regionPath !== "::" ? decl.regionPath :
          savedRegion && (src.editable ? editableRegionPaths : regionPaths).has(savedRegion) ? savedRegion : "::";
        if (savedRegion && savedRegion !== regionPath) diagnostics.push({
          severity: "warning", code: W_CODES.REGION_MISMATCH,
          message: `セル ${decl.cellName} のリージョン情報 ${savedRegion} とCDLの所属 ${regionPath} が一致しません。`,
          location: { file: src.fileName, line: decl.line, column: decl.column },
        });

        let x: number;
        let y: number;
        let width: number;
        let height: number;
        if (layout) {
          [x, y, width, height] = layout.location;
        } else {
          const pos = autoPositions.get(id)!;
          x = pos.x;
          y = pos.y;
          width = AUTO_CELL_WIDTH;
          height = AUTO_CELL_HEIGHT;
        }

        const attrs: Record<string, string> = {};
        for (const a of decl.attrs) attrs[a.name] = a.expr;

        if (!celltype) {
          diagnostics.push(unresolvedCelltype(decl.cellName, id));
          cells.set(
            id,
            Cell.create({
              id,
              name: decl.cellName,
              celltypeName: decl.celltypeName,
              x,
              y,
              width,
              height,
            regionId: asRegionId(regionPath),
              editable: src.editable,
              systemDefined: src.systemDefined,
              cports: [],
              eports: [],
              attrs,
              celltypeUnresolved: true,
              locale: src.sourcePath ?? src.fileName,
            }),
          );
          continue;
        }

        if (celltype.hiddenRequirePortCount > 0) {
          diagnostics.push(requirePortHidden(decl.cellName, celltype.hiddenRequirePortCount, id));
        }
        for (const portName of decl.inconsistentJoinPorts ?? []) {
          diagnostics.push(joinIndexInconsistent(decl.cellName, portName, id));
        }

        const applyPortLayout = (p: PortTemplate): PortTemplate => {
          // 配列の要素は `名前[添字]` の鍵を先に引き、無ければ名前の鍵（要素共通の旧形式）を使う。
          const saved = layout?.ports?.[portLayoutKey(p)] ?? (p.subscript !== null ? layout?.ports?.[p.name] : undefined);
          return saved ? { ...p, edgeSide: saved.edge, offset: saved.offset } : p;
        };

        // 配列の呼び口を要素へ展開する。固定長 `[N]` はN個、可変長 `[]` は結合で使われた添字の最大値+1個（最低1個）、
        // 保存済み要素数（array_elements）がある場合はそれらとの最大値を採用する。
        const expandCallArrayPort = (p: PortTemplate): PortTemplate[] => {
          const maxJoined = Math.max(
            -1,
            ...decl.joins
              .filter((j) => j.cport === p.name && j.cportIndex !== undefined)
              .map((j) => j.cportIndex!),
          );
          const savedCount = savedElementCounts.get(`${id}\0call\0${p.name}`) ?? 0;
          const count = p.arraySize
            ?? (p.variableArray
              ? Math.max(1, maxJoined + 1, savedCount)
              : null);
          if (count === null) return [p];
          const edgeLength = p.edgeSide === "TOP" || p.edgeSide === "BOTTOM" ? width : height;
          return Array.from({ length: count }, (_, i) => ({
            ...p,
            subscript: i,
            offset: Math.min(edgeLength, alignRound(p.offset + i * ARRAY_ELEMENT_GAP_MM)),
          }));
        };

        // 配列の受け口を要素へ展開する。固定長 `[N]` はN個、可変長 `[]` は参照された結合添字の最大値+1個（最低1個）、
        // 保存済み要素数（array_elements）がある場合はそれらとの最大値を採用する。
        const expandEntryArrayPort = (p: PortTemplate): PortTemplate[] => {
          const maxJoined = maxEportIndices.get(`${id}\0${p.name}`) ?? -1;
          const savedCount = savedElementCounts.get(`${id}\0entry\0${p.name}`) ?? 0;
          const count = p.arraySize
            ?? (p.variableArray
              ? Math.max(1, maxJoined + 1, savedCount)
              : null);
          if (count === null) return [p];
          const edgeLength = p.edgeSide === "TOP" || p.edgeSide === "BOTTOM" ? width : height;
          return Array.from({ length: count }, (_, i) => ({
            ...p,
            subscript: i,
            offset: Math.min(edgeLength, alignRound(p.offset + i * ARRAY_ELEMENT_GAP_MM)),
          }));
        };

        const cports = celltype.cportTemplates.flatMap(expandCallArrayPort).map((p) => {
          const t = applyPortLayout(p);
          return CPort.create({
            name: t.name,
            signature: t.signature,
            edgeSide: t.edgeSide,
            offset: t.offset,
            subscript: t.subscript,
            arraySize: t.arraySize,
          });
        });
        const eports = celltype.eportTemplates.flatMap(expandEntryArrayPort).map((p) => {
          const t = applyPortLayout(p);
          return EPort.create({
            name: t.name,
            signature: t.signature,
            edgeSide: t.edgeSide,
            offset: t.offset,
            subscript: t.subscript,
            arraySize: t.arraySize,
          });
        });

        cells.set(
          id,
          Cell.create({
            id,
            name: decl.cellName,
            celltypeName: celltype.name,
            x,
            y,
            width,
            height,
          regionId: asRegionId(regionPath),
            editable: src.editable,
            systemDefined: src.systemDefined,
            cports,
            eports,
            attrs,
            celltypeUnresolved: false,
            locale: src.sourcePath ?? src.fileName,
          }),
        );
      }
    }

    // --- 結合（2周目: 全セルが揃ってから解決） ---
    const joins = new Map<JoinId, Join>();
    // 結合先の解決（tecsgen の名前解決に倣う）。`::N::c` は絶対、`N::c` と `c` は呼び元の名前空間から外側へ探す。
    // 外側で見つからなくても、同名のセルが1つだけで修飾が末尾一致するなら受ける（従来の寛容な挙動を保つ）。
    const cellsByName = new Map<string, Cell[]>();
    for (const cell of cells.values()) cellsByName.set(cell.name, [...(cellsByName.get(cell.name) ?? []), cell]);
    const namespaceOfCell = (cell: Cell): string => cellNamespaces.get(cell.id) ?? "::";
    const resolveTargetCell = (raw: string, fromNamespace: string): Cell | undefined => {
      const absolute = raw.startsWith("::");
      const parts = raw.replace(/^::/, "").split("::");
      const candidates = cellsByName.get(parts.pop()!) ?? [];
      if (candidates.length === 0) return undefined;
      const prefix = parts.length > 0 ? `::${parts.join("::")}` : "::";
      if (absolute) return candidates.find((c) => namespaceOfCell(c) === prefix);
      const within = (scope: string): string => (scope === "::" ? prefix : prefix === "::" ? scope : `${scope}${prefix}`);
      for (let scope = fromNamespace; ; ) {
        const found = candidates.find((c) => namespaceOfCell(c) === within(scope));
        if (found) return found;
        if (scope === "::") break;
        const separator = scope.lastIndexOf("::");
        scope = separator === 0 ? "::" : scope.slice(0, separator);
      }
      const only = candidates.length === 1 ? candidates[0]! : undefined;
      return only && (prefix === "::" || namespaceOfCell(only).endsWith(prefix)) ? only : undefined;
    };
    for (const src of selectedSources) {
      for (const decl of src.cells) {
        const sourceCell = cells.get(idFor(decl.regionPath, decl.cellName));
        if (!sourceCell) continue;
        for (const j of decl.joins) {
          // 添字の形が揃わず添字を持たない結合は、`W-JOIN-INDEX-INCONSISTENT`で知らせ済み。解決は試みない。
          if (j.subscriptOmitted && j.cportIndex === undefined) continue;
          const jid = asJoinId(`${sourceCell.id}.${j.cport}${j.cportIndex !== undefined ? `[${j.cportIndex}]` : ""}`);
          const cport = sourceCell.cports.find((p) => p.name === j.cport && p.subscript === (j.cportIndex ?? null));
          const targetCell = resolveTargetCell(j.targetCell, namespaceOfCell(sourceCell));

          let eport: EPort | undefined;
          if (j.eportSubscriptInvalid !== undefined) {
            eport = undefined;
          } else {
            const wantEportSubscript = j.eportIndex ?? null;
            eport = targetCell?.eports.find((p) => p.name === j.eport && p.subscript === wantEportSubscript);
          }

          if (!cport || !targetCell || !eport) {
            diagnostics.push(missingJoinTarget(decl.cellName, j.cport, sourceCell.id));
            continue;
          }

          const savedBars = (layoutsBySource.get(src.sourcePath ?? src.fileName) ?? tecscdeParsed).joinList[jid as unknown as string]?.bars;
          const bars: readonly Bar[] = savedBars
            ? savedBars.map((b) => ({ direction: b.dir, fixed: b.fixed, from: b.from, to: b.to }))
            : autoRouteBars(
                portPosition(sourceCell, cport),
                cport.edgeSide,
                portPosition(targetCell, eport),
                eport.edgeSide,
                [...cells.values()], // 外部仕様7.3.2: 保存済みの経路が無い結合は、他のセルを避ける
              );

          const join = Join.create(
            jid, sourceCell.id, cport, targetCell.id, eport, bars,
            j.targetCell.includes("::") ? j.targetCell : undefined,
          );
          joins.set(jid, join);

          const updatedSource = cells.get(sourceCell.id);
          if (updatedSource) {
            cells.set(sourceCell.id, updatedSource.withCPort(cport.withJoin(jid)));
          }
          const updatedTarget = cells.get(targetCell.id);
          if (updatedTarget) {
            const currentEport = updatedTarget.findEPort(eport.name, eport.subscript) ?? eport;
            cells.set(targetCell.id, updatedTarget.withEPort(currentEport.withJoin(jid)));
          }
        }
      }
    }

    for (const [sourceKey, template] of sourceTemplates) {
      const updated = {
        ...template,
        cells: template.cells.map((cell) => ({
          ...cell,
          joins: cell.joins?.filter((join) => !joins.has(asJoinId(
            `${idFor(cell.regionPath, cell.cellName)}.${join.cport}${join.cportIndex !== undefined ? `[${join.cportIndex}]` : ""}`,
          ))),
        })),
      };
      sourceTemplates.set(sourceKey, updated);
      if (sourceTemplate === template) sourceTemplate = updated;
    }

    const referenceFiles = sources.filter((source) => source !== primarySource && !source.generated).map((source) => source.fileName);

    const document = TecscdeDocument.build({
      cells,
      joins,
      celltypes,
      regions: buildRegionTree(regionPaths, cells),
      toolInfoTecsgen,
      paper,
      referenceFiles,
      editingFileName: primarySource ? sourceKey(primarySource) : undefined,
      primarySourceKey: primarySource ? sourceKey(primarySource) : null,
      sourceOrder,
      unknownToolInfoTecscde: primarySource ? layoutsBySource.get(sourceKey(primarySource))?.unknownFields ?? {} : {},
      preservedImports,
      sourceTemplate,
      sourceTemplates,
    });

    return { document, diagnostics, portTypeIndex: { signatures: signatureTypes, ports: portTypes } };
  }

  /** 単一ファイル読み込みの簡便ラッパ（テスト・新規作成後の1ファイル読込用）。 */
  static loadSingle(text: string, fileName: string, editable = true): LoadResult {
    return CdlDocumentLoader.loadSources([{ text, fileName, editable }], { primarySourceKey: fileName });
  }
}
