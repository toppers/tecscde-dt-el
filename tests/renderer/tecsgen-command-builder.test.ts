// [[TECSCDE-DT-EL内部仕様]] 第9章9.5節・[[work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 08 CDL 連携|TECSCDE-DT外部仕様8.4.2節]]
// — `TecsgenCommandBuilder`のヘッドレステスト。

import { describe, expect, it } from "vitest";
import { TecsgenCommandBuilder } from "../../src/renderer/tecsgen/command-builder";

describe("TecsgenCommandBuilder.buildArgs", () => {
  it("orders -I(baseDir), -I(importPath...), -D(defineMacro...), reference files, then the editing file", () => {
    const args = TecsgenCommandBuilder.buildArgs({
      baseDir: "/proj",
      importPath: ["./include", "./vendor"],
      defineMacro: ["TECSGEN", "DEBUG"],
      referenceFilePaths: ["/proj/celltypes.cdl"],
      editingFilePath: "/proj/main.cde",
    });
    expect(args).toEqual([
      "-I",
      "/proj",
      "-I",
      "./include",
      "-I",
      "./vendor",
      "-D",
      "TECSGEN",
      "-D",
      "DEBUG",
      "/proj/celltypes.cdl",
      "/proj/main.cde",
    ]);
  });

  it("omits -I/-D entirely when baseDir/importPath/defineMacro are absent", () => {
    const args = TecsgenCommandBuilder.buildArgs({
      referenceFilePaths: [],
      editingFilePath: "/proj/main.cde",
    });
    expect(args).toEqual(["/proj/main.cde"]);
  });

  it("includes multiple reference files in order before the editing file", () => {
    const args = TecsgenCommandBuilder.buildArgs({
      referenceFilePaths: ["/a.cdl", "/b.cdl"],
      editingFilePath: "/main.cde",
    });
    expect(args).toEqual(["/a.cdl", "/b.cdl", "/main.cde"]);
  });
});

describe("TecsgenCommandBuilder.buildCommandLine", () => {
  it("joins the tecsgen args with a leading executable name", () => {
    const line = TecsgenCommandBuilder.buildCommandLine({
      baseDir: "/proj",
      referenceFilePaths: ["/proj/celltypes.cdl"],
      editingFilePath: "/proj/main.cde",
    });
    expect(line).toBe("tecsgen -I /proj /proj/celltypes.cdl /proj/main.cde");
  });

  it("quotes an argument that contains whitespace", () => {
    const line = TecsgenCommandBuilder.buildCommandLine({
      referenceFilePaths: [],
      editingFilePath: "C:/Program Files/proj/main.cde",
    });
    expect(line).toBe('tecsgen "C:/Program Files/proj/main.cde"');
  });
});
