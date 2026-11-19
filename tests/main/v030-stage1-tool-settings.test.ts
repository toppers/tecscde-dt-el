import { describe, expect, it, vi } from "vitest";
import { ToolSettingsService } from "../../src/main/tool-settings.js";

vi.mock("electron", () => ({
  app: { getPath: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
}));

describe("V0.3.0 Stage 1: ToolSettingsService tecsgenCommandEnv", () => {
  it("exposes TECSGEN_COMMAND raw value when set and empty string when unset", async () => {
    const withEnv = new ToolSettingsService({
      env: { TECSGEN_COMMAND: 'ruby "C:\\tools\\tecsgen.rb"', TECSPATH: "C:\\tecs" },
      platform: "win32",
      load: async () => ({}),
      save: async () => {},
      exists: async () => false,
    });
    const s1 = await withEnv.get();
    expect(s1.tecspath).toBe("C:\\tecs");
    expect(s1.tecsgenCommandEnv).toBe('ruby "C:\\tools\\tecsgen.rb"');

    const withoutEnv = new ToolSettingsService({
      env: { TECSPATH: "C:\\tecs" },
      platform: "win32",
      load: async () => ({}),
      save: async () => {},
      exists: async () => false,
    });
    const s2 = await withoutEnv.get();
    expect(s2.tecsgenCommandEnv).toBe("");
  });
});
