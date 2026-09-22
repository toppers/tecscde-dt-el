// [[TECSCDE-DT-EL内部仕様]] 第7D章7.5.1・7.5.4節・第7E章7.5.4節 — import/import_C文の
// 参照先を再帰的に解決するrenderer側オーケストレーション。モジュールB（cdl/cst.ts）は
// import/import_C文をすでに解析済み（ParsedCdl.imports）——ここでは新しい解析を行わず、
// その出力をFileGateway.resolveImports()（main側のファイルI/O）へつなぐだけ。

import { ToolInfoValidator } from "../cdl/tool-info";
import { CdlDocumentBuilder, type ImportDecl } from "../cdl/cst";
import { unresolvedReferenceFile } from "../cdl/messages";
import { emptyToolInfoTecsgen, type ToolInfoTecsgen } from "../model/tool-info-types";
import type { FileGateway } from "../gateways/file-gateway";
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
 * 編集対象ファイルの`import`/`import_C`を推移的に解決する。
 * `import_C`は再帰しない——Cヘッダ自身はCDLの`import`文を持たず、内容の扱いは
 * 第9章9.6節（Cプリプロセッサ実行／フォールバック、`CdeclExtractor`は未実装）へ委ねる。
 * `import_C`の解決結果は`references`に含めない（第7E章7.5.5節）——図には現れないCヘッダを
 * 参照ファイル一覧に混ぜないため。
 */
export async function resolveAllImports(
  gateway: FileGateway,
  editablePath: string,
  editableText: string,
  toolInfo: ToolInfoTecsgen,
): Promise<{ references: OpenFileEntry[]; diagnostics: Diagnostic[] }> {
  const options: ImportResolutionOptions = { baseDir: toolInfo.baseDir, importPaths: toolInfo.importPath ?? ["."] };
  // editablePath自身で種付けする——自己importの循環（A自身への参照）を防ぐ（第7D章7.5.4節）。
  const resolvedPaths = new Set<string>([editablePath]);
  const extraSearchDirs: string[] = []; // 第7D章7.5.3節: 解決が進むごとに成長する
  const references: OpenFileEntry[] = [];
  const diagnostics: Diagnostic[] = [];

  let frontier = extractImportRequests(editableText);
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

      if (r.request.kind === "import") {
        references.push({ path: r.canonicalPath, content: r.content! });
        nextFrontier.push(...extractImportRequests(r.content!)); // 推移的closure
      }
      // kind === "import_C": ここでは解決の成否のみ確定する（上記の理由でreferences対象外）。
    }
    frontier = nextFrontier;
  }
  return { references, diagnostics };
}
