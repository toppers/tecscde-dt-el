// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaletteView } from "../../src/renderer/app/palette";
import { FileBrowserView } from "../../src/renderer/app/file-browser-panel";
import { AppStore } from "../../src/renderer/app/store";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";

afterEach(() => { document.body.replaceChildren(); });

describe("stage 2 panel lifecycle", () => {
  it("detaches all three palette actions only on disposal, including repeated disposal", () => {
    const root = document.createElement("div");
    root.innerHTML = '<button data-mode="select"></button><button data-mode="newCell"></button><div id="palette-celltypes"><button data-celltype="tChosen">tChosen</button></div>';
    document.body.append(root);
    const store = new AppStore();
    const mode = vi.spyOn(store, "setMode");
    const active = vi.spyOn(store, "setActiveCelltype");
    const palette = new PaletteView(root, store);
    const select = root.querySelector<HTMLButtonElement>('[data-mode="select"]')!;
    const newCell = root.querySelector<HTMLButtonElement>('[data-mode="newCell"]')!;
    const celltype = root.querySelector<HTMLButtonElement>('[data-celltype]')!;
    newCell.click();
    expect(store.getMode()).toBe("newCell");
    select.click();
    expect(store.getMode()).toBe("select");
    celltype.click();
    expect(store.getActiveCelltypeName()).toBe("tChosen");
    expect(store.getMode()).toBe("newCell");
    expect(() => { palette.dispose(); palette.dispose(); }).not.toThrow();
    mode.mockClear(); active.mockClear();
    select.click(); newCell.click(); celltype.click();
    expect(mode).not.toHaveBeenCalled();
    expect(active).not.toHaveBeenCalled();
  });

  it("detaches the file browser root listener without changing the retained tree", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const gateway = {
      chooseFolder: vi.fn(async () => "/project"),
      listDirectory: vi.fn(async () => [
        { name: "main.cdl", path: "/project/main.cdl", kind: "file" },
        { name: "options.tecsgen-opts", path: "/project/options.tecsgen-opts", kind: "file" },
      ]),
    };
    const open = vi.fn(), add = vi.fn(), options = vi.fn();
    const browser = new FileBrowserView(root, new AppStore(), gateway as unknown as FileGateway, open, add, options);
    await browser.chooseRoot();
    const main = root.querySelector<HTMLElement>('[data-path="/project/main.cdl"]')!;
    const opts = root.querySelector<HTMLElement>('[data-path="/project/options.tecsgen-opts"]')!;
    main.click();
    main.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    opts.click();
    expect(open).toHaveBeenCalledExactlyOnceWith("/project/main.cdl");
    expect(add).toHaveBeenCalledExactlyOnceWith("/project/main.cdl");
    expect(options).toHaveBeenCalledExactlyOnceWith("/project/options.tecsgen-opts");
    const tree = root.innerHTML;
    expect(() => { browser.dispose(); browser.dispose(); }).not.toThrow();
    open.mockClear(); add.mockClear(); options.mockClear();
    main.click();
    main.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    opts.click();
    root.querySelector<HTMLElement>('[data-kind="directory"]')!.click();
    expect(open).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(options).not.toHaveBeenCalled();
    expect(root.innerHTML).toBe(tree);
  });
});
