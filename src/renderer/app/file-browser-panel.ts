// [[TECSCDE-DT-EL内部仕様]] 第7章7.6.3節・[[TECSCDE-DT外部仕様]]3.5.1節（2026-09-21採用）—
// ファイルブラウザ（サイドパネル、モジュールG次段）。ルートフォルダ配下を階層ツリーとして
// 表示し、`.cde`/`.cdl`ファイルのクリックで開く。ディレクトリはクリックのたびに1階層ずつ
// 遅延展開する（`FileGateway.listDirectory`、7.6.1節の設計判断——tecsgenプロジェクトは
// 本アプリに関係のない大きなサブディレクトリを含みうるため、全体を先読みしない）。

import type { DirEntry } from "../../shared/ipc-types";
import type { FileGateway } from "../gateways/file-gateway";
import { baseName } from "./file-actions";
import type { AppStore } from "./store";

export class FileBrowserView {
  private root: string | null = null;
  /** 3.5.1節: 展開状態・選択位置はアプリケーション実行中の状態としてのみ保持する（保存内容に含めない）。 */
  private readonly expanded = new Set<string>();
  private readonly children = new Map<string, readonly DirEntry[]>();

  constructor(
    private readonly el: HTMLElement,
    private readonly store: AppStore,
    private readonly gateway: FileGateway,
    private readonly onOpen: (path: string) => void,
    /** 第7C章7.7.2節（#8）: Ctrl+クリックで参照専用として追加する。 */
    private readonly onAddReference: (path: string) => void,
    /** 第7C章7.7.4節（#10）: `.tecsgen-opts`ファイルのクリックで一括読み込みする。 */
    private readonly onLoadOptionsFile: (path: string) => void,
  ) {
    this.el.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      const node = target?.closest<HTMLElement>("[data-path]");
      if (!node) return;
      const path = node.dataset["path"]!;
      if (node.dataset["kind"] === "directory") {
        void this.toggle(path);
        return;
      }
      const event = e as MouseEvent;
      if (event.ctrlKey || event.metaKey) {
        this.onAddReference(path);
      } else if (/\.tecsgen-opts$/i.test(path)) {
        this.onLoadOptionsFile(path);
      } else {
        this.onOpen(path);
      }
    });
  }

  /** ツールバーの「フォルダを開く」操作（7.6.5節）から呼ばれる。 */
  async chooseRoot(): Promise<void> {
    const dir = await this.gateway.chooseFolder();
    if (dir) await this.setRoot(dir);
  }

  /**
   * 7.6.6節: 起動時の自動復元用。フォルダが存在しない・アクセスできない場合は
   * フォルダ未選択のまま起動する（エラーにしない、3.5.1節）。
   */
  async restoreRoot(dir: string): Promise<void> {
    try {
      await this.setRoot(dir);
    } catch {
      this.root = null;
      this.render();
    }
  }

  private async setRoot(dir: string): Promise<void> {
    this.root = dir;
    this.expanded.clear();
    this.children.clear();
    await this.loadChildren(dir);
    this.expanded.add(dir);
    this.render();
  }

  private async loadChildren(dirPath: string): Promise<void> {
    if (this.children.has(dirPath)) return;
    this.children.set(dirPath, await this.gateway.listDirectory(dirPath));
  }

  private async toggle(dirPath: string): Promise<void> {
    if (this.expanded.has(dirPath)) {
      this.expanded.delete(dirPath);
      this.render();
      return;
    }
    await this.loadChildren(dirPath);
    this.expanded.add(dirPath);
    this.render();
  }

  render(): void {
    this.el.replaceChildren();
    if (!this.root) {
      const empty = document.createElement("div");
      empty.className = "file-browser-empty";
      empty.textContent = "(フォルダ未選択)";
      this.el.appendChild(empty);
      return;
    }
    const rootEntry: DirEntry = { name: baseName(this.root), path: this.root, kind: "directory" };
    this.el.appendChild(this.buildTree([rootEntry]));
  }

  private buildTree(entries: readonly DirEntry[]): HTMLUListElement {
    const ul = document.createElement("ul");
    ul.className = "file-browser-tree";
    for (const entry of entries) {
      ul.appendChild(this.buildNode(entry));
    }
    return ul;
  }

  private buildNode(entry: DirEntry): HTMLLIElement {
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.dataset["path"] = entry.path;
    row.dataset["kind"] = entry.kind;

    if (entry.kind === "directory") {
      row.className = "file-browser-dir";
      row.textContent = (this.expanded.has(entry.path) ? "▾ " : "▸ ") + entry.name;
    } else {
      row.className = "file-browser-file";
      // 3.5.1節: 現在編集対象になっているファイルはツリー上で強調表示する。
      row.classList.toggle("active", entry.path === this.store.filePath);
      // 第7C章7.7.5節（#11(a)）: 参照読み込み済みのファイルも編集中とは異なる見た目で示す
      // （editable/referencesは排他集合のため両方に該当するノードは無い）。
      row.classList.toggle("reference", this.store.getReferenceFilePaths().includes(entry.path));
      row.textContent = entry.name;
    }
    li.appendChild(row);

    if (entry.kind === "directory" && this.expanded.has(entry.path)) {
      li.appendChild(this.buildTree(this.children.get(entry.path) ?? []));
    }
    return li;
  }
}
