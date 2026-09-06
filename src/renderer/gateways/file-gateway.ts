// [[TECSCDE-DT-EL内部仕様]] 第7章7.3節: FileGateway（renderer）。
// preloadが公開する window.tecscde.file を薄くラップする。プロセス境界があるという
// 事実はこのクラスの内部に閉じ込め、呼び出し側（UIシェル）はPromiseを返す通常の
// メソッド呼び出しとしてしか扱わない（第2章2.4節）。

import type { OpenResult } from "../../shared/ipc-types.js";

export class FileGateway {
  open(): Promise<OpenResult | null> {
    return window.tecscde.file.open();
  }

  save(path: string, content: string): Promise<void> {
    return window.tecscde.file.save(path, content);
  }

  saveAs(content: string, suggestedName: string): Promise<string | null> {
    return window.tecscde.file.saveAs(content, suggestedName);
  }

  export(path: string, data: string): Promise<void> {
    return window.tecscde.file.export(path, data);
  }
}
