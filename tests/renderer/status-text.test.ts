import { describe, expect, it } from "vitest";
import { documentStatusText, documentTitle, inputModeLabel } from "../../src/renderer/app/status-text";

describe("current input mode label", () => {
  it("names both supported input modes", () => {
    expect(inputModeLabel("select")).toBe("選択");
    expect(inputModeLabel("newCell")).toBe("セル新規作成");
  });
});

describe("document title and status text", () => {
  it.each([
    { path: "/project/main.cde", name: "main.cde" },
    { path: "C:\\日本語 user\\project\\main.cde", name: "main.cde" },
    { path: "\\\\server\\share\\図.cdl", name: "図.cdl" },
    { path: null, name: "(未保存)" },
    { path: "/project/<img onerror=alert(1)>.cde", name: "<img onerror=alert(1)>.cde" },
  ])("uses the plain text basename for $path, with dirty independent of path presence", ({ path, name }) => {
    expect(documentTitle(path, false)).toBe(`${name} — TECSCDE`);
    expect(documentTitle(path, true)).toBe(`* ${name} — TECSCDE`);
    expect(documentStatusText(path, false)).toBe(name);
    expect(documentStatusText(path, true)).toBe(`${name} ● 未保存の変更`);
  });
});
