// [[TECSCDE-DT-EL内部仕様]] 第9章9.3節: TecsgenGateway（renderer）。
// preloadが公開する window.tecscde.tecsgen を薄くラップする。

import type { TecsgenResult, TecsgenVersionResult, CppResult, GeneratedCdlResult } from "../../shared/ipc-types.js";

export class TecsgenGateway {
  generate(args: readonly string[], cwd?: string): Promise<TecsgenResult> {
    return cwd !== undefined ? window.tecscde.tecsgen.generate(args, cwd) : window.tecscde.tecsgen.generate(args);
  }

  generatedTypes(args: readonly string[], editingFilePath: string, optionsFilePath?: string): Promise<GeneratedCdlResult> {
    return window.tecscde.tecsgen.generatedTypes(args, editingFilePath, optionsFilePath);
  }

  preprocess(headerPath: string, cppCommand?: string, includeDirs?: readonly string[]): Promise<CppResult> {
    return window.tecscde.tecsgen.preprocess(headerPath, cppCommand, includeDirs);
  }

  version(): Promise<TecsgenVersionResult> {
    return window.tecscde.tecsgen.version();
  }
}
