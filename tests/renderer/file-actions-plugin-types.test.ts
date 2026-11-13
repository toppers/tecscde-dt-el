/** @vitest-environment happy-dom */
// [[TECSCDE-DT-EL内部仕様 - 09D V0.2.0tecsgen設定と内部処理]] 9D.6 / 外部仕様 8.5, 4.2.x, 9.4.x, 9.5
// 三者監査 #60: Plugin生成型の取り込み方式（external / internal）と統合結線の単体テスト。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyOpenResult, openFromPath } from "../../src/renderer/app/file-actions";
import { AppStore } from "../../src/renderer/app/store";
import { definitionLocation } from "../../src/renderer/app/definition-source";
import { DefinitionFileView } from "../../src/renderer/app/definition-file-view";
import { W_CODES } from "../../src/renderer/cdl/messages";
import { asCellId } from "../../src/renderer/model/ids";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";
import type { OpenResult, PluginTypeSource, ToolSettings } from "../../src/shared/ipc-types";

describe("file-actions plugin types integration", () => {
  const mrubyBridgeCdl = `signature sKernel {
  void foo(void);
};
celltype tKernel {
  entry sKernel eKernel;
};
generate(MrubyBridgePlugin, sKernel, "");
region rDomainEV3 {
  cell nMruby::tsKernel BridgeKernel {
    cTECS = HRP2Kernel.eKernel;
  };
  cell tKernel HRP2Kernel {};
};
`;

  const unsupportedPluginCdl = `signature sOther {
  void bar(void);
};
celltype tOther {
  entry sOther eOther;
};
generate(OtherPlugin, sOther, "");
cell tOther MyOtherCell {};
`;

  const failingInternalCdl = `signature sKernel {
  void foo(void);
};
generate(MrubyBridgePlugin, sMissingSignature, "");
cell tDummy DummyCell {};
`;

  const fakeFileGateway: FileGateway = {
    resolveImports: async () => [],
    saveSession: vi.fn(),
    confirmDiscardChanges: async () => true,
    openPath: async (path: string) => {
      let content = mrubyBridgeCdl;
      if (path.includes("unsupported")) content = unsupportedPluginCdl;
      else if (path.includes("failing")) content = failingInternalCdl;
      return {
        editable: { path, content },
        references: [],
      };
    },
  } as unknown as FileGateway;

  beforeEach(() => {
    document.body.replaceChildren();
    vi.spyOn(HTMLDialogElement.prototype, "show").mockImplementation(function (this: HTMLDialogElement) {
      this.open = true;
    });
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
      this.open = true;
    });
    vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("pluginTypeSource === 'internal' のとき、外部 tecsgenGateway.generatedTypes が 0 回呼ばれ、InternalPluginTypeProvider で型が取り込まれること", async () => {
    const mockGeneratedTypes = vi.fn();
    const tecsgenGateway = { generatedTypes: mockGeneratedTypes } as unknown as TecsgenGateway;
    const store = new AppStore();

    const openResult: OpenResult = {
      editable: { path: "/project/main.cdl", content: mrubyBridgeCdl },
      references: [],
    };

    const logs: string[] = [];
    const mockLog = {
      append: vi.fn(async (lines: readonly string[]) => {
        logs.push(...lines);
      }),
    };

    const success = await applyOpenResult(store, fakeFileGateway, tecsgenGateway, openResult, [], undefined, {
      pluginTypeSource: "internal",
      log: mockLog,
    });

    expect(success).toBe(true);
    // 外部 tecsgen は一切呼ばれない（0回）
    expect(mockGeneratedTypes).toHaveBeenCalledTimes(0);

    // MrubyBridgePlugin の生成型が取り込まれていること
    const generatedTypes = store.getGeneratedTypeSources();
    expect(generatedTypes.length).toBeGreaterThan(0);
    for (const g of generatedTypes) {
      expect(g.fileName).toMatch(/^plugin:\/MrubyBridge/);
    }

    const doc = store.getDocument();
    expect(doc.getCelltype("nMruby::tsKernel")).toBeDefined();
    expect(doc.getCell(asCellId("BridgeKernel"))).toBeDefined();
    expect(doc.getCell(asCellId("BridgeKernel"))?.celltypeUnresolved).toBe(false);

    // 方式がログに記録されていること
    expect(mockLog.append).toHaveBeenCalled();
    expect(logs.some((l) => l.includes("内部 tecsgen") && l.includes("internal"))).toBe(true);
  });

  it("pluginTypeSource === 'internal' で未対応プラグインを含む CDL を開いたとき、W-PLUGIN-UNSUPPORTED 警告が入り、開く処理は成功すること", async () => {
    const mockGeneratedTypes = vi.fn();
    const tecsgenGateway = { generatedTypes: mockGeneratedTypes } as unknown as TecsgenGateway;
    const store = new AppStore();

    const openResult: OpenResult = {
      editable: { path: "/project/unsupported.cdl", content: unsupportedPluginCdl },
      references: [],
    };

    const success = await applyOpenResult(store, fakeFileGateway, tecsgenGateway, openResult, [], undefined, {
      pluginTypeSource: "internal",
    });

    expect(success).toBe(true);
    expect(mockGeneratedTypes).toHaveBeenCalledTimes(0);

    // W-PLUGIN-UNSUPPORTED 警告が診断に含まれること
    const report = store.getReport();
    const unsupportedDiag = report.items.find((d) => d.code === W_CODES.PLUGIN_UNSUPPORTED);
    expect(unsupportedDiag).toBeDefined();
    expect(unsupportedDiag?.message).toContain("OtherPlugin");
    expect(unsupportedDiag?.message).toContain("内部処理の対象外");
    expect(unsupportedDiag?.message).toContain("外部 tecsgen 方式");

    // 開く処理自体は成功し、通常セルが読み込まれていること
    const doc = store.getDocument();
    expect(doc.getCell(asCellId("MyOtherCell"))).toBeDefined();
  });

  it("pluginTypeSource === 'internal' で内部処理が失敗したとき、W-PLUGIN-TYPE-LOAD 警告となり、外部へ自動フォールバックせず、前回の生成物がクリアされること", async () => {
    const mockGeneratedTypes = vi.fn();
    const tecsgenGateway = { generatedTypes: mockGeneratedTypes } as unknown as TecsgenGateway;
    const store = new AppStore();

    // 1回目: 成功させて生成物を保持させる
    await applyOpenResult(store, fakeFileGateway, tecsgenGateway, {
      editable: { path: "/project/main.cdl", content: mrubyBridgeCdl },
      references: [],
    }, [], undefined, { pluginTypeSource: "internal" });
    expect(store.getGeneratedTypeSources().length).toBeGreaterThan(0);

    // 2回目: 内部処理が失敗する CDL を開く
    const success = await applyOpenResult(store, fakeFileGateway, tecsgenGateway, {
      editable: { path: "/project/failing.cdl", content: failingInternalCdl },
      references: [],
    }, [], undefined, { pluginTypeSource: "internal" });

    expect(success).toBe(true);
    // 自動フォールバックしないこと（呼び出し0回）
    expect(mockGeneratedTypes).toHaveBeenCalledTimes(0);

    // 警告 W-PLUGIN-TYPE-LOAD が記録されること
    const report = store.getReport();
    const loadWarning = report.items.find((d) => d.code === W_CODES.PLUGIN_TYPE_LOAD);
    expect(loadWarning).toBeDefined();

    // 寿命管理: 生成物が空配列になり、前回の生成物や今回の部分生成物が一切混入しないこと
    expect(store.getGeneratedTypeSources()).toEqual([]);
  });

  it("内部処理で生成された型の定義位置（definitionLocation）が kind: 'virtual' となり、DefinitionFileView で仮想内容が読み取り専用表示されること", async () => {
    const store = new AppStore();
    const tecsgenGateway = { generatedTypes: vi.fn() } as unknown as TecsgenGateway;

    await applyOpenResult(store, fakeFileGateway, tecsgenGateway, {
      editable: { path: "/project/main.cdl", content: mrubyBridgeCdl },
      references: [],
    }, [], undefined, { pluginTypeSource: "internal" });

    const doc = store.getDocument();
    const bridgeType = doc.getCelltype("nMruby::tsKernel")!;
    expect(bridgeType).toBeDefined();
    expect(bridgeType.generated).toBe(true);

    const generatedSources = store.getGeneratedTypeSources();
    expect(generatedSources.length).toBeGreaterThan(0);

    // definitionLocation の照合
    const location = definitionLocation(
      bridgeType.sourcePath ?? bridgeType.locale,
      generatedSources,
      bridgeType.generated,
    );

    expect(location.label).toMatch(/^plugin:\/MrubyBridge/);
    expect(location.source?.kind).toBe("virtual");
    expect(location.source?.path).toMatch(/^plugin:\/MrubyBridge/);
    expect(location.source && "content" in location.source ? location.source.content : "").toContain("celltype tsKernel");

    // DefinitionFileView で表示したときディスク読み込みが発生せず、メモリ上内容が表示されること
    const mockReadFile = vi.fn();
    const view = new DefinitionFileView({ readFile: mockReadFile, document });
    await view.open(location.source!, "セルタイプ定義");

    expect(mockReadFile).toHaveBeenCalledTimes(0);
    expect(document.querySelector(".definition-file-window pre")!.textContent).toContain("celltype tsKernel");
    expect(document.querySelector(".definition-file-window")!.textContent).toContain("仮想ソース（読み取り専用）");

    view.dispose();
  });

  it("設定変更だけでは開いている CDL が勝手に再読込されず、次回のファイル読み込みから新しい方式が使われること", async () => {
    const mockGeneratedTypes = vi.fn().mockResolvedValue({
      result: { exitCode: 0, executableFound: true, stdout: "", stderr: "" },
      sources: [{ fileName: "tmp_external.cdl", content: "celltype tExternal {};" }],
    });
    const tecsgenGateway = { generatedTypes: mockGeneratedTypes } as unknown as TecsgenGateway;
    const store = new AppStore();

    let currentSource: PluginTypeSource = "external";
    const mockSettingsGateway = {
      getToolSettings: async () => ({
        revision: 1,
        pluginTypeSource: currentSource,
        tecsgenPath: "",
        tecspath: "",
        effectiveSource: "path",
        effectiveCommand: "tecsgen",
        executable: "tecsgen",
        prefixArgs: [],
        override: false,
      } as ToolSettings),
      updateToolSettings: async (patch: { pluginTypeSource?: PluginTypeSource }) => {
        if (patch.pluginTypeSource) currentSource = patch.pluginTypeSource;
        return { ok: true as const, settings: await mockSettingsGateway.getToolSettings() };
      },
    };

    // 1回目: external 設定で開く
    await openFromPath(store, fakeFileGateway, tecsgenGateway, "/project/first.cdl", {
      settingsGateway: mockSettingsGateway,
    });

    expect(mockGeneratedTypes).toHaveBeenCalledTimes(1);
    const initialEpoch = store.documentEpoch;

    // 設定を internal に変更
    await mockSettingsGateway.updateToolSettings({ pluginTypeSource: "internal" });

    // 設定変更だけでは勝手に再読込されない（epochも同じ、generatedTypes呼び出しも増えない）
    expect(store.documentEpoch).toBe(initialEpoch);
    expect(mockGeneratedTypes).toHaveBeenCalledTimes(1);

    // 次回のファイル読み込みを実行
    mockGeneratedTypes.mockClear();
    await openFromPath(store, fakeFileGateway, tecsgenGateway, "/project/second.cdl", {
      settingsGateway: mockSettingsGateway,
    });

    // 次回読み込みでは internal が使われるため、外部 tecsgen は 0 回
    expect(mockGeneratedTypes).toHaveBeenCalledTimes(0);
    expect(store.getGeneratedTypeSources().some((g) => g.fileName.startsWith("plugin:/MrubyBridge"))).toBe(true);
  });

  it("definitionLocation は key と generatedSources.fileName の仮想パス形式の差異（plugin:/... vs tmp_...）を相互に吸収して一致すること", () => {
    const content = "celltype tSample {};";

    // 1. key: plugin:/MrubyBridge/tmp_0.cdl, g.fileName: plugin:/MrubyBridge/tmp_0.cdl
    const loc1 = definitionLocation("plugin:/MrubyBridge/tmp_0.cdl", [{ fileName: "plugin:/MrubyBridge/tmp_0.cdl", content }]);
    expect(loc1.source?.kind).toBe("virtual");
    expect(loc1.source && "content" in loc1.source ? loc1.source.content : "").toBe(content);

    // 2. key: plugin:/MrubyBridge/tmp_0.cdl, g.fileName: tmp_0.cdl (外部 tecsgen 生成物)
    const loc2 = definitionLocation("plugin:/MrubyBridge/tmp_0.cdl", [{ fileName: "tmp_0.cdl", content }]);
    expect(loc2.source?.kind).toBe("virtual");
    expect(loc2.source && "content" in loc2.source ? loc2.source.content : "").toBe(content);

    // 3. key: plugin:tmp_0.cdl, g.fileName: plugin:/MrubyBridge/tmp_0.cdl (内部 tecsgen 生成物)
    const loc3 = definitionLocation("plugin:tmp_0.cdl", [{ fileName: "plugin:/MrubyBridge/tmp_0.cdl", content }]);
    expect(loc3.source?.kind).toBe("virtual");
    expect(loc3.source && "content" in loc3.source ? loc3.source.content : "").toBe(content);

    // 4. key: plugin:tmp_0.cdl, g.fileName: tmp_0.cdl
    const loc4 = definitionLocation("plugin:tmp_0.cdl", [{ fileName: "tmp_0.cdl", content }]);
    expect(loc4.source?.kind).toBe("virtual");
    expect(loc4.source && "content" in loc4.source ? loc4.source.content : "").toBe(content);

    // 5. generated = true, key: /MrubyBridge/tmp_0.cdl, g.fileName: plugin:/MrubyBridge/tmp_0.cdl
    const loc5 = definitionLocation("/MrubyBridge/tmp_0.cdl", [{ fileName: "plugin:/MrubyBridge/tmp_0.cdl", content }], true);
    expect(loc5.source?.kind).toBe("virtual");
    expect(loc5.source && "content" in loc5.source ? loc5.source.content : "").toBe(content);

    // 6. 一致する仮想ソースが存在しない場合は unavailable
    const loc6 = definitionLocation("plugin:missing.cdl", [{ fileName: "tmp_0.cdl", content }]);
    expect(loc6.source).toBeUndefined();
    expect(loc6.unavailable).toContain("仮想ソースがないため表示できません");
  });
});
