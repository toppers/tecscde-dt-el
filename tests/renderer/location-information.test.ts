// 旧世代tecscde（Ruby版）が書く`__location_information__`ブロックを読み込んで無視する。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ToolInfoValidator } from "../../src/renderer/cdl/tool-info";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";

// Ruby版 saveload.rb の save_old_info が出力する形式（ポート配列の添字、浮動小数点の座標を含む）。
const OLD_BLOCK = `//////////  TECSCDE  ///////////

/*************************************************
 *             LOCATION INFORMATION              *
 ************************************************/
__location_information__ {
    __cell__  TECSTest( 81.37399999999998, 17.36600000000001, 25, 15 ) {
        eTest( EDGE_LEFT, 5 )
    }
    __cell__  RTMTest( 22.581999999999997, 16.858000000000004, 25, 15 ) {
        cTECS( 0, EDGE_RIGHT, 3 )
    }
    __join__( RTMTest.cTECS[ 0 ] => TECSTest.eTest ){
        HBar( 57.58200000000002 )
        VBar( 12.36600000000001 )
    }
} //__location_information
`;

describe("__location_information__ (旧形式)", () => {
  it("blanks the block and keeps every line position", () => {
    const source = `cell ::tA A {\n};\n${OLD_BLOCK}cell ::tA B {\n};\n`;

    const { sourceWithBlanks } = ToolInfoValidator.extractBlocks(source);

    expect(sourceWithBlanks).not.toContain("__location_information__");
    expect(sourceWithBlanks).not.toContain("__cell__");
    expect(sourceWithBlanks.length).toBe(source.length);
    expect(sourceWithBlanks.split("\n").length).toBe(source.split("\n").length);
    expect(sourceWithBlanks).toContain("cell ::tA B {");
  });

  it("leaves an unclosed block untouched", () => {
    const source = "__location_information__ {\n  __cell__ A( 1, 2, 3, 4 ) {\n";

    expect(ToolInfoValidator.extractBlocks(source).sourceWithBlanks).toBe(source);
  });

  it("loads a file containing the old block without errors", () => {
    const celltypes = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");
    const main = readFileSync(resolve(__dirname, "../fixtures/main.cde"), "utf-8");

    const { diagnostics, document } = CdlDocumentLoader.loadSources([
      { text: celltypes, fileName: "celltypes.cdl", editable: false },
      { text: `${main}\n${OLD_BLOCK}`, fileName: "main.cde", editable: true },
    ]);

    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(document.cellCount).toBe(3);
  });
});
