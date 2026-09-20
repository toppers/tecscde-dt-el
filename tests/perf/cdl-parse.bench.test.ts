// [[work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 11 未決事項と実装単位案#11.2 Electron固有の未決事項]]
// 項目5（tree-sitterバインディングの選択）— web-tree-sitter(WASM) vs node-tree-sitter(ネイティブ)の
// 判断材料として、大規模CDLでのパース時間を実測する。
//
// 既定では skip（`npm test`/`npm run check` を汚染・徐行させない）。実行するには:
//   RUN_CDL_BENCH=1 npx vitest run tests/perf/cdl-parse.bench.test.ts
//
// vitestのbench APIはこのバージョン（v5.0.0）では未提供（`bench is not a function`）だったため、
// 素朴な performance.now() 計測に切り替えている。

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "vitest";
import { CdlGrammar } from "../../src/renderer/cdl/grammar";
import { CdlDocumentBuilder } from "../../src/renderer/cdl/cst";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";

const celltypesText = readFileSync(resolve(__dirname, "../../public/samples/celltypes.cdl"), "utf-8");

/** N組の tLogger/tSensor/tController セル（= 3N セル・2N 結合）を持つCDLソースを生成する。 */
function generateMainCde(groups: number): string {
  const lines: string[] = [];
  for (let i = 0; i < groups; i += 1) {
    lines.push(
      `cell tLogger cLogger${i} {`,
      `  level = 1;`,
      `};`,
      "",
      `cell tSensor cSensor${i} {`,
      `};`,
      "",
      `cell tController cController${i} {`,
      `  cLog = cLogger${i}.eLog;`,
      `  cSensor = cSensor${i}.eRead;`,
      `  intervalMs = 100;`,
      `};`,
      "",
    );
  }
  return lines.join("\n");
}

function timeMs(fn: () => void, iterations: number): { minMs: number; medianMs: number } {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { minMs: samples[0], medianMs: samples[Math.floor(samples.length / 2)] };
}

describe.skipIf(!process.env.RUN_CDL_BENCH)("CDL parse performance (large documents)", () => {
  for (const groups of [50, 200, 500, 1000, 2000]) {
    const cellCount = groups * 3;
    const joinCount = groups * 2;
    const iterations = cellCount > 3000 ? 3 : 10;

    test(`${cellCount} cells / ${joinCount} joins`, () => {
      const mainText = generateMainCde(groups);

      const rawParse = timeMs(() => {
        CdlGrammar.parserInstance.parse(mainText);
      }, iterations);

      const build = timeMs(() => {
        CdlDocumentBuilder.build(mainText);
      }, iterations);

      const fullLoad = timeMs(() => {
        CdlDocumentLoader.loadSources([
          { text: celltypesText, fileName: "celltypes.cdl", editable: false },
          { text: mainText, fileName: "main.cde", editable: true },
        ]);
      }, iterations);

      // eslint-disable-next-line no-console
      console.log(
        `[bench] ${cellCount} cells / ${joinCount} joins (n=${iterations}) — ` +
          `raw parse: min ${rawParse.minMs.toFixed(2)}ms / median ${rawParse.medianMs.toFixed(2)}ms — ` +
          `build (parse+CST): min ${build.minMs.toFixed(2)}ms / median ${build.medianMs.toFixed(2)}ms — ` +
          `full loadSources: min ${fullLoad.minMs.toFixed(2)}ms / median ${fullLoad.medianMs.toFixed(2)}ms`,
      );
    });
  }
});
