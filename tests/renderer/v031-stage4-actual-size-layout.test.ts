import { describe, expect, it } from "vitest";
import { placeAutoCells, type Rect } from "../../src/renderer/cdl/auto-placement";
import { AutoPlaceCellsCommand, planAutoPlacement } from "../../src/renderer/commands/layout-commands";
import { prepareMoveActiveToTop } from "../../src/renderer/commands/move-active-to-top";
import { Cell } from "../../src/renderer/model/cell";
import { CelltypeRef } from "../../src/renderer/model/celltype";
import { TecscdeDocument } from "../../src/renderer/model/document";
import { asCellId, ROOT_REGION_ID } from "../../src/renderer/model/ids";
import { PaperSpec } from "../../src/renderer/model/paper";
import { emptyToolInfoTecsgen } from "../../src/renderer/model/tool-info-types";

const A4 = PaperSpec.create("A4", "LANDSCAPE").contentSize(); // 277 x 190 mm

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function makeCell(
  id: string,
  celltypeName: string,
  x: number,
  y: number,
  width: number,
  height: number,
  editable = true,
): Cell {
  return Cell.create({
    id: asCellId(id),
    name: id,
    celltypeName,
    x,
    y,
    width,
    height,
    regionId: ROOT_REGION_ID,
    editable,
    cports: [],
    eports: [],
    attrs: {},
    celltypeUnresolved: false,
  });
}

describe("V0.3.1 Stage 4: actual cell dimensions in relayout (6-8) and moveActiveToTop (6-12)", () => {
  it("6-8: placeAutoCells uses actual cell width/height to avoid overlap and stay within paper", () => {
    // 60 mm wide cells: (10,10) occupies x=10..70, so x=65 overlaps -> second cell must go to x=120
    const sizes = [
      { width: 60, height: 40 },
      { width: 60, height: 40 },
      { width: 60, height: 40 },
    ];
    const { positions, overflow } = placeAutoCells(sizes, [], A4.width, A4.height);

    expect(overflow).toBe(0);
    expect(positions[0]).toEqual({ x: 10, y: 10 });
    expect(positions[1]).toEqual({ x: 120, y: 10 });
    // x=230 + 60 = 290 > 277 (paperW), so third cell cannot go to (230, 10);
    // y=40 overlaps y=10..50, so it must skip y=40 and go to (10, 70)
    expect(positions[2]).toEqual({ x: 10, y: 70 });

    const rects: Rect[] = positions.map((p, i) => ({ ...p, ...sizes[i]! }));
    for (let i = 0; i < rects.length; i += 1) {
      expect(rects[i]!.x + rects[i]!.width).toBeLessThanOrEqual(A4.width);
      expect(rects[i]!.y + rects[i]!.height).toBeLessThanOrEqual(A4.height);
      for (let j = i + 1; j < rects.length; j += 1) {
        expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
      }
    }
  });

  it("6-8: planAutoPlacement & AutoPlaceCellsCommand pass actual cell dimensions from document", () => {
    const ct = CelltypeRef.create({
      name: "tBig",
      cportTemplates: [],
      eportTemplates: [],
      attributeNames: [],
      hiddenRequirePortCount: 0,
    });
    const c1 = makeCell("Big1", "tBig", 100, 100, 60, 40);
    const c2 = makeCell("Big2", "tBig", 100, 100, 60, 40);
    const doc = TecscdeDocument.build({
      cells: new Map([
        [c1.id, c1],
        [c2.id, c2],
      ]),
      joins: new Map(),
      celltypes: new Map([[ct.name, ct]]),
      toolInfoTecsgen: emptyToolInfoTecsgen(),
      paper: PaperSpec.create("A4", "LANDSCAPE"),
      referenceFiles: [],
      unknownToolInfoTecscde: {},
    });

    const plan = planAutoPlacement(doc, [c1.id, c2.id]);
    expect(plan.overflow).toBe(0);
    expect(plan.positions).toEqual([
      { x: 10, y: 10 },
      { x: 120, y: 10 },
    ]);

    const next = new AutoPlaceCellsCommand([c1.id, c2.id]).apply(doc);
    const moved1 = next.getCell(c1.id)!;
    const moved2 = next.getCell(c2.id)!;
    expect(overlaps(moved1, moved2)).toBe(false);
  });

  it("6-12: prepareMoveActiveToTop checks paper bounds with actual cell width/height", () => {
    const ctActive = CelltypeRef.create({
      name: "tTask",
      cportTemplates: [],
      eportTemplates: [],
      attributeNames: [],
      hiddenRequirePortCount: 0,
      active: true,
    });
    // Obstacle blocks (10,10)..(220,10) so only x=230 is free on top row;
    // a 60mm wide active cell at x=230 would end at 290 > 277, so it must spill to next row (10, 40)
    const obs = makeCell("Obs", "tObs", 10, 10, 210, 15, false);
    const wideActive = makeCell("WideTask", "tTask", 50, 100, 60, 15, true);
    const doc = TecscdeDocument.build({
      cells: new Map([
        [obs.id, obs],
        [wideActive.id, wideActive],
      ]),
      joins: new Map(),
      celltypes: new Map([[ctActive.name, ctActive]]),
      toolInfoTecsgen: emptyToolInfoTecsgen(),
      paper: PaperSpec.create("A4", "LANDSCAPE"),
      referenceFiles: [],
      unknownToolInfoTecscde: {},
    });

    const plan = prepareMoveActiveToTop(doc);
    expect(plan.success).toBe(true);
    const pos = plan.moves.get(wideActive.id)!;
    expect(pos.x + wideActive.width).toBeLessThanOrEqual(A4.width);
    expect(pos.y + wideActive.height).toBeLessThanOrEqual(A4.height);
    expect(pos).toEqual({ x: 10, y: 40 });
    expect(plan.spilledCellIds).toEqual([wideActive.id]);
  });

  it("6-12: prepareMoveActiveToTop resets scan per cell so a smaller later cell uses an earlier free slot", () => {
    const ctActive = CelltypeRef.create({
      name: "tTask",
      cportTemplates: [],
      eportTemplates: [],
      attributeNames: [],
      hiddenRequirePortCount: 0,
      active: true,
    });
    // Obstacle at x=40..60, y=10..25:
    // - WideTask (width 60) cannot fit at (10,10) (10..70 overlaps 40..60), so it goes to (65,10)
    // - SmallTask (width 25) CAN fit at (10,10) (10..35 does not overlap 40..60)!
    const obs = makeCell("Obs", "tObs", 40, 10, 20, 15, false);
    const wideActive = makeCell("WideTask", "tTask", 50, 100, 60, 15, true);
    const smallActive = makeCell("SmallTask", "tTask", 120, 100, 25, 15, true);
    const doc = TecscdeDocument.build({
      cells: new Map([
        [obs.id, obs],
        [wideActive.id, wideActive],
        [smallActive.id, smallActive],
      ]),
      joins: new Map(),
      celltypes: new Map([[ctActive.name, ctActive]]),
      toolInfoTecsgen: emptyToolInfoTecsgen(),
      paper: PaperSpec.create("A4", "LANDSCAPE"),
      referenceFiles: [],
      unknownToolInfoTecscde: {},
    });

    const plan = prepareMoveActiveToTop(doc);
    expect(plan.success).toBe(true);
    expect(plan.moves.get(wideActive.id)).toEqual({ x: 65, y: 10 });
    expect(plan.moves.get(smallActive.id)).toEqual({ x: 10, y: 10 });
  });
});
