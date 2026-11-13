// [[TECSCDE-DT-EL内部仕様 - 09D V0.2.0tecsgen設定と内部処理]] 9D.6 の9・外部仕様8.5 — ゴールデン照合。
// 内部処理（InternalTecsgenProcessor）の MrubyBridgePlugin 系の生成物が、外部 tecsgen 1.9.1 の記録済みの出力
// （tests/fixtures/tecsgen-golden/sample1-mruby-bridge/）と一致することを確かめる。一致したものだけを付表に載せる。
//
// 入力は基準データの採取条件（README）と同じ: sample1 の tEV3Sample.cdl と tEV3Sample.tecsgen-opts。
// import_C の C 型は、アプリの読み込みと同じく C プリプロセッサ（gcc -E -DTECSGEN）を通して CdeclExtractor で集める。
// gcc が無い環境では照合できないため、この照合だけを飛ばす。
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CdeclExtractor, type CdeclResult } from "../../src/renderer/cdecl/extractor";
import { CTypeRegistry, type TypeDefinition } from "../../src/renderer/cdecl/type-registry";
import { CdlDocumentBuilder } from "../../src/renderer/cdl/cst";
import type { CdlSourceProvider, ResolvedSource } from "../../src/renderer/tecsgen/internal/cdl-program";
import { InternalTecsgenProcessor } from "../../src/renderer/tecsgen/internal/processor";
import { DEFAULT_PLUGIN_REGISTRY } from "../../src/renderer/tecsgen/internal/plugin-registry";

const sampleDir = resolve(__dirname, "../hr-tecs/workspace/sample1");
const goldenDir = resolve(__dirname, "../fixtures/tecsgen-golden/sample1-mruby-bridge");

function hasGcc(): boolean {
  try {
    execFileSync("gcc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function readOpts(): { includeDirs: string[]; importDirs: string[] } {
  const text = readFileSync(resolve(sampleDir, "tEV3Sample.tecsgen-opts"), "utf8");
  const tokens = text.split(/\s+/).filter(Boolean);
  const includeDirs: string[] = [];
  const importDirs: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token === "-I") includeDirs.push(tokens[++i]!);
    else if (token.startsWith("-I")) includeDirs.push(token.slice(2));
    else if (token === "--import-path") importDirs.push(tokens[++i]!);
  }
  return { includeDirs, importDirs };
}

/** tecsgen の import の探索（`.`、`-I`、`--import-path` の順。基点は .tecsgen-opts のあるディレクトリ）。 */
class FsProvider implements CdlSourceProvider {
  readonly searchDirs: string[];
  readonly loaded = new Map<string, string>();

  constructor(dirs: readonly string[]) {
    this.searchDirs = [sampleDir, ...dirs.map((d) => (isAbsolute(d) ? d : resolve(sampleDir, d)))];
  }

  find(spec: string): string | undefined {
    for (const dir of this.searchDirs) {
      const candidate = resolve(dir, spec);
      if (existsSync(candidate)) return candidate;
    }
    return undefined;
  }

  resolveImport(spec: string): ResolvedSource | undefined {
    const path = this.find(spec);
    if (!path) return undefined;
    // CDL のコメントは EUC-JP・Shift_JIS が混ざる。生成物に影響するのは ASCII だけなので latin1 で読む。
    const text = readFileSync(path, "latin1");
    this.loaded.set(path, text);
    return { path, text };
  }
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** import の閉包をたどり、import_C のヘッダと CDL 内の typedef を集める（アプリの読み込みに当たる前処理）。 */
function collectCTypes(provider: FsProvider, main: string, includeDirs: readonly string[]): CTypeRegistry {
  const seen = new Set<string>();
  const headers: string[] = [];
  const locals: TypeDefinition[] = [];
  const visit = (path: string): void => {
    if (seen.has(path)) return;
    seen.add(path);
    const text = readFileSync(path, "latin1");
    for (const def of CdlDocumentBuilder.build(text).typedefs) locals.push({ name: def.name, type: def.type, origin: path, fallback: false });
    for (const m of stripComments(text).matchAll(/\bimport(_C)?\s*\(\s*[<"]([^>"]+)[>"]\s*\)/g)) {
      if (m[1]) {
        if (!headers.includes(m[2]!)) headers.push(m[2]!);
      } else {
        const found = provider.find(m[2]!);
        if (found) visit(found);
      }
    }
  };
  visit(main);
  const includeArgs = includeDirs.map((d) => `-I${isAbsolute(d) ? d : resolve(sampleDir, d)}`);
  const results = new Map<string, CdeclResult>();
  for (const header of headers) {
    const path = [sampleDir, ...includeDirs.map((d) => resolve(sampleDir, d))].map((d) => resolve(d, header)).find(existsSync);
    if (!path) throw new Error(`import_C ヘッダ ${header} が見つかりません`);
    const text = execFileSync("gcc", ["-E", "-DTECSGEN", ...includeArgs, path], { encoding: "latin1", maxBuffer: 64 * 1024 * 1024 });
    results.set(path, CdeclExtractor.extract(text));
  }
  return new CTypeRegistry(results, locals);
}

const lf = (text: string): string => text.replace(/\r\n/g, "\n");

describe("内部 tecsgen: MrubyBridgePlugin 系のゴールデン照合（tecsgen 1.9.1）", () => {
  it.skipIf(!hasGcc())("基準データの MrubyBridge 系 CDL と、ファイルの集合・内容がすべて一致する", () => {
    const { includeDirs, importDirs } = readOpts();
    const provider = new FsProvider([...includeDirs, ...importDirs]);
    const mainPath = resolve(sampleDir, "tEV3Sample.cdl");
    const cTypes = collectCTypes(provider, mainPath, includeDirs);

    const result = InternalTecsgenProcessor.process({
      main: { path: mainPath, text: readFileSync(mainPath, "latin1") },
      provider,
      cTypes,
    });

    expect(result.diagnostics.filter((d) => d.code === "W-PLUGIN-TYPE-LOAD")).toEqual([]);
    expect(result.ok).toBe(true);

    const produced = new Map(result.files.list().map((path) => [basename(path), result.files.read(path)!]));
    const golden = new Map(
      readdirSync(goldenDir)
        .filter((name) => name.endsWith(".cdl") && !name.startsWith("tmp_HRP2"))
        .map((name) => [name, readFileSync(resolve(goldenDir, name), "utf8")]),
    );
    expect([...produced.keys()].sort()).toEqual([...golden.keys()].sort());
    for (const [name, text] of golden) {
      expect(lf(produced.get(name) ?? ""), name).toBe(lf(text));
    }

    // HRP2 系は付表の対象外（CDL を生成しない）。内部処理では対象外の警告になる。
    const unsupported = new Set(result.diagnostics.filter((d) => d.code === "W-PLUGIN-UNSUPPORTED").map((d) => d.pluginName));
    for (const name of unsupported) expect(name).toMatch(/^HRP2/);
  });

  it("付表の登録は MrubyBridgePlugin と MrubyBridgeCellPlugin（tecsgen 1.9.1 で照合）", () => {
    expect(DEFAULT_PLUGIN_REGISTRY.list().map((p) => [p.name, p.tecsgenVersion])).toEqual([
      ["MrubyBridgePlugin", "1.9.1"],
      ["MrubyBridgeCellPlugin", "1.9.1"],
    ]);
    expect(dirname(goldenDir)).toContain("tecsgen-golden");
  });
});
