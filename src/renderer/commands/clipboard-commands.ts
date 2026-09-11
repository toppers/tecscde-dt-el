// [[TECSCDE-DT-EL内部仕様]] 第4章4.1節: Copy/Cut/PasteとOSクリップボード連携。
//
// 設計上の差分（内部仕様4.1節のスケッチからの変更点）:
// 実際に実装済みの`ClipboardGateway`（gateways/clipboard-gateway.ts、2026-09-07）は
// Electron 44のclipboardモジュール自体が非同期化されたことに伴い、`readText()`が
// `Promise<string>`を返す（内部仕様4.1節のスケッチが想定した同期`string`ではない）。
// 一方`Command.apply()`は同期シグネチャ（第4章4.2節）であり、コマンドの内部でawaitできない。
// そのため本実装では、OSクリップボードの「読み取り」はコマンド外（呼び出し側=将来のモジュールG／
// AppStore）で先に済ませ、`PasteCommand`には解決済みのテキストを渡す形にする。
// 「書き込み」（Copy/Cut）は結果を待つ必要がない発火のみの操作なので、`ClipboardGateway`を
// そのままコンストラクタで受け取り、`apply()`内でawaitせず呼び出す（fire-and-forget）。

import { Command } from "./command";
import { DeleteCommand, instantiateCPorts, instantiateEPorts, DEFAULT_CELL_WIDTH_MM, DEFAULT_CELL_HEIGHT_MM } from "./cell-commands";
import { deriveCellName } from "./support";
import { Cell } from "../model/cell";
import { alignRound } from "../model/align";
import { asCellId, ROOT_REGION_ID, type CellId, type JoinId } from "../model/ids";
import type { TecscdeDocument } from "../model/document";
import { serializeCellsAsCdl, tryParseCdlFragment, type CdlFragmentCell } from "../cdl/fragment";
import type { ClipboardGateway } from "../gateways/clipboard-gateway";

const PASTE_OFFSET_MM = 10;
const PASTE_ANCHOR_MM = 20;

/**
 * 外部仕様6.7.2: アプリ内クリップボード（コピー時点のCellスナップショット）からの貼り付け。
 * 元の位置から`PASTE_OFFSET_MM`だけずらし、名前・結合は新規に割り当てる（結合は引き継がない）。
 * セルタイプが解決できないセルは生成しない（6.1.2と同じ方針）。
 */
export function pasteFromAppClipboard(doc: TecscdeDocument, cells: readonly Cell[]): TecscdeDocument {
  let next = doc;
  for (const source of cells) {
    const celltype = next.getCelltype(source.celltypeName);
    if (!celltype) continue;
    const name = deriveCellName(next, source.celltypeName);
    const cell = Cell.create({
      id: asCellId(name),
      name,
      celltypeName: source.celltypeName,
      x: alignRound(source.x + PASTE_OFFSET_MM),
      y: alignRound(source.y + PASTE_OFFSET_MM),
      width: source.width,
      height: source.height,
      regionId: source.regionId,
      editable: true,
      cports: instantiateCPorts(celltype.cportTemplates),
      eports: instantiateEPorts(celltype.eportTemplates),
      attrs: { ...source.attrs },
      celltypeUnresolved: false,
      locale: next.editingFileName,
    });
    next = next.withCell(cell);
  }
  return next;
}

/**
 * 6.7節: OSクリップボードから解析できたCDL断片からの貼り付け。断片は位置情報を持たないため、
 * `PASTE_ANCHOR_MM`を起点に`PASTE_OFFSET_MM`刻みで斜めに並べる（複数セルの重なりを避ける簡易配置）。
 */
export function pasteFromCdlFragment(doc: TecscdeDocument, fragments: readonly CdlFragmentCell[]): TecscdeDocument {
  let next = doc;
  let placed = 0;
  for (const frag of fragments) {
    const celltype = next.getCelltype(frag.celltypeName);
    if (!celltype) continue;
    const name = deriveCellName(next, frag.celltypeName);
    const pos = PASTE_ANCHOR_MM + placed * PASTE_OFFSET_MM;
    placed += 1;
    const cell = Cell.create({
      id: asCellId(name),
      name,
      celltypeName: frag.celltypeName,
      x: alignRound(pos),
      y: alignRound(pos),
      width: DEFAULT_CELL_WIDTH_MM,
      height: DEFAULT_CELL_HEIGHT_MM,
      regionId: ROOT_REGION_ID,
      editable: true,
      cports: instantiateCPorts(celltype.cportTemplates),
      eports: instantiateEPorts(celltype.eportTemplates),
      attrs: { ...frag.attrs },
      celltypeUnresolved: false,
      locale: next.editingFileName,
    });
    next = next.withCell(cell);
  }
  return next;
}

/**
 * 履歴を作らない特殊なコマンド（TS内部仕様4.5節）: ドキュメントは変更せず、選択セルを
 * CDL断片としてOSクリップボードへ書き込む副作用のみを行う。呼び出し側は`History.commit()`を
 * 呼ばず、`apply()`の返り値（変更なしのdoc）を捨ててよい。
 */
export class CopyCommand extends Command {
  readonly kind = "Copy";
  override readonly summary: string;

  constructor(
    private readonly cellIds: readonly CellId[],
    private readonly clipboard: Pick<ClipboardGateway, "writeText">,
  ) {
    super();
    this.summary = `copy ${cellIds.length} cell(s)`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const fragment = serializeCellsAsCdl(doc, this.cellIds);
    void this.clipboard.writeText(fragment);
    return doc;
  }
}

/**
 * 外部仕様6.7.2: アプリ内クリップボードを優先し、空の場合のみOSクリップボードのCDL断片を試みる。
 * `osClipboardText`はコマンド構築前に呼び出し側が`ClipboardGateway.readText()`を解決して渡す
 * （`apply()`は同期のため、非同期の読み取り自体はコマンドの外で行う——本ファイル冒頭の注記参照）。
 */
export class PasteCommand extends Command {
  readonly kind = "Paste";

  constructor(
    private readonly appClipboard: readonly Cell[],
    private readonly osClipboardText: string | undefined,
  ) {
    super();
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    if (this.appClipboard.length > 0) {
      return pasteFromAppClipboard(doc, this.appClipboard);
    }
    if (this.osClipboardText === undefined) return doc;
    const fragment = tryParseCdlFragment(this.osClipboardText);
    return fragment ? pasteFromCdlFragment(doc, fragment) : doc;
  }
}

/**
 * 外部仕様6.7.2・TS内部仕様4.5節: CopyCommand相当（OSクリップボードへの書き込み）と
 * DeleteCommand相当（カスケード削除）を1コマンドに合成する。
 */
export class CutCommand extends Command {
  readonly kind = "Cut";
  override readonly summary: string;

  constructor(
    private readonly cellIds: readonly CellId[],
    private readonly joinIds: readonly JoinId[],
    private readonly clipboard: Pick<ClipboardGateway, "writeText">,
  ) {
    super();
    this.summary = `cut ${cellIds.length} cell(s), ${joinIds.length} join(s)`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    void this.clipboard.writeText(serializeCellsAsCdl(doc, this.cellIds));
    return new DeleteCommand(this.cellIds, this.joinIds).apply(doc);
  }
}
