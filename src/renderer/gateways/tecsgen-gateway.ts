// [[TECSCDE-DT-EL内部仕様]] 第9章9.3節: TecsgenGateway（renderer）。
// preloadが公開する window.tecscde.tecsgen を薄くラップする。

import type { TecsgenResult, CppResult } from "../../shared/ipc-types.js";

export class TecsgenGateway {
  generate(args: readonly string[]): Promise<TecsgenResult> {
    return window.tecscde.tecsgen.generate(args);
  }

  preprocess(headerPath: string, cppCommand?: string): Promise<CppResult> {
    return window.tecscde.tecsgen.preprocess(headerPath, cppCommand);
  }

  version(): Promise<string | null> {
    return window.tecscde.tecsgen.version();
  }
}
