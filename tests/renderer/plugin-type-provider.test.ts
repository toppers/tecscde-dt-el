// [[TECSCDE-DT-EL内部仕様 - 09D V0.2.0tecsgen設定と内部処理]] 9D.6 / 外部仕様 8.5
// PluginTypeProvider (ExternalPluginTypeProvider / InternalPluginTypeProvider) の単体テスト。

import { describe, expect, it, vi } from "vitest";
import type { GeneratedCdlResult, TecsgenResult } from "../../src/shared/ipc-types";
import type { TecsgenGateway } from "../../src/renderer/gateways/tecsgen-gateway";
import {
  ExternalPluginTypeProvider,
  InternalPluginTypeProvider,
  type PluginTypeRequest,
  type WorkerLike,
} from "../../src/renderer/tecsgen/plugin-type-provider";

describe("ExternalPluginTypeProvider", () => {
  const successResult: GeneratedCdlResult = {
    result: { exitCode: 0, executableFound: true, stdout: "", stderr: "" },
    sources: [{ fileName: "tmp_test.cdl", content: "celltype tTest {};" }],
  };

  it("TecsgenGateway.generatedTypes を呼び出し、成功時に外部生成物を返す", async () => {
    const mockGeneratedTypes = vi.fn<TecsgenGateway["generatedTypes"]>().mockResolvedValue(successResult);
    const gateway = { generatedTypes: mockGeneratedTypes };
    const provider = new ExternalPluginTypeProvider(gateway);

    const req: PluginTypeRequest = {
      main: { path: "main.cdl", text: "celltype tMain {};" },
      sources: [{ path: "sub.cdl", text: "celltype tSub {};" }],
      optionsFilePath: "path/to/.tecsgen-opts",
    };

    const res = await provider.generateTypes(req);
    expect(res.ok).toBe(true);
    expect(res.source).toBe("external");
    expect(res.files).toEqual(successResult.sources);
    expect(res.sources).toEqual(successResult.sources);
    expect(res.diagnostics).toEqual([]);
    expect(mockGeneratedTypes).toHaveBeenCalledWith(
      expect.arrayContaining(["sub.cdl", "main.cdl"]),
      "main.cdl",
      "path/to/.tecsgen-opts",
    );
  });

  it("明示的に args が渡された場合はその args をそのまま gateway に渡す", async () => {
    const mockGeneratedTypes = vi.fn<TecsgenGateway["generatedTypes"]>().mockResolvedValue(successResult);
    const gateway = { generatedTypes: mockGeneratedTypes };
    const provider = new ExternalPluginTypeProvider(gateway);

    const req: PluginTypeRequest = {
      main: { path: "main.cdl", text: "" },
      args: ["-I", "extra/dir", "custom_main.cdl"],
    };

    await provider.generateTypes(req);
    expect(mockGeneratedTypes).toHaveBeenCalledWith(["-I", "extra/dir", "custom_main.cdl"], "main.cdl", undefined);
  });

  it("exitCode が 0 以外（外部実行エラー）のときは ok: false, files: [] を返し、内部処理へフォールバックしない", async () => {
    const failResult: GeneratedCdlResult = {
      result: { exitCode: 1, executableFound: true, stdout: "", stderr: "error: plugin error" },
      sources: [{ fileName: "leak.cdl", content: "should not be returned" }],
    };
    const mockGeneratedTypes = vi.fn<TecsgenGateway["generatedTypes"]>().mockResolvedValue(failResult);
    const gateway = { generatedTypes: mockGeneratedTypes };
    const provider = new ExternalPluginTypeProvider(gateway);

    const res = await provider.generateTypes({
      main: { path: "main.cdl", text: "" },
    });

    expect(res.ok).toBe(false);
    expect(res.source).toBe("external");
    expect(res.files).toEqual([]);
    expect(res.sources).toEqual([]);
    expect(res.diagnostics).toHaveLength(1);
    expect(res.diagnostics[0]!.code).toBe("W-PLUGIN-TYPE-LOAD");
    expect(res.diagnostics[0]!.message).toContain("tecsgen が失敗しました");
  });

  it("launchFailure（未検出・権限エラー等）のときも ok: false, files: [] を返し、内部処理へフォールバックしない", async () => {
    const launchFailResult: GeneratedCdlResult = {
      result: {
        exitCode: null,
        executableFound: false,
        launchFailure: { kind: "not-found", command: "tecsgen", detail: "ENOENT" },
        stdout: "",
        stderr: "",
      },
      sources: [],
    };
    const mockGeneratedTypes = vi.fn<TecsgenGateway["generatedTypes"]>().mockResolvedValue(launchFailResult);
    const gateway = { generatedTypes: mockGeneratedTypes };
    const provider = new ExternalPluginTypeProvider(gateway);

    const res = await provider.generateTypes({
      main: { path: "main.cdl", text: "" },
    });

    expect(res.ok).toBe(false);
    expect(res.source).toBe("external");
    expect(res.files).toEqual([]);
    expect(res.diagnostics[0]!.code).toBe("W-PLUGIN-TYPE-LOAD");
    expect(res.diagnostics[0]!.message).toContain("tecsgen が見つかりません");
  });

  it("例外発生時にも ok: false, files: [] を返し、内部処理へフォールバックしない", async () => {
    const mockGeneratedTypes = vi.fn<TecsgenGateway["generatedTypes"]>().mockRejectedValue(new Error("IPC communication failure"));
    const gateway = { generatedTypes: mockGeneratedTypes };
    const provider = new ExternalPluginTypeProvider(gateway);

    const res = await provider.generateTypes({
      main: { path: "main.cdl", text: "" },
    });

    expect(res.ok).toBe(false);
    expect(res.source).toBe("external");
    expect(res.files).toEqual([]);
    expect(res.diagnostics[0]!.code).toBe("W-PLUGIN-TYPE-LOAD");
    expect(res.diagnostics[0]!.message).toContain("IPC communication failure");
  });
});

describe("InternalPluginTypeProvider", () => {
  it("外部プロセス（TecsgenGateway）を一切呼ばないこと（呼び出し0回）", async () => {
    const mockGateway = {
      generatedTypes: vi.fn(),
    };

    const provider = new InternalPluginTypeProvider();
    const res = await provider.generateTypes({
      main: {
        path: "main.cdl",
        text: `signature sSimple { void f(void); };\ngenerate( MrubyBridgePlugin, sSimple, "" );\n`,
      },
      sources: [{ path: "mruby.cdl", text: "" }],
    });

    expect(mockGateway.generatedTypes).toHaveBeenCalledTimes(0);
    expect(res.ok).toBe(true);
    expect(res.source).toBe("internal");
  });

  it("登録済みプラグイン（MrubyBridgePlugin）で plugin:/MrubyBridge... の正規化仮想パス生成物が得られること", async () => {
    const provider = new InternalPluginTypeProvider();
    const res = await provider.generateTypes({
      main: {
        path: "main.cdl",
        text: `signature sSimple { void f(void); };\ngenerate( MrubyBridgePlugin, sSimple, "" );\n`,
      },
      sources: [{ path: "mruby.cdl", text: "" }],
    });

    expect(res.ok).toBe(true);
    expect(res.source).toBe("internal");
    expect(res.files.length).toBeGreaterThan(0);
    for (const file of res.files) {
      expect(file.fileName).toMatch(/^plugin:\/MrubyBridge/);
      expect(file.content.length).toBeGreaterThan(0);
    }
    expect(res.diagnostics).toEqual([]);
  });

  it("対象外プラグイン（例: UnknownPlugin）で W-PLUGIN-UNSUPPORTED 警告が生成され、ok: true で開く処理が続行できること", async () => {
    const provider = new InternalPluginTypeProvider();
    const res = await provider.generateTypes({
      main: {
        path: "main.cdl",
        text: `signature sA { void f(void); };\ngenerate( UnknownPlugin, sA, "" );\n`,
      },
    });

    expect(res.ok).toBe(true);
    expect(res.source).toBe("internal");
    expect(res.files).toEqual([]);
    expect(res.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "W-PLUGIN-UNSUPPORTED",
        pluginName: "UnknownPlugin",
      }),
    ]);
  });

  it("タイムアウト時に worker.terminate() が呼ばれ、W-PLUGIN-TYPE-LOAD 警告となり、生成物が空になること（寿命管理）", async () => {
    let terminated = false;
    const mockWorker: WorkerLike = {
      postMessage: vi.fn(),
      terminate: vi.fn(() => {
        terminated = true;
      }),
    };

    const provider = new InternalPluginTypeProvider({
      workerFactory: () => mockWorker,
      timeoutMs: 25,
    });

    const res = await provider.generateTypes({
      main: {
        path: "main.cdl",
        text: `signature sSimple { void f(void); };\ngenerate( MrubyBridgePlugin, sSimple, "" );\n`,
      },
    });

    expect(terminated).toBe(true);
    expect(mockWorker.terminate).toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.source).toBe("internal");
    expect(res.files).toEqual([]);
    expect(res.sources).toEqual([]);
    expect(res.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "W-PLUGIN-TYPE-LOAD",
        message: expect.stringContaining("タイムアウト"),
      }),
    ]);
  });

  it("プラグインエラー（MRB1012 全関数除外）時に W-PLUGIN-TYPE-LOAD 警告となり、生成物が空になり、外部実行へフォールバックしないこと", async () => {
    const mockGateway = {
      generatedTypes: vi.fn(),
    };

    const provider = new InternalPluginTypeProvider();
    const res = await provider.generateTypes({
      main: {
        path: "main.cdl",
        text: `signature sA { void f([send(a)] int8_t *p); };\ngenerate( MrubyBridgePlugin, sA, "" );\n`,
      },
    });

    expect(mockGateway.generatedTypes).toHaveBeenCalledTimes(0);
    expect(res.ok).toBe(false);
    expect(res.source).toBe("internal");
    expect(res.files).toEqual([]);
    expect(res.sources).toEqual([]);
    expect(res.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "W-PLUGIN-TYPE-LOAD",
      }),
    ]);
  });

  it("Worker エラー（worker.onerror）発生時に worker.terminate() が呼ばれ、W-PLUGIN-TYPE-LOAD 警告となり生成物が空になること", async () => {
    let terminated = false;
    const mockWorker: WorkerLike = {
      postMessage: vi.fn(function (this: WorkerLike) {
        setTimeout(() => {
          this.onerror?.(new Error("Simulated worker crash"));
        }, 5);
      }),
      terminate: vi.fn(() => {
        terminated = true;
      }),
    };

    const provider = new InternalPluginTypeProvider({
      workerFactory: () => mockWorker,
    });

    const res = await provider.generateTypes({
      main: { path: "main.cdl", text: "" },
    });

    expect(terminated).toBe(true);
    expect(res.ok).toBe(false);
    expect(res.files).toEqual([]);
    expect(res.diagnostics[0]!.code).toBe("W-PLUGIN-TYPE-LOAD");
    expect(res.diagnostics[0]!.message).toContain("Simulated worker crash");
  });

  it("寿命管理: 前回の生成物を引き継がず、失敗時には一切ファイルを返さない", async () => {
    const provider = new InternalPluginTypeProvider();

    // 1回目: 成功
    const firstRes = await provider.generateTypes({
      main: {
        path: "main.cdl",
        text: `signature sSimple { void f(void); };\ngenerate( MrubyBridgePlugin, sSimple, "" );\n`,
      },
      sources: [{ path: "mruby.cdl", text: "" }],
    });
    expect(firstRes.ok).toBe(true);
    expect(firstRes.files.length).toBeGreaterThan(0);

    // 2回目: 失敗
    const secondRes = await provider.generateTypes({
      main: {
        path: "main.cdl",
        text: `generate( MrubyBridgePlugin, sMissing, "" );\n`,
      },
    });
    expect(secondRes.ok).toBe(false);
    expect(secondRes.files).toEqual([]);
    expect(secondRes.sources).toEqual([]);
    expect(secondRes.diagnostics[0]!.code).toBe("W-PLUGIN-TYPE-LOAD");
  });
});
