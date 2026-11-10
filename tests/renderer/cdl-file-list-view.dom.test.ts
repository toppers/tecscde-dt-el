/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { CdlFileListView } from "../../src/renderer/app/cdl-file-list-view";

describe("CDL file list view", () => {
  it("does not apply a delayed plan after the view is disposed", async () => {
    let finish!: (value: { kind: "planned"; planId: string; items: [] }) => void;
    const settings = { getCdlFilesRoot: vi.fn(async () => "/root"), setCdlFilesRoot: vi.fn(async () => {}), chooseCdlFilesRoot: vi.fn(async () => null) };
    const file = { planCdlFileLists: vi.fn(() => new Promise<{ kind: "planned"; planId: string; items: [] }>((resolve) => { finish = resolve; })),
      applyCdlFileLists: vi.fn(async () => ({ kind: "empty" as const })), confirmCdlFileLists: vi.fn(async () => true) };
    const view = new CdlFileListView(document, settings, file); document.body.append(view.element); await view.refresh();
    view.element.querySelector<HTMLButtonElement>("[data-list-action=generate]")!.click();
    await new Promise((done) => setTimeout(done, 0)); view.dispose(); finish({ kind: "planned", planId: "p", items: [] });
    await new Promise((done) => setTimeout(done, 0)); expect(file.applyCdlFileLists).not.toHaveBeenCalled();
  });
  it("plans before writing and cancels changed lists without applying", async () => {
    const settings = { getCdlFilesRoot: vi.fn(async () => "/root"), setCdlFilesRoot: vi.fn(async () => {}), chooseCdlFilesRoot: vi.fn(async () => null) };
    const file = { planCdlFileLists: vi.fn(async () => ({ kind: "planned" as const, planId: "p", items: [{ path: "/root/_CDL_FILES.txt", status: "differs" as const }] })),
      applyCdlFileLists: vi.fn(async () => ({ kind: "empty" as const })), confirmCdlFileLists: vi.fn(async () => false) };
    const view = new CdlFileListView(document, settings, file);
    document.body.append(view.element); await view.refresh();
    view.element.querySelector<HTMLButtonElement>("[data-list-action=generate]")!.click();
    await new Promise((done) => setTimeout(done, 0));
    expect(file.confirmCdlFileLists).toHaveBeenCalledOnce(); expect(file.applyCdlFileLists).not.toHaveBeenCalled();
    view.dispose();
  });
});
