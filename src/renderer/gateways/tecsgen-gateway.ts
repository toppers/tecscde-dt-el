// [[TECSCDE-DT-EL内部仕様]] 第9章9.3節: TecsgenGateway（renderer）。
// preloadが公開する window.tecscde.tecsgen を薄くラップする。

import type { TecsgenResult } from "../../shared/ipc-types.js";

export class TecsgenGateway {
  generate(args: readonly string[]): Promise<TecsgenResult> {
    return window.tecscde.tecsgen.generate(args);
  }

  version(): Promise<string | null> {
    return window.tecscde.tecsgen.version();
  }
}
