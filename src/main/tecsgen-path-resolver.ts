// 09D.2: environment command syntax is distinct from a saved literal path.
import { constants, promises as fs } from "node:fs";
import { posix, win32 } from "node:path";
import type { ResolvedTecsgenCommand } from "../shared/ipc-types.js";

/** Windows process.env is case-insensitive; an ordinary spread object is not. */
export function snapshotTecsgenEnvironment(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Readonly<NodeJS.ProcessEnv> {
  const snapshot = { ...environment };
  if (platform === "win32") {
    for (const canonical of ["TECSGEN_COMMAND", "TECSPATH", "PATH"]) {
      const entry = Object.entries(environment).find(([key, value]) => key === canonical && value !== undefined) ??
        Object.entries(environment).find(([key, value]) => key.toUpperCase() === canonical && value !== undefined);
      for (const key of Object.keys(snapshot)) if (key.toUpperCase() === canonical) delete snapshot[key];
      if (entry) snapshot[canonical] = entry[1];
    }
  }
  return Object.freeze(snapshot);
}

export function splitCommand(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let started = false;
  for (const char of command) {
    if (char === quote) quote = null;
    else if (quote === null && (char === '"' || char === "'")) { quote = char; started = true; }
    else if (quote === null && /\s/.test(char)) {
      if (started) args.push(current);
      current = ""; started = false;
    } else { current += char; started = true; }
  }
  if (quote !== null) throw new Error("Unclosed quote in command");
  if (started) args.push(current);
  return args;
}

export function environmentCommand(env: Readonly<NodeJS.ProcessEnv>): ResolvedTecsgenCommand | undefined {
  if (env.TECSGEN_COMMAND === undefined) return undefined;
  try {
    const [executable, ...args] = splitCommand(env.TECSGEN_COMMAND);
    if (!executable) throw new Error("TECSGEN_COMMAND is empty");
    return { executable, args, source: "environment" };
  } catch {
    return { executable: "", args: [], source: "invalid" };
  }
}

export interface TecsgenDiscoveryOptions {
  readonly platform?: NodeJS.Platform;
  readonly pathCandidates?: readonly string[];
  readonly exists?: (path: string, executableFile?: boolean) => Promise<boolean>;
}

async function pathExists(path: string, executableFile = false): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    if (executableFile && !stat.isFile()) return false;
    await fs.access(path, executableFile && process.platform !== "win32" ? constants.X_OK : constants.F_OK);
    return true;
  } catch { return false; }
}

export async function resolveTecsgenCommand(
  env: Readonly<NodeJS.ProcessEnv>,
  savedPath: string,
  options: TecsgenDiscoveryOptions = {},
): Promise<ResolvedTecsgenCommand> {
  const override = environmentCommand(env);
  if (override) return override;
  if (savedPath !== "") return { executable: savedPath, args: [], source: "settings" };
  const exists = options.exists ?? pathExists;
  if (env.TECSPATH !== undefined && env.TECSPATH !== "" && await exists(env.TECSPATH)) {
    return { executable: env.TECSPATH, args: [], source: "tecspath" };
  }
  const windows = (options.platform ?? process.platform) === "win32";
  const pathValue = Object.entries(env).find(([key]) => windows ? key.toUpperCase() === "PATH" : key === "PATH")?.[1] ?? "";
  for (const directory of pathValue.split(windows ? ";" : ":").filter((part) => part.length > 0)) {
    // Windows candidates were settled as batch first, then PowerShell. Do not
    // discover .exe or infer a Ruby command from a directory/.rb path.
    for (const candidate of options.pathCandidates ?? (windows ? ["tecsgen.bat", "tecsgen.ps1"] : ["tecsgen"])) {
      const path = (windows ? win32 : posix).join(directory, candidate);
      if (await exists(path, true)) return { executable: path, args: [], source: "path" };
    }
  }
  return { executable: "", args: [], source: "missing" };
}
