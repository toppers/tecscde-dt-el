/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InformationDialog } from "../../src/renderer/app/information-dialog";
import type { AppInformation, ToolSettings, ToolSettingsUpdate, TecsgenVersionResult } from "../../src/shared/ipc-types";

const baseSettings: ToolSettings = {
  revision: 1,
  tecsgenPath: "/tools/tecsgen",
  tecspath: "/env/tecs",
  tecsgenCommandEnv: 'ruby "C:\\tools\\tecsgen.rb"',
  effectiveSource: "environment",
  effectiveCommand: 'ruby "C:\\tools\\tecsgen.rb"',
  executable: "ruby",
  prefixArgs: ["C:\\tools\\tecsgen.rb"],
  override: true,
  pluginTypeSource: "external",
  cdlFilesRoot: "",
};

const baseInfo: AppInformation = {
  name: "TECSCDE-DT-EL",
  version: "0.3.0",
  commit: "abc1234",
  cdeFormatVersion: "0.1.0.0",
  electron: "44",
  chrome: "148",
  node: "24",
  platform: "win32",
  arch: "x64",
};

beforeEach(() => {
  document.body.replaceChildren();
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("V0.3.0 Stage 1: InformationDialog fields", () => {
  it("shows tecsgen version, tecsgenのコマンドラインオプション, 環境変数TECSPATH, and 環境変数TECSGEN_COMMAND", async () => {
    const settings = {
      getToolSettings: vi.fn(async () => baseSettings),
      getAppInformation: vi.fn(async () => baseInfo),
      chooseTecsgenPath: vi.fn(async () => null),
      updateToolSettings: vi.fn(async (_patch: ToolSettingsUpdate) => ({ ok: true as const, settings: baseSettings })),
    };
    const tecsgen = { checkPath: vi.fn(async (): Promise<TecsgenVersionResult> => ({ kind: "ok", text: "tecsgen version 1.9.1" })) };
    const clipboard = { writeText: vi.fn(async () => {}) };
    const onSaved = vi.fn(async () => undefined);
    const getTecsgenStatus = vi.fn(() => ({ version: "tecsgen version 1.9.1", command: 'ruby "C:\\tools\\tecsgen.rb"' }));

    const view = new InformationDialog({ settings, tecsgen, clipboard, onSaved, getTecsgenStatus, document });
    await view.open();

    const versionText = document.querySelector("#information-version")!.textContent ?? "";
    expect(versionText).toContain("tecsgen: tecsgen version 1.9.1");
    expect(versionText).toContain('tecsgenのコマンドラインオプション: ruby "C:\\tools\\tecsgen.rb"');
    expect(versionText).not.toContain("実行コマンド:");

    const tecspathLabel = document.querySelector<HTMLLabelElement>('label[for="information-tecspath"]');
    const tecspathInput = document.querySelector<HTMLInputElement>("#information-tecspath");
    expect(tecspathLabel?.textContent).toBe("環境変数TECSPATH:");
    expect(tecspathInput?.readOnly).toBe(true);
    expect(tecspathInput?.value).toBe("/env/tecs");

    const cmdEnvLabel = document.querySelector<HTMLLabelElement>('label[for="information-tecsgen-command"]');
    const cmdEnvInput = document.querySelector<HTMLInputElement>("#information-tecsgen-command");
    expect(cmdEnvLabel?.textContent).toBe("環境変数TECSGEN_COMMAND:");
    expect(cmdEnvInput?.readOnly).toBe(true);
    expect(cmdEnvInput?.value).toBe('ruby "C:\\tools\\tecsgen.rb"');

    view.dispose();
  });

  it("shows empty string in 環境変数TECSGEN_COMMAND input when unset", async () => {
    const unsetSettings: ToolSettings = { ...baseSettings, tecsgenCommandEnv: "", override: false };
    const settings = {
      getToolSettings: vi.fn(async () => unsetSettings),
      getAppInformation: vi.fn(async () => baseInfo),
      chooseTecsgenPath: vi.fn(async () => null),
      updateToolSettings: vi.fn(async (_patch: ToolSettingsUpdate) => ({ ok: true as const, settings: unsetSettings })),
    };
    const view = new InformationDialog({
      settings,
      tecsgen: { checkPath: vi.fn(async () => ({ kind: "not-found" as const })) },
      clipboard: { writeText: vi.fn(async () => {}) },
      onSaved: vi.fn(async () => undefined),
      document,
    });
    await view.open();

    const cmdEnvInput = document.querySelector<HTMLInputElement>("#information-tecsgen-command");
    expect(cmdEnvInput?.readOnly).toBe(true);
    expect(cmdEnvInput?.value).toBe("");

    view.dispose();
  });
});

describe("V0.3.0 Stage 1: 5B status legend does not cover canvas cells", () => {
  it("places #status-legend outside #canvas-area and without absolute overlay positioning", () => {
    const htmlPath = resolve(__dirname, "../../src/renderer/index.html");
    const html = readFileSync(htmlPath, "utf-8");

    const parser = new DOMParser();
    const parsed = parser.parseFromString(html, "text/html");
    const app = parsed.querySelector("#app");
    const toolbar = parsed.querySelector("#toolbar");
    const statusLegend = parsed.querySelector("#status-legend");
    const main = parsed.querySelector("#main");
    const canvasArea = parsed.querySelector("#canvas-area");

    expect(statusLegend).not.toBeNull();
    expect(canvasArea?.querySelector("#status-legend")).toBeNull();
    expect(statusLegend?.parentElement).toBe(app);

    const children = Array.from(app!.children);
    expect(children.indexOf(toolbar!)).toBeLessThan(children.indexOf(statusLegend!));
    expect(children.indexOf(statusLegend!)).toBeLessThan(children.indexOf(main!));

    const styleBlock = parsed.querySelector("style")?.textContent ?? "";
    const legendCssMatch = styleBlock.match(/#status-legend\s*\{([^}]*)\}/);
    expect(legendCssMatch).not.toBeNull();
    expect(legendCssMatch![1]).not.toMatch(/position\s*:\s*absolute/i);
  });
});
