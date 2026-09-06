// [[TECSCDE-DT-EL内部仕様]] 第10章10.1節: プロセス境界の逸脱を機械的に強制する。
// renderer/ 配下のいかなるファイルも electron を直接importしてはならない
// （fs・child_process・dialog等のNode/Electron APIも同様に、electron経由でしか
// 触れられないため、electronの禁止だけで十分に強制できる）。gateways/ 経由
// （window.tecscde.*）でのみアクセスする。

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "renderer-must-not-import-electron",
      comment:
        "renderer/ はcontextIsolationされたプロセスで動作し、Node/ElectronのAPIへ直接アクセスできない。" +
        "gateways/ が公開する window.tecscde.* 経由でのみアクセスすること（第2章2.4節・第10章10.1節）。",
      severity: "error",
      from: { path: "^src/renderer" },
      // resolved path for a bare `import ... from "electron"` is
      // "node_modules/electron/index.js" — match that, not the raw specifier.
      to: { path: "^node_modules/electron($|/)" },
    },
    {
      name: "main-must-not-import-dom-facing-renderer-code",
      comment:
        "main/ はDOM/SVGへアクセスできない（そもそもmainプロセスにDOMが存在しないため実行時エラーとして" +
        "自然に検出されるが、コンパイル時にも検出できるよう禁止する、第10章10.1節）。",
      severity: "error",
      from: { path: "^src/main" },
      to: { path: "^src/renderer" },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
