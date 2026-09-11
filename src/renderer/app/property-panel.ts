// [[TECSCDE-DT-EL内部仕様]] 第2章2.3節「G: UIシェル」モジュールG次段 — プロパティパネル
// （外部仕様3.4節）。選択中のセル／結合に応じて表示を切り替え（3.4.2、対象をセルに限定しない）、
// 複数選択時は個別編集不可の旨を示す。編集不可のオブジェクトは入力欄を読み取り専用にし、
// その旨を文言で示す（色のみによる区別はしない、3.4.2）。
//
// regionフィールドは読み取り専用: 11.3の実装単位ではRegionTreeへのセル割り当てが未接続
// （全セルがROOTに置かれる、cdl/document-builder.ts参照）のため、切り替え先のリージョンが
// 実質存在しない。`ChangeRegionCommand`自体は第4章に実装済みだが、UIからの配線は
// RegionTreeが実際に複数ノードを持つようになってから行う。

import { RenameCellCommand, EditAttrCommand } from "../commands";
import type { Cell } from "../model/cell";
import type { Join } from "../model/join";
import type { TecscdeDocument } from "../model/document";
import type { AppStore } from "./store";

function field(labelText: string): { wrapper: HTMLDivElement; input: HTMLInputElement } {
  const wrapper = document.createElement("div");
  wrapper.className = "prop-field";
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  wrapper.append(label, input);
  return { wrapper, input };
}

function note(text: string, className = "prop-note"): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  return el;
}

export class PropertyPanelView {
  constructor(
    private readonly root: HTMLElement,
    private readonly store: AppStore,
  ) {}

  render(): void {
    this.root.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = "プロパティ";
    this.root.appendChild(heading);

    const selection = this.store.selection;
    const doc = this.store.getDocument();

    if (selection.cellIds.size === 0 && selection.joinIds.size === 0) {
      this.root.appendChild(note("(未選択)"));
      return;
    }
    if (selection.cellIds.size > 1 || (selection.cellIds.size > 0 && selection.joinIds.size > 0)) {
      this.root.appendChild(note("(複数選択 — 個別編集はセルを1つだけ選択してください)"));
      return;
    }
    if (selection.joinIds.size > 0) {
      const joinId = [...selection.joinIds][0]!;
      const join = doc.getJoin(joinId);
      if (join) this.renderJoin(doc, join);
      return;
    }
    const cellId = [...selection.cellIds][0]!;
    const cell = doc.getCell(cellId);
    if (cell) this.renderCell(doc, cell);
  }

  private renderJoin(doc: TecscdeDocument, join: Join): void {
    this.root.appendChild(note("(結合を選択中 — 属性編集はセル選択時のみ)"));
    const source = doc.getCell(join.cellId);
    const target = doc.getCell(join.eportCellId);
    const info = document.createElement("div");
    info.className = "prop-readonly";
    info.textContent = `${source?.name ?? "?"}.${join.cportName} → ${target?.name ?? "?"}.${join.eportName}`;
    this.root.appendChild(info);
  }

  private renderCell(doc: TecscdeDocument, cell: Cell): void {
    if (!cell.editable) {
      this.root.appendChild(note("このセルは読み込み専用ファイル由来のため編集できません。", "prop-readonly-note"));
    }

    const nameField = field("name");
    nameField.input.value = cell.name;
    nameField.input.readOnly = !cell.editable;
    nameField.input.addEventListener("change", () => {
      if (nameField.input.value !== cell.name) {
        this.store.dispatch(new RenameCellCommand(cell.id, nameField.input.value));
      }
    });
    this.root.appendChild(nameField.wrapper);

    const typeField = field("celltype");
    typeField.input.value = cell.celltypeName;
    typeField.input.readOnly = true;
    this.root.appendChild(typeField.wrapper);

    const regionField = field("region");
    regionField.input.value = doc.regions.findById(cell.regionId)?.namespacePath ?? cell.regionId;
    regionField.input.readOnly = true;
    this.root.appendChild(regionField.wrapper);

    if (cell.celltypeUnresolved) {
      this.root.appendChild(note("セルタイプが解決できないため、ポート構成が不明です。", "prop-readonly-note"));
    }

    const celltype = doc.celltypeValues().find((c) => c.name === cell.celltypeName);
    const attrNames = celltype?.attributeNames ?? Object.keys(cell.attrs);
    for (const attrName of attrNames) {
      const attrField = field(attrName);
      attrField.input.value = cell.attrs[attrName] ?? "";
      attrField.input.readOnly = !cell.editable;
      attrField.input.addEventListener("change", () => {
        this.store.dispatch(new EditAttrCommand(cell.id, attrName, attrField.input.value));
      });
      this.root.appendChild(attrField.wrapper);
    }
  }
}
