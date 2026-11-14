import { describe, expect, it } from "vitest";
import { evaluateConstInt } from "../../src/renderer/cdl/const-expr";

describe("evaluateConstInt", () => {
  it.each([
    ["3", 3], ["0x10", 16], [" 2 + 3 * 4 ", 14], ["(2 + 3) * 4", 20], ["-3 + 5", 2],
    ["7 / 2", 3], ["-7 / 2", -3], ["7 % 4", 3], ["--2", 2],
  ])("evaluates %s", (text, expected) => {
    expect(evaluateConstInt(text)).toBe(expected);
  });

  it.each(["", "N", "2 +", "(1", "1)", "1 / 0", "1 % 0", "12abc", "3L", "1 << 2", "sizeof(int)"])(
    "returns undefined for %j",
    (text) => {
      expect(evaluateConstInt(text)).toBeUndefined();
    },
  );
});
