// [[TECSCDE-DT-EL内部仕様]] 第4章4.1節: Copy/Cut/PasteとOSクリップボード連携。
//
// 設計上の差分1（内部仕様4.1節のスケッチからの変更点）:
// 実際に実装済みの`ClipboardGateway`（gateways/clipboard-gateway.ts、2026-09-07）は
// Electron 44のclipboardモジュール自体が非同期化されたことに伴い、`readText()`が
// `Promise<string>`を返す（内部仕様4.1節のスケッチが想定した同期`string`ではない）。
// 一方`Command.apply()`は同期シグネチャ（第4章4.2節）であり、コマンドの内部でawaitできない。
// そのため本実装では、OSクリップボードの「読み取り」はコマンド外（呼び出し側=モジュールG／
// AppStore）で先に済ませ、`PasteCommand`には解決済みのテキストを渡す形にする。
//
// 設計上の差分2: `CutCommand`はOSクリップボードへの書き込みを`apply()`の中で行わない
// （TS内部仕様4.5節のスケッチと異なる）。`History.current`は`past`を毎回`initial`から
// 再生する（4.3節、O(履歴長)）ため、`apply()`内に副作用を持つコマンドを`history.commit()`
// すると、その副作用が`current`を読むたび（=ほぼ毎回の`render()`）に再実行されてしまう。
// これは冪等（同じテキストを書くだけ）とはいえ無駄かつ壊れやすい前提であるため、
// クリップボードへの書き込みは呼び出し側（`AppStore.cutSelection`）が`apply()`を通さず
// 1回だけ行い、`CutCommand`自体は`DeleteCommand`と同じ純粋な削除のみを行う
// （`kind`/`summary`が"Cut"である点だけが差分）。`CopyCommand`は`history.commit()`を
// 経由しない特殊呼び出しのため、この問題は生じない（`apply()`は呼び出し側が直接1回だけ呼ぶ）。

import { Command } from "./command";
import { DeleteCommand, DEFAULT_CELL_WIDTH_MM, DEFAULT_CELL_HEIGHT_MM } from "./cell-commands";
import { CreateJoinCommand } from "./join-commands";
import { deriveCellName } from "./support";
import { Cell } from "../model/cell";
import { portTemplateArrayKind, type PortTemplate } from "../model/celltype";
import { alignRound } from "../model/align";
import { asCellId, ROOT_REGION_ID, type CellId, type JoinId } from "../model/ids";
import type { Join } from "../model/join";
import { CPort, EPort } from "../model/port";
import type { TecscdeDocument } from "../model/document";
import { serializeCellsAsCdl, serializeClipboardAsCdl, tryParseCdlFragment, type CdlFragmentCell } from "../cdl/fragment";
import type { ClipboardGateway } from "../gateways/clipboard-gateway";

const PASTE_OFFSET_MM = 10;
const PASTE_ANCHOR_MM = 20;
const ARRAY_ELEMENT_GAP_MM = 3;

/** 第4章4.1節（三者監査#25）: コピー時点の不変スナップショット。単一セルでは joins は空。 */
export interface ClipboardSnapshot {
  readonly cells: readonly Cell[];
  readonly joins: readonly Join[];
}

export const EMPTY_CLIPBOARD_SNAPSHOT: ClipboardSnapshot = { cells: [], joins: [] };

/** コピー時点の選択セル集合から不変な ClipboardSnapshot を構築する（2個以上なら内部結合を含む）。 */
export function buildClipboardSnapshot(doc: TecscdeDocument, cellIds: readonly CellId[]): ClipboardSnapshot {
  const seen = new Set<CellId>();
  const cells: Cell[] = [];
  for (const id of cellIds) {
    if (seen.has(id)) continue;
    const cell = doc.getCell(id);
    if (!cell) continue;
    seen.add(id);
    cells.push(cell);
  }
  const joins =
    cells.length >= 2
      ? doc.joinValues().filter((j) => seen.has(j.cellId) && seen.has(j.eportCellId))
      : [];
  return { cells, joins };
}

function normalizeSnapshot(input: ClipboardSnapshot | readonly Cell[]): ClipboardSnapshot {
  return Array.isArray(input) ? { cells: input, joins: [] } : (input as ClipboardSnapshot);
}

/** コピー元セルのポート構造（辺・オフセット・配列要素数・arrayKind）を新しい未結合ポートとして複製する。 */
function cloneUnjoinedCPorts(source: Cell): CPort[] {
  return source.cports.map((p) =>
    CPort.create({
      name: p.name,
      signature: p.signature,
      edgeSide: p.edgeSide,
      offset: p.offset,
      subscript: p.subscript,
      arraySize: p.arraySize,
      arrayKind: p.arrayKind,
    }),
  );
}

function cloneUnjoinedEPorts(source: Cell): EPort[] {
  return source.eports.map((p) =>
    EPort.create({
      name: p.name,
      signature: p.signature,
      edgeSide: p.edgeSide,
      offset: p.offset,
      subscript: p.subscript,
      arraySize: p.arraySize,
      arrayKind: p.arrayKind,
    }),
  );
}

/** テンプレートから新規セルのポートを展開する（固定長は N 個、可変長は必要最大添字+1 個）。 */
function expandTemplatesForFragment<P extends CPort | EPort>(
  templates: readonly PortTemplate[],
  maxSubscripts: ReadonlyMap<string, number>,
  cellWidth: number,
  cellHeight: number,
  factory: (params: Parameters<typeof CPort.create>[0]) => P,
): P[] {
  const result: P[] = [];
  for (const t of templates) {
    const kind = portTemplateArrayKind(t);
    const count =
      kind === "fixed" && t.arraySize !== null
        ? t.arraySize
        : kind === "variable"
          ? Math.max(1, (maxSubscripts.get(t.name) ?? -1) + 1)
          : null;
    if (count === null) {
      result.push(
        factory({
          name: t.name,
          signature: t.signature,
          edgeSide: t.edgeSide,
          offset: t.offset,
          subscript: t.subscript,
          arraySize: t.arraySize,
          arrayKind: kind,
        }),
      );
      continue;
    }
    const edgeLen = t.edgeSide === "TOP" || t.edgeSide === "BOTTOM" ? cellWidth : cellHeight;
    for (let i = 0; i < count; i += 1) {
      result.push(
        factory({
          name: t.name,
          signature: t.signature,
          edgeSide: t.edgeSide,
          offset: Math.min(edgeLen, alignRound(t.offset + i * ARRAY_ELEMENT_GAP_MM)),
          subscript: i,
          arraySize: t.arraySize,
          arrayKind: kind,
        }),
      );
    }
  }
  return result;
}

/**
 * 外部仕様6.7.2・内部仕様4.1節（6-16）: アプリ内クリップボードからの貼り付け。
 * 元の位置から`PASTE_OFFSET_MM`だけずらして全セルを生成し、複数セルコピー時は
 * スナップショットに含まれる内部結合を新セル同士へ再対応・経路再計算して復元する。
 */
export function pasteFromAppClipboard(
  doc: TecscdeDocument,
  input: ClipboardSnapshot | readonly Cell[],
  targetSourceKey?: string,
): TecscdeDocument {
  const snapshot = normalizeSnapshot(input);
  let next = doc;
  const idMap = new Map<CellId, CellId>();

  for (const source of snapshot.cells) {
    const celltype = next.getCelltype(source.celltypeName);
    if (!celltype) continue;
    const name = deriveCellName(next, source.celltypeName);
    const newId = asCellId(name);
    const cell = Cell.create({
      id: newId,
      name,
      celltypeName: source.celltypeName,
      x: alignRound(source.x + PASTE_OFFSET_MM),
      y: alignRound(source.y + PASTE_OFFSET_MM),
      width: source.width,
      height: source.height,
      regionId: targetSourceKey && source.regionId !== ROOT_REGION_ID &&
        !doc.sourceTemplates.get(targetSourceKey)?.scopes.some((scope) => scope.path === source.regionId)
        ? ROOT_REGION_ID : source.regionId,
      editable: true,
      cports: cloneUnjoinedCPorts(source),
      eports: cloneUnjoinedEPorts(source),
      attrs: { ...source.attrs },
      celltypeUnresolved: false,
      locale: targetSourceKey ?? next.editingFileName,
    });
    next = next.withCell(cell);
    idMap.set(source.id, newId);
  }

  if (snapshot.cells.length >= 2) {
    for (const join of snapshot.joins) {
      const newSourceId = idMap.get(join.cellId);
      const newTargetId = idMap.get(join.eportCellId);
      if (!newSourceId || !newTargetId) continue;
      next = new CreateJoinCommand(
        newSourceId,
        join.cportName,
        join.cportSubscript,
        newTargetId,
        join.eportName,
        join.eportSubscript,
      ).apply(next);
    }
  }

  return next;
}

/**
 * 6.7節・4.1節（6-16）: OSクリップボードから解析できたCDL断片からの貼り付け。
 * 断片は位置情報を持たないため、`PASTE_ANCHOR_MM`を起点に`PASTE_OFFSET_MM`刻みで斜めに並べる。
 * 複数セルの断片に内部結合が含まれる場合は、新セル同士へ再対応・経路再計算して復元する。
 */
export function pasteFromCdlFragment(doc: TecscdeDocument, fragments: readonly CdlFragmentCell[], targetSourceKey?: string): TecscdeDocument {
  // 各断片セルで参照される配列ポートの最大添字を集計
  const maxCSub = new Map<string, Map<string, number>>();
  const maxESub = new Map<string, Map<string, number>>();
  const recordSub = (outer: Map<string, Map<string, number>>, cellName: string, portName: string, sub: number | null) => {
    if (sub === null) return;
    let inner = outer.get(cellName);
    if (!inner) {
      inner = new Map<string, number>();
      outer.set(cellName, inner);
    }
    inner.set(portName, Math.max(inner.get(portName) ?? -1, sub));
  };
  if (fragments.length >= 2) {
    for (const frag of fragments) {
      for (const j of frag.joins ?? []) {
        recordSub(maxCSub, frag.cellName, j.cportName, j.cportSubscript);
        recordSub(maxESub, j.targetCellName, j.eportName, j.eportSubscript);
      }
    }
  }

  let next = doc;
  let placed = 0;
  const nameToNewId = new Map<string, CellId>();

  for (const frag of fragments) {
    const celltype = next.getCelltype(frag.celltypeName);
    if (!celltype) continue;
    const name = deriveCellName(next, frag.celltypeName);
    const newId = asCellId(name);
    const pos = PASTE_ANCHOR_MM + placed * PASTE_OFFSET_MM;
    placed += 1;
    const cell = Cell.create({
      id: newId,
      name,
      celltypeName: frag.celltypeName,
      x: alignRound(pos),
      y: alignRound(pos),
      width: DEFAULT_CELL_WIDTH_MM,
      height: DEFAULT_CELL_HEIGHT_MM,
      regionId: ROOT_REGION_ID,
      editable: true,
      cports: expandTemplatesForFragment(
        celltype.cportTemplates,
        maxCSub.get(frag.cellName) ?? new Map(),
        DEFAULT_CELL_WIDTH_MM,
        DEFAULT_CELL_HEIGHT_MM,
        (p) => CPort.create(p),
      ),
      eports: expandTemplatesForFragment(
        celltype.eportTemplates,
        maxESub.get(frag.cellName) ?? new Map(),
        DEFAULT_CELL_WIDTH_MM,
        DEFAULT_CELL_HEIGHT_MM,
        (p) => EPort.create(p),
      ),
      attrs: { ...frag.attrs },
      celltypeUnresolved: false,
      locale: targetSourceKey ?? next.editingFileName,
    });
    next = next.withCell(cell);
    nameToNewId.set(frag.cellName, newId);
  }

  if (fragments.length >= 2) {
    for (const frag of fragments) {
      const newSourceId = nameToNewId.get(frag.cellName);
      if (!newSourceId) continue;
      for (const j of frag.joins ?? []) {
        const newTargetId = nameToNewId.get(j.targetCellName);
        if (!newTargetId) continue;
        next = new CreateJoinCommand(
          newSourceId,
          j.cportName,
          j.cportSubscript,
          newTargetId,
          j.eportName,
          j.eportSubscript,
        ).apply(next);
      }
    }
  }

  return next;
}

/**
 * 履歴を作らない特殊なコマンド（TS内部仕様4.5節）: ドキュメントは変更せず、選択セル（複数時は内部結合含む）を
 * CDL断片としてOSクリップボードへ書き込む副作用のみを行う。
 */
export class CopyCommand extends Command {
  readonly kind = "Copy";
  override readonly summary: string;

  constructor(
    private readonly source: ClipboardSnapshot | readonly CellId[],
    private readonly clipboard: Pick<ClipboardGateway, "writeText">,
  ) {
    super();
    const count = Array.isArray(source) ? source.length : (source as ClipboardSnapshot).cells.length;
    this.summary = `copy ${count} cell(s)`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    const fragment = Array.isArray(this.source)
      ? serializeCellsAsCdl(doc, this.source)
      : serializeClipboardAsCdl(this.source as ClipboardSnapshot);
    void this.clipboard.writeText(fragment);
    return doc;
  }
}

/**
 * 外部仕様6.7.2: アプリ内クリップボードを優先し、空の場合のみOSクリップボードのCDL断片を試みる。
 */
export class PasteCommand extends Command {
  readonly kind = "Paste";
  private readonly appSnapshot: ClipboardSnapshot;

  constructor(
    appClipboard: ClipboardSnapshot | readonly Cell[],
    private readonly osClipboardText: string | undefined,
    private readonly targetSourceKey?: string,
  ) {
    super();
    this.appSnapshot = normalizeSnapshot(appClipboard);
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    if (this.appSnapshot.cells.length > 0) {
      return pasteFromAppClipboard(doc, this.appSnapshot, this.targetSourceKey);
    }
    if (this.osClipboardText === undefined) return doc;
    const fragment = tryParseCdlFragment(this.osClipboardText);
    return fragment ? pasteFromCdlFragment(doc, fragment, this.targetSourceKey) : doc;
  }
}

/**
 * 外部仕様6.7.2・TS内部仕様4.5節: `DeleteCommand`相当のカスケード削除を`kind: "Cut"`として
 * 履歴に残す。OSクリップボードへの書き込みは含まない——ファイル冒頭「設計上の差分2」のとおり、
 * `history.commit()`で繰り返し再生されるコマンドに副作用を持たせないため、呼び出し側
 * （`AppStore.cutSelection`）が`apply()`を通さず1回だけ`serializeCellsAsCdl`+`writeText`する。
 */
export class CutCommand extends Command {
  readonly kind = "Cut";
  override readonly summary: string;

  constructor(
    private readonly cellIds: readonly CellId[],
    private readonly joinIds: readonly JoinId[],
  ) {
    super();
    this.summary = `cut ${cellIds.length} cell(s), ${joinIds.length} join(s)`;
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    return new DeleteCommand(this.cellIds, this.joinIds).apply(doc);
  }
}
