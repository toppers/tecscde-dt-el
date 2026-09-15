// TECSCDE-TS内部仕様 3.2 — TecscdeDocument。ルート集約。
// 内部のMapをprivateフィールドとして隠蔽し、getCell/withCell等の問い合わせ・更新メソッドのみを公開する
// （既存内部仕様のinterface版はReadonlyMapを直接公開していたが、本書はこれをカプセル化する）。

import type { CellId, JoinId } from "./ids";
import { Cell } from "./cell";
import type { CelltypeRef } from "./celltype";
import { Join } from "./join";
import { PaperSpec } from "./paper";
import { RegionTree } from "./region";
import { emptyToolInfoTecsgen, type ToolInfoTecsgen } from "./tool-info-types";

export interface TecscdeDocumentBuildParams {
  readonly cells: ReadonlyMap<CellId, Cell>;
  readonly joins: ReadonlyMap<JoinId, Join>;
  readonly celltypes: ReadonlyMap<string, CelltypeRef>;
  readonly regions?: RegionTree;
  readonly toolInfoTecsgen: ToolInfoTecsgen;
  readonly paper: PaperSpec;
  /** 8.2.2: 今回のセッションで参照専用として読み込んだファイル名のみ。 */
  readonly referenceFiles: readonly string[];
  /** 編集対象ファイル名。5.2.2: 新規作成時は未設定。 */
  readonly editingFileName?: string;
  /** 5.5.2: __tool_info__("tecscde") の未知キーを保持して書き戻す。 */
  readonly unknownToolInfoTecscde: Readonly<Record<string, unknown>>;
  /**
   * 内部仕様3章: モデルに反映しない構文（import / import_C）を入力時のテキストの
   * まま保持し、保存時にそのまま書き戻す。参照先は追跡しない（外部仕様8.1.2）。
   */
  readonly preservedImports?: readonly string[];
}

export class TecscdeDocument {
  private constructor(
    private readonly cellsById: ReadonlyMap<CellId, Cell>,
    private readonly joinsById: ReadonlyMap<JoinId, Join>,
    private readonly celltypesByName: ReadonlyMap<string, CelltypeRef>,
    readonly regions: RegionTree,
    readonly toolInfoTecsgen: ToolInfoTecsgen,
    readonly paper: PaperSpec,
    readonly referenceFiles: readonly string[],
    readonly editingFileName: string | undefined,
    readonly unknownToolInfoTecscde: Readonly<Record<string, unknown>>,
    readonly preservedImports: readonly string[],
  ) {}

  static empty(): TecscdeDocument {
    return new TecscdeDocument(
      new Map(),
      new Map(),
      new Map(),
      RegionTree.empty(),
      emptyToolInfoTecsgen(),
      PaperSpec.default(),
      [],
      undefined,
      {},
      [],
    );
  }

  /** モジュールB（CdlDocumentLoader）がパース結果一式からまとめて構築する際の入口。 */
  static build(params: TecscdeDocumentBuildParams): TecscdeDocument {
    return new TecscdeDocument(
      params.cells,
      params.joins,
      params.celltypes,
      params.regions ?? RegionTree.empty(),
      params.toolInfoTecsgen,
      params.paper,
      params.referenceFiles,
      params.editingFileName,
      params.unknownToolInfoTecscde,
      params.preservedImports ?? [],
    );
  }

  getCell(id: CellId): Cell | undefined {
    return this.cellsById.get(id);
  }

  getJoin(id: JoinId): Join | undefined {
    return this.joinsById.get(id);
  }

  getCelltype(name: string): CelltypeRef | undefined {
    return this.celltypesByName.get(name);
  }

  get cellCount(): number {
    return this.cellsById.size;
  }

  get joinCount(): number {
    return this.joinsById.size;
  }

  get celltypeCount(): number {
    return this.celltypesByName.size;
  }

  cellValues(): readonly Cell[] {
    return Array.from(this.cellsById.values());
  }

  joinValues(): readonly Join[] {
    return Array.from(this.joinsById.values());
  }

  celltypeValues(): readonly CelltypeRef[] {
    return Array.from(this.celltypesByName.values());
  }

  withCell(cell: Cell): TecscdeDocument {
    const next = new Map(this.cellsById);
    next.set(cell.id, cell);
    return new TecscdeDocument(
      next,
      this.joinsById,
      this.celltypesByName,
      this.regions,
      this.toolInfoTecsgen,
      this.paper,
      this.referenceFiles,
      this.editingFileName,
      this.unknownToolInfoTecscde,
      this.preservedImports,
    );
  }

  withoutCell(id: CellId): TecscdeDocument {
    const next = new Map(this.cellsById);
    next.delete(id);
    return new TecscdeDocument(
      next,
      this.joinsById,
      this.celltypesByName,
      this.regions,
      this.toolInfoTecsgen,
      this.paper,
      this.referenceFiles,
      this.editingFileName,
      this.unknownToolInfoTecscde,
      this.preservedImports,
    );
  }

  withJoin(join: Join): TecscdeDocument {
    const next = new Map(this.joinsById);
    next.set(join.id, join);
    return new TecscdeDocument(
      this.cellsById,
      next,
      this.celltypesByName,
      this.regions,
      this.toolInfoTecsgen,
      this.paper,
      this.referenceFiles,
      this.editingFileName,
      this.unknownToolInfoTecscde,
      this.preservedImports,
    );
  }

  withoutJoin(id: JoinId): TecscdeDocument {
    const next = new Map(this.joinsById);
    next.delete(id);
    return new TecscdeDocument(
      this.cellsById,
      next,
      this.celltypesByName,
      this.regions,
      this.toolInfoTecsgen,
      this.paper,
      this.referenceFiles,
      this.editingFileName,
      this.unknownToolInfoTecscde,
      this.preservedImports,
    );
  }
}
