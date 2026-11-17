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
import type { GeneratedCdlFile, LogAppendResult, OpenFileEntry, OpenResult, PluginTypeSource, ToolSettings } from "../../shared/ipc-types.js";
import type { FileGateway } from "../gateways/file-gateway";
import type { TecsgenGateway } from "../gateways/tecsgen-gateway";
import {
  ExternalPluginTypeProvider,
  InternalPluginTypeProvider,
  type PluginTypeProvider,
  type PluginTypeRequest,
} from "../tecsgen/plugin-type-provider";
import { TecscdeDocument } from "../model/document";
import { cascadeDeleteCell } from "../commands/support";
import { Cell } from "../model/cell";
import { ViewState } from "../view-state/view-state";
import { extractToolInfoTecsgen, resolveAddedReference, resolveAllImports, type ImportResolutionResult } from "./import-resolution";
import type { AppStore, LoadGuard } from "./store";
import { SaveFailure, describeFailure, optionsNoCdlDiagnostic, saveReadOnlyDiagnostic } from "./action-failure";
import { logWriteFailedDiagnostic } from "./log-warning";

export interface ApplyOpenResultOptions {
  readonly extraImportPaths?: readonly string[];
  readonly pluginTypeSource?: PluginTypeSource;
  readonly pluginTypeProvider?: PluginTypeProvider;
  readonly settingsGateway?: { getToolSettings(): Promise<ToolSettings> };
  readonly log?: { append(lines: readonly string[]): Promise<unknown> };
}

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
  extraImportPathsOrOptions: readonly string[] | ApplyOpenResultOptions = result.extraImportPaths ?? [],
  guard: LoadGuard = store.beginLoad(),
  options?: ApplyOpenResultOptions,
): Promise<boolean> {
  const opts: ApplyOpenResultOptions | undefined = options ?? (Array.isArray(extraImportPathsOrOptions) ? undefined : (extraImportPathsOrOptions as ApplyOpenResultOptions));
  const extraImportPaths: readonly string[] = Array.isArray(extraImportPathsOrOptions)
    ? extraImportPathsOrOptions
    : (opts?.extraImportPaths ?? result.extraImportPaths ?? []);

  if (!await store.canApplyLoad(guard) || !store.isLoadCurrent(guard)) return false;
  const contextPaths = contextImportPaths(extraImportPaths, result.optionsFilePath);
  const toolInfo = extractToolInfoTecsgen(result.editable.content);
  const { references: autoReferences, diagnostics: importDiagnostics, cdeclResults, cTypes } = await resolveAllImports(
    gateway,
    tecsgenGateway,
    result.editable.path,
    result.editable.content,
    toolInfo,
    contextPaths,
    result.references,
    result.systemDirs ?? [],
    false,
    result.cpp,
  );
  const references = mergeReferences(result.references, autoReferences);

  // PluginTypeProvider の決定（内部仕様 9D.6 #1, #7 / 外部仕様 8.5 #3）
  let provider = opts?.pluginTypeProvider;
  if (!provider) {
    let source: PluginTypeSource | undefined = opts?.pluginTypeSource;
    if (!source && opts?.settingsGateway) {
      try {
        const s = await opts.settingsGateway.getToolSettings();
        source = s.pluginTypeSource;
      } catch {}
    }
    if (!source && typeof window !== "undefined" && (window as any).tecscde?.settings?.getToolSettings) {
      try {
        const s = await (window as any).tecscde.settings.getToolSettings();
        source = s.pluginTypeSource;
      } catch {}
    }
    const effectiveSource: PluginTypeSource = source === "internal" ? "internal" : "external";
    provider = effectiveSource === "internal"
      ? new InternalPluginTypeProvider()
      : new ExternalPluginTypeProvider(tecsgenGateway);
  }

  let generatedTypeSources: readonly GeneratedCdlFile[] = [];
  const pluginDiagnostics: Array<{ severity: "warning"; code: string; message: string }> = [];

  const shouldGenerate = Boolean(
    result.editable.path && (
      provider.source !== "external" || (tecsgenGateway && typeof tecsgenGateway.generatedTypes === "function")
    )
  );

  if (shouldGenerate) {
    let grammarAssets: any;
    if (provider.source === "internal" && typeof window !== "undefined" && (window as any).tecscde?.cdl?.loadGrammarAssets) {
      try {
        grammarAssets = await (window as any).tecscde.cdl.loadGrammarAssets();
      } catch {}
    }

    const pluginRequest: PluginTypeRequest = {
      main: { path: result.editable.path, text: result.editable.content },
      sources: references.map((r) => ({ path: r.path, text: r.content })),
      cTypes,
      cdeclResults,
      grammarAssets,
      args: TecsgenCommandBuilder.buildArgs({
        importPath: [...(toolInfo.importPath ?? []), ...extraImportPaths],
        defineMacro: toolInfo.defineMacro,
        cpp: result.cpp ?? toolInfo.cpp,
        referenceFilePaths: references.map((reference) => reference.path),
        editingFilePath: result.editable.path,
      }),
      optionsFilePath: result.optionsFilePath,
      importPaths: [...(toolInfo.importPath ?? []), ...extraImportPaths],
      defineMacros: toolInfo.defineMacro,
      cpp: result.cpp ?? toolInfo.cpp,
    };

    try {
      const pluginResult = await provider.generateTypes(pluginRequest);
      if (pluginResult.ok) {
        generatedTypeSources = pluginResult.files;
      } else {
        generatedTypeSources = [];
      }
      for (const d of pluginResult.diagnostics) {
        pluginDiagnostics.push({
          severity: "warning",
          code: d.code,
          message: d.message,
        });
      }
      if (!pluginResult.ok && pluginDiagnostics.length === 0) {
        pluginDiagnostics.push({
          severity: "warning",
          code: "W-PLUGIN-TYPE-LOAD",
          message: provider.source === "internal"
            ? "内部 tecsgen 処理で Plugin 生成型を読み込めませんでした。"
            : "Plugin生成型を読み込めませんでした。",
        });
      }
    } catch (error) {
      generatedTypeSources = [];
      pluginDiagnostics.push({
        severity: "warning",
        code: "W-PLUGIN-TYPE-LOAD",
        message: provider.source === "internal"
          ? `内部 tecsgen 処理でエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`
          : `Plugin生成型を読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    const logService = opts?.log ?? (typeof window !== "undefined" ? (window as any).tecscde?.log : undefined);
    if (logService && typeof logService.append === "function") {
      const mode = provider.source === "internal" ? "内部 tecsgen (internal)" : "外部 tecsgen (external)";
      // 書けなかった最初の一度は、診断一覧へ警告を出す（結果を捨てない。三者相違一覧9-1）。IPC自体の失敗は無視する。
      const logged = await logService.append([`Plugin 生成型取り込み方式: ${mode}`]).catch(() => undefined) as LogAppendResult | void;
      if (logged && logged.newFailure !== undefined) store.setLogWriteWarning(logWriteFailedDiagnostic(logged.newFailure));
    }
  }

  // 寿命管理: 新しい生成物リスト（失敗時は []）で store を更新
  store.setGeneratedTypeSources(generatedTypeSources);

  const primary = result.primarySourceKey === undefined ? result.editable.path : result.primarySourceKey;
  const ordinary = result.sources ?? [...result.references, ...(primary ? [result.editable] : [])];
  const byPath = new Map([...ordinary, ...references].map((entry) => [entry.path, entry]));
  const order = [...new Set([...(result.sourceOrder ?? ordinary.map((entry) => entry.path)), ...byPath.keys()])];
  const sources: CdlSource[] = [
    ...order.map((path) => byPath.get(path)!).map((r) => ({ text: r.content, fileName: baseName(r.path), sourcePath: r.path, editable: true })),
    ...generatedTypeSources.map((source) => ({
      text: source.content,
      fileName: source.fileName.startsWith("plugin:") ? source.fileName : `plugin:${source.fileName}`,
      editable: false,
      generated: true,
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
  options: ApplyOpenResultOptions & { optionsFilePath?: string } = {},
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
      options,
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

/**
 * `.tecsgen-opts`の相対`-I`・`-S`を、optsのあるディレクトリを基点にした探索パスへ直す（外部仕様5.3節、内部7I.1）。
 * 開いた直後の解決とCtrl+クリックの追加の解決で同じ基点を使う（三者相違一覧5-5）。絶対パスはそのまま。
 */
function contextImportPaths(extraImportPaths: readonly string[], optionsFilePath: string | undefined | null): string[] {
  return extraImportPaths.map((path) =>
    optionsFilePath && !/^(?:[A-Za-z]:[\/]|[\/])/.test(path)
      ? `${optionsFilePath.replace(/[\/][^\/]*$/, "")}/${path}` : path);
}

/** 今開いている`.tecsgen-opts`の`cpp`。無い・読めないときは`undefined`（`import_C`はCDLの`cpp`・設定に従う）。 */
async function optionsCppOf(gateway: FileGateway, optionsFilePath: string): Promise<string | undefined> {
  if (typeof gateway.parseTecsgenOptionsFile !== "function") return undefined;
  try {
    return (await gateway.parseTecsgenOptionsFile(optionsFilePath)).cpp;
  } catch {
    return undefined;
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
    const contextPaths = contextImportPaths(extraImportPaths, store.getOptionsFilePath());
    const mergedToolInfo = { ...toolInfo, importPath: [...(toolInfo.importPath ?? ["."]), ...contextPaths] };
    // 追加のたびに、今開いている.tecsgen-optsのcppを読み直す（Generateと同じく呼ぶたびに再解析する）。
    // opts を開いていないときは待たない（解決の呼び出しを非同期にずらさない）。
    const optionsFilePath = store.getOptionsFilePath();
    const optionsCpp = optionsFilePath ? await optionsCppOf(gateway, optionsFilePath) : undefined;
    const { references: discovered, diagnostics: importDiagnostics, cdeclResults: addedCdeclResults } = await resolveAddedReference(
      gateway,
      tecsgenGateway,
      editablePath,
      mergedToolInfo,
      path,
      existingPaths,
      store.getSystemDirs(),
      optionsCpp,
    );
    if (!await store.canApplyLoad(guard)) return;
    if (discovered.length === 0) {
      // 追加したCDL自身が見つからないときだけ、旧状態を保って利用者へ知らせる。
      // 既に読み込み済み（診断なし）は何もしない。追加したCDLのimport未解決は、下で警告にして続ける（5-4）。
      if (importDiagnostics.some((entry) => entry.code === W_CODES.UNRESOLVED_REF_FILE)) {
        store.setTransientActionDiagnostics(importDiagnostics);
      }
      return;
    }

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
      gateway, tecsgenGateway, editablePath, editableText, toolInfo, contextPaths, allReferences, store.getSystemDirs(), true, optionsCpp,
    );
    if (!await store.canApplyLoad(guard)) return;
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
        text: source.content,
        fileName: source.fileName.startsWith("plugin:") ? source.fileName : `plugin:${source.fileName}`,
        editable: false,
        generated: true,
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
  options: ApplyOpenResultOptions = {},
): Promise<void> {
  const guard = store.beginLoad();
  try {
    if (store.isClosing && !await store.canApplyLoad(guard)) return;
    const parsed = await gateway.parseTecsgenOptionsFile(path);
    if (!await store.canApplyLoad(guard)) return;
    if (parsed.cdlFiles.length === 0) {
      // 図とセッションは保持し、何も読み込まなかったことを知らせる（三者相違一覧5-3）。
      store.setTransientActionDiagnostics([optionsNoCdlDiagnostic(path)]);
      return;
    }
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
      ...(parsed.cpp !== undefined ? { cpp: parsed.cpp } : {}),
      primarySourceKey: editable.path,
      sourceOrder: [...new Set(opened.map((entry) => entry.path))],
      sources: [...new Map(opened.map((entry) => [entry.path, entry])).values()],
    }, parsed.importPaths, guard, options);
  } catch (error) {
    if (await store.canApplyLoad(guard) && store.isLoadCurrent(guard)) throw error;
  }
}

/** Capture every source ticket before the first I/O; reflect each success independently. */
export async function save(store: AppStore, gateway: FileGateway): Promise<void> {
  // 主ファイルが閲覧のみ（システム定義CDL）のときは、主ファイルだけを保存しない。編集した参照CDLは保存し、
  // 主ファイルを保存しなかったことを知らせる（三者相違一覧4-3、2026-11-17 決定）。
  const readOnlyPrimary = store.isEditingFileReadOnlySystemDefined();
  if (!readOnlyPrimary && !store.filePath) return saveAs(store, gateway);
  const document = store.getDocument();
  const path = store.filePath;
  const referenceTickets = store.getReferenceFilePaths().filter((key) =>
    document.sourceTemplates.has(key) && store.isSourceDirty(key)).map((key) =>
    store.createSaveTicket(key, CdlSerializer.serializeSource(document, key)));
  if (readOnlyPrimary && referenceTickets.length === 0) {
    store.setTransientActionDiagnostics([saveReadOnlyDiagnostic(path, [])]);
    return;
  }
  const primary = readOnlyPrimary ? undefined
    : store.createSaveTicket(document.editingFileName ?? null, CdlSerializer.serialize(document));
  return store.trackSave(async () => {
    const targets = [...referenceTickets, ...(primary ? [primary] : [])].map((ticket) => ({
      ticket, destination: ticket === primary ? path! : ticket.key!,
    }));
    const results = await Promise.allSettled(targets.map(async ({ ticket, destination }) => {
      const receipt = await gateway.save(destination, ticket.content);
      store.recordSaved(ticket, destination, false, receipt?.writeSequence);
    }));
    // 一部だけ失敗したときは、失敗したソースと保存できたソースを分けて知らせる（三者相違一覧4-1）。
    const failed = results.flatMap((result, index) => result.status === "rejected"
      ? [{ path: targets[index]!.destination, reason: describeFailure(result.reason) }] : []);
    const saved = results.flatMap((result, index) => result.status === "fulfilled" ? [targets[index]!.destination] : []);
    if (failed.length > 0) throw new SaveFailure(failed, saved);
    if (readOnlyPrimary) store.setTransientActionDiagnostics([saveReadOnlyDiagnostic(path, saved)]);
  });
}

export function saveAs(store: AppStore, gateway: FileGateway): Promise<void> {
  if (store.isEditingFileReadOnlySystemDefined()) {
    store.setTransientActionDiagnostics([saveReadOnlyDiagnostic(store.filePath, [])]);
    return Promise.resolve();
  }
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
