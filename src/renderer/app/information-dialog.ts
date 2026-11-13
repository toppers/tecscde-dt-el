// [[TECSCDE-DT-EL内部仕様 - 02B V0.2.0画面構成]] 2B.2:
// modal view state only. Candidate checks never change the running tool settings.
// [[TECSCDE-DT-EL内部仕様 - 09E V0.2.1 Cプリプロセッサ設定と失敗詳細]] 9E.4:
// Cプリプロセッサ設定（cppPath, cppArgs, effectiveCommand, originReason）の表示と更新。
// [[TECSCDE-DT-EL内部仕様 - 09D V0.2.0tecsgen設定と内部処理]] 9D.3, 9D.5, 9D.6:
// Plugin生成型の取り込み方式（pluginTypeSource）の表示と更新、内部処理プラグイン付表・注記。
import type { AppInformation, ToolSettings, ToolSettingsUpdate, ToolSettingsUpdateResult, TecsgenVersionResult, PluginTypeSource } from "../../shared/ipc-types";
import { parseTecsgenVersion } from "./tecsgen-version";
import { CdlFileListView } from "./cdl-file-list-view";
import { DEFAULT_PLUGIN_REGISTRY } from "../tecsgen/internal/plugin-registry";
import type { FileGateway } from "../gateways/file-gateway";
import type { SettingsGateway } from "../gateways/settings-gateway";

export interface InformationDialogOptions {
  readonly settings: {
    getToolSettings(): Promise<ToolSettings>;
    updateToolSettings(patch: ToolSettingsUpdate): Promise<ToolSettingsUpdateResult>;
    chooseTecsgenPath(): Promise<string | null>;
    chooseCppPath?(currentPath?: string): Promise<string | null>;
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

  // Cプリプロセッサ設定用
  private readonly cppEffective: HTMLParagraphElement;
  private readonly cppMeta: HTMLParagraphElement;
  private readonly cppPath: HTMLInputElement;
  private readonly cppArgs: HTMLInputElement;
  private readonly cppBrowseButton: HTMLButtonElement;
  private readonly cppSaveButton: HTMLButtonElement;
  private readonly cppResult: HTMLParagraphElement;

  // Plugin生成型の取り込み方式設定用
  private readonly pluginSourceSelect: HTMLSelectElement;
  private readonly pluginSaveButton: HTMLButtonElement;
  private readonly pluginResult: HTMLParagraphElement;

  private settings: ToolSettings | undefined;
  private information: AppInformation | undefined;
  private toolStatus: { version: string; command: string } | undefined;
  private generation = 0;
  private inputGeneration = 0;
  private checkGeneration = 0;
  private pickerGeneration = 0;
  private hasDraft = false;
  private saving = false;

  private cppInputGeneration = 0;
  private cppPickerGeneration = 0;
  private hasCppDraft = false;
  private cppSaving = false;

  private pluginInputGeneration = 0;
  private hasPluginDraft = false;
  private pluginSaving = false;

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
    this.saveButton.id = "information-tecsgen-save";
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

    // Cプリプロセッサ設定セクション
    const cppHeading = this.doc.createElement("h3");
    cppHeading.textContent = "Cプリプロセッサの設定";
    this.cppEffective = this.doc.createElement("p");
    this.cppEffective.id = "information-cpp-effective";
    this.cppEffective.className = "information-note cpp-effective";
    this.cppMeta = this.doc.createElement("p");
    this.cppMeta.id = "information-cpp-meta";
    this.cppMeta.className = "information-note cpp-meta";
    this.renderCppStatus();

    const cppPathField = this.field("information-cpp-path", "Cプリプロセッサのパス");
    this.cppPath = cppPathField.input;
    this.cppPath.placeholder = "例: arm-none-eabi-gcc (空欄でPATHから自動検出)";
    this.cppPath.addEventListener("input", () => this.changedCppInput());

    const cppActions = this.doc.createElement("div");
    cppActions.className = "information-actions";
    this.cppBrowseButton = this.button("browse-cpp", "参照…", () => this.chooseCppPath());
    this.cppBrowseButton.id = "information-cpp-browse";
    this.cppSaveButton = this.button("save-cpp", "保存", () => this.saveCpp());
    this.cppSaveButton.id = "information-cpp-save";
    this.cppSaveButton.disabled = true;
    cppActions.append(this.cppBrowseButton, this.cppSaveButton);

    const cppArgsField = this.field("information-cpp-args", "コマンドラインオプション");
    this.cppArgs = cppArgsField.input;
    this.cppArgs.placeholder = "オプションなしの場合は空欄";
    this.cppArgs.addEventListener("input", () => this.changedCppInput());

    this.cppResult = this.result("information-cpp-result");

    // Plugin生成型の取り込み方式セクション
    const pluginHeading = this.doc.createElement("h3");
    pluginHeading.id = "information-plugin-heading";
    pluginHeading.textContent = "Plugin生成型の取り込み方式";

    const pluginField = this.doc.createElement("div");
    pluginField.className = "information-field";
    const pluginLabel = this.doc.createElement("label");
    pluginLabel.htmlFor = "information-plugin-type-source";
    pluginLabel.textContent = "取り込み方式";
    this.pluginSourceSelect = this.doc.createElement("select");
    this.pluginSourceSelect.id = "information-plugin-type-source";

    const optExternal = this.doc.createElement("option");
    optExternal.value = "external";
    optExternal.textContent = "外部 tecsgen（既定）";
    const optInternal = this.doc.createElement("option");
    optInternal.value = "internal";
    optInternal.textContent = "内部処理";
    this.pluginSourceSelect.append(optExternal, optInternal);
    this.pluginSourceSelect.addEventListener("change", () => this.changedPluginSource());
    pluginField.append(pluginLabel, this.pluginSourceSelect);

    const pluginActions = this.doc.createElement("div");
    pluginActions.className = "information-actions";
    this.pluginSaveButton = this.button("save-plugin", "保存", () => this.savePlugin());
    this.pluginSaveButton.id = "information-plugin-save";
    this.pluginSaveButton.disabled = true;
    pluginActions.append(this.pluginSaveButton);

    this.pluginResult = this.result("information-plugin-result");

    const pluginTableLabel = this.doc.createElement("p");
    pluginTableLabel.className = "information-note";
    pluginTableLabel.textContent = "内部処理の対象プラグイン付表:";

    const pluginTable = this.doc.createElement("table");
    pluginTable.id = "information-plugin-table";
    pluginTable.className = "information-table";
    const thead = this.doc.createElement("thead");
    const headerRow = this.doc.createElement("tr");
    const thName = this.doc.createElement("th");
    thName.textContent = "対象プラグイン名";
    const thVer = this.doc.createElement("th");
    thVer.textContent = "照合済み tecsgen 版";
    headerRow.append(thName, thVer);
    thead.append(headerRow);
    const tbody = this.doc.createElement("tbody");
    for (const plugin of DEFAULT_PLUGIN_REGISTRY.list()) {
      const row = this.doc.createElement("tr");
      const tdName = this.doc.createElement("td");
      tdName.textContent = plugin.name;
      const tdVer = this.doc.createElement("td");
      tdVer.textContent = plugin.tecsgenVersion;
      row.append(tdName, tdVer);
      tbody.append(row);
    }
    pluginTable.append(thead, tbody);

    const pluginNoteUnsupported = this.doc.createElement("p");
    pluginNoteUnsupported.className = "information-note";
    pluginNoteUnsupported.textContent = "※ 内部処理の対象は付表に載ったプラグインのみであり、対象外のプラグインは取り込まれず警告 W-PLUGIN-UNSUPPORTED が出ます。";

    const pluginNoteExternal = this.doc.createElement("p");
    pluginNoteExternal.className = "information-note";
    pluginNoteExternal.textContent = "※ 「実行(Generate)」および版確認は常に外部 tecsgen を使用します。";

    const pluginNoteReload = this.doc.createElement("p");
    pluginNoteReload.className = "information-note";
    pluginNoteReload.textContent = "※ 設定変更は次回読み込みから反映されます（開いているCDLは自動で再読込されません）。";

    const footer = this.doc.createElement("div");
    footer.className = "information-footer";
    footer.append(this.button("close", "閉じる", () => { this.dialog.close(); }));
    this.dialog.append(
      heading, versionHeading, this.version, copy, this.copyResult,
      settingsHeading, pathField.wrapper, actions, help, this.checkResult, this.settingsResult, tecspathField.wrapper, this.override,
      cppHeading, this.cppEffective, this.cppMeta, cppPathField.wrapper, cppActions, cppArgsField.wrapper, this.cppResult,
      pluginHeading, pluginField, pluginActions, this.pluginResult, pluginTableLabel, pluginTable, pluginNoteUnsupported, pluginNoteExternal, pluginNoteReload,
      footer
    );
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
      this.cppPickerGeneration++;
      this.pluginInputGeneration++;
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
    const cppInputGeneration = this.cppInputGeneration;
    const pluginInputGeneration = this.pluginInputGeneration;
    this.dialog.showModal();
    this.toolStatus = this.options.getTecsgenStatus?.();
    this.checkResult.textContent = "";
    if (!this.saving) this.show(this.settingsResult, "");
    if (!this.cppSaving) this.show(this.cppResult, "");
    if (!this.pluginSaving) this.show(this.pluginResult, "");
    const [settings, information] = await Promise.allSettled([
      this.options.settings.getToolSettings(), this.options.settings.getAppInformation(),
    ]);
    if (!this.active(generation)) return;
    if (settings.status === "fulfilled") {
      const applied = this.applySettings(settings.value);
      if (applied && !this.hasDraft && inputGeneration === this.inputGeneration) this.path.value = settings.value.tecsgenPath;
      if (applied && !this.hasCppDraft && cppInputGeneration === this.cppInputGeneration) {
        this.cppPath.value = settings.value.cppPath ?? "";
        this.cppArgs.value = settings.value.cppArgs !== undefined ? settings.value.cppArgs : "-E -DTECSGEN";
      }
      if (applied && !this.hasPluginDraft && pluginInputGeneration === this.pluginInputGeneration) {
        this.pluginSourceSelect.value = settings.value.pluginTypeSource ?? "external";
      }
      this.saveButton.disabled = this.saving;
      this.cppSaveButton.disabled = this.cppSaving;
      this.pluginSaveButton.disabled = this.pluginSaving;
    } else {
      this.show(this.settingsResult, `設定を読み込めませんでした: ${errorText(settings.reason)}`, true);
      this.show(this.cppResult, `設定を読み込めませんでした: ${errorText(settings.reason)}`, true);
      this.show(this.pluginResult, `設定を読み込めませんでした: ${errorText(settings.reason)}`, true);
    }
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

  private changedCppInput(): void {
    this.hasCppDraft = true;
    this.cppInputGeneration++;
    this.cppResult.textContent = "";
  }

  private changedPluginSource(): void {
    this.hasPluginDraft = true;
    this.pluginInputGeneration++;
    this.pluginResult.textContent = "";
  }

  private applySettings(settings: ToolSettings): boolean {
    if (this.settings && settings.revision < this.settings.revision) return false;
    this.settings = settings;
    this.tecspath.value = settings.tecspath;
    this.override.textContent = settings.override
      ? "環境変数TECSGEN_COMMANDが優先されているため、保存したパスは実行に使われません。"
      : "";
    this.renderCppStatus(settings);
    if (!this.hasPluginDraft) {
      this.pluginSourceSelect.value = settings.pluginTypeSource ?? "external";
    }
    return true;
  }

  private renderCppStatus(settings?: ToolSettings): void {
    const effectiveCommand = settings?.effectiveCppCommand || "gcc";
    const fullPath = settings?.effectiveCppFullPath || "未検出 (PATH上)";
    const originReason = settings?.cppOriginReason || "フォールバック";

    this.cppEffective.textContent = "";
    this.cppEffective.append("有効なコマンド: ");
    const codeCmd = this.doc.createElement("code");
    codeCmd.textContent = effectiveCommand;
    this.cppEffective.append(codeCmd);

    this.cppMeta.textContent = "";
    this.cppMeta.append("（フルパス: ");
    const codePath = this.doc.createElement("code");
    codePath.textContent = fullPath;
    this.cppMeta.append(codePath, `、決定理由: ${originReason}）`);
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

  private async chooseCppPath(): Promise<void> {
    const generation = this.generation;
    const inputGeneration = this.cppInputGeneration;
    const picker = ++this.cppPickerGeneration;
    try {
      const currentVal = this.cppPath.value.trim() || undefined;
      const path = await this.options.settings.chooseCppPath?.(currentVal);
      if (!this.active(generation) || inputGeneration !== this.cppInputGeneration || picker !== this.cppPickerGeneration || path === null || path === undefined) return;
      this.cppPath.value = path;
      this.changedCppInput();
    } catch (error) {
      if (this.active(generation) && picker === this.cppPickerGeneration) this.show(this.cppResult, `選択できませんでした: ${errorText(error)}`, true);
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
    const cppInputGeneration = this.cppInputGeneration;
    const pluginInputGeneration = this.pluginInputGeneration;
    const path = this.path.value;
    const includeCpp = this.hasCppDraft;
    const cppPath = this.cppPath.value;
    const cppArgs = this.cppArgs.value;
    const includePlugin = this.hasPluginDraft;
    const pluginTypeSource = (this.pluginSourceSelect.value === "internal" ? "internal" : "external") as PluginTypeSource;

    this.saving = true;
    this.saveButton.disabled = true;
    this.checkGeneration++;
    this.checkResult.textContent = "";
    this.show(this.settingsResult, "保存中…");
    if (includeCpp) this.show(this.cppResult, "保存中…");
    if (includePlugin) this.show(this.pluginResult, "保存中…");

    try {
      const patch: ToolSettingsUpdate = {
        tecsgenPath: path,
        ...(includeCpp ? { cppPath, cppArgs } : {}),
        ...(includePlugin ? { pluginTypeSource } : {}),
      };
      const result = await this.options.settings.updateToolSettings(patch);
      if (!result.ok) {
        if (this.active(generation)) {
          this.show(this.settingsResult, `保存できませんでした: ${result.error}`, true);
          if (includeCpp) this.show(this.cppResult, `保存できませんでした: ${result.error}`, true);
          if (includePlugin) this.show(this.pluginResult, `保存できませんでした: ${result.error}`, true);
        }
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
      if (includeCpp && cppInputGeneration === this.cppInputGeneration) {
        this.cppPath.value = result.settings.cppPath ?? "";
        this.cppArgs.value = result.settings.cppArgs !== undefined ? result.settings.cppArgs : "-E -DTECSGEN";
        this.hasCppDraft = false;
        this.show(this.cppResult, "保存しました。");
      }
      if (includePlugin && pluginInputGeneration === this.pluginInputGeneration) {
        this.pluginSourceSelect.value = result.settings.pluginTypeSource ?? "external";
        this.hasPluginDraft = false;
        this.show(this.pluginResult, "保存しました。（次回読み込みから反映されます）");
      }
      const draft = inputGeneration === this.inputGeneration ? "" : " 入力中の変更は未保存です。";
      if (recheck) this.toolStatus = {
        version: recheck.kind === "ok" && parseTecsgenVersion(recheck.text) ? recheck.text : "未確認",
        command: result.settings.effectiveCommand,
      };
      this.renderVersion();
      this.show(this.settingsResult, `保存しました。${recheck ? ` ${versionText(recheck)}` : " 現在の設定を再確認しました。"}${draft}`, recheck !== undefined && recheck.kind !== "ok");
    } catch (error) {
      if (this.active(generation)) {
        this.show(this.settingsResult, `保存できませんでした: ${errorText(error)}`, true);
        if (includeCpp) this.show(this.cppResult, `保存できませんでした: ${errorText(error)}`, true);
        if (includePlugin) this.show(this.pluginResult, `保存できませんでした: ${errorText(error)}`, true);
      }
    } finally {
      this.saving = false;
      if (!this.disposed) this.saveButton.disabled = this.settings === undefined;
    }
  }

  private async saveCpp(): Promise<void> {
    if (this.cppSaving || !this.settings) return;
    const generation = this.generation;
    const inputGeneration = this.cppInputGeneration;
    const cppPath = this.cppPath.value;
    const cppArgs = this.cppArgs.value;

    this.cppSaving = true;
    this.cppSaveButton.disabled = true;
    this.show(this.cppResult, "保存中…");

    try {
      const result = await this.options.settings.updateToolSettings({ cppPath, cppArgs });
      if (!result.ok) {
        if (this.active(generation)) this.show(this.cppResult, `保存できませんでした: ${result.error}`, true);
        return;
      }
      // A late response must not replace a newer revision's effective setting.
      if (this.settings && result.settings.revision < this.settings.revision) return;
      this.applySettings(result.settings);
      if (!this.active(generation) || this.settings?.revision !== result.settings.revision) return;
      if (inputGeneration === this.cppInputGeneration) {
        this.cppPath.value = result.settings.cppPath ?? "";
        this.cppArgs.value = result.settings.cppArgs !== undefined ? result.settings.cppArgs : "-E -DTECSGEN";
        this.hasCppDraft = false;
      }
      const draft = inputGeneration === this.cppInputGeneration ? "" : " 入力中の変更は未保存です。";
      this.show(this.cppResult, `保存しました。${draft}`);
    } catch (error) {
      if (this.active(generation)) this.show(this.cppResult, `保存できませんでした: ${errorText(error)}`, true);
    } finally {
      this.cppSaving = false;
      if (!this.disposed) this.cppSaveButton.disabled = this.settings === undefined;
    }
  }

  private async savePlugin(): Promise<void> {
    if (this.pluginSaving || !this.settings) return;
    const generation = this.generation;
    const inputGeneration = this.pluginInputGeneration;
    const pluginTypeSource = (this.pluginSourceSelect.value === "internal" ? "internal" : "external") as PluginTypeSource;

    this.pluginSaving = true;
    this.pluginSaveButton.disabled = true;
    this.show(this.pluginResult, "保存中…");

    try {
      const result = await this.options.settings.updateToolSettings({ pluginTypeSource });
      if (!result.ok) {
        if (this.active(generation)) this.show(this.pluginResult, `保存できませんでした: ${result.error}`, true);
        return;
      }
      // A late response must not replace a newer revision's effective setting.
      if (this.settings && result.settings.revision < this.settings.revision) return;
      this.applySettings(result.settings);
      if (!this.active(generation) || this.settings?.revision !== result.settings.revision) return;
      if (inputGeneration === this.pluginInputGeneration) {
        this.pluginSourceSelect.value = result.settings.pluginTypeSource ?? "external";
        this.hasPluginDraft = false;
      }
      const draft = inputGeneration === this.pluginInputGeneration ? "" : " 入力中の変更は未保存です。";
      this.show(this.pluginResult, `保存しました。（次回読み込みから反映されます）${draft}`);
    } catch (error) {
      if (this.active(generation)) this.show(this.pluginResult, `保存できませんでした: ${errorText(error)}`, true);
    } finally {
      this.pluginSaving = false;
      if (!this.disposed) this.pluginSaveButton.disabled = this.settings === undefined;
    }
  }
}
