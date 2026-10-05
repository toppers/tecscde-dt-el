import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogService, logFileName } from "../../src/main/log-service";

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

  it("creates the log file in the first directory with a header and appends in order", async () => {
    const service = new LogService([dir], () => started);

    await service.append(["[W-A] first"]);
    await service.append(["[W-B] second", "[W-C] third"]);

    const files = await readdir(dir);
    expect(files).toEqual(["tecscde-log-20261005-102030.txt"]);
    expect(service.path).toBe(join(dir, files[0]!));
    const text = await readFile(join(dir, files[0]!), "utf8");
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toContain("TECSCDE 診断ログ");
    expect(lines.slice(1)).toEqual(["[W-A] first", "[W-B] second", "[W-C] third"]);
  });

  it("keeps the order of calls that are not awaited one by one", async () => {
    const service = new LogService([dir], () => started);

    await Promise.all([service.append(["1"]), service.append(["2"]), service.append(["3"])]);

    const text = await readFile(service.path!, "utf8");
    expect(text.trimEnd().split("\n").slice(1)).toEqual(["1", "2", "3"]);
  });

  it("falls back to the next directory when the first cannot be written", async () => {
    const blocker = join(dir, "not-a-directory");
    await writeFile(blocker, "x");
    const fallback = join(dir, "fallback");
    const service = new LogService([join(blocker, "sub"), fallback], () => started);

    await service.append(["[W-A] first"]);

    expect(service.path).toBe(join(fallback, "tecscde-log-20261005-102030.txt"));
    expect(await readFile(service.path!, "utf8")).toContain("[W-A] first");
  });

  it("reports to stderr instead of throwing when no directory is writable", async () => {
    const blocker = join(dir, "not-a-directory");
    await writeFile(blocker, "x");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = new LogService([join(blocker, "sub")], () => started);

    await expect(service.append(["[W-A] first"])).resolves.toBeUndefined();

    expect(service.path).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("does nothing for an empty batch", async () => {
    const service = new LogService([dir], () => started);

    await service.append([]);

    expect(await readdir(dir)).toEqual([]);
  });
});
