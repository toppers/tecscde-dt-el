// [[TECSCDE-DT-EL内部仕様]] 第7章7.3節 — ファイル操作のユースケース。
// renderer 側の `FileGateway`（IPC 越しの薄いプロキシ）とモジュールB（CDLローダ／
// シリアライザ）を繋ぎ、`AppStore` を更新する。プロセス境界は `FileGateway` の内側に
// 閉じているので、ここからは Promise を返す通常のメソッド呼び出しにしか見えない。

import { CdlDocumentLoader } from "../cdl/document-builder";
import type { CdlSource } from "../cdl/document-builder";
import { CdlSerializer } from "../cdl/serializer";
import type { OpenFileEntry, OpenResult } from "../../shared/ipc-types.js";
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
 * `import_C`が見つけたCヘッダの型（9B章`cdeclResults`）は、ポート型解決へつなぐ設計が
 * まだ無い（9B章9B.2の範囲外）ため、ここでは診断（`importDiagnostics`）に反映される
 * フォールバック・構文エラーの警告以外は使わず捨てる——保持先（`store`等）を今回新設しない。
 */
export async function applyOpenResult(
  store: AppStore,
  gateway: FileGateway,
  tecsgenGateway: TecsgenGateway,
  result: OpenResult,
  extraImportPaths: readonly string[] = [],
): Promise<void> {
  const toolInfo = extractToolInfoTecsgen(result.editable.content);
  const { references: autoReferences, diagnostics: importDiagnostics } = await resolveAllImports(
    gateway,
    tecsgenGateway,
    result.editable.path,
    result.editable.content,
    toolInfo,
    extraImportPaths,
  );
  const references = mergeReferences(result.references, autoReferences);

  const sources: CdlSource[] = [
    ...references.map((r) => ({ text: r.content, fileName: baseName(r.path), editable: false })),
    { text: result.editable.content, fileName: baseName(result.editable.path), editable: true },
  ];
  const { document, diagnostics } = CdlDocumentLoader.loadSources(sources);
  const referenceFilePaths = references.map((r) => r.path);
  const referenceSources = new Map(references.map((r) => [r.path, r.content]));
  store.loadDocument(document, result.editable.path, [...importDiagnostics, ...diagnostics], referenceFilePaths, referenceSources);
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
  options: { extraImportPaths?: readonly string[] } = {},
): Promise<void> {
  if (store.isDirty()) {
    const proceed = await gateway.confirmDiscardChanges();
    if (!proceed) return;
  }
  const result = await gateway.openPath(path);
  await applyOpenResult(store, gateway, tecsgenGateway, result, options.extraImportPaths ?? []);
  // 第7C章7.7.1節: 編集対象が変化するたびに前回セッションを保存する。
  await gateway.saveSession(store.filePath, store.getReferenceFilePaths());
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
  store.loadDocument(document, null, [], referenceFilePaths, referenceSources);
  // openFromPath/applyOpenResultと同じく、読み込み直後は表示中心を図の中心に戻す。
  const { width, height } = document.paper.contentSize();
  store.setView(ViewState.initial().panTo({ x: width / 2, y: height / 2 }));
  // 7.7.1節: editablePathは無し（未保存の新規作成はセッション復元の対象外）、
  // references集合は維持されたまま保存する。
  await gateway.saveSession(null, referenceFilePaths);
}

/**
 * 第7C章7.7.2節（#8）: ファイルブラウザのCtrl+クリックで選択したファイルを参照専用として
 * 追加する。既存の編集対象(editable)は変えない。新しい参照ファイルのセルタイプを既存の
 * `cell`（celltype未解決のもの）へ反映するには、editable＋全referencesを合わせて再パース
 * する必要があり、これは`store.loadDocument()`経由でUndo/Redo履歴をリセットする
 * （`openFromPath`が別ファイルを開く際に既に持つのと同じトレードオフ）。現在の
 * 未保存の内容自体は`CdlSerializer.serialize()`で引き継ぐため失われない。
 */
export async function addAsReference(
  store: AppStore,
  gateway: FileGateway,
  tecsgenGateway: TecsgenGateway,
  path: string,
): Promise<void> {
  const editablePath = store.filePath;
  if (!editablePath) return; // 消去直後など編集対象未確定では参照追加の起点が無い
  const existingPaths = store.getReferenceFilePaths();
  if (path === editablePath || existingPaths.includes(path)) return; // #8決定: 既読み込み済みなら無視

  const toolInfo = store.getDocument().toolInfoTecsgen;
  const { references: discovered, diagnostics: importDiagnostics } = await resolveAddedReference(
    gateway,
    tecsgenGateway,
    editablePath,
    toolInfo,
    path,
    existingPaths,
  );
  if (discovered.length === 0) return; // 重複（種付けにより検出）または解決失敗

  const mergedSources = new Map(store.getReferenceSources());
  for (const r of discovered) mergedSources.set(r.path, r.content);

  const editableText = CdlSerializer.serialize(store.getDocument()); // 未保存の変更を含む現在の内容
  const sources: CdlSource[] = [
    ...[...mergedSources.entries()].map(([p, text]) => ({ text, fileName: baseName(p), editable: false })),
    { text: editableText, fileName: baseName(editablePath), editable: true },
  ];
  const { document, diagnostics } = CdlDocumentLoader.loadSources(sources);
  store.loadDocument(document, editablePath, [...importDiagnostics, ...diagnostics], [...mergedSources.keys()], mergedSources);
  const { width, height } = document.paper.contentSize();
  store.setView(ViewState.initial().panTo({ x: width / 2, y: height / 2 }));
  await gateway.saveSession(store.filePath, store.getReferenceFilePaths());
}

/**
 * 第7C章7.7.4節④（#10）: tecsgenオプション形式ファイルを読み込み、列挙されたCDLファイル群を
 * 一括で反映する。列挙順で最後のファイルを編集対象として開く（8.1.2節の規則）——
 * `addAsReference`が既存の編集対象を前提とするため、07C章の擬似コードとは逆に、
 * 残りを参照追加する前に必ず先へ`openFromPath`する。
 */
export async function loadOptionsFile(
  store: AppStore,
  gateway: FileGateway,
  tecsgenGateway: TecsgenGateway,
  path: string,
): Promise<void> {
  const parsed = await gateway.parseTecsgenOptionsFile(path);
  const [last, ...rest] = [...parsed.cdlFiles].reverse();
  if (!last) return;
  await openFromPath(store, gateway, tecsgenGateway, last, { extraImportPaths: parsed.importPaths });
  for (const refPath of rest.reverse()) {
    await addAsReference(store, gateway, tecsgenGateway, refPath);
  }
}

/** ［保存］: 既存パスがあれば上書き、無ければ［名前を付けて保存］へ委譲。 */
export async function save(store: AppStore, gateway: FileGateway): Promise<void> {
  const path = store.filePath;
  if (!path) {
    await saveAs(store, gateway);
    return;
  }
  const text = CdlSerializer.serialize(store.getDocument());
  await gateway.save(path, text);
  store.markSaved(path);
}

/** ［名前を付けて保存］: 保存ダイアログを開く。キャンセル時は何もしない。 */
export async function saveAs(store: AppStore, gateway: FileGateway): Promise<void> {
  const text = CdlSerializer.serialize(store.getDocument());
  const suggested = store.filePath ? baseName(store.filePath) : "untitled.cde";
  const savedPath = await gateway.saveAs(text, suggested);
  if (savedPath) store.markSaved(savedPath);
}
