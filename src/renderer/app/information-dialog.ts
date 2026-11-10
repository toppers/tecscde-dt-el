// [[TECSCDE-DT-EL内部仕様 - 02B V0.2.0画面構成]] 2B.2:
// modal view state only. Candidate checks never change the running tool settings.
import type { AppInformation, ToolSettings, ToolSettingsUpdateResult, TecsgenVersionResult } from "../../shared/ipc-types";
import { parseTecsgenVersion } from "./tecsgen-version";
import { CdlFileListView } from "./cdl-file-list-view";
import type { FileGateway } from "../gateways/file-gateway";
import type { SettingsGateway } from "../gateways/settings-gateway";

export interface InformationDialogOptions {
  readonly settings: {
    getToolSettings(): Promise<ToolSettings>;
    updateToolSettings(patch: { tecsgenPath: string }): Promise<ToolSettingsUpdateResult>;
    chooseTecsgenPath(): Promise<string | null>;
    getAppInformation(): Promise<AppInformation>;
  };
  readonly tecsgen: { checkPath(path: string): Promise<TecsgenVersionResult> };
  readonly clipboard: { writeText(text: string): Promise<void> };
  readonly onSaved: (settings: ToolSettings) => Promise<TecsgenVersionResult | void> | TecsgenVersionResult | void;
  readonly getTecsgenStatus?: () => { readonly version: string; readonly command: string } | undefined;
  readonly document?: Document;
  readonly cdlFiles?: { readonly settings: SettingsGateway; readonly file: FileGateway };
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
function versionText(result: TecsgenVersionResult): string {
  if (result.kind === "ok") return result.text;
  return result.kind === "not-found" ? "tecsgenが見つかりません。" : result.detail;
}

export class InformationDialog {
  private readonly doc: Document;
  private readonly dialog: HTMLDialogElement;
  private readonly version: HTMLPreElement;
  private readonly path: HTMLInputElement;
  private readonly tecspath: HTMLInputElement;
  private readonly override: HTMLParagraphElement;
  private readonly checkResult: HTMLParagraphElement;
  private readonly settingsResult: HTMLParagraphElement;
  private readonly copyResult: HTMLParagraphElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly cdlList: CdlFileListView | undefined;
  private settings: ToolSettings | undefined;
  private information: AppInformation | undefined;
  private toolStatus: { version: string; command: string } | undefined;
  private generation = 0;
  private inputGeneration = 0;
  private checkGeneration = 0;
  private pickerGeneration = 0;
  private hasDraft = false;
  private saving = false;
  private disposed = false;

  constructor(private readonly options: InformationDialogOptions) {
    this.doc = options.document ?? document;
    this.dialog = this.doc.createElement("dialog");
    this.dialog.id = "information-dialog";
    this.dialog.setAttribute("aria-labelledby", "information-heading");
    const heading = this.doc.createElement("h2");
    heading.id = "information-heading";
    heading.textContent = "情報";
    const versionHeading = this.doc.createElement("h3");
    versionHeading.textContent = "バージョン情報";
    this.version = this.doc.createElement("pre");
    this.version.id = "information-version";
    this.version.textContent = "読み込み中…";
    const copy = this.button("copy", "情報をコピー", () => this.copyInformation());
    this.copyResult = this.result("information-copy-result");
    const settingsHeading = this.doc.createElement("h3");
    settingsHeading.textContent = "tecsgenの設定";
    const pathField = this.field("information-tecsgen-path", "tecsgenのパス");
    this.path = pathField.input;
    this.path.placeholder = "空欄で自動探索";
    this.path.addEventListener("input", () => this.changedInput());
    const actions = this.doc.createElement("div");
    actions.className = "information-actions";
    actions.append(this.button("browse", "参照…", () => this.choosePath()), this.button("check", "確認", () => this.checkPath()));
    this.saveButton = this.button("save", "保存", () => this.save());
    this.saveButton.disabled = true;
    actions.append(this.saveButton);
    const help = this.doc.createElement("p");
    help.className = "information-note";
    help.textContent = "確認は入力中の候補を調べます。確認に失敗しても保存できます。";
    this.checkResult = this.result("information-check-result");
    this.settingsResult = this.result("information-settings-result");
    const tecspathField = this.field("information-tecspath", "TECSPATH");
    this.tecspath = tecspathField.input;
    this.tecspath.readOnly = true;
    this.override = this.doc.createElement("p");
    this.override.id = "information-override";
    this.override.className = "information-note";
    const footer = this.doc.createElement("div");
    footer.className = "information-footer";
    footer.append(this.button("close", "閉じる", () => { this.dialog.close(); }));
    this.dialog.append(heading, versionHeading, this.version, copy, this.copyResult, settingsHeading,
      pathField.wrapper, actions, help, this.checkResult, this.settingsResult, tecspathField.wrapper, this.override, footer);
    if (options.cdlFiles) {
      this.cdlList = new CdlFileListView(this.doc, options.cdlFiles.settings, options.cdlFiles.file);
      this.dialog.insertBefore(this.cdlList.element, footer);
    }
    this.dialog.addEventListener("close", () => {
      // Chromium queues this event. A subsequent open already has its own
      // generation and must not be invalidated by the previous close event.
      if (this.dialog.open) return;
      this.generation++;
      this.checkGeneration++;
      this.pickerGeneration++;
    });
    this.doc.body.append(this.dialog);
  }

  get isOpen(): boolean { return this.dialog.open; }

  /** Current tool discovery can finish after the modal opens; drafts stay local. */
  refreshStatus(): void {
    if (this.disposed) return;
    this.toolStatus = this.options.getTecsgenStatus?.();
    this.renderVersion();
  }

  async open(): Promise<void> {
    if (this.disposed) return;
    if (this.dialog.open) { this.dialog.focus(); return; }
    void this.cdlList?.refresh();
    const generation = ++this.generation;
    const inputGeneration = this.inputGeneration;
    this.dialog.showModal();
    this.toolStatus = this.options.getTecsgenStatus?.();
    this.checkResult.textContent = "";
    if (!this.saving) this.show(this.settingsResult, "");
    const [settings, information] = await Promise.allSettled([
      this.options.settings.getToolSettings(), this.options.settings.getAppInformation(),
    ]);
    if (!this.active(generation)) return;
    if (settings.status === "fulfilled") {
      const applied = this.applySettings(settings.value);
      if (applied && !this.hasDraft && inputGeneration === this.inputGeneration) this.path.value = settings.value.tecsgenPath;
      this.saveButton.disabled = this.saving;
    } else this.show(this.settingsResult, `設定を読み込めませんでした: ${errorText(settings.reason)}`, true);
    if (information.status === "fulfilled") this.information = information.value;
    else this.show(this.copyResult, `情報を読み込めませんでした: ${errorText(information.reason)}`, true);
    this.renderVersion();
  }

  dispose(): void {
    this.cdlList?.dispose();
    this.disposed = true;
    this.generation++;
    if (this.dialog.open) this.dialog.close();
    this.dialog.remove();
  }

  private button(action: string, text: string, run: () => Promise<void> | void): HTMLButtonElement {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.dataset["informationAction"] = action;
    button.textContent = text;
    button.addEventListener("click", () => { void run(); });
    return button;
  }

  private field(id: string, text: string): { wrapper: HTMLDivElement; input: HTMLInputElement } {
    const wrapper = this.doc.createElement("div");
    wrapper.className = "information-field";
    const label = this.doc.createElement("label");
    label.htmlFor = id;
    label.textContent = text;
    const input = this.doc.createElement("input");
    input.id = id;
    input.type = "text";
    input.spellcheck = false;
    wrapper.append(label, input);
    return { wrapper, input };
  }

  private result(id: string): HTMLParagraphElement {
    const result = this.doc.createElement("p");
    result.id = id;
    result.className = "information-result";
    result.setAttribute("role", "status");
    result.setAttribute("aria-live", "polite");
    return result;
  }

  private active(generation: number): boolean { return !this.disposed && this.dialog.open && generation === this.generation; }
  private show(element: HTMLElement, text: string, failed = false): void {
    element.textContent = text;
    element.classList.toggle("error", failed);
  }

  private changedInput(): void {
    this.hasDraft = true;
    this.inputGeneration++;
    this.checkGeneration++;
    this.checkResult.textContent = "";
    this.settingsResult.textContent = "";
  }

  private applySettings(settings: ToolSettings): boolean {
    if (this.settings && settings.revision < this.settings.revision) return false;
    this.settings = settings;
    this.tecspath.value = settings.tecspath;
    this.override.textContent = settings.override
      ? "環境変数TECSGEN_COMMANDが優先されているため、保存したパスは実行に使われません。"
      : "";
    return true;
  }

  private renderVersion(): void {
    const info = this.information;
    const lines = info ? [
      `アプリケーション: ${info.name}`, `バージョン: ${info.version}`, `Commit: ${info.commit || "unknown"}`, `CDE形式: ${info.cdeFormatVersion}`,
      `Electron: ${info.electron}`, `Chrome: ${info.chrome}`, `Node.js: ${info.node}`, `OS: ${info.platform} (${info.arch})`,
    ] : ["バージョン情報: 未取得"];
    const confirmedCommand = this.toolStatus?.command === "未確認" ? undefined : this.toolStatus?.command;
    lines.push(`tecsgen: ${this.toolStatus?.version || "未確認"}`,
      `実行コマンド: ${confirmedCommand || this.settings?.effectiveCommand || "未確認"}`);
    this.version.textContent = lines.join("\n");
  }

  private async copyInformation(): Promise<void> {
    const generation = this.generation;
    try {
      await this.options.clipboard.writeText(this.version.textContent ?? "");
      if (this.active(generation)) this.show(this.copyResult, "コピーしました。");
    } catch (error) {
      if (this.active(generation)) this.show(this.copyResult, `コピーできませんでした: ${errorText(error)}`, true);
    }
  }

  private async choosePath(): Promise<void> {
    const generation = this.generation;
    const inputGeneration = this.inputGeneration;
    const picker = ++this.pickerGeneration;
    try {
      const path = await this.options.settings.chooseTecsgenPath();
      if (!this.active(generation) || inputGeneration !== this.inputGeneration || picker !== this.pickerGeneration || path === null) return;
      this.path.value = path;
      this.changedInput();
    } catch (error) {
      if (this.active(generation) && picker === this.pickerGeneration) this.show(this.settingsResult, `選択できませんでした: ${errorText(error)}`, true);
    }
  }

  private async checkPath(): Promise<void> {
    const generation = this.generation;
    const inputGeneration = this.inputGeneration;
    const check = ++this.checkGeneration;
    this.show(this.checkResult, "確認中…");
    try {
      const result = await this.options.tecsgen.checkPath(this.path.value);
      if (this.active(generation) && inputGeneration === this.inputGeneration && check === this.checkGeneration) {
        this.show(this.checkResult, versionText(result), result.kind !== "ok");
      }
    } catch (error) {
      if (this.active(generation) && inputGeneration === this.inputGeneration && check === this.checkGeneration) this.show(this.checkResult, `確認できませんでした: ${errorText(error)}`, true);
    }
  }

  private async save(): Promise<void> {
    if (this.saving || !this.settings) return;
    const generation = this.generation;
    const inputGeneration = this.inputGeneration;
    const path = this.path.value;
    this.saving = true;
    this.saveButton.disabled = true;
    this.checkGeneration++;
    this.checkResult.textContent = "";
    this.show(this.settingsResult, "保存中…");
    try {
      const result = await this.options.settings.updateToolSettings({ tecsgenPath: path });
      if (!result.ok) {
        if (this.active(generation)) this.show(this.settingsResult, `保存できませんでした: ${result.error}`, true);
        return;
      }
      // A late response must not replace a newer revision's effective setting.
      if (this.settings && result.settings.revision < this.settings.revision) return;
      this.applySettings(result.settings);
      let recheck: TecsgenVersionResult | void;
      try { recheck = await this.options.onSaved(result.settings); }
      catch (error) { recheck = { kind: "failed", detail: errorText(error) }; }
      if (!this.active(generation) || this.settings?.revision !== result.settings.revision) return;
      if (inputGeneration === this.inputGeneration) { this.path.value = result.settings.tecsgenPath; this.hasDraft = false; }
      const draft = inputGeneration === this.inputGeneration ? "" : " 入力中の変更は未保存です。";
      if (recheck) this.toolStatus = {
        version: recheck.kind === "ok" && parseTecsgenVersion(recheck.text) ? recheck.text : "未確認",
        command: result.settings.effectiveCommand,
      };
      this.renderVersion();
      this.show(this.settingsResult, `保存しました。${recheck ? ` ${versionText(recheck)}` : " 現在の設定を再確認しました。"}${draft}`, recheck !== undefined && recheck.kind !== "ok");
    } catch (error) {
      if (this.active(generation)) this.show(this.settingsResult, `保存できませんでした: ${errorText(error)}`, true);
    } finally {
      this.saving = false;
      if (!this.disposed) this.saveButton.disabled = this.settings === undefined;
    }
  }
}
