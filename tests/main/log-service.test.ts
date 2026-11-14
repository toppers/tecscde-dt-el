import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogService, logFileName, pruneOldLogs, LOG_KEEP_COUNT } from "../../src/main/log-service";

describe("logFileName", () => {
  it("builds a timestamped .txt name from the local time", () => {
    expect(logFileName(new Date(2026, 9, 5, 7, 8, 9))).toBe("tecscde-log-20261005-070809.txt");
  });
});

describe("LogService", () => {
  let dir: string;
  const started = new Date(2026, 9, 5, 10, 20, 30);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tecscde-log-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the app version in the header, as the version it was given (spec 9.5.2)", async () => {
    const service = new LogService(dir, "9.8.7", () => started);

    await service.append(["[W-A] first"]);

    const text = await readFile(service.path!, "utf8");
    expect(text.split("\n")[0]).toContain("版: 9.8.7");
  });

  it("creates the log file in the given directory with a header and appends in order", async () => {
    const service = new LogService(dir, "0.1.0", () => started);

    await service.append(["[W-A] first"]);
    await service.append(["[W-B] second", "[W-C] third"]);

    const files = await readdir(dir);
    expect(files).toEqual(["tecscde-log-20261005-102030.txt"]);
    expect(service.path).toBe(join(dir, files[0]!));
    const text = await readFile(join(dir, files[0]!), "utf8");
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toBe(`# TECSCDE 診断ログ（起動: ${started.toISOString()}、版: 0.1.0）`);
    expect(lines.slice(1)).toEqual(["[W-A] first", "[W-B] second", "[W-C] third"]);
  });

  it("creates the log directory (and its parents) when it does not exist yet", async () => {
    const nested = join(dir, "tecscde-dt-el", "logs");
    const service = new LogService(nested, "0.1.0", () => started);

    await service.append(["[W-A] first"]);

    expect(await readdir(nested)).toEqual(["tecscde-log-20261005-102030.txt"]);
  });

  it("keeps the order of calls that are not awaited one by one", async () => {
    const service = new LogService(dir, "0.1.0", () => started);

    await Promise.all([service.append(["1"]), service.append(["2"]), service.append(["3"])]);

    const text = await readFile(service.path!, "utf8");
    expect(text.trimEnd().split("\n").slice(1)).toEqual(["1", "2", "3"]);
  });

  it("does nothing for an empty batch", async () => {
    const service = new LogService(dir, "0.1.0", () => started);

    await service.append([]);

    expect(await readdir(dir)).toEqual([]);
  });

  it("resolves with an empty result when the write succeeds", async () => {
    const service = new LogService(dir, "0.1.0", () => started);

    await expect(service.append(["[W-A] first"])).resolves.toEqual({});
  });

  describe("when the log cannot be written (spec 9.5.2 rule 13)", () => {
    let blockedDir: string;

    beforeEach(async () => {
      // 親がファイルなので、ディレクトリを作れない
      const blocker = join(dir, "not-a-directory");
      await writeFile(blocker, "x");
      blockedDir = join(blocker, "sub");
      vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("does not throw, and reports the failure once, with a reason", async () => {
      const service = new LogService(blockedDir, "0.1.0", () => started);

      const first = await service.append(["[W-A] first"]);

      expect(service.path).toBeNull();
      expect(typeof first.newFailure).toBe("string");
      expect(first.newFailure!.length).toBeGreaterThan(0);
    });

    it("does not report the same failure again on later writes", async () => {
      const service = new LogService(blockedDir, "0.1.0", () => started);

      await service.append(["[W-A] first"]);
      const second = await service.append(["[W-B] second"]);

      expect(second).toEqual({});
    });

    it("recovers: once the directory becomes writable, writes succeed and nothing is reported", async () => {
      const service = new LogService(blockedDir, "0.1.0", () => started);
      await service.append(["[W-A] first"]); // 失敗

      await rm(join(dir, "not-a-directory"));
      await mkdir(blockedDir, { recursive: true });
      const result = await service.append(["[W-B] second"]);

      expect(result).toEqual({});
      expect(service.path).not.toBeNull();
      expect(await readFile(service.path!, "utf8")).toContain("[W-B] second");
    });
  });
});

describe("pruneOldLogs (spec 9.5.2 rule 12)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tecscde-prune-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const name = (i: number): string => `tecscde-log-202610${String(i).padStart(2, "0")}-120000.txt`;

  it("keeps the newest 30 tecscde-log-*.txt files (by file name) and deletes the older ones", async () => {
    expect(LOG_KEEP_COUNT).toBe(30);
    for (let i = 1; i <= 35; i += 1) await writeFile(join(dir, name(i)), "x");

    await pruneOldLogs(dir);

    const left = (await readdir(dir)).sort();
    expect(left).toHaveLength(30);
    expect(left[0]).toBe(name(6)); // 1〜5 が消える
    expect(left[29]).toBe(name(35));
  });

  it("leaves everything when there are 30 or fewer", async () => {
    for (let i = 1; i <= 30; i += 1) await writeFile(join(dir, name(i)), "x");

    await pruneOldLogs(dir);

    expect(await readdir(dir)).toHaveLength(30);
  });

  it("never touches files that do not match tecscde-log-*.txt, nor subdirectories", async () => {
    for (let i = 1; i <= 35; i += 1) await writeFile(join(dir, name(i)), "x");
    await writeFile(join(dir, "settings.json"), "{}");
    await writeFile(join(dir, "notes.txt"), "keep");
    await writeFile(join(dir, "tecscde-log-keep.bak"), "keep");
    await mkdir(join(dir, "tecscde-log-20200101-000000.txt")); // 名前は合うがディレクトリ

    await pruneOldLogs(dir);

    const left = await readdir(dir);
    expect(left).toEqual(expect.arrayContaining(["settings.json", "notes.txt", "tecscde-log-keep.bak", "tecscde-log-20200101-000000.txt"]));
    expect(left.filter((f) => /^tecscde-log-\d{8}-\d{6}\.txt$/.test(f) && f !== "tecscde-log-20200101-000000.txt")).toHaveLength(30);
  });

  it("does nothing, without throwing, when the directory does not exist", async () => {
    await expect(pruneOldLogs(join(dir, "missing"))).resolves.toBeUndefined();
  });
});
