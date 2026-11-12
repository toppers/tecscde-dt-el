// [[TECSCDE-DT-EL内部仕様]] 第7章7.3節 — ファイル操作のユースケース。
// renderer 側の `FileGateway`（IPC 越しの薄いプロキシ）とモジュールB（CDLローダ／
// シリアライザ）を繋ぎ、`AppStore` を更新する。プロセス境界は `FileGateway` の内側に
// 閉じているので、ここからは Promise を返す通常のメソッド呼び出しにしか見えない。

import { CdlDocumentLoader } from "../cdl/document-builder";
import type { CdlSource } from "../cdl/document-builder";
import { CdlSerializer } from "../cdl/serializer";
import { W_CODES } from "../cdl/messages";
import { TecsgenCommandBuilder } from "../tecsgen/command-builder";
import { describeLaunchFailure, describeTecsgenFailure } from "../tecsgen/failure-summary";
import type { GeneratedCdlFile, OpenFileEntry, OpenResult } from "../../shared/ipc-types.js";
import type { FileGateway } from "../gateways/file-gateway";
import type { TecsgenGateway } from "../gateways/tecsgen-gateway";
import { TecscdeDocument } from "../model/document";
import { cascadeDeleteCell } from "../commands/support";
import { Cell } from "../model/cell";
import { ViewState } from "../view-state/view-state";
import { extractToolInfoTecsgen, resolveAddedReference, resolveAllImports } from "./import-resolution";
import type { AppStore, LoadGuard } from "./store";

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
  guard: LoadGuard = store.beginLoad(),
): Promise<boolean> {
  if (!await store.canApplyLoad(guard) || !store.isLoadCurrent(guard)) return false;
  const contextPaths = extraImportPaths.map((path) =>
    result.optionsFilePath && !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(path)
      ? `${result.optionsFilePath.replace(/[\\/][^\\/]*$/, "")}/${path}` : path);
  const toolInfo = extractToolInfoTecsgen(result.editable.content);
  const { references: autoReferences, diagnostics: importDiagnostics, cdeclResults } = await resolveAllImports(
    gateway,
    tecsgenGateway,
    result.editable.path,
    result.editable.content,
    toolInfo,
    contextPaths,
    result.references,
    result.systemDirs ?? [],
  );
  const references = mergeReferences(result.references, autoReferences);

  let generatedTypeSources: readonly GeneratedCdlFile[] = [];
  const pluginDiagnostics: Array<{ severity: "warning"; code: string; message: string }> = [];
  if (result.editable.path && typeof tecsgenGateway.generatedTypes === "function") {
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

  const primary = result.primarySourceKey === undefined ? result.editable.path : result.primarySourceKey;
  const ordinary = result.sources ?? [...result.references, ...(primary ? [result.editable] : [])];
  const byPath = new Map([...ordinary, ...references].map((entry) => [entry.path, entry]));
  const order = [...new Set([...(result.sourceOrder ?? ordinary.map((entry) => entry.path)), ...byPath.keys()])];
  const sources: CdlSource[] = [
    ...order.map((path) => byPath.get(path)!).map((r) => ({ text: r.content, fileName: baseName(r.path), sourcePath: r.path, editable: true })),
    ...generatedTypeSources.map((source) => ({
      text: source.content, fileName: `plugin:${source.fileName}`, editable: false, generated: true,
    })),
  ];
  const systemDirs = result.systemDirs ?? [];
  const { document, diagnostics, portTypeIndex } = CdlDocumentLoader.loadSources(sources, {
    cdeclResults, systemDirs, allowEditSystemDefined: store.getAllowEditSystemDefined(), primarySourceKey: primary,
  });
  const referenceFilePaths = order.filter((path) => path !== primary);
  const referenceSources = new Map(references.map((r) => [r.path, r.content]));
  if (!await store.canApplyLoad(guard) || !store.isLoadCurrent(guard)) return false;
  store.loadDocument(
    document,
    primary,
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
  const snapshot = store.getSessionSnapshot();
  await gateway.saveSession?.(snapshot);
  return true;
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
  const guard = store.beginLoad();
  try {
    if (store.isClosing && !await store.canApplyLoad(guard)) return;
    if (store.isDirty()) {
      const proceed = await gateway.confirmDiscardChanges();
      if (!proceed || !await store.canApplyLoad(guard)) return;
    }
    const result = await gateway.openPath(path);
    if (store.isClosing && !await store.canApplyLoad(guard)) return;
    if (!store.isLoadCurrent(guard)) return;
    await applyOpenResult(
      store, gateway, tecsgenGateway,
      options.optionsFilePath ? { ...result, optionsFilePath: options.optionsFilePath } : result,
      options.extraImportPaths,
      guard,
    );
  } catch (error) {
    if (await store.canApplyLoad(guard) && store.isLoadCurrent(guard)) throw error;
  }
}

/**
 * 第7C章7.7.3節（#9・消去ボタン）: [[TECSCDE-DT外部仕様]]5.2節「新規作成」の別名として設計。
 * references集合・ファイルブラウザの展開状態は維持する——消去は編集対象(editable)のみを
 * 空にする操作であり、参照ファイル一覧はアプリケーション実行中の状態として維持する
 * （FileBrowserViewの展開状態は本関数と結線されていないため自然に維持される）。
 */
export async function newDocument(store: AppStore, gateway: FileGateway): Promise<void> {
  const guard = store.beginLoad();
  try {
    if (store.isClosing && !await store.canApplyLoad(guard)) return;
    if (store.isDirty()) {
      const proceed = await gateway.confirmDiscardChanges();
      if (!proceed || !await store.canApplyLoad(guard)) return;
    }
    const current = store.getDocument();
    let retained = current;
    for (const cell of current.cellValues()) {
      if ((cell.locale ?? null) === current.primarySourceKey) retained = cascadeDeleteCell(retained, cell.id);
    }
    const empty = TecscdeDocument.empty();
    const document = TecscdeDocument.build({
      cells: new Map(retained.cellValues().map((cell) => [cell.id, cell])),
      joins: new Map(retained.joinValues().map((join) => [join.id, join])),
      celltypes: new Map(current.celltypeValues().filter((type) =>
        !type.sourcePath || type.sourcePath !== current.primarySourceKey).map((type) => [type.name, type])),
      regions: retained.regions, toolInfoTecsgen: empty.toolInfoTecsgen, paper: empty.paper,
      referenceFiles: current.referenceFiles, primarySourceKey: null,
      sourceOrder: current.sourceOrder.filter((key) => key !== current.primarySourceKey),
      sourceTemplates: new Map([...current.sourceTemplates].filter(([key]) => key !== current.primarySourceKey)),
      unknownToolInfoTecscde: {},
    });
    if (store.isClosing && !await store.canApplyLoad(guard)) return;
    if (!store.isLoadCurrent(guard)) return;
    store.clearPrimaryDocument(document);
    // openFromPath/applyOpenResultと同じく、読み込み直後は表示中心を図の中心に戻す。
    const { width, height } = document.paper.contentSize();
    store.setView(ViewState.initial().panTo({ x: width / 2, y: height / 2 }));
    // 7.7.1節: editablePathは無し（未保存の新規作成はセッション復元の対象外）、
    // references集合は維持されたまま保存する。
    await gateway.saveSession(store.getSessionSnapshot());
  } catch (error) {
    if (await store.canApplyLoad(guard) && store.isLoadCurrent(guard)) throw error;
  }
}

/** Add a CDL selected in the file browser to the editable, jointly loaded files. */
export async function addAsReference(
  store: AppStore,
  gateway: FileGateway,
  tecsgenGateway: TecsgenGateway,
  path: string,
): Promise<void> {
  const guard = store.beginLoad();
  try {
    if (store.isClosing && !await store.canApplyLoad(guard)) return;
    const editablePath = store.filePath;
    const existingPaths = store.getReferenceFilePaths();
    if (path === editablePath || existingPaths.includes(path)) return;

    const toolInfo = store.getDocument().toolInfoTecsgen;
    const extraImportPaths = store.getExtraImportPaths();
    const mergedToolInfo = { ...toolInfo, importPath: [...(toolInfo.importPath ?? ["."]), ...extraImportPaths] };
    const { references: discovered, diagnostics: importDiagnostics, cdeclResults: addedCdeclResults } = await resolveAddedReference(
      gateway,
      tecsgenGateway,
      editablePath,
      mergedToolInfo,
      path,
      existingPaths,
      store.getSystemDirs(),
    );
    if (!await store.canApplyLoad(guard)) return;
    if (discovered.length === 0 || importDiagnostics.some((entry) => entry.code === W_CODES.UNRESOLVED_REF_FILE)) return;

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
      gateway, tecsgenGateway, editablePath, editableText, toolInfo, extraImportPaths, allReferences, store.getSystemDirs(), true,
    );
    if (!await store.canApplyLoad(guard) || allImportDiagnostics.some((entry) => entry.code === W_CODES.UNRESOLVED_REF_FILE)) return;
    // An empty key is only a transient loader input for the in-memory primary;
    // it never enters the session or ordinary reference paths.
    const primaryKey = editablePath ?? "";
    const sourceTexts = new Map([...mergedSources, [primaryKey, editableText] as const]);
    const sourceOrder = [...new Set([
      ...store.getDocument().sourceOrder.map((key) => key === store.getDocument().primarySourceKey ? primaryKey : key)
        .filter((key) => sourceTexts.has(key)), ...sourceTexts.keys(),
    ])];
    const sources: CdlSource[] = [
      ...sourceOrder.map((p) => ({ text: sourceTexts.get(p)!, fileName: baseName(p), sourcePath: p, editable: true })),
      ...store.getGeneratedTypeSources().map((source) => ({
        text: source.content, fileName: `plugin:${source.fileName}`, editable: false, generated: true,
      })),
    ];
    const { document: loaded, diagnostics, portTypeIndex } = CdlDocumentLoader.loadSources(sources, {
      cdeclResults: new Map([...addedCdeclResults, ...cdeclResults]),
      systemDirs: store.getSystemDirs(), allowEditSystemDefined: store.getAllowEditSystemDefined(),
      primarySourceKey: primaryKey,
    });
    const document = TecscdeDocument.build({
      cells: new Map(loaded.cellValues().map((cell) => [cell.id,
        editablePath === null && cell.locale === "" ? Cell.create({ ...cell, locale: undefined }) : cell])),
      joins: new Map(loaded.joinValues().map((join) => [join.id, join])),
      celltypes: new Map(loaded.celltypeValues().map((type) => [type.name, type])),
      regions: loaded.regions, toolInfoTecsgen: loaded.toolInfoTecsgen, paper: loaded.paper,
      referenceFiles: loaded.referenceFiles, primarySourceKey: editablePath,
      editingFileName: editablePath ?? undefined,
      sourceOrder: sourceOrder.filter((key) => key !== ""),
      sourceTemplate: store.getDocument().sourceTemplate ?? loaded.sourceTemplate,
      sourceTemplates: new Map([
        ...loaded.sourceTemplates,
        ...[...store.getDocument().sourceTemplates].filter(([key]) => sourceTexts.has(key)),
      ].filter(([key]) => key !== "")),
      preservedImports: loaded.preservedImports, unknownToolInfoTecscde: loaded.unknownToolInfoTecscde,
    });
    if (!await store.canApplyLoad(guard) || !store.isLoadCurrent(guard)) return;
    store.loadDocument(
      document,
      editablePath,
      [...allImportDiagnostics, ...importDiagnostics.filter((first) =>
        !allImportDiagnostics.some((later) => first.code === later.code && first.message === later.message)
      ), ...diagnostics],
      sourceOrder.filter((key) => key !== primaryKey),
      mergedSources,
      extraImportPaths,
      store.getOptionsFilePath(),
      store.getGeneratedTypeSources(),
      portTypeIndex,
      true,
      store.getSystemDirs(),
    );
    const { width, height } = document.paper.contentSize();
    store.setView(ViewState.initial().panTo({ x: width / 2, y: height / 2 }));
    await gateway.saveSession(store.getSessionSnapshot());
  } catch (error) {
    if (await store.canApplyLoad(guard) && store.isLoadCurrent(guard)) throw error;
  }
}

/** Open every CDL listed by tecsgen options as editable, with the last file as primary. */
export async function loadOptionsFile(
  store: AppStore,
  gateway: FileGateway,
  tecsgenGateway: TecsgenGateway,
  path: string,
): Promise<void> {
  const guard = store.beginLoad();
  try {
    if (store.isClosing && !await store.canApplyLoad(guard)) return;
    const parsed = await gateway.parseTecsgenOptionsFile(path);
    if (!await store.canApplyLoad(guard)) return;
    if (parsed.cdlFiles.length === 0) return;
    if (store.isDirty() && !await gateway.confirmDiscardChanges()) return;
    if (!await store.canApplyLoad(guard)) return;
    const sourcePaths = [...new Set(parsed.cdlFiles)];
    const openedResult = typeof gateway.openPaths === "function" ? await gateway.openPaths(parsed.cdlFiles) : undefined;
    const opened = openedResult?.sources ?? await Promise.all(sourcePaths.map(async (filePath) => (await gateway.openPath(filePath)).editable));
    if (!await store.canApplyLoad(guard)) return;
    const editable = openedResult?.editable ?? opened[sourcePaths.indexOf(parsed.cdlFiles[parsed.cdlFiles.length - 1]!)]!;
    const references = opened.filter((entry) => entry.path !== editable.path);
    await applyOpenResult(store, gateway, tecsgenGateway, {
      editable,
      references,
      extraImportPaths: parsed.importPaths,
      optionsFilePath: path,
      ...(parsed.systemDirs.length > 0 ? { systemDirs: parsed.systemDirs } : {}),
      primarySourceKey: editable.path,
      sourceOrder: [...new Set(opened.map((entry) => entry.path))],
      sources: [...new Map(opened.map((entry) => [entry.path, entry])).values()],
    }, parsed.importPaths, guard);
  } catch (error) {
    if (await store.canApplyLoad(guard) && store.isLoadCurrent(guard)) throw error;
  }
}

/** Capture every source ticket before the first I/O; reflect each success independently. */
export async function save(store: AppStore, gateway: FileGateway): Promise<void> {
  if (store.isEditingFileReadOnlySystemDefined()) return Promise.resolve();
  if (!store.filePath) return saveAs(store, gateway);
  const document = store.getDocument();
  const path = store.filePath;
  const referenceTickets = store.getReferenceFilePaths().filter((key) =>
    document.sourceTemplates.has(key) && store.isSourceDirty(key)).map((key) =>
    store.createSaveTicket(key, CdlSerializer.serializeSource(document, key)));
  const primary = store.createSaveTicket(document.editingFileName ?? null, CdlSerializer.serialize(document));
  return store.trackSave(async () => {
    const results = await Promise.allSettled([...referenceTickets, primary].map(async (ticket) => {
      const destination = ticket === primary ? path : ticket.key!;
      const receipt = await gateway.save(destination, ticket.content);
      store.recordSaved(ticket, destination, false, receipt?.writeSequence);
    }));
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  });
}

export function saveAs(store: AppStore, gateway: FileGateway): Promise<void> {
  if (store.isEditingFileReadOnlySystemDefined()) return Promise.resolve();
  // Save As changes the primary only. Other unsaved sources retain their own checkpoints.
  return store.enqueueSaveAs(async () => {
    const document = store.getDocument();
    const primary = store.createSaveTicket(document.editingFileName ?? null, CdlSerializer.serialize(document));
    const suggested = store.filePath ? baseName(store.filePath) : "untitled.cde";
    const destination = typeof gateway.chooseSavePath === "function"
      ? await gateway.chooseSavePath(suggested) : await gateway.saveAs(primary.content, suggested);
    if (!store.canSaveTicket(primary)) return;
    const receipt = destination && typeof gateway.chooseSavePath === "function"
      ? await gateway.save(destination, primary.content) : undefined;
    if (destination && store.recordSaved(primary, destination, true, receipt?.writeSequence)) {
      const session = store.getSessionSnapshot();
      await gateway.saveSession?.(session);
    }
  });
}
