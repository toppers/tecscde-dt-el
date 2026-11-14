/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppShell } from "../../src/renderer/app/shell";
import { AppStore } from "../../src/renderer/app/store";
import { CdlDocumentLoader } from "../../src/renderer/cdl/document-builder";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { AppInformation, ToolSettings } from "../../src/shared/ipc-types";

// 内部仕様 02B 2B.2 / 外部仕様 3.8: ツールバーの「情報」ボタンは、バージョン情報に加えて
// tecsgen 設定・CDLファイル一覧作成を持つ「情報」ダイアログ（InformationDialog）を開く。
// 以前は、ボタンが旧い「バージョン情報」ダイアログ（AboutDialogView）にだけつながっていて、
// InformationDialog には本物のボタンから届かなかった。

const source = "signature sMain { void f(void); }; celltype tMain { entry sMain e; }; cell tMain Main {};";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const toolSettings: ToolSettings = {
  revision: 1, tecsgenPath: "/tools/tecsgen", tecspath: "/tecs", effectiveSource: "settings",
  effectiveCommand: "/tools/tecsgen", executable: "/tools/tecsgen", prefixArgs: [], override: false,
  pluginTypeSource: "external",
};
const appInformation: AppInformation = {
  name: "TECSCDE-DT-EL", version: "0.2.2", commit: "a123b45", cdeFormatVersion: "0.1.0.0",
  electron: "44", chrome: "148", node: "24", platform: "win32", arch: "x64",
};

let shell: AppShell | undefined;

function mount(withSettings: boolean) {
  const html = readFileSync(resolve(__dirname, "../../src/renderer/index.html"), "utf8");
  document.body.innerHTML = html.split("<body>")[1]!.split("</body>")[0]!.replace(/<script[\s\S]*?<\/script>/g, "");
  const store = new AppStore(CdlDocumentLoader.loadSingle(source, "/project/main.cdl").document);
  const gateway = {
    onRestoreFileBrowserRoot: vi.fn(), chooseFolder: vi.fn(async () => null), listDirectory: vi.fn(async () => []),
    save: vi.fn(async () => {}), saveAs: vi.fn(async () => null), saveSession: vi.fn(async () => {}),
    resolveImports: vi.fn(async () => []),
  };
  const settings = {
    getToolSettings: vi.fn(async () => toolSettings),
    getAppInformation: vi.fn(async () => appInformation),
    chooseTecsgenPath: vi.fn(async () => null),
    chooseCppPath: vi.fn(async () => null),
    updateToolSettings: vi.fn(async () => ({ ok: true as const, settings: toolSettings })),
  };
  shell = new AppShell({
    root: document, store, gateway: gateway as unknown as FileGateway,
    tecsgen: { checkPath: vi.fn(async () => ({ kind: "ok", text: "tecsgen" })) } as never,
    clipboard: { writeText: vi.fn(), readText: vi.fn() } as never,
    ...(withSettings ? { settings: settings as never } : {}),
    win: window,
  });
  shell.start();
  return { shell, settings };
}

/** 画面上の「情報」ボタン。data-action の名前に頼らず、利用者に見える文字で探す。 */
function infoButton(): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>("#toolbar button")).find((b) => b.textContent?.trim() === "情報");
  if (!found) throw new Error("「情報」ボタンが見つからない");
  return found;
}

beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "show").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
    this.open = false; this.dispatchEvent(new Event("close"));
  });
});
afterEach(() => { shell?.dispose(); shell = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("「情報」ボタン", () => {
  it("opens the information dialog (tecsgen settings and CDL file list) when the settings gateway is available", async () => {
    const { settings } = mount(true);
    infoButton().click();
    await tick(); await tick();
    const information = document.querySelector<HTMLDialogElement>("#information-dialog");
    expect(information).not.toBeNull();
    expect(information!.open).toBe(true);
    expect(settings.getToolSettings).toHaveBeenCalled();
    // 旧い、バージョン情報だけのダイアログは開かない。
    expect(document.querySelector<HTMLDialogElement>("#about-dialog")!.open).toBe(false);
  });

  it("falls back to the version-only dialog when no settings gateway is given", async () => {
    mount(false);
    infoButton().click();
    await tick();
    expect(document.querySelector<HTMLDialogElement>("#about-dialog")!.open).toBe(true);
    expect(document.querySelector("#information-dialog")).toBeNull();
  });
});
