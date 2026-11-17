import type { CdlFileListPlan, CdlFileListResult, ToolSettings, ToolSettingsUpdateResult } from "../../shared/ipc-types";

/** 対象ディレクトリは、他のツール設定と同じ`getToolSettings`・`updateToolSettings`で読み書きする（三者相違一覧1-6）。 */
interface Settings {
  getToolSettings(): Promise<Pick<ToolSettings, "cdlFilesRoot">>;
  updateToolSettings(patch: { readonly cdlFilesRoot: string }): Promise<ToolSettingsUpdateResult>;
  chooseCdlFilesRoot(): Promise<string | null>;
}
interface Files {
  planCdlFileLists(root: string): Promise<CdlFileListPlan>;
  applyCdlFileLists(planId: string): Promise<CdlFileListResult>;
  confirmCdlFileLists(paths: readonly string[]): Promise<boolean>;
}

export class CdlFileListView {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly result: HTMLElement;
  private readonly generate: HTMLButtonElement;
  private readonly browse: HTMLButtonElement;
  private busy = false;
  private disposed = false;
  private generation = 0;
  constructor(doc: Document, private readonly settings: Settings, private readonly files: Files) {
    this.element = doc.createElement("section");
    this.element.className = "cdl-file-list-section";
    const heading = doc.createElement("h3"); heading.textContent = "CDLファイル一覧の作成";
    const label = doc.createElement("label"); label.textContent = "対象ディレクトリ";
    this.input = doc.createElement("input"); this.input.type = "text"; this.input.id = "cdl-list-root";
    this.input.addEventListener("input", () => { this.generation++; });
    this.input.addEventListener("change", () => { void this.saveRoot(this.input.value); });
    label.htmlFor = this.input.id;
    const choose = doc.createElement("button"); choose.type = "button"; choose.textContent = "参照…";
    this.browse = choose;
    choose.dataset["listAction"] = "browse"; choose.addEventListener("click", () => void this.choose());
    this.generate = doc.createElement("button"); this.generate.type = "button"; this.generate.textContent = "CDLファイル一覧を作成";
    this.generate.dataset["listAction"] = "generate"; this.generate.addEventListener("click", () => void this.run());
    this.result = doc.createElement("p"); this.result.setAttribute("role", "status"); this.result.setAttribute("aria-live", "polite");
    this.element.append(heading, label, this.input, choose, this.generate, this.result);
  }
  async refresh(): Promise<void> {
    if (this.busy || this.disposed) return;
    const token = ++this.generation;
    try { const root = (await this.settings.getToolSettings()).cdlFilesRoot; if (token === this.generation) this.input.value = root; }
    catch (error) { if (token === this.generation) this.show(error); }
  }
  dispose(): void { this.disposed = true; this.generation++; this.element.remove(); }
  /** 保存し、失敗したときは理由を表示して`false`を返す。 */
  private async saveRoot(root: string): Promise<boolean> {
    try {
      const result = await this.settings.updateToolSettings({ cdlFilesRoot: root });
      if (result.ok) return true;
      this.show(result.error);
    } catch (error) { this.show(error); }
    return false;
  }
  private show(value: unknown): void { this.result.textContent = value instanceof Error ? value.message : String(value); }
  private async choose(): Promise<void> {
    try {
      const token = this.generation;
      const root = await this.settings.chooseCdlFilesRoot();
      if (!this.disposed && token === this.generation && root !== null) { this.generation++; this.input.value = root; await this.saveRoot(root); }
    }
    catch (error) { this.show(error); }
  }
  private async run(): Promise<void> {
    if (this.busy || this.disposed) return;
    const token = this.generation;
    this.busy = true; this.generate.disabled = true; this.input.disabled = true; this.browse.disabled = true;
    try {
      const root = this.input.value;
      if (!await this.saveRoot(root)) return;
      if (this.disposed || token !== this.generation) return;
      const plan = await this.files.planCdlFileLists(root);
      if (this.disposed || token !== this.generation) return;
      if (plan.kind === "empty") { this.show("CDLファイルが見つかりませんでした。"); return; }
      if (plan.kind === "failed") { this.show(`${plan.path}: ${plan.detail}`); return; }
      const changed = plan.items.filter((item) => item.status === "differs").map((item) => item.path);
      if (changed.length && !await this.files.confirmCdlFileLists(changed)) { this.show("キャンセルしました。"); return; }
      if (this.disposed || token !== this.generation) return;
      const result = await this.files.applyCdlFileLists(plan.planId);
      if (result.kind === "ok") this.show(`${result.rootListPath}\n子一覧: ${result.listCount}件／変更なしの一覧: ${result.skippedSame}件（ルート一覧を含む）`);
      else if (result.kind === "failed") this.show(`${result.path}: ${result.detail}\n書込済み: ${result.writtenPaths.join(", ")}`);
      else if (result.kind === "changed") this.show(`一覧が変更されたため中止しました: ${result.path}`);
      else this.show("CDLファイルが見つかりませんでした。");
    } catch (error) { this.show(error); }
    finally { this.busy = false; this.generate.disabled = false; this.input.disabled = false; this.browse.disabled = false; }
  }
}
