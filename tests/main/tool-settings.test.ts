import { describe, expect, it, vi } from "vitest";
import { ToolSettingsService } from "../../src/main/tool-settings.js";

vi.mock("electron", () => ({ app: { getPath: vi.fn() } }));
const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const callback = args.at(-1) as (error: unknown, result?: unknown) => void;
    execFileMock(...args.slice(0, -1)).then((result: unknown) => callback(null, result), (error: unknown) => callback(error));
  },
}));

function setup(initial: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}) {
  let saved = { ...initial };
  const save = vi.fn(async (patch: Record<string, unknown>) => { saved = { ...saved, ...patch }; });
  const existing = new Set<string>();
  const exists = vi.fn(async (path: string) => existing.has(path));
  const service = new ToolSettingsService({
    env, platform: "linux", load: async () => saved, save, exists, pathCandidates: ["tecsgen"],
  });
  return { service, save, exists, existing, saved: () => saved };
}

describe("ToolSettingsService", () => {
  it("honors the explicit environment command and preserves the saved path", async () => {
    const { service, save, exists } = setup({ tecsgenPath: "/saved/tecsgen", unknown: 3 }, {
      TECSGEN_COMMAND: 'ruby "/Program Files/tecsgen.rb"', TECSPATH: "/env/tool", PATH: "/bin",
    });
    expect(await service.get()).toMatchObject({ tecsgenPath: "/saved/tecsgen", tecspath: "/env/tool",
      effectiveSource: "environment", executable: "ruby", prefixArgs: ["/Program Files/tecsgen.rb"], override: true });
    expect(save).not.toHaveBeenCalled(); expect(exists).not.toHaveBeenCalled();
  });

  it.each(["", "   ", '""', '"unclosed'])("does not fall back for an invalid explicit command %j", async (command) => {
    const { service, save, exists } = setup({ tecsgenPath: "/saved/tecsgen" }, { TECSGEN_COMMAND: command, PATH: "/bin" });
    expect(await service.get()).toMatchObject({ effectiveSource: "invalid", executable: "", override: true });
    expect(save).not.toHaveBeenCalled(); expect(exists).not.toHaveBeenCalled();
  });

  it("uses a saved literal path even when it no longer exists", async () => {
    const { service, exists } = setup({ tecsgenPath: "/missing/tool with spaces" }, { TECSPATH: "/other/tool", PATH: "/bin" });
    expect(await service.resolveCommand()).toEqual({ executable: "/missing/tool with spaces", args: [], source: "settings", revision: 0 });
    expect(exists).not.toHaveBeenCalled();
  });

  it("auto-saves an existing TECSPATH literal without deriving a command inside the directory", async () => {
    const { service, save, existing } = setup({}, { TECSPATH: "/tecs-directory", PATH: "/bin" });
    existing.add("/tecs-directory");
    expect(await service.get()).toMatchObject({ tecsgenPath: "/tecs-directory", effectiveSource: "tecspath", executable: "/tecs-directory" });
    expect(save).toHaveBeenCalledExactlyOnceWith({ tecsgenPath: "/tecs-directory" });
  });

  it("searches PATH from the first directory and persists the found path", async () => {
    const { service, existing, exists } = setup({}, { PATH: "/first:/second:/third" });
    existing.add("/second/tecsgen"); existing.add("/third/tecsgen");
    expect(await service.get()).toMatchObject({ tecsgenPath: "/second/tecsgen", executable: "/second/tecsgen", effectiveSource: "path" });
    expect(exists.mock.calls.map(([path]) => path)).toEqual(["/first/tecsgen", "/second/tecsgen"]);
  });

  it("keeps an undetected command unset", async () => {
    const { service, save } = setup({}, {});
    expect(await service.get()).toMatchObject({ tecsgenPath: "", effectiveSource: "missing", executable: "", override: false });
    expect(save).not.toHaveBeenCalled();
  });

  it("snapshots startup environment and updates the effective command only after successful persistence", async () => {
    const env = { PATH: "/old" };
    const { service, save } = setup({ tecsgenPath: "/old/tool" }, env);
    const initial = await service.get();
    env.PATH = "/changed";
    save.mockRejectedValueOnce(Error("disk full"));
    expect(await service.update({ tecsgenPath: "/new/tool" })).toEqual({ ok: false, error: "disk full" });
    expect(await service.get()).toEqual(initial);
    const update = await service.update({ tecsgenPath: "/new/tool" });
    expect(update).toMatchObject({ ok: true, settings: { tecsgenPath: "/new/tool", revision: initial.revision + 1 } });
    expect(await service.resolveCommand()).toEqual({ executable: "/new/tool", args: [], source: "settings", revision: 1 });
  });

  it("empty save clears, then rediscovers using the frozen environment", async () => {
    const env = { PATH: "/startup" };
    const { service, existing, save } = setup({ tecsgenPath: "/saved/tool" }, env);
    await service.get(); existing.add("/startup/tecsgen"); env.PATH = "/changed";
    expect(await service.update({ tecsgenPath: "" })).toMatchObject({ ok: true,
      settings: { tecsgenPath: "/startup/tecsgen", effectiveSource: "path" } });
    expect(save.mock.calls.map(([patch]) => patch)).toEqual([{ tecsgenPath: "/startup/tecsgen" }]);
  });

  it("serializes competing updates and continues after a failure", async () => {
    const { service, save } = setup({ tecsgenPath: "/old/tool" });
    await service.get();
    let complete!: () => void;
    save.mockImplementationOnce(() => new Promise<void>((r) => { complete = r; }));
    const first = service.update({ tecsgenPath: "/first" });
    const second = service.update({ tecsgenPath: "/second" });
    await new Promise((r) => setTimeout(r, 0));
    expect(save).toHaveBeenCalledTimes(1);
    complete(); await Promise.all([first, second]);
    expect(await service.get()).toMatchObject({ tecsgenPath: "/second", revision: 2 });
  });

  it("rejects unsupported patch keys and non-string paths", async () => {
    const { service, save } = setup({ tecsgenPath: "/old/tool" });
    expect(await service.update({ tecsgenPath: 3 } as never)).toMatchObject({ ok: false });
    expect(await service.update({ tecsgenPath: "/new/tool", PATH: "/evil" } as never)).toMatchObject({ ok: false });
    expect(save).not.toHaveBeenCalled();
  });

  it("checks an unsaved candidate as one literal executable without changing saved settings", async () => {
    const { service, save } = setup({ tecsgenPath: "/saved/tool" }, { TECSGEN_COMMAND: "overriding-tool --flag" });
    const before = await service.get();
    execFileMock.mockReset().mockResolvedValue({ stdout: "", stderr: " tecsgen 1.9.1 " });
    expect(await service.checkPath('/candidate with spaces/"literal"')).toMatchObject({ kind: "ok", text: "tecsgen 1.9.1" });
    expect(execFileMock).toHaveBeenCalledExactlyOnceWith('/candidate with spaces/"literal"', ["--version"], { timeout: 30_000, shell: false });
    expect(await service.get()).toEqual(before);
    expect(save).not.toHaveBeenCalled();
  });

  it("normalizes known Windows environment names without changing their frozen values", async () => {
    const env = { tecsgen_command: 'ruby "C:\\Tools\\tecsgen.rb"', TecSpAtH: "C:\\tecs", Path: "C:\\bin" };
    const service = new ToolSettingsService({ env, platform: "win32", load: async () => ({ tecsgenPath: "saved" }), save: vi.fn() });
    env.tecsgen_command = "changed";
    expect(await service.get()).toMatchObject({ tecspath: "C:\\tecs", effectiveSource: "environment", executable: "ruby",
      prefixArgs: ["C:\\Tools\\tecsgen.rb"], override: true });
  });

  it("includes the active settings revision in the resolved execution snapshot", async () => {
    const { service } = setup({ tecsgenPath: "/old/tool" });
    const first = await service.resolveCommand();
    await service.update({ tecsgenPath: "/new/tool" });
    const second = await service.resolveCommand();
    expect(first.revision).toBe(0);
    expect(second.revision).toBe(1);
  });
});
