// [[TECSCDE-DT-EL内部仕様]] 第9章9.5節・[[work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 08 CDL 連携|TECSCDE-DT外部仕様8.4.2節]]
// — `TecsgenCommandBuilder`のヘッドレステスト。

import { describe, expect, it } from "vitest";
import { TecsgenCommandBuilder } from "../../src/renderer/tecsgen/command-builder";

describe("TecsgenCommandBuilder.buildArgs", () => {
  it("orders -k utf8, -I(importPath...), -D(defineMacro...), -c(cpp), reference files, then the editing file", () => {
    const args = TecsgenCommandBuilder.buildArgs({
      baseDir: "/proj",
      importPath: ["./include", "./vendor"],
      defineMacro: ["TECSGEN", "DEBUG"],
      cpp: "gcc",
      referenceFilePaths: ["/proj/celltypes.cdl"],
      editingFilePath: "/proj/main.cde",
    });
    expect(args).toEqual([
      "-k",
      "utf8",
      "-I",
      "./include",
      "-I",
      "./vendor",
      "-D",
      "TECSGEN",
      "-D",
      "DEBUG",
      "-c",
      "gcc",
      "/proj/celltypes.cdl",
      "/proj/main.cde",
    ]);
  });

  it("never puts baseDir on the command line, even when present", () => {
    const args = TecsgenCommandBuilder.buildArgs({
      baseDir: "/proj",
      referenceFilePaths: [],
      editingFilePath: "/proj/main.cde",
    });
    expect(args).toEqual(["-k", "utf8", "/proj/main.cde"]);
  });

  it("always includes -k utf8 even when importPath/defineMacro/cpp are absent", () => {
    const args = TecsgenCommandBuilder.buildArgs({
      referenceFilePaths: [],
      editingFilePath: "/proj/main.cde",
    });
    expect(args).toEqual(["-k", "utf8", "/proj/main.cde"]);
  });

  it("includes multiple reference files in order before the editing file", () => {
    const args = TecsgenCommandBuilder.buildArgs({
      referenceFilePaths: ["/a.cdl", "/b.cdl"],
      editingFilePath: "/main.cde",
    });
    expect(args).toEqual(["-k", "utf8", "/a.cdl", "/b.cdl", "/main.cde"]);
  });
});

describe("TecsgenCommandBuilder.buildCommandLine", () => {
  it("joins the tecsgen args with a leading executable name, omitting baseDir", () => {
    const line = TecsgenCommandBuilder.buildCommandLine({
      baseDir: "/proj",
      importPath: ["./include"],
      referenceFilePaths: ["/proj/celltypes.cdl"],
      editingFilePath: "/proj/main.cde",
    });
    expect(line).toBe("tecsgen -k utf8 -I ./include /proj/celltypes.cdl /proj/main.cde");
  });

  it("quotes an argument that contains whitespace", () => {
    const line = TecsgenCommandBuilder.buildCommandLine({
      referenceFilePaths: [],
      editingFilePath: "C:/Program Files/proj/main.cde",
    });
    expect(line).toBe('tecsgen -k utf8 "C:/Program Files/proj/main.cde"');
  });
});
