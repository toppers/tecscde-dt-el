// [[TECSCDE-DT-EL内部仕様 - 09D V0.2.0tecsgen設定と内部処理]] 9D.6 の3 — PluginRegistry（プラグイン名 → 処理）。
// 登録するのは、外部仕様8.5の付表に載ったプラグインだけ。付表に載せる条件は、外部 tecsgen の記録済みの
// 出力（基準データ）と一致すること（9D.6 の9）。照合は tests/renderer/internal-tecsgen-golden.test.ts。

import type { GenerateRequest } from "./cdl-program";
import {
  CELL_PLUGIN, CELLTYPE_PLUGIN, CellPlugin, CelltypePlugin, MrubyBridgeState, PluginError, SIGNATURE_PLUGIN,
  SignaturePlugin, signaturePostCode, type PluginHost,
} from "./mruby-bridge";

export interface RegisteredPlugin {
  readonly name: string;
  /** 照合した tecsgen の版（外部仕様8.5 の5.3.4）。 */
  readonly tecsgenVersion: string;
  apply(request: GenerateRequest, host: PluginHost): void;
}

export interface PluginRegistry {
  get(name: string): RegisteredPlugin | undefined;
  list(): readonly RegisteredPlugin[];
}

const MRUBY_STATE = "MrubyBridge";
const mrubyState = (host: PluginHost): MrubyBridgeState => host.state(MRUBY_STATE, () => new MrubyBridgeState());

function applySignature(request: GenerateRequest, host: PluginHost): void {
  const target = request.target;
  if (target.kind !== "signature") return;
  if (target.functions.length === 0) {
    // Signature#apply_plugin: 関数のない署名には適用しない（警告のみ）。
    host.info(`S9999 ${target.name} is empty. cannot apply signature plugin. ignored`);
    return;
  }
  const state = mrubyState(host);
  host.registerPostCode(SIGNATURE_PLUGIN, () => signaturePostCode(state));
  const plugin = new SignaturePlugin(target, request.option, state, host);
  host.generateAndParse(SIGNATURE_PLUGIN, () => plugin.genCdlFile(), plugin);
}

function applyCelltype(request: GenerateRequest, host: PluginHost): void {
  const target = request.target;
  if (target.kind !== "celltype") return;
  const state = mrubyState(host);
  host.registerPostCode(CELLTYPE_PLUGIN, () => "");
  const plugin = new CelltypePlugin(target, request.option, state, host);
  target.celltypePlugins.push(plugin);
  host.generateAndParse(CELLTYPE_PLUGIN, () => plugin.genCdlFile(), plugin);
  // CelltypePluginModule#apply_plugin: 既にあるセルにも new_cell を適用する。
  for (const cell of [...target.cells]) plugin.newCell(cell);
}

function applyCell(request: GenerateRequest, host: PluginHost): void {
  const target = request.target;
  if (target.kind !== "cell") return;
  const state = mrubyState(host);
  host.registerPostCode(CELL_PLUGIN, () => "");
  const plugin = new CellPlugin(target, request.option, state, host);
  host.generateAndParse(CELL_PLUGIN, () => plugin.genCdlFile(), plugin);
}

const TECSGEN_VERSION = "1.9.1";

/** MrubyBridgePlugin（MultiPlugin）: 対象が署名・セルタイプ・セルのどれかで振り分ける。 */
const mrubyBridgePlugin: RegisteredPlugin = {
  name: "MrubyBridgePlugin",
  tecsgenVersion: TECSGEN_VERSION,
  apply(request, host) {
    switch (request.target.kind) {
      case "signature": return applySignature(request, host);
      case "celltype": return applyCelltype(request, host);
      case "cell": return applyCell(request, host);
      default: throw new PluginError("MrubyBridgePlugin: 対象の種類を扱えません");
    }
  },
};

const mrubyBridgeCellPlugin: RegisteredPlugin = {
  name: CELL_PLUGIN,
  tecsgenVersion: TECSGEN_VERSION,
  apply(request, host) {
    if (request.target.kind !== "cell") throw new PluginError(`${CELL_PLUGIN}: '${request.targetText}' はセルではありません`);
    applyCell(request, host);
  },
};

export class MapPluginRegistry implements PluginRegistry {
  private readonly plugins: ReadonlyMap<string, RegisteredPlugin>;

  constructor(plugins: readonly RegisteredPlugin[]) {
    this.plugins = new Map(plugins.map((plugin) => [plugin.name, plugin]));
  }

  get(name: string): RegisteredPlugin | undefined {
    return this.plugins.get(name);
  }

  list(): readonly RegisteredPlugin[] {
    return [...this.plugins.values()];
  }
}

/** 付表（外部仕様8.5）。基準データ sample1-mruby-bridge（tecsgen 1.9.1）との一致を確認したもの。 */
export const DEFAULT_PLUGIN_REGISTRY: PluginRegistry = new MapPluginRegistry([mrubyBridgePlugin, mrubyBridgeCellPlugin]);
