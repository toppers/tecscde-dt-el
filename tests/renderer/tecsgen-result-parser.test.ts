// [[TECSCDE-DT-EL内部仕様]] 第9章9.4節 — `TecsgenResultParser`のヘッドレステスト。
// 外部仕様9.1.1・9.3.1が定める固定書式（<file>:<line>:<col>: error|warning: <message>、
// または位置情報なしの error|warning: <message>）を解析する。

import { describe, expect, it } from "vitest";
import { TECSGEN_CODES, TecsgenResultParser } from "../../src/renderer/diagnostics/tecsgen-result-parser";
import type { TecsgenResult } from "../../src/shared/ipc-types";

function result(overrides: Partial<TecsgenResult>): TecsgenResult {
  return { stdout: "", stderr: "", exitCode: 0, executableFound: true, ...overrides };
}

describe("TecsgenResultParser.parse", () => {
  it("returns a single NOT_FOUND diagnostic when the executable itself is missing", () => {
    const diagnostics = TecsgenResultParser.parse(result({ executableFound: false }));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: "error", code: TECSGEN_CODES.NOT_FOUND });
  });

  it("parses a located error line, splitting the leading G-code from the message", () => {
    const diagnostics = TecsgenResultParser.parse(
      result({ stdout: "main.cdl:12:5: error: G1015 Unexpected EOF\n" }),
    );
    expect(diagnostics).toEqual([
      {
        severity: "error",
        code: "G1015",
        message: "Unexpected EOF",
        location: { file: "main.cdl", line: 12, column: 5 },
      },
    ]);
  });

  it("parses a located warning line with an S-code", () => {
    const diagnostics = TecsgenResultParser.parse(
      result({ stdout: "main.cdl:3:1: warning: S1042 'cLog' not joined and not optional\n" }),
    );
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        code: "S1042",
        message: "'cLog' not joined and not optional",
        location: { file: "main.cdl", line: 3, column: 1 },
      },
    ]);
  });

  it("parses an unlocated line (locale not available, ext-spec 9.1.1)", () => {
    const diagnostics = TecsgenResultParser.parse(result({ stdout: "error: S1109 'foo' not found\n" }));
    expect(diagnostics).toEqual([{ severity: "error", code: "S1109", message: "'foo' not found" }]);
  });

  it("falls back to the severity itself as the code when the message has no leading code token", () => {
    const diagnostics = TecsgenResultParser.parse(result({ stdout: "main.cdl:1:1: error: something went wrong\n" }));
    expect(diagnostics[0]!.code).toBe("ERROR");
  });

  it("ignores lines that don't match the fixed format (e.g. tecsgen's ordinary progress output)", () => {
    const diagnostics = TecsgenResultParser.parse(
      result({ stdout: "Generating code for celltype tController...\nDone.\n" }),
    );
    expect(diagnostics).toEqual([]);
  });

  it("skips blank lines", () => {
    const diagnostics = TecsgenResultParser.parse(result({ stdout: "\n\n" }));
    expect(diagnostics).toEqual([]);
  });

  it("collects diagnostics from both stdout and stderr", () => {
    const diagnostics = TecsgenResultParser.parse(
      result({
        stdout: "a.cdl:1:1: error: G1015 Unexpected EOF\n",
        stderr: "b.cdl:2:2: warning: S1042 not joined\n",
      }),
    );
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((d) => d.severity).sort()).toEqual(["error", "warning"]);
  });

  it("handles a Windows-style drive-letter path without misreading the drive colon as line/column", () => {
    const diagnostics = TecsgenResultParser.parse(
      result({ stdout: "C:\\proj\\main.cdl:7:2: error: G1016 syntax error near '$1'\n" }),
    );
    expect(diagnostics[0]).toMatchObject({
      location: { file: "C:\\proj\\main.cdl", line: 7, column: 2 },
      code: "G1016",
    });
  });

  it("a non-zero exit with no parseable lines produces no diagnostics on its own", () => {
    const diagnostics = TecsgenResultParser.parse(result({ exitCode: 1, stdout: "", stderr: "" }));
    expect(diagnostics).toEqual([]);
  });
});
