import { describe, expect, it } from "vitest";
import { normalizeAppSettings, type AppSettings, type AppSettingsPatch } from "../../src/main/app-settings";
import { ToolSettingsService } from "../../src/main/tool-settings";

describe("V0.3.1 Stage 2: display settings persistence in settings.json", () => {
  it("normalizes valid display settings and drops invalid ones while keeping unknown keys", () => {
    const valid = normalizeAppSettings({
      showCelltypeName: false,
      cellNameDisplay: "shorten",
      showStatusSymbols: false,
      namespaceDisplay: "dot",
      customUserKey: 42,
    });
    expect(valid.showCelltypeName).toBe(false);
    expect(valid.cellNameDisplay).toBe("shorten");
    expect(valid.showStatusSymbols).toBe(false);
    expect(valid.namespaceDisplay).toBe("dot");
    expect(valid.customUserKey).toBe(42);

    const invalid = normalizeAppSettings({
      showCelltypeName: "false",
      cellNameDisplay: "invalid",
      showStatusSymbols: 0,
      namespaceDisplay: "circle",
    });
    expect(invalid.showCelltypeName).toBeUndefined();
    expect(invalid.cellNameDisplay).toBeUndefined();
    expect(invalid.showStatusSymbols).toBeUndefined();
    expect(invalid.namespaceDisplay).toBeUndefined();
  });

  it("saves and reloads display settings via ToolSettingsService", async () => {
    let stored: AppSettings = {};
    const service = new ToolSettingsService({
      env: {},
      exists: async () => false,
      load: async () => stored,
      save: async (patch: AppSettingsPatch) => {
        stored = { ...stored, ...patch };
      },
    });

    const initial = await service.get();
    expect(initial.showCelltypeName).toBeUndefined();
    expect(initial.cellNameDisplay).toBeUndefined();
    expect(initial.showStatusSymbols).toBeUndefined();
    expect(initial.namespaceDisplay).toBeUndefined();

    const updated = await service.update({
      showCelltypeName: false,
      cellNameDisplay: "shorten",
      showStatusSymbols: false,
      namespaceDisplay: "dot",
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.settings.showCelltypeName).toBe(false);
      expect(updated.settings.cellNameDisplay).toBe("shorten");
      expect(updated.settings.showStatusSymbols).toBe(false);
      expect(updated.settings.namespaceDisplay).toBe("dot");
    }

    // Reload with a fresh service instance reading the saved settings
    const reloaded = new ToolSettingsService({
      env: {},
      exists: async () => false,
      load: async () => stored,
      save: async (patch: AppSettingsPatch) => {
        stored = { ...stored, ...patch };
      },
    });
    const afterReload = await reloaded.get();
    expect(afterReload.showCelltypeName).toBe(false);
    expect(afterReload.cellNameDisplay).toBe("shorten");
    expect(afterReload.showStatusSymbols).toBe(false);
    expect(afterReload.namespaceDisplay).toBe("dot");

    // Invalid values are rejected
    const bad = await reloaded.update({ cellNameDisplay: "bad" as "show" });
    expect(bad.ok).toBe(false);
  });
});
