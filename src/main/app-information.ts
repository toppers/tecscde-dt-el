// 02.5 / audit 63: package-derived app.getVersion is the runtime version authority.
// The build supplies its commit and independent CDL format version as metadata.
import { app } from "electron";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { AppInformation } from "../shared/ipc-types.js";

export interface AppInformationInput {
  readonly name: string;
  readonly version: string;
  readonly commit?: string;
  readonly cdeFormatVersion: string;
  readonly versions: Readonly<Record<string, string | undefined>>;
  readonly platform: string;
  readonly arch: string;
}

function available(value: string | undefined): string {
  return value?.trim() || "unknown";
}

function readRuntimeValue(read: () => string): string {
  try { return read(); } catch { return "unknown"; }
}

function shortCommit(value: string | undefined): string {
  const hash = value?.trim();
  if (!hash || !/^[a-f\d]{7,64}$/i.test(hash)) return "unknown";
  // Preserve a build's git --short abbreviation; shorten full SHA-1/SHA-256 values.
  return hash.length === 40 || hash.length === 64 ? hash.slice(0, 7) : hash;
}

export function createAppInformation(input: AppInformationInput): AppInformation {
  return {
    name: available(input.name),
    version: available(input.version),
    commit: shortCommit(input.commit),
    cdeFormatVersion: available(input.cdeFormatVersion),
    electron: available(input.versions.electron),
    chrome: available(input.versions.chrome),
    node: available(input.versions.node),
    platform: available(input.platform),
    arch: available(input.arch),
  };
}

/** Never spawns git in an installed application; missing build fields remain explicit. */
export async function getAppInformation(): Promise<AppInformation> {
  let commit: string | undefined;
  let cdeFormatVersion = "unknown";
  try {
    const raw: unknown = JSON.parse(await fs.readFile(join(app.getAppPath(), "dist", "build-info.json"), "utf-8"));
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      const metadata = raw as Record<string, unknown>;
      if (typeof metadata.commit === "string") commit = metadata.commit;
      if (typeof metadata.formatVersion === "string") cdeFormatVersion = metadata.formatVersion;
    }
  } catch {
    // Reading build information must not make the Information dialog unavailable.
  }
  return createAppInformation({
    name: readRuntimeValue(() => app.getName()), version: readRuntimeValue(() => app.getVersion()), commit, cdeFormatVersion,
    versions: process.versions, platform: process.platform, arch: process.arch,
  });
}
