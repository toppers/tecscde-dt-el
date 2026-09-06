// [[TECSCDE-DT-EL内部仕様]] 第2章2.4節: preload が exposeInMainWorld した
// `window.tecscde` の型宣言。renderer側のどのファイルもこれ以外の経路で
// electron の機能へアクセスしてはならない（第10章10.1節）。

import type { TecscdeApi } from "../shared/ipc-types.js";

declare global {
  interface Window {
    readonly tecscde: TecscdeApi;
  }
}

export {};
