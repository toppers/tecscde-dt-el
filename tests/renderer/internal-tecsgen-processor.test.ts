// [[TECSCDE-DT-EL内部仕様 - 09D V0.2.0tecsgen設定と内部処理]] 9D.6・9D.7 — 内部処理の境界の振る舞い。
import { describe, expect, it } from "vitest";
import { CTypeRegistry } from "../../src/renderer/cdecl/type-registry";
import type { CdlSourceProvider } from "../../src/renderer/tecsgen/internal/cdl-program";
import { parsePluginArgs } from "../../src/renderer/tecsgen/internal/plugin-args";
import { InternalTecsgenProcessor } from "../../src/renderer/tecsgen/internal/processor";

const noImports: CdlSourceProvider = { resolveImport: () => undefined };
const run = (text: string, enabledPlugins?: readonly string[]) => InternalTecsgenProcessor.process(
  { main: { path: "main.cdl", text }, provider: noImports, cTypes: new CTypeRegistry() },
  enabledPlugins ? { enabledPlugins } : {},
);

describe("InternalTecsgenProcessor", () => {
  it("付表にないプラグインは W-PLUGIN-UNSUPPORTED にして、読み込みを続ける", () => {
    const result = run(`signature sA { void f(void); };\ngenerate( OtherPlugin, sA, "" );\n`);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toMatchObject([{ code: "W-PLUGIN-UNSUPPORTED", pluginName: "OtherPlugin" }]);
    expect(result.files.list()).toEqual([]);
  });

  it("有効にしていないプラグインも対象外として扱う", () => {
    const result = run(`signature sA { void f(void); };\ngenerate( MrubyBridgePlugin, sA, "" );\n`, []);
    expect(result.diagnostics).toMatchObject([{ code: "W-PLUGIN-UNSUPPORTED", pluginName: "MrubyBridgePlugin" }]);
  });

  it("失敗したときは W-PLUGIN-TYPE-LOAD にして、生成物を1つも返さない", () => {
    // 関数が全部除外される（MRB1012）と tecsgen はエラーになる。
    const result = run(`signature sA { void f([send(a)] int8_t *p); };\ngenerate( MrubyBridgePlugin, sA, "" );\n`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain("W-PLUGIN-TYPE-LOAD");
    expect(result.files.list()).toEqual([]);
  });

  it("generate の対象が見つからなければ失敗にする", () => {
    const result = run(`generate( MrubyBridgePlugin, sMissing, "" );\n`);
    expect(result.ok).toBe(false);
  });
});

describe("parsePluginArgs（tecsgen の parse_plugin_arg）", () => {
  it("カンマ区切りと囲み文字を読む", () => {
    expect(parsePluginArgs("ignoreUnsigned=false, auto_exclude=true, ")).toEqual([["ignoreUnsigned", "false"], ["auto_exclude", "true"]]);
    expect(parsePluginArgs("exclude='a,b', auto_exclude=false")).toEqual([["exclude", "a,b"], ["auto_exclude", "false"]]);
  });
});
