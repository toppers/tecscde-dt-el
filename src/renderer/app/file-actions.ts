// [[TECSCDE-DT-EL内部仕様]] 第7章7.3節 — ファイル操作のユースケース。
// renderer 側の `FileGateway`（IPC 越しの薄いプロキシ）とモジュールB（CDLローダ／
// シリアライザ）を繋ぎ、`AppStore` を更新する。プロセス境界は `FileGateway` の内側に
// 閉じているので、ここからは Promise を返す通常のメソッド呼び出しにしか見えない。

import { CdlDocumentLoader } from "../cdl/document-builder";
import type { CdlSource } from "../cdl/document-builder";
import { CdlSerializer } from "../cdl/serializer";
import type { OpenResult } from "../../shared/ipc-types.js";
import type { FileGateway } from "../gateways/file-gateway";
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
  store.loadDocument(document, result.editable.path, diagnostics);
  // 読み込み直後は図の中心を表示中心にしておく（panCenter 初期値 {0,0} だと左上寄り）。
  const { width, height } = document.paper.contentSize();
  store.setView(ViewState.initial().panTo({ x: width / 2, y: height / 2 }));
}

/** ［開く］: ダイアログ経由でファイルを選び、読み込む。キャンセル時は何もしない。 */
export async function openViaDialog(store: AppStore, gateway: FileGateway): Promise<void> {
  const result = await gateway.open();
  if (result) applyOpenResult(store, result);
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
