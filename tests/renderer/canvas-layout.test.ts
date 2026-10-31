// 拡大時に一部のセルしか見えず、横スクロールもできなかった不具合の回帰防止。
// 親(#canvas-scroll)がflexのため、#canvas(SVG)が縮められないよう `flex: none` が要る。
// happy-dom はレイアウトを持たず挙動では検証できないので、スタイル宣言そのものを確かめる。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(__dirname, "../../src/renderer/index.html"), "utf-8");

function ruleBody(selector: string): string {
  const match = new RegExp(`${selector}\s*\{([^}]*)\}`).exec(html);
  expect(match, `${selector} のルールが見つかりません`).not.toBeNull();
  return match![1]!;
}

describe("canvas layout", () => {
  it("does not let the SVG canvas shrink inside the flex scroll container", () => {
    expect(ruleBody("#canvas-scroll")).toMatch(/display:\s*flex/);
    expect(ruleBody("#canvas")).toMatch(/flex:\s*none/);
  });
});
