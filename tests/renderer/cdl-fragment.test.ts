// [[TECSCDE-DT-EL内部仕様]] 第4章4.1節 — CDL断片（cellブロックのみ）のシリアライズ／パース。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import { serializeCellsAsCdl, tryParseCdlFragment } from "../../src/renderer/cdl/fragment";
import { asCellId } from "../../src/renderer/model/ids";
import type { TecscdeDocument } from "../../src/renderer/model/document";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
const mainText = readFileSync(resolve(__dirname, "../../public/samples/main.cde"), "utf-8");

function loadDoc(): TecscdeDocument {
  return CdlDocumentLoader.loadSources([
    { text: celltypesText, fileName: "celltypes.cdl", editable: false },
    { text: mainText, fileName: "main.cde", editable: true },
  ]).document;
}

const LOGGER = asCellId("cLogger1");
const SENSOR = asCellId("cSensor1");

describe("serializeCellsAsCdl", () => {
  it("emits one cell block per id, with attrs but no joins or position", () => {
    const doc = loadDoc();
    const text = serializeCellsAsCdl(doc, [LOGGER, SENSOR]);
    expect(text).toBe(["cell tLogger cLogger1 {\n  level = 1;\n}", "cell tSensor cSensor1 {\n}"].join("\n\n"));
    expect(text).not.toMatch(/=.*\./); // 結合(join)代入(`x = y.z;`)は含まない
  });

  it("skips ids that don't resolve to a cell", () => {
    const doc = loadDoc();
    expect(serializeCellsAsCdl(doc, [asCellId("noSuchCell")])).toBe("");
  });
});

describe("tryParseCdlFragment", () => {
  it("round-trips a fragment produced by serializeCellsAsCdl", () => {
    const doc = loadDoc();
    const text = serializeCellsAsCdl(doc, [LOGGER]);
    const parsed = tryParseCdlFragment(text);
    expect(parsed).toEqual([{ celltypeName: "tLogger", cellName: "cLogger1", attrs: { level: "1" } }]);
  });

  it("parses several cell blocks separated by blank lines", () => {
    const parsed = tryParseCdlFragment(serializeCellsAsCdl(loadDoc(), [LOGGER, SENSOR]));
    expect(parsed?.map((c) => c.cellName)).toEqual(["cLogger1", "cSensor1"]);
  });

  it("returns undefined for empty or whitespace-only text", () => {
    expect(tryParseCdlFragment("")).toBeUndefined();
    expect(tryParseCdlFragment("   \n\t")).toBeUndefined();
  });

  it("returns undefined for text that isn't valid CDL (e.g. pasted from another app)", () => {
    expect(tryParseCdlFragment("Hello, world! This is not CDL.")).toBeUndefined();
  });

  it("returns undefined for syntactically valid CDL with no cell block (e.g. a celltype only)", () => {
    expect(tryParseCdlFragment("celltype tFoo {\n  entry_port sLog eLog;\n}")).toBeUndefined();
  });
});
