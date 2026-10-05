import { describe, expect, it } from "vitest";
import { describeTecsgenFailure } from "../../src/renderer/tecsgen/failure-summary";

describe("describeTecsgenFailure", () => {
  it("surfaces error lines even when they come after a long plugin progress log", () => {
    const progress = Array.from({ length: 50 }, (_, i) => `  MrubyBridgePlugin: [pointer] T${i}* => [class] X`).join("\n");
    const message = describeTecsgenFailure({
      stdout: `${progress}\n../../include/kernel.cdl:63:17: error: G1016 syntax error near 'TEXPTN'\n`,
      stderr: "",
      exitCode: 1,
    });

    expect(message).toContain("終了コード 1");
    expect(message).toContain("G1016 syntax error near 'TEXPTN'");
    expect(message).not.toContain("MrubyBridgePlugin");
  });

  it("lists stderr errors first and removes duplicates", () => {
    const message = describeTecsgenFailure({
      stdout: "x.cdl:1:1: error: S1075 'sA' signature not found",
      stderr: "x.cdl:1:1: error: S1075 'sA' signature not found\nfatal error: stdint.h: No such file or directory",
      exitCode: 2,
    });

    const lines = message.split("\n");
    expect(lines.filter((line) => line.includes("S1075"))).toHaveLength(1);
    expect(lines.some((line) => line.includes("stdint.h"))).toBe(true);
  });

  it("falls back to the tail of the output when no line looks like an error", () => {
    const stdout = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const message = describeTecsgenFailure({ stdout, stderr: "", exitCode: 3 });

    expect(message).toContain("line 29");
    expect(message).not.toContain("line 0\n");
  });

  it("caps the number of error lines and says how many were omitted", () => {
    const stdout = Array.from({ length: 14 }, (_, i) => `a.cdl:${i}:1: error: E${i}`).join("\n");
    const message = describeTecsgenFailure({ stdout, stderr: "", exitCode: 1 });

    expect(message).toContain("E9");
    expect(message).not.toContain("E10");
    expect(message).toContain("ほか 4 件");
  });

  it("returns only the header when there is no output at all", () => {
    expect(describeTecsgenFailure({ stdout: "", stderr: "", exitCode: null })).toBe(
      "tecsgen が失敗しました（終了コード 不明）",
    );
  });
});
