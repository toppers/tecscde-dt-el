import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogService, logFileName, pruneOldLogs, LOG_FILE_REGEX } from "../../src/main/log-service";

describe("logFileName", () => {
  it("builds a timestamped .txt name from the local time", () => {
    const name = logFileName(new Date(2026, 9, 5, 7, 8, 9));
    expect(name).toBe("tecscde-log-20261005-070809.txt");
    expect(LOG_FILE_REGEX.test(name)).toBe(true);
  });
});

describe("pruneOldLogs", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tecscde-prune-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps up to maxKeep files and removes older log files", async () => {
    // 35個のログファイルと、関係のないファイルを配置
    for (let i = 1; i <= 35; i++) {
      const pad = String(i).padStart(2, "0");
      await writeFile(join(dir, `tecscde-log-20261005-1000${pad}.txt`), `log ${i}`);
    }
    await writeFile(join(dir, "keep-me.txt"), "other");
    await mkdir(join(dir, "tecscde-log-20261005-999999.txt")); // 同名ディレクトリ

    await pruneOldLogs(dir, 30);

    const remaining = await readdir(dir);
    // 保持されるのは: keep-me.txt, 同名ディレクトリ, そして新しい30個のログファイル (06〜35)
    expect(remaining).toContain("keep-me.txt");
    expect(remaining).toContain("tecscde-log-20261005-999999.txt");
    const logFiles = remaining.filter((f) => LOG_FILE_REGEX.test(f) && f !== "tecscde-log-20261005-999999.txt");
    expect(logFiles.length).toBe(30);
    expect(logFiles).not.toContain("tecscde-log-20261005-100001.txt");
    expect(logFiles).not.toContain("tecscde-log-20261005-100005.txt");
    expect(logFiles).toContain("tecscde-log-20261005-100006.txt");
    expect(logFiles).toContain("tecscde-log-20261005-100035.txt");
  });

  it("does not throw if the directory does not exist", async () => {
    await expect(pruneOldLogs(join(dir, "non-existent"), 30)).resolves.not.toThrow();
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

  it("does not create a file when only delimiters or empty lines are appended (audit #67)", async () => {
    const service = new LogService(dir, "9.8.7-test", () => started);

    const r1 = await service.append([]);
    expect(r1).toEqual({ success: true, newFailure: false });

    const r2 = await service.append(["--- /path/to/main.cdl ---"]);
    expect(r2).toEqual({ success: true, newFailure: false });

    expect(await readdir(dir)).toEqual([]);
    expect(service.path).toBeNull();
  });

  it("creates a file and prepends header and delimiter once real records arrive", async () => {
    const service = new LogService(dir, "9.8.7-test", () => started);

    // まず区切り行を渡す（保留される）
    await service.append(["--- /path/to/main.cdl ---"]);
    expect(service.path).toBeNull();

    // 実記録を渡す
    const res = await service.append(["[W-UNRESOLVED-CELLTYPE] warning message"]);
    expect(res).toEqual({ success: true, newFailure: false });

    expect(service.path).toBe(join(dir, "tecscde-log-20261005-102030.txt"));
    const content = await readFile(service.path!, "utf8");
    const lines = content.trimEnd().split("\n");
    expect(lines[0]).toBe(`# TECSCDE 診断ログ（起動: ${started.toISOString()}、版: 9.8.7-test）`);
    expect(lines[1]).toBe("--- /path/to/main.cdl ---");
    expect(lines[2]).toBe("[W-UNRESOLVED-CELLTYPE] warning message");
  });

  it("appends subsequent lines without duplicating the header", async () => {
    const service = new LogService(dir, "9.8.7-test", () => started);

    await service.append(["first line"]);
    await service.append(["second line", "third line"]);

    const content = await readFile(service.path!, "utf8");
    const lines = content.trimEnd().split("\n");
    expect(lines[0]).toContain("TECSCDE 診断ログ");
    expect(lines.slice(1)).toEqual(["first line", "second line", "third line"]);
  });

  it("maintains call order under asynchronous concurrent calls", async () => {
    const service = new LogService(dir, "9.8.7-test", () => started);

    await Promise.all([
      service.append(["line 1"]),
      service.append(["line 2"]),
      service.append(["line 3"]),
    ]);

    const content = await readFile(service.path!, "utf8");
    const lines = content.trimEnd().split("\n").slice(1);
    expect(lines).toEqual(["line 1", "line 2", "line 3"]);
  });

  it("returns newFailure: true on the first write failure and false on subsequent failures (audit #66)", async () => {
    const blocker = join(dir, "not-a-directory");
    await writeFile(blocker, "file blocker");
    const targetDir = join(blocker, "logs"); // cannot create directory under a regular file

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = new LogService(targetDir, "9.8.7-test", () => started);

    const first = await service.append(["[W-FAIL] line 1"]);
    expect(first.success).toBe(false);
    expect(first.newFailure).toBe(true);
    expect(first.error).toBeDefined();

    const second = await service.append(["[W-FAIL] line 2"]);
    expect(second.success).toBe(false);
    expect(second.newFailure).toBe(false);

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
