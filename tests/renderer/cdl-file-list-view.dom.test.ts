/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { CdlFileListView } from "../../src/renderer/app/cdl-file-list-view";

// 三者相違一覧 1-6: 対象ディレクトリは getToolSettings・updateToolSettings で読み書きする（成否を受け取る）。
function makeSettings(failure?: string) {
  return {
    getToolSettings: vi.fn(async () => ({ cdlFilesRoot: "/root" })),
    updateToolSettings: vi.fn(async (patch: { cdlFilesRoot: string }) => failure
      ? { ok: false as const, error: failure }
      : { ok: true as const, settings: { cdlFilesRoot: patch.cdlFilesRoot } as never }),
    chooseCdlFilesRoot: vi.fn(async () => null),
  };
}

describe("CDL file list view", () => {
  it("does not apply a delayed plan after the view is disposed", async () => {
    let finish!: (value: { kind: "planned"; planId: string; items: [] }) => void;
    const settings = makeSettings();
    const file = { planCdlFileLists: vi.fn(() => new Promise<{ kind: "planned"; planId: string; items: [] }>((resolve) => { finish = resolve; })),
      applyCdlFileLists: vi.fn(async () => ({ kind: "empty" as const })), confirmCdlFileLists: vi.fn(async () => true) };
    const view = new CdlFileListView(document, settings, file); document.body.append(view.element); await view.refresh();
    view.element.querySelector<HTMLButtonElement>("[data-list-action=generate]")!.click();
    await new Promise((done) => setTimeout(done, 0)); view.dispose(); finish({ kind: "planned", planId: "p", items: [] });
    await new Promise((done) => setTimeout(done, 0)); expect(file.applyCdlFileLists).not.toHaveBeenCalled();
  });
  it("plans before writing and cancels changed lists without applying", async () => {
    const settings = makeSettings();
    const file = { planCdlFileLists: vi.fn(async () => ({ kind: "planned" as const, planId: "p", items: [{ path: "/root/_CDL_FILES.txt", status: "differs" as const }] })),
      applyCdlFileLists: vi.fn(async () => ({ kind: "empty" as const })), confirmCdlFileLists: vi.fn(async () => false) };
    const view = new CdlFileListView(document, settings, file);
    document.body.append(view.element); await view.refresh();
    view.element.querySelector<HTMLButtonElement>("[data-list-action=generate]")!.click();
    await new Promise((done) => setTimeout(done, 0));
    expect(file.confirmCdlFileLists).toHaveBeenCalledOnce(); expect(file.applyCdlFileLists).not.toHaveBeenCalled();
    view.dispose();
  });
  it("shows the reason and does not plan when saving the root fails", async () => {
    const settings = makeSettings("disk full");
    const file = { planCdlFileLists: vi.fn(async () => ({ kind: "empty" as const })),
      applyCdlFileLists: vi.fn(async () => ({ kind: "empty" as const })), confirmCdlFileLists: vi.fn(async () => true) };
    const view = new CdlFileListView(document, settings, file);
    document.body.append(view.element); await view.refresh();
    view.element.querySelector<HTMLButtonElement>("[data-list-action=generate]")!.click();
    await new Promise((done) => setTimeout(done, 0));
    expect(settings.updateToolSettings).toHaveBeenCalledWith({ cdlFilesRoot: "/root" });
    expect(file.planCdlFileLists).not.toHaveBeenCalled();
    expect(view.element.querySelector("[role=status]")!.textContent).toContain("disk full");
    view.dispose();
  });
  it("saves a changed root through updateToolSettings and shows a failure", async () => {
    const settings = makeSettings("read only");
    const file = { planCdlFileLists: vi.fn(), applyCdlFileLists: vi.fn(), confirmCdlFileLists: vi.fn() };
    const view = new CdlFileListView(document, settings, file as never);
    document.body.append(view.element); await view.refresh();
    const input = view.element.querySelector<HTMLInputElement>("#cdl-list-root")!;
    input.value = "/elsewhere"; input.dispatchEvent(new Event("change"));
    await new Promise((done) => setTimeout(done, 0));
    expect(settings.updateToolSettings).toHaveBeenCalledWith({ cdlFilesRoot: "/elsewhere" });
    expect(view.element.querySelector("[role=status]")!.textContent).toContain("read only");
    view.dispose();
  });
});
