// Exercise installed launchers without generating into a user's project.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TecsgenRunner } from "../../dist/main/tecsgen-runner.js";
import { resolveTecsgenCommand } from "../../dist/main/tecsgen-path-resolver.js";

const evidence = fileURLToPath(new URL("./stage1-installed-tecsgen.json", import.meta.url));
const isolated = await mkdtemp(join(tmpdir(), "tecscde-installed-tools-"));
const path = Object.entries(process.env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
const result = { date: new Date().toISOString(), scope: "Installed launchers; version-only calls, isolated cwd; no TECS source generation", checks: [], success: false };
process.chdir(isolated);
try {
  for (const extension of ["bat", "ps1"]) {
    const command = await resolveTecsgenCommand({ PATH: path }, "", { pathCandidates: [`tecsgen.${extension}`] });
    if (command.source === "missing") throw new Error(`Installed tecsgen.${extension} is not on PATH`);
    const runner = new TecsgenRunner(async () => command);
    const version = await runner.version();
    result.checks.push({ entry: `tecsgen.${extension}`, operation: "version", result: version, passed: version.kind === "ok" });
    if (version.kind !== "ok") throw new Error(`tecsgen.${extension} version failed: ${JSON.stringify(version)}`);
    const generation = await runner.generate(["--version"], isolated);
    const generatedTypes = await runner.generatedTypes(["--version"], join(isolated, "version-only.cdl"));
    for (const [operation, outcome] of [["generate with --version", generation], ["generatedTypes with --version", generatedTypes.result]]) {
      const passed = outcome.executableFound && outcome.exitCode === 0 && !outcome.launchFailure;
      result.checks.push({ entry: `tecsgen.${extension}`, operation, passed, exitCode: outcome.exitCode,
        text: (outcome.stdout || outcome.stderr).trim() });
      if (!passed) throw new Error(`tecsgen.${extension} ${operation} failed`);
    }
  }
  result.success = true;
} catch (error) {
  result.error = String(error);
  process.exitCode = 1;
} finally {
  await writeFile(evidence, JSON.stringify(result, (_key, value) => typeof value === "string"
    ? value.replaceAll(isolated, "<isolated-temp>") : value, 2));
  console.log(JSON.stringify({ success: result.success, checks: result.checks.length, error: result.error }));
}
