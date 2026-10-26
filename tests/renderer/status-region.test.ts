// 外部仕様4.9.2 — セルを選択したとき、所属リージョンをステータス表示に示す。

import { describe, expect, it } from "vitest";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { regionStatusText } from "../../src/renderer/app/status-region";
import { asCellId } from "../../src/renderer/model/ids";
import { SelectionState } from "../../src/renderer/render/view";
import type { TecscdeDocument } from "../../src/renderer/model/document";

const CDL = `
namespace N {
  region A { cell tLogger a1 {}; cell tLogger a2 {}; region A1 { cell tLogger x1 {}; }; };
  region B { cell tLogger b1 {}; };
};
cell tLogger top {};`;

let doc: TecscdeDocument;
const sel = (...ids: string[]) =>
  ids.reduce((s, id) => s.withCellAdded(asCellId(id)), SelectionState.empty());

describe("regionStatusText — 外部仕様4.9.2", () => {
  doc = undefined as unknown as TecscdeDocument;
  const load = (): TecscdeDocument => (doc ??= CdlDocumentLoader.loadSingle(CDL, "main.cde").document);

  it("is empty when no cell is selected", () => {
    expect(regionStatusText(load(), SelectionState.empty())).toBe("");
  });

  it("shows the region path of a single selected cell", () => {
    expect(regionStatusText(load(), sel("a1"))).toBe("リージョン: ::N::A");
    expect(regionStatusText(load(), sel("x1"))).toBe("リージョン: ::N::A::A1");
  });

  it("shows 'ルート' for a cell that belongs to no named region", () => {
    expect(regionStatusText(load(), sel("top"))).toBe("リージョン: ルート");
  });

  it("shows the shared region when all selected cells are in the same region", () => {
    expect(regionStatusText(load(), sel("a1", "a2"))).toBe("リージョン: ::N::A");
  });

  it("shows how many regions when the selection spans several", () => {
    expect(regionStatusText(load(), sel("a1", "b1"))).toBe("リージョン: 複数（2）");
    expect(regionStatusText(load(), sel("a1", "b1", "top"))).toBe("リージョン: 複数（3）");
  });

  it("ignores a join selection and unknown cell ids", () => {
    expect(regionStatusText(load(), SelectionState.empty().withCellAdded(asCellId("nope")))).toBe("");
  });
});
