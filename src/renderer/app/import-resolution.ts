// [[TECSCDE-DT-EL内部仕様]] 第7D章7.5.1・7.5.4節・第7E章7.5.4節 — import/import_C文の
// 参照先を再帰的に解決するrenderer側オーケストレーション。モジュールB（cdl/cst.ts）は
// import/import_C文をすでに解析済み（ParsedCdl.imports）——ここでは新しい解析を行わず、
// その出力をFileGateway.resolveImports()（main側のファイルI/O）へつなぐだけ。

import { ToolInfoValidator } from "../cdl/tool-info";
import { CdlDocumentBuilder, type ImportDecl } from "../cdl/cst";
import { cdeclParseError, cppFallback, unresolvedReferenceFile } from "../cdl/messages";
import { emptyToolInfoTecsgen, type ToolInfoTecsgen } from "../model/tool-info-types";
import type { FileGateway } from "../gateways/file-gateway";
import type { TecsgenGateway } from "../gateways/tecsgen-gateway";
import { CdeclExtractor, type CdeclResult } from "../cdecl/extractor";
import type { ImportRequest, ImportResolutionOptions, OpenFileEntry } from "../../shared/ipc-types.js";
import type { Diagnostic } from "../diagnostics/types";

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
  return path.replace(/[\\/][^\\/]*$/, "");
}

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
  diagnostics: Diagnostic[],
): Promise<CdeclResult> {
  const cpp = await tecsgenGateway.preprocess(canonicalPath, cppCommand);
  const usedFallback = !cpp.executableFound || cpp.exitCode !== 0;
  const text = usedFallback ? rawContent : cpp.stdout;
  if (usedFallback) diagnostics.push(cppFallback(canonicalPath));

  const result = CdeclExtractor.extract(text);
  if (result.hasErrors) diagnostics.push(cdeclParseError(canonicalPath));
  return result;
}

/**
 * `import`/`import_C`/`manual`（第7C章7.7.2節、手動追加）を推移的に解決する共通エンジン。
 * `kind !== "import_C"`のものだけ`references`へ追加し（`import_C`の解決結果は図に現れない
 * Cヘッダのため対象外、第7E章7.5.5節）、`kind`が`"import"`または`"manual"`のものだけ
 * その内容から更なる`import`/`import_C`を辿る（`manual`自身が持つimportも連鎖的に
 * 解決する、第7C章7.7.2節末尾）。`import_C`は`ingestImportC`（9B章）で型を抽出し
 * `cdeclResults`へ蓄積する——このマップを実際にポート型解決へつなぐ設計は9B章9B.2の
 * 範囲外のまま、呼び出し元（file-actions.ts）へそのまま返すだけに留める。
 */
async function resolveImportClosure(
  gateway: FileGateway,
  tecsgenGateway: TecsgenGateway,
  editablePath: string,
  toolInfo: ToolInfoTecsgen,
  initialFrontier: readonly ImportRequest[],
  seedResolvedPaths: ReadonlySet<string>,
): Promise<{ references: OpenFileEntry[]; diagnostics: Diagnostic[]; cdeclResults: Map<string, CdeclResult> }> {
  const options: ImportResolutionOptions = { baseDir: toolInfo.baseDir, importPaths: toolInfo.importPath ?? ["."] };
  const resolvedPaths = new Set(seedResolvedPaths);
  const extraSearchDirs: string[] = []; // 第7D章7.5.3節: 解決が進むごとに成長する
  const references: OpenFileEntry[] = [];
  const diagnostics: Diagnostic[] = [];
  const cdeclResults = new Map<string, CdeclResult>();

  let frontier = initialFrontier;
  while (frontier.length > 0) {
    // extraSearchDirsは以後の周回でも書き換えられる可変配列のため、呼び出しごとに
    // その時点のスナップショットを渡す（呼び出し側に配列の参照を握らせない）。
    const resolved = await gateway.resolveImports(editablePath, frontier, { ...options, extraSearchDirs: [...extraSearchDirs] });
    const nextFrontier: ImportRequest[] = [];

    for (const r of resolved) {
      if (r.error || !r.canonicalPath) {
        diagnostics.push(unresolvedReferenceFile(r.request.specifier));
        continue;
      }
      if (resolvedPaths.has(r.canonicalPath)) continue; // 循環・重複
      resolvedPaths.add(r.canonicalPath);
      const dir = dirnameOf(r.canonicalPath);
      if (!extraSearchDirs.includes(dir)) extraSearchDirs.push(dir); // tecsgenの$base_dir累積に相当

      if (r.request.kind === "import_C") {
        const result = await ingestImportC(tecsgenGateway, r.canonicalPath, r.content!, toolInfo.cpp, diagnostics);
        cdeclResults.set(r.canonicalPath, result);
      } else {
        references.push({ path: r.canonicalPath, content: r.content! });
      }
      if (r.request.kind === "import" || r.request.kind === "manual") {
        nextFrontier.push(...extractImportRequests(r.content!)); // 推移的closure
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
  editablePath: string,
  editableText: string,
  toolInfo: ToolInfoTecsgen,
  extraImportPaths: readonly string[] = [],
): Promise<{ references: OpenFileEntry[]; diagnostics: Diagnostic[]; cdeclResults: Map<string, CdeclResult> }> {
  const mergedToolInfo: ToolInfoTecsgen = { ...toolInfo, importPath: [...(toolInfo.importPath ?? ["."]), ...extraImportPaths] };
  // editablePath自身で種付けする——自己importの循環（A自身への参照）を防ぐ（第7D章7.5.4節）。
  return resolveImportClosure(
    gateway,
    tecsgenGateway,
    editablePath,
    mergedToolInfo,
    extractImportRequests(editableText),
    new Set([editablePath]),
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
  editablePath: string,
  toolInfo: ToolInfoTecsgen,
  path: string,
  alreadyLoadedPaths: readonly string[],
): Promise<{ references: OpenFileEntry[]; diagnostics: Diagnostic[]; cdeclResults: Map<string, CdeclResult> }> {
  const seed = new Set([editablePath, ...alreadyLoadedPaths]);
  return resolveImportClosure(gateway, tecsgenGateway, editablePath, toolInfo, [{ kind: "manual", specifier: path }], seed);
}
