// 三者相違一覧 3-8（V0.2.6 段5）: セルの塗りと、セル内の文字（セル名・セルタイプ名）のコントラスト比は
// 4.5:1 以上を保つ（外部仕様4.1.x項目6、内部6C.2項目3。WCAG の相対輝度式）。
import { describe, expect, it } from "vitest";
import { SVG_STYLES } from "../../src/renderer/render/svg-styles";

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function ratio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
/** `.selector { ... fill: #xxxxxx; ... }` の fill を返す（セレクタは完全一致の行頭で探す）。 */
function fillOf(selector: string): string {
  const rule = new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, "\\.")}\\s*\\{[^}]*?fill:\\s*(#[0-9a-fA-F]{6})`).exec(SVG_STYLES);
  if (!rule) throw new Error(`fill of ${selector} not found`);
  return rule[1]!;
}

describe("セル内の文字のコントラスト比", () => {
  const cellFills = {
    "通常": fillOf(".cell-rect"),
    "閲覧のみ": fillOf(".cell-rect.readonly"),
    "アクティブ": fillOf(".cell-rect.active"),
  };
  const textFills = { "セル名": fillOf(".cell-label"), "セルタイプ名": fillOf(".celltype-label") };

  for (const [cellName, cellFill] of Object.entries(cellFills)) {
    for (const [textName, textFill] of Object.entries(textFills)) {
      it(`${textName}(${textFill}) on ${cellName}セル(${cellFill}) is at least 4.5:1`, () => {
        expect(ratio(textFill, cellFill)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
