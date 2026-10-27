// [[TECSCDE-DT-EL内部仕様]] 第2章2.3節「G: UIシェル」モジュールG次段 — プロパティパネル
// （外部仕様3.4節）。選択中のセル／ポート／結合に応じて表示を切り替え（3.4.2）、
// 複数選択時は個別編集不可の旨を示す。編集不可のオブジェクトは入力欄を読み取り専用にし、
// その旨を文言で示す（色のみによる区別はしない、3.4.2）。
//
import {
  RenameCellCommand,
  EditAttrCommand,
  EditCellsAttrCommand,
  ChangeRegionCommand,
  ChangeCellsRegionCommand,
} from "../commands";
import type { Cell } from "../model/cell";
import type { Join } from "../model/join";
import type { TecscdeDocument } from "../model/document";
import type { Region } from "../model/region";
import type { SelectedPort, SelectionState } from "../render/view";
import type { AppStore } from "./store";

function field(labelText: string): { wrapper: HTMLDivElement; input: HTMLInputElement } {
  const wrapper = document.createElement("div");
  wrapper.className = "prop-field";
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.setAttribute("aria-label", labelText);
  wrapper.append(label, input);
  return { wrapper, input };
}

function comboField(
  labelText: string,
  options: readonly string[],
): { wrapper: HTMLDivElement; select: HTMLSelectElement } {
  const wrapper = document.createElement("div");
  wrapper.className = "prop-field";
  const label = document.createElement("label");
  label.textContent = labelText;
  const select = document.createElement("select");
  select.setAttribute("aria-label", labelText);
  for (const opt of options) {
    const optEl = document.createElement("option");
    optEl.value = opt;
    optEl.textContent = opt;
    select.appendChild(optEl);
  }
  wrapper.append(label, select);
  return { wrapper, select };
}

function note(text: string, className = "prop-note"): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  return el;
}

function selectedPort(doc: TecscdeDocument, selected: SelectedPort) {
  const cell = doc.getCell(selected.cellId);
  const ports = selected.kind === "cport" ? cell?.cports : cell?.eports;
  const port = ports?.find((candidate) => candidate.name === selected.portName && candidate.subscript === selected.subscript);
  if (!cell || !port) return undefined;
  const joinCount = "joinId" in port ? (port.joinId === null ? 0 : 1) : port.joinIds.length;
  return { cell, port, joinCount };
}

export class PropertyPanelView {
  /**
   * 直近に描画した選択・セル/結合データの署名。notify()のたびに全DOM再構築すると、
   * 未コミット（change未発火）の入力中フィールドが無関係な更新（パン・モード切替・
   * tecsgen診断等）で消え、フォーカスも失われるため、実際に表示内容が変わる場合のみ
   * 再構築する（palette.tsのlastCelltypeSignatureと同じ方針）。
   */
  private lastSignature: string | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: AppStore,
  ) {}

  render(): void {
    const selection = this.store.selection;
    const doc = this.store.getDocument();

    const signature = this.computeSignature(selection, doc);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.root.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = "プロパティ";
    this.root.appendChild(heading);

    if (selection.ports.length > 0) {
      this.renderPorts(doc, selection.ports);
      return;
    }
    if (selection.isEmpty) {
      this.root.appendChild(note("(未選択)"));
      return;
    }
    if (selection.cellIds.size > 1 && selection.joinIds.size === 0) {
      const cells = [...selection.cellIds]
        .map((id) => doc.getCell(id))
        .filter((c): c is Cell => c !== undefined);
      if (cells.length > 0) {
        this.renderMultipleCells(doc, cells);
        return;
      }
    }
    if (selection.cellIds.size > 1 || selection.joinIds.size > 1 || (selection.cellIds.size > 0 && selection.joinIds.size > 0)) {
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

  /** render()が実際に描画へ使う全入力を反映した署名。これが不変なら再構築不要。 */
  private computeSignature(selection: SelectionState, doc: TecscdeDocument): string {
    if (selection.ports.length > 0) {
      return JSON.stringify(selection.ports.map((selected) => {
        const details = selectedPort(doc, selected);
        return details ? {
          selected, name: details.cell.name, editable: details.cell.editable,
          signature: details.port.signature, edge: details.port.edgeSide, offset: details.port.offset,
          arraySize: details.port.arraySize, joinCount: details.joinCount,
        } : { selected, missing: true };
      }));
    }
    if (selection.isEmpty) return "none";
    if (selection.cellIds.size > 1 && selection.joinIds.size === 0) {
      const cells = [...selection.cellIds]
        .map((id) => doc.getCell(id))
        .filter((c): c is Cell => c !== undefined);
      const cellsSig = cells.map((c) => {
        const attrsSig = Object.entries(c.attrs)
          .map(([k, v]) => `${k}=${v}`)
          .join(",");
        return `${c.id}:${c.editable}:${c.regionId}:${attrsSig}`;
      }).join(";");
      return `multi-cells|${cells.length}|${cellsSig}`;
    }
    if (selection.cellIds.size > 1 || selection.joinIds.size > 1 || (selection.cellIds.size > 0 && selection.joinIds.size > 0)) {
      return `multi|${selection.cellIds.size}|${selection.joinIds.size}`;
    }
    if (selection.joinIds.size > 0) {
      const joinId = [...selection.joinIds][0]!;
      const join = doc.getJoin(joinId);
      if (!join) return `join-missing|${joinId}`;
      const source = doc.getCell(join.cellId);
      const target = doc.getCell(join.eportCellId);
      return `join|${joinId}|${source?.name ?? ""}|${join.cportName}|${target?.name ?? ""}|${join.eportName}`;
    }
    const cellId = [...selection.cellIds][0]!;
    const cell = doc.getCell(cellId);
    if (!cell) return `cell-missing|${cellId}`;
    const region = doc.regions.findById(cell.regionId)?.namespacePath ?? cell.regionId;
    const regionOptions = this.regionOptions(doc).map((r) => r.namespacePath).join(",");
    const attrsSig = Object.entries(cell.attrs)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return [
      "cell",
      cell.id,
      cell.editable,
      cell.name,
      cell.celltypeName,
      cell.celltypeUnresolved,
      doc.getCelltype(cell.celltypeName)?.hasUnsupportedSyntax ?? false,
      region,
      regionOptions,
      attrsSig,
    ].join("|");
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

  private renderPorts(doc: TecscdeDocument, selected: readonly SelectedPort[]): void {
    this.root.appendChild(note("ポート情報（読み取り専用）"));
    for (const reference of selected) {
      const details = selectedPort(doc, reference);
      if (!details) {
        this.root.appendChild(note("選択したポートが見つかりません。"));
        continue;
      }
      const { cell, port, joinCount } = details;
      const section = document.createElement("section");
      section.className = "prop-port";
      const heading = document.createElement("h4");
      heading.textContent = `${reference.kind === "cport" ? "呼び口" : "受け口"}: ${port.name}${port.subscript === null ? "" : `[${port.subscript}]`}`;
      section.appendChild(heading);
      if (!cell.editable) section.appendChild(note("このセルは読み取り専用です。", "prop-readonly-note"));
      const edges = { LEFT: "左", RIGHT: "右", TOP: "上", BOTTOM: "下" };
      const fields: readonly (readonly [string, string])[] = [
        ["所属セル", cell.name], ["名前", port.name], ["シグニチャ", port.signature],
        ["配列添字", port.subscript === null ? "—" : String(port.subscript)],
        ["配列長", port.arraySize === null ? "—" : String(port.arraySize)],
        ["辺", edges[port.edgeSide]], ["位置 (mm)", String(port.offset)], ["結合数", String(joinCount)],
      ];
      for (const [label, value] of fields) {
        const item = field(label);
        item.input.value = value;
        item.input.readOnly = true;
        item.input.setAttribute("aria-label", label);
        section.appendChild(item.wrapper);
      }
      this.root.appendChild(section);
    }
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
    const regionSelect = document.createElement("select");
    regionSelect.setAttribute("aria-label", "region");
    const sourceTemplate = doc.sourceTemplates.get(cell.locale ?? "") ?? doc.sourceTemplate;
    for (const region of this.regionOptions(doc)) {
      const option = document.createElement("option");
      option.value = region.id;
      option.textContent = region.namespacePath;
      option.disabled = region.id !== doc.regions.root.id &&
        !!sourceTemplate && !sourceTemplate.scopes.some((scope) => scope.path === region.namespacePath);
      regionSelect.appendChild(option);
    }
    regionSelect.value = cell.regionId;
    regionSelect.disabled = !cell.editable;
    regionSelect.addEventListener("change", () => {
      this.store.dispatch(new ChangeRegionCommand(cell.id, regionSelect.value as Cell["regionId"]));
    });
    regionField.input.replaceWith(regionSelect);
    this.root.appendChild(regionField.wrapper);

    if (cell.celltypeUnresolved) {
      this.root.appendChild(note("セルタイプが解決できないため、ポート構成が不明です。", "prop-readonly-note"));
    }

    const celltype = doc.getCelltype(cell.celltypeName);
    if (celltype?.hasUnsupportedSyntax) {
      this.root.appendChild(note("未対応構文があります。", "prop-readonly-note"));
    }
    const attrNames = celltype?.attributeNames ?? Object.keys(cell.attrs);
    for (const attrName of attrNames) {
      const options = celltype?.getAttributeOptions(attrName);
      if (options && options.length > 0) {
        const combo = comboField(attrName, options);
        const val = cell.attrs[attrName] ?? "";
        if (val && !options.includes(val)) {
          const optEl = document.createElement("option");
          optEl.value = val;
          optEl.textContent = val;
          combo.select.insertBefore(optEl, combo.select.firstChild);
        }
        combo.select.value = val || (options[0] ?? "");
        combo.select.disabled = !cell.editable;
        combo.select.addEventListener("change", () => {
          this.store.dispatch(new EditAttrCommand(cell.id, attrName, combo.select.value));
        });
        this.root.appendChild(combo.wrapper);
      } else {
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

  private renderMultipleCells(doc: TecscdeDocument, cells: readonly Cell[]): void {
    this.root.appendChild(note(`(複数選択: ${cells.length}個のセル — 共通項目を編集できます)`));

    if (cells.some((c) => !c.editable)) {
      this.root.appendChild(note("読み込み専用ファイル由来のセルが含まれます。", "prop-readonly-note"));
    }

    const nameField = field("name");
    nameField.input.value = "(複数選択)";
    nameField.input.readOnly = true;
    this.root.appendChild(nameField.wrapper);

    const sameCelltype = cells.every((c) => c.celltypeName === cells[0]!.celltypeName);
    const typeField = field("celltype");
    typeField.input.value = sameCelltype ? cells[0]!.celltypeName : "(複数)";
    typeField.input.readOnly = true;
    this.root.appendChild(typeField.wrapper);

    const sameRegion = cells.every((c) => c.regionId === cells[0]!.regionId);
    const regionField = field("region");
    const regionSelect = document.createElement("select");
    regionSelect.setAttribute("aria-label", "region");

    if (!sameRegion) {
      const multiOpt = document.createElement("option");
      multiOpt.value = "";
      multiOpt.textContent = "(複数)";
      multiOpt.disabled = true;
      multiOpt.selected = true;
      regionSelect.appendChild(multiOpt);
    }

    for (const region of this.regionOptions(doc)) {
      const option = document.createElement("option");
      option.value = region.id;
      option.textContent = region.namespacePath;
      regionSelect.appendChild(option);
    }
    if (sameRegion) {
      regionSelect.value = cells[0]!.regionId;
    }
    const allReadOnly = cells.every((c) => !c.editable);
    regionSelect.disabled = allReadOnly;

    regionSelect.addEventListener("change", () => {
      const editableIds = cells.filter((c) => c.editable).map((c) => c.id);
      if (editableIds.length > 0 && regionSelect.value) {
        this.store.dispatch(new ChangeCellsRegionCommand(editableIds, regionSelect.value as Cell["regionId"]));
      }
    });
    regionField.input.replaceWith(regionSelect);
    this.root.appendChild(regionField.wrapper);

    const getAttrNames = (c: Cell): string[] => {
      const ct = doc.getCelltype(c.celltypeName);
      return ct?.attributeNames ? [...ct.attributeNames] : Object.keys(c.attrs);
    };
    const commonAttrNames = getAttrNames(cells[0]!).filter((attr) =>
      cells.slice(1).every((c) => getAttrNames(c).includes(attr)),
    );

    for (const attrName of commonAttrNames) {
      const firstCt = doc.getCelltype(cells[0]!.celltypeName);
      const firstOptions = firstCt?.getAttributeOptions(attrName);
      const allHaveSameOptions = Boolean(firstOptions) && cells.every((c) => {
        const ct = doc.getCelltype(c.celltypeName);
        const opts = ct?.getAttributeOptions(attrName);
        return opts && opts.length === firstOptions!.length && opts.every((o, i) => o === firstOptions![i]);
      });

      if (allHaveSameOptions && firstOptions) {
        const combo = comboField(attrName, firstOptions);
        const firstVal = cells[0]!.attrs[attrName] ?? "";
        const sameVal = cells.every((c) => (c.attrs[attrName] ?? "") === firstVal);
        if (!sameVal) {
          const multiOpt = document.createElement("option");
          multiOpt.value = "";
          multiOpt.textContent = "(複数)";
          multiOpt.disabled = true;
          multiOpt.selected = true;
          combo.select.insertBefore(multiOpt, combo.select.firstChild);
          combo.select.value = "";
        } else {
          if (firstVal && !firstOptions.includes(firstVal)) {
            const optEl = document.createElement("option");
            optEl.value = firstVal;
            optEl.textContent = firstVal;
            combo.select.insertBefore(optEl, combo.select.firstChild);
          }
          combo.select.value = firstVal || (firstOptions[0] ?? "");
        }
        combo.select.disabled = allReadOnly;
        combo.select.addEventListener("change", () => {
          const editableIds = cells.filter((c) => c.editable).map((c) => c.id);
          if (editableIds.length > 0 && combo.select.value) {
            this.store.dispatch(new EditCellsAttrCommand(editableIds, attrName, combo.select.value));
          }
        });
        this.root.appendChild(combo.wrapper);
      } else {
        const attrField = field(attrName);
        const firstVal = cells[0]!.attrs[attrName] ?? "";
        const sameVal = cells.every((c) => (c.attrs[attrName] ?? "") === firstVal);
        if (sameVal) {
          attrField.input.value = firstVal;
        } else {
          attrField.input.value = "";
          attrField.input.placeholder = "(複数)";
        }
        attrField.input.readOnly = allReadOnly;
        attrField.input.addEventListener("change", () => {
          const editableIds = cells.filter((c) => c.editable).map((c) => c.id);
          if (editableIds.length > 0) {
            this.store.dispatch(new EditCellsAttrCommand(editableIds, attrName, attrField.input.value));
          }
        });
        this.root.appendChild(attrField.wrapper);
      }
    }
  }

  private regionOptions(doc: TecscdeDocument): Region[] {
    const result: Region[] = [];
    const visit = (region: Region): void => {
      result.push(region);
      for (const child of region.children) visit(child);
    };
    visit(doc.regions.root);
    return result;
  }
}
