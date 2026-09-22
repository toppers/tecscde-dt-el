/**
 * @vitest-environment happy-dom
 */
// [[TECSCDE-DT-EL内部仕様]] 第7章7.6.3節・[[TECSCDE-DT外部仕様]]3.5.1節 — `FileBrowserView`
// の単体テスト。`FileGateway`はスタブし、遅延展開（listDirectoryは展開のたびに呼ばれる）と
// 現在編集中ファイルの強調表示を検証する。

import { describe, expect, it, vi } from "vitest";
import type { DirEntry } from "../../src/shared/ipc-types";
import type { FileGateway } from "../../src/renderer/gateways/file-gateway";
import type { AppStore } from "../../src/renderer/app/store";
import { FileBrowserView } from "../../src/renderer/app/file-browser-panel";

function fakeStore(filePath: string | null): AppStore {
  return { filePath } as unknown as AppStore;
}

function fakeGateway(opts: {
  chooseFolder?: () => Promise<string | null>;
  listDirectory?: (dir: string) => Promise<readonly DirEntry[]>;
}): { gateway: FileGateway; listDirectoryCalls: string[] } {
  const listDirectoryCalls: string[] = [];
  const gateway = {
    chooseFolder: opts.chooseFolder ?? (async () => null),
    listDirectory: async (dir: string) => {
      listDirectoryCalls.push(dir);
      return opts.listDirectory ? opts.listDirectory(dir) : [];
    },
  } as unknown as FileGateway;
  return { gateway, listDirectoryCalls };
}

describe("FileBrowserView", () => {
  it("shows a placeholder when no root folder has been chosen", () => {
    const el = document.createElement("div");
    const { gateway } = fakeGateway({});
    const view = new FileBrowserView(el, fakeStore(null), gateway, vi.fn());

    view.render();

    expect(el.querySelector(".file-browser-empty")).not.toBeNull();
  });

  it("chooseRoot() loads the root's children and renders an expanded root node", async () => {
    const el = document.createElement("div");
    const entries: DirEntry[] = [
      { name: "sub", path: "/root/sub", kind: "directory" },
      { name: "main.cde", path: "/root/main.cde", kind: "file" },
    ];
    const { gateway, listDirectoryCalls } = fakeGateway({
      chooseFolder: async () => "/root",
      listDirectory: async (dir) => (dir === "/root" ? entries : []),
    });
    const view = new FileBrowserView(el, fakeStore(null), gateway, vi.fn());

    await view.chooseRoot();

    expect(listDirectoryCalls).toEqual(["/root"]);
    const rows = Array.from(el.querySelectorAll<HTMLElement>("[data-path]"));
    expect(rows.map((r) => r.dataset["path"])).toEqual(["/root", "/root/sub", "/root/main.cde"]);
  });

  it("clicking a collapsed directory lazily loads and expands its children", async () => {
    const el = document.createElement("div");
    const { gateway, listDirectoryCalls } = fakeGateway({
      chooseFolder: async () => "/root",
      listDirectory: async (dir) => {
        if (dir === "/root") return [{ name: "sub", path: "/root/sub", kind: "directory" }];
        if (dir === "/root/sub") return [{ name: "a.cde", path: "/root/sub/a.cde", kind: "file" }];
        return [];
      },
    });
    const view = new FileBrowserView(el, fakeStore(null), gateway, vi.fn());
    await view.chooseRoot();
    expect(listDirectoryCalls).toEqual(["/root"]);

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    const subRow = el.querySelector<HTMLElement>('[data-path="/root/sub"]')!;
    subRow.dispatchEvent(new Event("click", { bubbles: true }));
    // toggle() は非同期（listDirectory を await するチェーンが複数段ある）ので、
    // マイクロタスクではなくマクロタスクの区切りまで待つ。
    await flush();

    expect(listDirectoryCalls).toEqual(["/root", "/root/sub"]);
    expect(el.querySelector('[data-path="/root/sub/a.cde"]')).not.toBeNull();

    // 再度クリックすると折りたたまれ、子は再取得されない（キャッシュ済み）。
    el.querySelector<HTMLElement>('[data-path="/root/sub"]')!.dispatchEvent(new Event("click", { bubbles: true }));
    await flush();
    expect(el.querySelector('[data-path="/root/sub/a.cde"]')).toBeNull();
  });

  it("clicking a file row invokes onOpen with its path, not the directory toggle", async () => {
    const el = document.createElement("div");
    const { gateway } = fakeGateway({
      chooseFolder: async () => "/root",
      listDirectory: async () => [{ name: "main.cde", path: "/root/main.cde", kind: "file" }],
    });
    const onOpen = vi.fn();
    const view = new FileBrowserView(el, fakeStore(null), gateway, onOpen);
    await view.chooseRoot();

    el.querySelector<HTMLElement>('[data-path="/root/main.cde"]')!.dispatchEvent(new Event("click", { bubbles: true }));

    expect(onOpen).toHaveBeenCalledWith("/root/main.cde");
  });

  it("highlights the row matching the store's current filePath (3.5.1節)", async () => {
    const el = document.createElement("div");
    const { gateway } = fakeGateway({
      chooseFolder: async () => "/root",
      listDirectory: async () => [
        { name: "a.cde", path: "/root/a.cde", kind: "file" },
        { name: "b.cde", path: "/root/b.cde", kind: "file" },
      ],
    });
    const view = new FileBrowserView(el, fakeStore("/root/b.cde"), gateway, vi.fn());

    await view.chooseRoot();

    expect(el.querySelector('[data-path="/root/a.cde"]')!.classList.contains("active")).toBe(false);
    expect(el.querySelector('[data-path="/root/b.cde"]')!.classList.contains("active")).toBe(true);
  });

  it("restoreRoot() (7.6.6節) loads and expands the given path without a dialog", async () => {
    const el = document.createElement("div");
    const { gateway, listDirectoryCalls } = fakeGateway({
      listDirectory: async (dir) => (dir === "/saved-root" ? [{ name: "main.cde", path: "/saved-root/main.cde", kind: "file" }] : []),
    });
    const view = new FileBrowserView(el, fakeStore(null), gateway, vi.fn());

    await view.restoreRoot("/saved-root");

    expect(listDirectoryCalls).toEqual(["/saved-root"]);
    expect(el.querySelector('[data-path="/saved-root/main.cde"]')).not.toBeNull();
  });

  it("restoreRoot() falls back to the empty placeholder when the saved folder can't be read (3.5.1節)", async () => {
    const el = document.createElement("div");
    const { gateway } = fakeGateway({
      listDirectory: async () => {
        throw new Error("ENOENT");
      },
    });
    const view = new FileBrowserView(el, fakeStore(null), gateway, vi.fn());

    await view.restoreRoot("/missing-root");

    expect(el.querySelector(".file-browser-empty")).not.toBeNull();
  });
});
