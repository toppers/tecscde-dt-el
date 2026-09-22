// [[TECSCDE-DT-EL内部仕様]] 第7章7.3節 — ファイル操作のユースケース。
// renderer 側の `FileGateway`（IPC 越しの薄いプロキシ）とモジュールB（CDLローダ／
// シリアライザ）を繋ぎ、`AppStore` を更新する。プロセス境界は `FileGateway` の内側に
// 閉じているので、ここからは Promise を返す通常のメソッド呼び出しにしか見えない。

import { CdlDocumentLoader } from "../cdl/document-builder";
import type { CdlSource } from "../cdl/document-builder";
import { CdlSerializer } from "../cdl/serializer";
import type { OpenResult } from "../../shared/ipc-types.js";
import type { FileGateway } from "../gateways/file-gateway";
import { TecscdeDocument } from "../model/document";
import { ViewState } from "../view-state/view-state";
import type { AppStore } from "./store";

/** `path/to/foo.cde` → `foo.cde`（renderer には node:path が無いので自前）。 */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** `OpenResult`（参照ファイル＋編集対象）を `TecscdeDocument` へ組み立て、ストアへ反映する。 */
export function applyOpenResult(store: AppStore, result: OpenResult): void {
  const sources: CdlSource[] = [
    ...result.references.map((r) => ({ text: r.content, fileName: baseName(r.path), editable: false })),
    { text: result.editable.content, fileName: baseName(result.editable.path), editable: true },
  ];
  const { document, diagnostics } = CdlDocumentLoader.loadSources(sources);
  const referenceFilePaths = result.references.map((r) => r.path);
  store.loadDocument(document, result.editable.path, diagnostics, referenceFilePaths);
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
export async function openFromPath(store: AppStore, gateway: FileGateway, path: string): Promise<void> {
  if (store.isDirty()) {
    const proceed = await gateway.confirmDiscardChanges();
    if (!proceed) return;
  }
  const result = await gateway.openPath(path);
  applyOpenResult(store, result);
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
  const document = TecscdeDocument.empty();
  store.loadDocument(document, null, [], referenceFilePaths);
  // openFromPath/applyOpenResultと同じく、読み込み直後は表示中心を図の中心に戻す。
  const { width, height } = document.paper.contentSize();
  store.setView(ViewState.initial().panTo({ x: width / 2, y: height / 2 }));
  // 7.7.1節: editablePathは無し（未保存の新規作成はセッション復元の対象外）、
  // references集合は維持されたまま保存する。
  await gateway.saveSession(null, referenceFilePaths);
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
