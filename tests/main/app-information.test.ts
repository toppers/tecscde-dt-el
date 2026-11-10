import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const electron = vi.hoisted(() => ({
  getName: vi.fn(() => "TECSCDE"),
  getVersion: vi.fn(() => "9.8.7"),
  getAppPath: vi.fn(() => "/application"),
}));
vi.mock("electron", () => ({ app: electron }));

import { createAppInformation, getAppInformation } from "../../src/main/app-information.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("application information", () => {
  it("uses the injected application version independently of the file format version", () => {
    expect(createAppInformation({
      name: "TECSCDE", version: "9.8.7", commit: "abc1234", cdeFormatVersion: "0.1.0.0",
      versions: { electron: "44.2.0", chrome: "150.0.0", node: "22.0.0" }, platform: "win32", arch: "x64",
    })).toEqual({ name: "TECSCDE", version: "9.8.7", commit: "abc1234", cdeFormatVersion: "0.1.0.0",
      electron: "44.2.0", chrome: "150.0.0", node: "22.0.0", platform: "win32", arch: "x64" });
  });

  it("reports unavailable runtime/build values as unknown and abbreviates full commit hashes", () => {
    const input = { name: "TECSCDE", version: "9.8.7", cdeFormatVersion: "0.1.0.0", versions: {}, platform: "linux", arch: "arm64" };
    expect(createAppInformation(input)).toMatchObject({ commit: "unknown", electron: "unknown", chrome: "unknown", node: "unknown" });
    expect(createAppInformation({ ...input, commit: "abcdef0" + "1".repeat(33) }).commit).toBe("abcdef0");
    expect(createAppInformation({ ...input, commit: "not a commit" }).commit).toBe("unknown");
  });

  it("takes the runtime application version from Electron and only build fields from metadata", async () => {
    const read = vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({
      appVersion: "0.0.1", commit: "abc1234", formatVersion: "0.1.0.0",
    }));
    const info = await getAppInformation();
    expect(read).toHaveBeenCalledExactlyOnceWith(join("/application", "dist", "build-info.json"), "utf-8");
    expect(info).toMatchObject({ name: "TECSCDE", version: "9.8.7", commit: "abc1234", cdeFormatVersion: "0.1.0.0",
      node: process.versions.node, platform: process.platform, arch: process.arch });
    expect(electron.getVersion).toHaveBeenCalled();
  });

  it.each(["null", "[]", "{broken", JSON.stringify({ commit: 4, formatVersion: false })])(
    "keeps runtime information when metadata is invalid: %s", async (value) => {
      vi.spyOn(fs, "readFile").mockResolvedValue(value);
      await expect(getAppInformation()).resolves.toMatchObject({ version: "9.8.7", commit: "unknown", cdeFormatVersion: "unknown" });
    },
  );

  it("keeps runtime information when build metadata cannot be read", async () => {
    vi.spyOn(fs, "readFile").mockRejectedValue(new Error("missing metadata"));
    await expect(getAppInformation()).resolves.toMatchObject({ name: "TECSCDE", version: "9.8.7", commit: "unknown", cdeFormatVersion: "unknown" });
  });

  it("reports unknown if an Electron metadata accessor is unavailable", async () => {
    vi.spyOn(fs, "readFile").mockRejectedValue(new Error("missing metadata"));
    vi.spyOn(electron, "getName").mockImplementationOnce(() => { throw new Error("unavailable"); });
    vi.spyOn(electron, "getVersion").mockImplementationOnce(() => { throw new Error("unavailable"); });
    await expect(getAppInformation()).resolves.toMatchObject({ name: "unknown", version: "unknown", node: process.versions.node });
  });
});
