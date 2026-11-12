// [[TECSCDE-DT-EL内部仕様]] 第7D章7.5.1・7.5.4節・第7E章7.5.4節 — import/import_C文の
// 参照先を再帰的に解決するrenderer側オーケストレーション。モジュールB（cdl/cst.ts）は
// import/import_C文をすでに解析済み（ParsedCdl.imports）——ここでは新しい解析を行わず、
// その出力をFileGateway.resolveImports()（main側のファイルI/O）へつなぐだけ。

import { ToolInfoValidator } from "../cdl/tool-info";
import { CdlDocumentBuilder, type ImportDecl } from "../cdl/cst";
import { cdeclParseError, cppFallback, unresolvedReferenceFile, type CppFallbackOptions } from "../cdl/messages";
import { emptyToolInfoTecsgen, type ToolInfoTecsgen } from "../model/tool-info-types";
import type { FileGateway } from "../gateways/file-gateway";
import type { TecsgenGateway } from "../gateways/tecsgen-gateway";
import { CdeclExtractor, type CdeclResult } from "../cdecl/extractor";
import type {
  ImportRequest,
  ImportResolutionOptions,
  OpenFileEntry,
  ResolvedImport,
} from "../../shared/ipc-types.js";
import type { Diagnostic } from "../diagnostics/types";
import { normalizePathForCompare } from "../../shared/path-under";

function toImportRequest(decl: ImportDecl): ImportRequest {
  return { kind: decl.kind, specifier: decl.path };
}

/** 第7D章7.5.1節: モジュールBの既存出力（ParsedCdl.imports）を取り出すだけ。新しい解析は行わない。 */
function extractImportRequests(text: string): readonly ImportRequest[] {
  const { sourceWithBlanks } = ToolInfoValidator.extractBlocks(text);
  return CdlDocumentBuilder.build(sourceWithBlanks).imports.map(toImportRequest);
}

/** 第7D章7.5.2節: __tool_info__("tecsgen")のbaseDir/importPath/cppを取り出す。ブロックが無ければ既定値。 */
export function extractToolInfoTecsgen(text: string): ToolInfoTecsgen {
  const { blocks } = ToolInfoValidator.extractBlocks(text);
  const block = blocks.find((b) => b.toolName === "tecsgen");
  return block ? ToolInfoValidator.parseTecsgen(block.json) : emptyToolInfoTecsgen();
}

/** `path/to/foo.cdl` → foo.cdlを除いたディレクトリ部分（rendererにはnode:pathが無いので自前）。 */
function dirnameOf(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index < 0) return "";
  if (index === 0 || (index === 2 && /^[A-Za-z]:/.test(path))) return path.slice(0, index + 1);
  return path.slice(0, index);
}

/** Compare canonical identities without turning a relative specifier into a source key. */
function sourceKey(path: string): string {
  const windows = /^[A-Za-z]:|^[\\/]{2}/.test(path);
  const normalized = normalizePathForCompare(path);
  return windows ? "windows:" + normalized.toLowerCase() : "posix:" + normalized;
}
const absolutePath = (path: string): boolean => /^(?:[A-Za-z]:[\\/]|[\\/])/.test(path);

/**
 * 第9章9.6節・[[work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 09B CdeclExtractor設計|9B章]]:
 * `import_C`で参照されたCヘッダの生テキストを、Cプリプロセッサ経由（成功時）または
 * 未展開のまま（フォールバック時）で`CdeclExtractor`へ渡す。プリプロセッサが見つからない
 * ・失敗した場合はフォールバックした事実を診断として報告する。
 */
async function ingestImportC(
  tecsgenGateway: TecsgenGateway,
  canonicalPath: string,
  rawContent: string,
  cppCommand: string | undefined,
  includeDirs: readonly string[],
  diagnostics: Diagnostic[],
): Promise<CdeclResult> {
  const cpp = await tecsgenGateway.preprocess(canonicalPath, cppCommand, includeDirs);
  const usedFallback = !cpp.executableFound || cpp.exitCode !== 0;
  const text = usedFallback ? rawContent : cpp.stdout;
  if (usedFallback) {
    let failureDetail = cpp.failureDetail;
    if (!failureDetail && cpp.exitCode !== null && cpp.exitCode !== 0) {
      const trimmedStderr = cpp.stderr?.trim();
      const firstLine = trimmedStderr ? (trimmedStderr.split(/\r?\n/)[0] ?? "").slice(0, 200) : "";
      failureDetail = `終了コード ${cpp.exitCode}${firstLine ? `: ${firstLine}` : ""}`;
    }
    const fallbackOptions: CppFallbackOptions = {
      command: cpp.command ?? cppCommand ?? "gcc",
      originReason: cpp.originReason ?? (cppCommand ? "ユーザ直接指定" : "フォールバック"),
      fullPath: cpp.fullPath ?? (!cpp.executableFound ? (cppCommand ? cppCommand.trim().split(/\s+/)[0] : "未検出 (PATH上)") : undefined),
      failureKind: cpp.failureKind ?? (!cpp.executableFound ? "not-found" : "failed"),
      failureDetail,
    };
    diagnostics.push(cppFallback(canonicalPath, fallbackOptions));
  }

  const result = CdeclExtractor.extract(text);
  if (result.hasErrors) diagnostics.push(cdeclParseError(canonicalPath));
  return { ...result, usedFallback };
}

/**
 * import_Cのヘッダをプリプロセスするときの`-I`に使う探索ディレクトリ。tecsgenの`-I`（import_path）は
 * `.tecsgen-opts`のあるディレクトリ（＝通常は編集対象のあるディレクトリ）と`baseDir`を基点に
 * 解決されるため、その両方を基点に`importPaths`を展開する。存在しないディレクトリはgccが無視する。
 */
function includeDirsFor(editablePath: string, options: ImportResolutionOptions): string[] {
  const bases = [dirnameOf(editablePath), ...(options.baseDir ? [options.baseDir] : [])];
  const dirs = bases.flatMap((base) =>
    options.importPaths.map((importPath) => absolutePath(importPath) ? importPath :
      (importPath === "." ? base : `${base}/${importPath}`)),
  );
  return [...new Set(dirs)];
}

/**
 * `import`/`import_C`/`manual`（第7C章7.7.2節、手動追加）を推移的に解決する共通エンジン。
 * `kind !== "import_C"`のものだけ`references`へ追加し（`import_C`の解決結果は図に現れない
 * Cヘッダのため対象外、第7E章7.5.5節）、`kind`が`"import"`または`"manual"`のものだけ
 * その内容から更なる`import`/`import_C`を辿る（`manual`自身が持つimportも連鎖的に
 * 解決する、第7C章7.7.2節末尾）。`import_C`は`ingestImportC`（9B章）で型を抽出し
 * `cdeclResults`へ蓄積し、呼び出し元（file-actions.ts）がポート型解決に渡す。
 */
async function resolveImportClosure(
  gateway: FileGateway,
  tecsgenGateway: TecsgenGateway,
  editablePath: string,
  toolInfo: ToolInfoTecsgen,
  initialFrontier: readonly ImportRequest[],
  seedResolvedPaths: ReadonlySet<string>,
  existingReferences: readonly OpenFileEntry[] = [],
  systemDirs: readonly string[] = [],
  useManualToolInfo = false,
): Promise<{ references: OpenFileEntry[]; diagnostics: Diagnostic[]; cdeclResults: Map<string, CdeclResult> }> {
  const options: ImportResolutionOptions = { baseDir: toolInfo.baseDir, importPaths: toolInfo.importPath ?? ["."],
    ...(systemDirs.length > 0 ? { systemDirs: [...systemDirs] } : {}) };
  const resolvedPaths = new Set([...seedResolvedPaths].map(sourceKey));
  const sourceContexts = new Map<string, ToolInfoTecsgen>();
  const contextFor = (path: string): ToolInfoTecsgen => sourceContexts.get(sourceKey(path)) ?? toolInfo;
  const optionsFor = (path: string): ImportResolutionOptions => {
    const context = contextFor(path);
    return { ...options, baseDir: context.baseDir, importPaths: context.importPath ?? options.importPaths };
  };
  const extraSearchDirs: string[] = []; // 第7D章7.5.3節: 解決が進むごとに成長する
  for (const r of existingReferences) {
    const dir = dirnameOf(r.path);
    if (dir && !extraSearchDirs.includes(dir)) extraSearchDirs.push(dir);
  }
  const references: OpenFileEntry[] = [];
  const diagnostics: Diagnostic[] = [];
  const cdeclResults = new Map<string, CdeclResult>();

  const knownByPath = new Map<string, OpenFileEntry>();
  for (const r of existingReferences) {
    if (!knownByPath.has(sourceKey(r.path))) knownByPath.set(sourceKey(r.path), r);
  }

  type FrontierEntry = { readonly request: ImportRequest; readonly sourcePath: string };
  // Finish a manual root's import closure before considering the next root.
  // A later root may be a descendant already reached with its parent's context.
  const pendingRoots = useManualToolInfo ? [...initialFrontier] : [];
  let frontier: readonly FrontierEntry[] = useManualToolInfo ? [] : initialFrontier.map((request) => ({ request, sourcePath: editablePath }));
  while (frontier.length > 0 || pendingRoots.length > 0) {
    if (frontier.length === 0) frontier = [{ request: pendingRoots.shift()!, sourcePath: editablePath }];
    const resolved: Array<ResolvedImport | undefined> = new Array(frontier.length);
    const groups = new Map<string, { sourcePath: string; requests: ImportRequest[]; indices: number[] }>();
    frontier.forEach(({ request: req, sourcePath }, index) => {
      // Only manual absolute paths identify a source without a search. Every
      // import still passes main's context and directory-list authorization.
      const found = req.kind === "manual" && absolutePath(req.specifier) ? knownByPath.get(sourceKey(req.specifier)) : undefined;
      if (found) {
        resolved[index] = { request: req, canonicalPath: found.path, content: found.content };
      } else {
        const key = sourceKey(sourcePath);
        let group = groups.get(key);
        if (!group) { group = { sourcePath, requests: [], indices: [] }; groups.set(key, group); }
        group.requests.push(req); group.indices.push(index);
      }
    });
    await Promise.all([...groups.values()].map(async (group) => {
      const results = await gateway.resolveImports(group.sourcePath, group.requests, { ...optionsFor(group.sourcePath), extraSearchDirs: [...extraSearchDirs] });
      group.indices.forEach((index, offset) => { resolved[index] = results[offset]; });
    }));
    const nextFrontier: FrontierEntry[] = [];

    for (let index = 0; index < frontier.length; index++) {
      const sourcePath = frontier[index]!.sourcePath;
      const r = resolved[index] ?? { request: frontier[index]!.request, error: "not-found" as const };
      if (r.error || !r.canonicalPath) {
        diagnostics.push(unresolvedReferenceFile(r.request.specifier));
        continue;
      }
      const key = sourceKey(r.canonicalPath);
      if (resolvedPaths.has(key)) continue; // 循環・正規化済みソースの重複
      const existing = knownByPath.get(key);
      const canonicalPath = existing?.path ?? r.canonicalPath;
      const content = existing?.content ?? r.content;
      if (content === undefined) { diagnostics.push(unresolvedReferenceFile(r.request.specifier)); continue; }
      resolvedPaths.add(key);
      const inherited = contextFor(sourcePath);
      const own = useManualToolInfo && r.request.kind === "manual" ? extractToolInfoTecsgen(content) : inherited;
      sourceContexts.set(key, { ...inherited, ...own,
        baseDir: own.baseDir ?? inherited.baseDir, importPath: own.importPath ?? inherited.importPath,
        cpp: own.cpp ?? inherited.cpp, defineMacro: own.defineMacro ?? inherited.defineMacro });
      const dir = dirnameOf(canonicalPath);
      if (!extraSearchDirs.includes(dir)) extraSearchDirs.push(dir); // tecsgenの$base_dir累積に相当

      if (r.request.kind === "import_C") {
        const result = await ingestImportC(tecsgenGateway, canonicalPath, content, inherited.cpp, includeDirsFor(sourcePath, optionsFor(sourcePath)), diagnostics);
        cdeclResults.set(canonicalPath, result);
      } else {
        references.push({ path: canonicalPath, content });
      }
      if (r.request.kind === "import" || r.request.kind === "manual") {
        nextFrontier.push(...extractImportRequests(content).map((request) => ({ request, sourcePath: canonicalPath })));
      }
    }
    frontier = nextFrontier;
  }
  return { references, diagnostics, cdeclResults };
}

/**
 * 編集対象ファイルの`import`/`import_C`を推移的に解決する。
 * `import_C`は再帰しない——Cヘッダ自身はCDLの`import`文を持たず、内容は
 * 第9章9.6節・9B章（Cプリプロセッサ実行／フォールバック、`CdeclExtractor`）で
 * 型を抽出し`cdeclResults`へ積むだけに留める。
 * `extraImportPaths`（第7C章7.7.4節③、#10）は`toolInfo.importPath`の末尾へ連結する——
 * 編集対象自身の`import_path`を先に試し、見つからなければオプションファイル由来を試す
 * という既定順序を保つ。
 */
export async function resolveAllImports(
  gateway: FileGateway,
  tecsgenGateway: TecsgenGateway,
  editablePath: string | null,
  editableText: string,
  toolInfo: ToolInfoTecsgen,
  extraImportPaths: readonly string[] = [],
  existingReferences: readonly OpenFileEntry[] = [],
  systemDirs: readonly string[] = [],
  useManualToolInfo = false,
): Promise<{ references: OpenFileEntry[]; diagnostics: Diagnostic[]; cdeclResults: Map<string, CdeclResult> }> {
  const mergedToolInfo: ToolInfoTecsgen = { ...toolInfo, importPath: [...(toolInfo.importPath ?? ["."]), ...extraImportPaths] };
  // editablePath自身で種付けする——自己importの循環（A自身への参照）を防ぐ（第7D章7.5.4節）。
  return resolveImportClosure(
    gateway,
    tecsgenGateway,
    editablePath ?? "",
    mergedToolInfo,
    [
      ...extractImportRequests(editableText),
      ...existingReferences.map((reference): ImportRequest => ({ kind: "manual", specifier: reference.path })),
    ],
    new Set(editablePath ? [editablePath] : []),
    existingReferences,
    systemDirs,
    useManualToolInfo,
  );
}

/**
 * 第7C章7.7.2節（#8）: ファイルブラウザでCtrl+クリックされたファイルを参照専用として
 * 解決する。`alreadyLoadedPaths`（editable＋既存references）で種付けすることで、
 * 「既に読み込み済みなら無視」という重複判定を自然に実現する——既読み込み済みの場合、
 * 解決結果は空（`references: []`）になる。
 */
export async function resolveAddedReference(
  gateway: FileGateway,
  tecsgenGateway: TecsgenGateway,
  editablePath: string | null,
  toolInfo: ToolInfoTecsgen,
  path: string,
  alreadyLoadedPaths: readonly string[],
  systemDirs: readonly string[] = [],
): Promise<{ references: OpenFileEntry[]; diagnostics: Diagnostic[]; cdeclResults: Map<string, CdeclResult> }> {
  const seed = new Set([...(editablePath ? [editablePath] : []), ...alreadyLoadedPaths]);
  return resolveImportClosure(gateway, tecsgenGateway, editablePath ?? path, toolInfo, [{ kind: "manual", specifier: path }], seed, [], systemDirs, true);
}
