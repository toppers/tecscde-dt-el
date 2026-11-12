/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InformationDialog } from "../../src/renderer/app/information-dialog";
import type { AppInformation, ToolSettings, ToolSettingsUpdate, TecsgenVersionResult } from "../../src/shared/ipc-types";

const current: ToolSettings = {
  revision: 1, tecsgenPath: "/tools/tecsgen", tecspath: "/tecs", effectiveSource: "settings",
  effectiveCommand: "/tools/tecsgen", executable: "/tools/tecsgen", prefixArgs: [], override: false,
};
const information: AppInformation = {
  name: "TECSCDE-DT-EL", version: "0.1.0", commit: "a123b45", cdeFormatVersion: "0.1.0.0",
  electron: "44", chrome: "148", node: "24", platform: "win32", arch: "x64",
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function setup() {
  const settings = {
    getToolSettings: vi.fn(async () => current),
    getAppInformation: vi.fn(async () => information),
    chooseTecsgenPath: vi.fn(async () => "/selected/tecsgen" as string | null),
    chooseCppPath: vi.fn(async (_current?: string) => "/selected/gcc" as string | null),
    updateToolSettings: vi.fn(async (patch: ToolSettingsUpdate) => ({
      ok: true as const,
      settings: {
        ...current,
        revision: 2,
        ...(patch.tecsgenPath !== undefined ? { tecsgenPath: patch.tecsgenPath, effectiveCommand: patch.tecsgenPath } : {}),
        ...(patch.cppPath !== undefined ? { cppPath: patch.cppPath, effectiveCppFullPath: patch.cppPath, effectiveCppCommand: `${patch.cppPath} ${patch.cppArgs ?? ""}`.trim() } : {}),
        ...(patch.cppArgs !== undefined ? { cppArgs: patch.cppArgs } : {}),
      },
    })),
  };
  const tecsgen = { checkPath: vi.fn(async (_path: string): Promise<TecsgenVersionResult> => ({ kind: "ok", text: "tecsgen candidate" })) };
  const clipboard = { writeText: vi.fn(async (_text: string) => {}) };
  const onSaved = vi.fn(async (_settings: ToolSettings): Promise<TecsgenVersionResult> => ({ kind: "ok", text: "tecsgen version 1.9.1 (saved)" }));
  const getTecsgenStatus = vi.fn(() => ({ version: "tecsgen current", command: "/current/tecsgen" }));
  const view = new InformationDialog({ settings, tecsgen, clipboard, onSaved, getTecsgenStatus, document });
  return { view, settings, tecsgen, clipboard, onSaved, getTecsgenStatus };
}
function button(action: string): HTMLButtonElement { return document.querySelector(`[data-information-action=${action}]`)!; }
function input(): HTMLInputElement { return document.querySelector("#information-tecsgen-path")!; }
function type(value: string) { input().value = value; input().dispatchEvent(new Event("input", { bubbles: true })); }
function result(): string { return document.querySelector("#information-settings-result")!.textContent!; }

function cppPathInput(): HTMLInputElement { return document.querySelector("#information-cpp-path")!; }
function cppArgsInput(): HTMLInputElement { return document.querySelector("#information-cpp-args")!; }
function cppBrowseButton(): HTMLButtonElement { return document.querySelector("#information-cpp-browse")!; }
function cppSaveButton(): HTMLButtonElement { return document.querySelector("#information-cpp-save")!; }
function cppResult(): string { return document.querySelector("#information-cpp-result")!.textContent!; }
function cppEffective(): string { return document.querySelector("#information-cpp-effective")!.textContent!; }
function cppMeta(): string { return document.querySelector("#information-cpp-meta")!.textContent!; }
function typeCppPath(value: string) { cppPathInput().value = value; cppPathInput().dispatchEvent(new Event("input", { bubbles: true })); }
function typeCppArgs(value: string) { cppArgsInput().value = value; cppArgsInput().dispatchEvent(new Event("input", { bubbles: true })); }

beforeEach(() => {
  document.body.replaceChildren();
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); });
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("InformationDialog", () => {
  it("keeps unparsable output distinct from a confirmed version after saving", async () => {
    const { view, onSaved } = setup();
    onSaved.mockResolvedValue({ kind: "ok", text: "not a version" });
    await view.open(); type("/candidate"); button("save").click(); await tick();
    expect(document.querySelector("#information-version")!.textContent).toContain("tecsgen: 未確認");
    expect(document.querySelector("#information-version")!.textContent).not.toContain("not a version");
    view.dispose();
  });
  it("opens modally and copies full version/current-tool information without exposing PATH", async () => {
    const { view, clipboard } = setup();
    await view.open();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
    expect(input().value).toBe("/tools/tecsgen");
    const tecspath = document.querySelector<HTMLInputElement>("#information-tecspath")!;
    expect(tecspath.value).toBe("/tecs");
    expect(tecspath.readOnly).toBe(true);
    expect(Array.from(document.querySelectorAll("label")).some((label) => label.textContent === "PATH")).toBe(false);
    expect(document.body.textContent).toContain("tecsgen current");
    button("copy").click(); await tick();
    const copied = clipboard.writeText.mock.calls[0]![0];
    expect(copied).toContain("アプリケーション: TECSCDE-DT-EL\nバージョン: 0.1.0\n");
    for (const value of ["TECSCDE-DT-EL", "0.1.0", "a123b45", "0.1.0.0", "Electron: 44", "Chrome: 148", "Node.js: 24", "win32", "x64", "tecsgen current", "/current/tecsgen"]) expect(copied).toContain(value);
    view.dispose();
  });

  it("checks a candidate without saving or changing the confirmed version", async () => {
    const { view, settings, tecsgen, onSaved } = setup();
    tecsgen.checkPath.mockResolvedValue({ kind: "failed", detail: "candidate failed" });
    await view.open(); type("/candidate"); button("check").click(); await tick();
    expect(tecsgen.checkPath).toHaveBeenCalledExactlyOnceWith("/candidate");
    expect(settings.updateToolSettings).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(document.querySelector("#information-check-result")!.textContent).toContain("candidate failed");
    expect(document.querySelector("#information-version")!.textContent).toContain("tecsgen current");
    expect(button("save").disabled).toBe(false);
    button("save").click(); await tick();
    expect(settings.updateToolSettings).toHaveBeenCalledExactlyOnceWith({ tecsgenPath: "/candidate" });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(tecsgen.checkPath).toHaveBeenCalledTimes(1);
    expect(result()).toContain("保存しました");
    expect(document.querySelector("#information-version")!.textContent).toContain("tecsgen version 1.9.1 (saved)");
    view.dispose();
  });

  it("keeps input and shows an inline error when persistence fails", async () => {
    const { view, settings, onSaved } = setup();
    settings.updateToolSettings.mockResolvedValue({ ok: false, error: "permission denied" } as never);
    await view.open(); type("/keep/this"); button("save").click(); await tick();
    expect(input().value).toBe("/keep/this");
    expect(result()).toContain("permission denied");
    expect(result()).not.toContain("保存しました");
    expect(onSaved).not.toHaveBeenCalled();
    view.dispose();
  });

  it("explains environment override and still permits saving an unverified path", async () => {
    const { view, settings } = setup();
    settings.getToolSettings.mockResolvedValue({ ...current, override: true, effectiveSource: "environment", effectiveCommand: "custom-tecsgen" });
    await view.open();
    expect(document.querySelector("#information-override")!.textContent).toContain("TECSGEN_COMMAND");
    expect(document.querySelector("#information-override")!.textContent).toContain("使われません");
    type("/unverified"); button("save").click(); await tick();
    expect(settings.updateToolSettings).toHaveBeenCalledOnce();
    view.dispose();
  });

  it("ignores delayed checks when the input or a newer check has changed", async () => {
    const { view, tecsgen } = setup();
    const old = deferred<TecsgenVersionResult>();
    tecsgen.checkPath.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ kind: "ok", text: "new candidate" });
    await view.open(); type("/old"); button("check").click();
    type("/new"); button("check").click(); await tick();
    old.resolve({ kind: "ok", text: "old candidate" }); await tick();
    expect(document.querySelector("#information-check-result")!.textContent).toContain("new candidate");
    expect(document.querySelector("#information-check-result")!.textContent).not.toContain("old candidate");
    view.dispose();
  });

  it("does not overwrite text typed while the file picker is open", async () => {
    const { view, settings } = setup();
    const selected = deferred<string | null>();
    settings.chooseTecsgenPath.mockReturnValue(selected.promise);
    await view.open(); button("browse").click(); type("/typed/later");
    selected.resolve("/obsolete/selection"); await tick();
    expect(input().value).toBe("/typed/later");
    view.dispose();
  });

  it("preserves edits made during save and reports recheck failures without reversing persistence", async () => {
    const { view, settings, onSaved } = setup();
    const save = deferred<Awaited<ReturnType<typeof settings.updateToolSettings>>>();
    settings.updateToolSettings.mockReturnValue(save.promise);
    onSaved.mockResolvedValue({ kind: "failed", detail: "current command failed" });
    await view.open(); type("/saved"); button("save").click(); type("/new-unsaved");
    save.resolve({ ok: true, settings: { ...current, revision: 2, tecsgenPath: "/saved" } }); await tick();
    expect(input().value).toBe("/new-unsaved");
    expect(result()).toContain("保存しました");
    expect(result()).toContain("current command failed");
    expect(result()).toContain("未保存");
    view.dispose();
  });

  it("preserves draft on reopen and ignores obsolete open/check responses after close or dispose", async () => {
    const { view, tecsgen } = setup();
    const check = deferred<TecsgenVersionResult>();
    tecsgen.checkPath.mockReturnValue(check.promise);
    await view.open(); type("/draft"); button("check").click(); button("close").click();
    await view.open();
    expect(input().value).toBe("/draft");
    check.resolve({ kind: "ok", text: "obsolete" }); await tick();
    expect(document.querySelector("#information-check-result")!.textContent).not.toContain("obsolete");
    view.dispose();
    expect(document.querySelector("#information-dialog")).toBeNull();
  });

  it("presents missing app build metadata and current tecsgen status explicitly", async () => {
    const { view, settings } = setup();
    settings.getAppInformation.mockResolvedValue({ ...information, commit: "unknown" });
    await view.open();
    expect(document.querySelector("#information-version")!.textContent).toContain("unknown");
    view.dispose();
  });

  it("shows unconfirmed status when no current tecsgen result is available", async () => {
    const services = setup();
    services.view.dispose();
    const view = new InformationDialog({ ...services, getTecsgenStatus: undefined, document });
    await view.open();
    expect(document.querySelector("#information-version")!.textContent).toContain("tecsgen: 未確認");
    expect(document.querySelector("#information-version")!.textContent).toContain("実行コマンド: /tools/tecsgen");
    view.dispose();
  });

  it("does not let an older open fetch replace newer saved settings", async () => {
    const { view, settings } = setup();
    await view.open(); button("close").click();
    const old = deferred<ToolSettings>();
    settings.getToolSettings.mockReturnValueOnce(old.promise);
    const reopening = view.open();
    type("/new-current"); button("save").click(); await tick();
    old.resolve(current); await reopening;
    expect(input().value).toBe("/new-current");
    expect(result()).toContain("保存しました");
    view.dispose();
  });

  it("does not let an older settings revision's recheck replace a later open", async () => {
    const { view, settings, onSaved } = setup();
    const recheck = deferred<TecsgenVersionResult>();
    onSaved.mockReturnValue(recheck.promise);
    await view.open(); type("/old-save"); button("save").click(); await tick();
    button("close").click();
    settings.getToolSettings.mockResolvedValue({ ...current, revision: 3, tecsgenPath: "/latest", effectiveCommand: "/latest" });
    await view.open();
    recheck.resolve({ kind: "ok", text: "obsolete checked version" }); await tick();
    expect(document.querySelector("#information-version")!.textContent).not.toContain("obsolete checked version");
    expect(input().value).toBe("/old-save"); // unsaved draft survives closing/reopening
    view.dispose();
  });

  it("renders version text as plain text rather than interpreting HTML", async () => {
    const { view, settings } = setup();
    settings.getAppInformation.mockResolvedValue({ ...information, name: "<img src=x onerror=alert(1)>" });
    await view.open();
    expect(document.querySelector("#information-dialog img")).toBeNull();
    expect(document.querySelector("#information-version")!.textContent).toContain("<img src=x");
    view.dispose();
  });

  it("does not invalidate a reopened dialog when the previous native close event arrives later", async () => {
    const { view, settings } = setup();
    await view.open();
    vi.mocked(HTMLDialogElement.prototype.close).mockImplementationOnce(function (this: HTMLDialogElement) { this.removeAttribute("open"); });
    button("close").click();
    settings.getToolSettings.mockResolvedValue({ ...current, revision: 2, tecsgenPath: "/fresh" });
    const reopened = view.open();
    document.querySelector("#information-dialog")!.dispatchEvent(new Event("close"));
    await reopened;
    expect(input().value).toBe("/fresh");
    expect(view.isOpen).toBe(true);
    view.dispose();
  });

  it("clears the obsolete saving indicator when a closed save finished before reopening", async () => {
    const { view, settings } = setup();
    const pending = deferred<Awaited<ReturnType<typeof settings.updateToolSettings>>>();
    settings.updateToolSettings.mockReturnValue(pending.promise);
    await view.open(); type("/saved"); button("save").click(); button("close").click();
    pending.resolve({ ok: true, settings: { ...current, revision: 2, tecsgenPath: "/saved" } });
    await tick();
    settings.getToolSettings.mockResolvedValue({ ...current, revision: 2, tecsgenPath: "/saved" });
    await view.open();
    expect(result()).not.toContain("保存中");
    expect(button("save").disabled).toBe(false);
    expect(input().value).toBe("/saved");
    view.dispose();
  });

  it("refreshes a late current version without changing a draft and uses the resolved command while unconfirmed", async () => {
    const { view, getTecsgenStatus } = setup();
    getTecsgenStatus.mockReturnValue({ version: "未確認", command: "未確認" });
    await view.open(); type("/keep/draft");
    expect(document.querySelector("#information-version")!.textContent).toContain("実行コマンド: /tools/tecsgen");
    getTecsgenStatus.mockReturnValue({ version: "tecsgen late version", command: "/tools/tecsgen" });
    view.refreshStatus();
    expect(document.querySelector("#information-version")!.textContent).toContain("tecsgen late version");
    expect(input().value).toBe("/keep/draft");
    view.dispose();
  });

  // ==========================================
  // V0.2.1: Cプリプロセッサ設定テスト (Unit D)
  // ==========================================
  it("displays effectiveCppCommand, fullPath, and originReason when opened", async () => {
    const { view, settings } = setup();
    settings.getToolSettings.mockResolvedValue({
      ...current,
      effectiveCppCommand: "arm-none-eabi-gcc -E -DTECSGEN",
      effectiveCppFullPath: "C:/ArmGNU/bin/arm-none-eabi-gcc.exe",
      cppOriginReason: "自動検出",
    });
    await view.open();
    expect(cppEffective()).toContain("arm-none-eabi-gcc -E -DTECSGEN");
    expect(cppMeta()).toContain("C:/ArmGNU/bin/arm-none-eabi-gcc.exe");
    expect(cppMeta()).toContain("自動検出");
    view.dispose();
  });

  it("displays fallback values safely when cpp fields are missing in ToolSettings", async () => {
    const { view } = setup();
    await view.open();
    expect(cppEffective()).toContain("gcc");
    expect(cppMeta()).toContain("未検出 (PATH上)");
    expect(cppMeta()).toContain("フォールバック");
    view.dispose();
  });

  it("initializes cppArgs input to default '-E -DTECSGEN' when settings.cppArgs is undefined", async () => {
    const { view, settings } = setup();
    settings.getToolSettings.mockResolvedValue({
      ...current,
      cppArgs: undefined,
    });
    await view.open();
    expect(cppArgsInput().value).toBe("-E -DTECSGEN");
    view.dispose();
  });

  it("initializes cppArgs input to empty string when settings.cppArgs is explicitly empty", async () => {
    const { view, settings } = setup();
    settings.getToolSettings.mockResolvedValue({
      ...current,
      cppArgs: "",
    });
    await view.open();
    expect(cppArgsInput().value).toBe("");
    view.dispose();
  });

  it("browses for cppPath using chooseCppPath and updates the input, keeping value on cancel", async () => {
    const { view, settings } = setup();
    settings.chooseCppPath.mockResolvedValue("C:/tools/arm-none-eabi-gcc.exe");
    await view.open();
    expect(cppPathInput().value).toBe("");
    cppBrowseButton().click();
    await tick();
    expect(settings.chooseCppPath).toHaveBeenCalledOnce();
    expect(cppPathInput().value).toBe("C:/tools/arm-none-eabi-gcc.exe");

    // Cancel preserves current value
    settings.chooseCppPath.mockResolvedValue(null);
    cppBrowseButton().click();
    await tick();
    expect(cppPathInput().value).toBe("C:/tools/arm-none-eabi-gcc.exe");
    view.dispose();
  });

  it("saves cppPath and cppArgs via save-cpp button and updates effective display and status message", async () => {
    const { view, settings } = setup();
    await view.open();
    typeCppPath("C:/mytools/gcc.exe");
    typeCppArgs("-E -DFOO");
    settings.updateToolSettings.mockResolvedValue({
      ok: true,
      settings: {
        ...current,
        revision: 2,
        cppPath: "C:/mytools/gcc.exe",
        cppArgs: "-E -DFOO",
        effectiveCppCommand: "C:/mytools/gcc.exe -E -DFOO",
        effectiveCppFullPath: "C:/mytools/gcc.exe",
        cppOriginReason: "ユーザ直接指定",
      },
    });
    cppSaveButton().click();
    await tick();
    expect(settings.updateToolSettings).toHaveBeenCalledWith({
      cppPath: "C:/mytools/gcc.exe",
      cppArgs: "-E -DFOO",
    });
    expect(cppResult()).toContain("保存しました");
    expect(cppEffective()).toContain("C:/mytools/gcc.exe -E -DFOO");
    expect(cppMeta()).toContain("C:/mytools/gcc.exe");
    expect(cppMeta()).toContain("ユーザ直接指定");
    view.dispose();
  });

  it("sends empty cppPath and empty cppArgs to clear settings", async () => {
    const { view, settings } = setup();
    settings.getToolSettings.mockResolvedValue({
      ...current,
      cppPath: "C:/old/gcc.exe",
      cppArgs: "-E -DOLD",
    });
    await view.open();
    expect(cppPathInput().value).toBe("C:/old/gcc.exe");
    typeCppPath("");
    typeCppArgs("");
    settings.updateToolSettings.mockResolvedValue({
      ok: true,
      settings: {
        ...current,
        revision: 2,
        cppPath: "",
        cppArgs: "",
        effectiveCppCommand: "gcc",
        effectiveCppFullPath: "未検出 (PATH上)",
        cppOriginReason: "フォールバック",
      },
    });
    cppSaveButton().click();
    await tick();
    expect(settings.updateToolSettings).toHaveBeenCalledWith({
      cppPath: "",
      cppArgs: "",
    });
    expect(cppResult()).toContain("保存しました");
    expect(cppEffective()).toContain("gcc");
    expect(cppMeta()).toContain("フォールバック");
    view.dispose();
  });

  it("shows an error message inline when cpp settings update fails", async () => {
    const { view, settings } = setup();
    settings.updateToolSettings.mockResolvedValue({ ok: false, error: "failed to write settings" } as never);
    await view.open();
    typeCppPath("/some/gcc");
    cppSaveButton().click();
    await tick();
    expect(cppResult()).toContain("failed to write settings");
    expect(cppResult()).not.toContain("保存しました");
    view.dispose();
  });

  it("includes cppPath and cppArgs in tecsgen save button when cpp input was modified", async () => {
    const { view, settings } = setup();
    await view.open();
    type("/new/tecsgen");
    typeCppPath("arm-gcc");
    typeCppArgs("-E -DTECSGEN");
    button("save").click();
    await tick();
    expect(settings.updateToolSettings).toHaveBeenCalledWith({
      tecsgenPath: "/new/tecsgen",
      cppPath: "arm-gcc",
      cppArgs: "-E -DTECSGEN",
    });
    view.dispose();
  });
});
