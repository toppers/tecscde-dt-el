// [[TECSCDE-DT-EL内部仕様]] 第7章7.3節 — ファイル操作のユースケース。
// renderer 側の `FileGateway`（IPC 越しの薄いプロキシ）とモジュールB（CDLローダ／
// シリアライザ）を繋ぎ、`AppStore` を更新する。プロセス境界は `FileGateway` の内側に
// 閉じているので、ここからは Promise を返す通常のメソッド呼び出しにしか見えない。

import { CdlDocumentLoader } from "../cdl/document-builder";
import type { CdlSource } from "../cdl/document-builder";
import { CdlSerializer } from "../cdl/serializer";
import { TecsgenCommandBuilder } from "../tecsgen/command-builder";
import { describeLaunchFailure, describeTecsgenFailure } from "../tecsgen/failure-summary";
import type { GeneratedCdlFile, OpenFileEntry, OpenResult } from "../../shared/ipc-types.js";
import type { FileGateway } from "../gateways/file-gateway";
import type { TecsgenGateway } from "../gateways/tecsgen-gateway";
import { TecscdeDocument } from "../model/document";
import { ViewState } from "../view-state/view-state";
import { extractToolInfoTecsgen, resolveAddedReference, resolveAllImports } from "./import-resolution";
import type { AppStore } from "./store";

/** `path/to/foo.cde` → `foo.cde`（renderer には node:path が無いので自前）。 */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** すでに読み込み済みのパス集合（正規化済み絶対パス）と重複しない参照だけを追加する（第7D章7.5節）。 */
function mergeReferences(existing: readonly OpenFileEntry[], discovered: readonly OpenFileEntry[]): OpenFileEntry[] {
  const seen = new Set(existing.map((r) => r.path));
  const merged = [...existing];
  for (const d of discovered) {
    if (seen.has(d.path)) continue;
    seen.add(d.path);
    merged.push(d);
  }
  return merged;
}

/**
 * `OpenResult`（参照ファイル＋編集対象）を `TecscdeDocument` へ組み立て、ストアへ反映する。
 * 第7D・7E章: 編集対象ファイルの`import`/`import_C`文の参照先を`resolveAllImports`で
 * 推移的に解決し、既存の`result.references`（手動指定・前回セッション復元由来）と
 * 正規化済み絶対パスで重複排除して合流させる。
 * `import_C`で抽出した型をCDLローダへ渡し、署名関数の戻り値・引数とポートの型を解決する。
 * 解決結果はストアの読込時情報として保持し、次のファイル読込時に置き換える。
 */
export async function applyOpenResult(
  store: AppStore,
  gateway: FileGateway,
  tecsgenGateway: TecsgenGateway,
  result: OpenResult,
  extraImportPaths: readonly string[] = result.extraImportPaths ?? [],
): Promise<void> {
  const toolInfo = extractToolInfoTecsgen(result.editable.content);
  const { references: autoReferences, diagnostics: importDiagnostics, cdeclResults } = await resolveAllImports(
    gateway,
    tecsgenGateway,
    result.editable.path,
    result.editable.content,
    toolInfo,
    extraImportPaths,
    result.references,
    result.systemDirs ?? [],
  );
  const references = mergeReferences(result.references, autoReferences);

  let generatedTypeSources: readonly GeneratedCdlFile[] = [];
  const pluginDiagnostics: Array<{ severity: "warning"; code: string; message: string }> = [];
  if (typeof tecsgenGateway.generatedTypes === "function") {
    const args = TecsgenCommandBuilder.buildArgs({
      importPath: [...(toolInfo.importPath ?? []), ...extraImportPaths],
      defineMacro: toolInfo.defineMacro,
      cpp: toolInfo.cpp,
      referenceFilePaths: references.map((reference) => reference.path),
      editingFilePath: result.editable.path,
    });
    try {
      const generated = await tecsgenGateway.generatedTypes(args, result.editable.path, result.optionsFilePath);
      const failure = generated.result.launchFailure ??
        (generated.result.executableFound ? undefined : { kind: "not-found" as const, command: "tecsgen", detail: "ENOENT" });
      if (failure) throw new Error(describeLaunchFailure(failure));
      if (generated.result.exitCode !== 0) {
        throw new Error(describeTecsgenFailure(generated.result));
      }
      generatedTypeSources = generated.sources;
    } catch (error) {
      pluginDiagnostics.push({
        severity: "warning",
        code: "W-PLUGIN-TYPE-LOAD",
        message: `Plugin生成型を読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const sources: CdlSource[] = [
    ...references.map((r) => ({ text: r.content, fileName: baseName(r.path), sourcePath: r.path, editable: true })),
    { text: result.editable.content, fileName: baseName(result.editable.path), sourcePath: result.editable.path, editable: true },
    ...generatedTypeSources.map((source) => ({
      text: source.content, fileName: `plugin:${source.fileName}`, editable: false, generated: true,
    })),
  ];
  const systemDirs = result.systemDirs ?? [];
  const { document, diagnostics, portTypeIndex } = CdlDocumentLoader.loadSources(sources, {
    cdeclResults, systemDirs, allowEditSystemDefined: store.getAllowEditSystemDefined(),
  });
  const referenceFilePaths = references.map((r) => r.path);
  const referenceSources = new Map(references.map((r) => [r.path, r.content]));
  store.loadDocument(
    document,
    result.editable.path,
    [...importDiagnostics, ...pluginDiagnostics, ...diagnostics],
    referenceFilePaths,
    referenceSources,
    extraImportPaths,
    result.optionsFilePath,
    generatedTypeSources,
    portTypeIndex,
    false,
    systemDirs,
  );
  // 読み込み直後は図の中心を表示中心にしておく（panCenter 初期値 {0,0} だと左上寄り）。
  const { width, height } = document.paper.contentSize();
  store.setView(ViewState.initial().panTo({ x: width / 2, y: height / 2 }));
}

/**
 * 7.6.5節（2026-09-21）: ツールバーから編集対象を選ぶ唯一の経路——ファイルブラウザの
 * クリックから、ダイアログを介さずパス指定で開く。当初は`openViaDialog`（ダイアログ経由の
 * 単一/複数ファイル選択）も並行提供していたが、実機確認でファイルブラウザとの入口重複が
 * 利用者を混乱させると判明し撤回した（[[TECSCDE-DT外部仕様]]5.3節）。
 * 7B章7.6.4節（2026-09-22）: 未保存の変更がある場合は破棄確認を挟む
 * （[[TECSCDE-DT外部仕様]]5.7節）。未保存でなければ確認を出さずそのまま開く。
 */
export async function openFromPath(
  store: AppStore,
  gateway: FileGateway,
  tecsgenGateway: TecsgenGateway,
  path: string,
  options: { extraImportPaths?: readonly string[]; optionsFilePath?: string } = {},
): Promise<void> {
  if (store.isDirty()) {
    const proceed = await gateway.confirmDiscardChanges();
    if (!proceed) return;
  }
  const result = await gateway.openPath(path);
  await applyOpenResult(
    store, gateway, tecsgenGateway,
    options.optionsFilePath ? { ...result, optionsFilePath: options.optionsFilePath } : result,
    options.extraImportPaths,
  );
  // 第7C章7.7.1節: 編集対象が変化するたびに前回セッションを保存する。
  await gateway.saveSession(store.filePath, store.getReferenceFilePaths(), store.getExtraImportPaths(), store.getOptionsFilePath());
}

/**
 * 第7C章7.7.3節（#9・消去ボタン）: [[TECSCDE-DT外部仕様]]5.2節「新規作成」の別名として設計。
 * references集合・ファイルブラウザの展開状態は維持する——消去は編集対象(editable)のみを
 * 空にする操作であり、参照ファイル一覧はアプリケーション実行中の状態として維持する
 * （FileBrowserViewの展開状態は本関数と結線されていないため自然に維持される）。
 */
export async function newDocument(store: AppStore, gateway: FileGateway): Promise<void> {
  if (store.isDirty()) {
    const proceed = await gateway.confirmDiscardChanges();
    if (!proceed) return;
  }
  const referenceFilePaths = store.getReferenceFilePaths();
  const referenceSources = store.getReferenceSources(); // #8: 消去後もaddAsReferenceが使えるよう維持する
  const document = TecscdeDocument.empty();
  store.loadDocument(document, null, [], referenceFilePaths, referenceSources, []);
  // openFromPath/applyOpenResultと同じく、読み込み直後は表示中心を図の中心に戻す。
  const { width, height } = document.paper.contentSize();
  store.setView(ViewState.initial().panTo({ x: width / 2, y: height / 2 }));
  // 7.7.1節: editablePathは無し（未保存の新規作成はセッション復元の対象外）、
  // references集合は維持されたまま保存する。
  await gateway.saveSession(null, referenceFilePaths, []);
}

/** Add a CDL selected in the file browser to the editable, jointly loaded files. */
export async function addAsReference(
  store: AppStore,
  gateway: FileGateway,
  tecsgenGateway: TecsgenGateway,
  path: string,
): Promise<void> {
  const editablePath = store.filePath;
  if (!editablePath) return; // 消去直後など編集対象未確定では参照追加の起点が無い
  const existingPaths = store.getReferenceFilePaths();
  if (path === editablePath || existingPaths.includes(path)) return;

  const toolInfo = store.getDocument().toolInfoTecsgen;
  const extraImportPaths = store.getExtraImportPaths();
  const mergedToolInfo = { ...toolInfo, importPath: [...(toolInfo.importPath ?? ["."]), ...extraImportPaths] };
  const { references: discovered, diagnostics: importDiagnostics } = await resolveAddedReference(
    gateway,
    tecsgenGateway,
    editablePath,
    mergedToolInfo,
    path,
    existingPaths,
    store.getSystemDirs(),
  );
  if (discovered.length === 0) return; // 重複（種付けにより検出）または解決失敗

  const keepDirty = store.isDirty();
  const mergedSources = new Map(store.getReferenceSources());
  for (const referencePath of store.getReferenceFilePaths()) {
    // 閲覧のみのシステム定義CDLはテンプレートを持たない（書き戻さない）ので、読み込んだ原文をそのまま使う。
    if (!store.getDocument().sourceTemplates.has(referencePath)) continue;
    mergedSources.set(referencePath, CdlSerializer.serializeSource(store.getDocument(), referencePath));
  }
  for (const r of discovered) mergedSources.set(r.path, r.content);

  const editableText = CdlSerializer.serialize(store.getDocument()); // 未保存の変更を含む現在の内容
  const allReferences = [...mergedSources.entries()].map(([referencePath, content]) => ({ path: referencePath, content }));
  const { diagnostics: allImportDiagnostics, cdeclResults } = await resolveAllImports(
    gateway, tecsgenGateway, editablePath, editableText, toolInfo, extraImportPaths, allReferences, store.getSystemDirs(),
  );
  const sources: CdlSource[] = [
    ...[...mergedSources.entries()].map(([p, text]) => ({ text, fileName: baseName(p), sourcePath: p, editable: true })),
    { text: editableText, fileName: baseName(editablePath), sourcePath: editablePath, editable: true },
    ...store.getGeneratedTypeSources().map((source) => ({
      text: source.content, fileName: `plugin:${source.fileName}`, editable: false, generated: true,
    })),
  ];
  const { document, diagnostics, portTypeIndex } = CdlDocumentLoader.loadSources(sources, {
    cdeclResults, systemDirs: store.getSystemDirs(), allowEditSystemDefined: store.getAllowEditSystemDefined(),
  });
  store.loadDocument(
    document,
    editablePath,
    [...allImportDiagnostics, ...importDiagnostics.filter((first) =>
      !allImportDiagnostics.some((later) => first.code === later.code && first.message === later.message)
    ), ...diagnostics],
    [...mergedSources.keys()],
    mergedSources,
    extraImportPaths,
    store.getOptionsFilePath(),
    store.getGeneratedTypeSources(),
    portTypeIndex,
    keepDirty,
    store.getSystemDirs(),
  );
  const { width, height } = document.paper.contentSize();
  store.setView(ViewState.initial().panTo({ x: width / 2, y: height / 2 }));
  await gateway.saveSession(store.filePath, store.getReferenceFilePaths(), store.getExtraImportPaths(), store.getOptionsFilePath());
}

/** Open every CDL listed by tecsgen options as editable, with the last file as primary. */
export async function loadOptionsFile(
  store: AppStore,
  gateway: FileGateway,
  tecsgenGateway: TecsgenGateway,
  path: string,
): Promise<void> {
  const parsed = await gateway.parseTecsgenOptionsFile(path);
  if (parsed.cdlFiles.length === 0) return;
  if (store.isDirty() && !await gateway.confirmDiscardChanges()) return;
  const opened = await Promise.all(parsed.cdlFiles.map(async (filePath) => (await gateway.openPath(filePath)).editable));
  const editable = opened[opened.length - 1]!;
  const references = opened.slice(0, -1);
  await applyOpenResult(store, gateway, tecsgenGateway, {
    editable,
    references,
    extraImportPaths: parsed.importPaths,
    optionsFilePath: path,
    ...(parsed.systemDirs.length > 0 ? { systemDirs: parsed.systemDirs } : {}),
  });
  await gateway.saveSession(store.filePath, store.getReferenceFilePaths(), store.getExtraImportPaths(), store.getOptionsFilePath());
}

/** ［保存］: 既存パスがあれば上書き、無ければ［名前を付けて保存］へ委譲。 */
export async function save(store: AppStore, gateway: FileGateway): Promise<void> {
  // 第3章3.2節: 主ファイルがシステム定義ディレクトリ配下で閲覧のみのときは保存しない。
  if (store.isEditingFileReadOnlySystemDefined()) return;
  const path = store.filePath;
  if (!path) {
    await saveAs(store, gateway);
    return;
  }
  const document = store.getDocument();
  for (const referencePath of store.getReferenceFilePaths()) {
    if (!store.isSourceDirty(referencePath)) continue;
    await gateway.save(referencePath, CdlSerializer.serializeSource(document, referencePath));
  }
  const text = CdlSerializer.serialize(document);
  await gateway.save(path, text);
  store.markSaved(path);
  await gateway.saveSession?.(store.filePath, store.getReferenceFilePaths(), store.getExtraImportPaths(), store.getOptionsFilePath());
}

/** ［名前を付けて保存］: 保存ダイアログを開く。キャンセル時は何もしない。 */
export async function saveAs(store: AppStore, gateway: FileGateway): Promise<void> {
  if (store.isEditingFileReadOnlySystemDefined()) return; // save()と同じ理由
  const document = store.getDocument();
  const text = CdlSerializer.serialize(document);
  const suggested = store.filePath ? baseName(store.filePath) : "untitled.cde";
  const savedPath = await gateway.saveAs(text, suggested);
  if (savedPath) {
    for (const referencePath of store.getReferenceFilePaths()) {
      if (!store.isSourceDirty(referencePath)) continue;
      await gateway.save(referencePath, CdlSerializer.serializeSource(document, referencePath));
    }
    store.markSaved(savedPath);
    await gateway.saveSession?.(store.filePath, store.getReferenceFilePaths(), store.getExtraImportPaths(), store.getOptionsFilePath());
  }
}
