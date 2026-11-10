// 07G / external 5.3.y: plan without side effects, then apply children before root.
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { fileWrites } from "./write-queue.js";

export interface CdlFileListPlanItem {
  readonly path: string;
  readonly status: "new" | "same" | "differs";
}
export type CdlFileListPlan =
  | { readonly kind: "planned"; readonly planId: string; readonly items: readonly CdlFileListPlanItem[] }
  | { readonly kind: "empty" }
  | { readonly kind: "failed"; readonly path: string; readonly detail: string };
export type CdlFileListResult =
  | { readonly kind: "ok"; readonly rootListPath: string; readonly listCount: number; readonly skippedSame: number }
  | { readonly kind: "empty" }
  | { readonly kind: "changed"; readonly path: string }
  | { readonly kind: "failed"; readonly path: string; readonly detail: string; readonly writtenPaths: readonly string[] };

interface PlannedFile extends CdlFileListPlanItem {
  readonly content: string;
  readonly hash: string | null;
}
interface StoredPlan {
  readonly rootListPath: string;
  readonly items: readonly PlannedFile[];
  readonly expiresAt: number;
}
export interface CdlFileListServiceOptions {
  readonly now?: () => number;
  readonly planLifetimeMs?: number;
}

function compareCodePoints(left: string, right: string): number {
  const a = [...left], b = [...right];
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

export function compareCdlNames(left: string, right: string): number {
  return compareCodePoints(left.toLowerCase(), right.toLowerCase()) || compareCodePoints(left, right);
}

export function compareCdlPaths(left: string, right: string): number {
  const a = left.split(/[\\/]/), b = right.split(/[\\/]/);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = compareCdlNames(a[index]!, b[index]!);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

const hash = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const detail = (error: unknown): string => error instanceof Error ? error.message : String(error);
const missing = (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

async function readExisting(path: string): Promise<Buffer | null> {
  await fileWrites.waitForPath(path);
  try { return await fs.readFile(path); } catch (error) { if (missing(error)) return null; throw error; }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await fileWrites.write(path, async (absolutePath) => {
    const temporary = `${absolutePath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await fs.writeFile(temporary, content, "utf8");
      await fs.rename(temporary, absolutePath);
    } catch (error) {
      await fs.unlink(temporary).catch(() => {});
      throw error;
    }
  });
}

export class CdlFileListService {
  private readonly plans = new Map<string, StoredPlan>();
  private readonly now: () => number;
  private readonly lifetime: number;
  private busy = false;

  constructor(options: CdlFileListServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.lifetime = options.planLifetimeMs ?? 5 * 60_000;
  }

  /** Caller asks once about all `differs` paths; cancellation simply does not apply the plan. */
  async plan(root: string): Promise<CdlFileListPlan> {
    if (typeof root !== "string" || root.trim() === "" || /[\0\r\n]/.test(root)) {
      return { kind: "failed", path: typeof root === "string" ? root : "", detail: "有効な対象ディレクトリを指定してください。" };
    }
    const absoluteRoot = resolve(root);
    if (this.busy) return { kind: "failed", path: absoluteRoot, detail: "一覧生成は既に処理中です。" };
    this.busy = true;
    let currentPath = absoluteRoot;
    try {
      this.expirePlans();
      const rootStat = await fs.lstat(absoluteRoot);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error("対象はリンクではないディレクトリを指定してください。");
      const filesByDirectory = new Map<string, string[]>();
      const directories = [absoluteRoot];
      while (directories.length > 0) {
        const directory = directories.pop()!;
        currentPath = directory;
        const names = (await fs.readdir(directory)).sort(compareCdlNames);
        for (const name of names) {
          currentPath = join(directory, name);
          const stat = await fs.lstat(currentPath);
          if (stat.isDirectory() && !stat.isSymbolicLink()) { directories.push(currentPath); continue; }
          if (!/\.cdl$/i.test(name)) continue;
          let isFile = stat.isFile();
          if (stat.isSymbolicLink()) {
            try { isFile = (await fs.stat(currentPath)).isFile(); }
            catch (error) { if (!missing(error)) throw error; }
          }
          if (!isFile) continue;
          if (/[\r\n]/.test(currentPath)) throw Error("一覧には改行を含むファイル名を記録できません。");
          const files = filesByDirectory.get(directory) ?? [];
          files.push(name);
          filesByDirectory.set(directory, files);
        }
      }
      if (filesByDirectory.size === 0) return { kind: "empty" };
      const children = [...filesByDirectory.entries()].map(([directory, names]) => ({
        path: join(directory, "_CDL_FILES.txt"), content: names.sort(compareCdlNames).join("\n") + "\n",
      })).sort((left, right) => compareCdlPaths(left.path, right.path));
      const rootListPath = join(absoluteRoot, "_ROOT_CDL_FILES.txt");
      const outputs = [...children, { path: rootListPath, content: children.map((item) => item.path).join("\n") + "\n" }];
      const items: PlannedFile[] = [];
      for (const output of outputs) {
        currentPath = output.path;
        const existing = await readExisting(output.path);
        items.push({ ...output, hash: existing === null ? null : hash(existing),
          status: existing === null ? "new" : existing.equals(Buffer.from(output.content, "utf8")) ? "same" : "differs" });
      }
      const planId = randomUUID();
      this.plans.set(planId, { items, rootListPath, expiresAt: this.now() + this.lifetime });
      // Bound abandoned confirmations in addition to the plan's time limit.
      if (this.plans.size > 32) this.plans.delete(this.plans.keys().next().value!);
      return { kind: "planned", planId, items: items.map(({ path, status }) => ({ path, status })) };
    } catch (error) {
      return { kind: "failed", path: currentPath, detail: detail(error) };
    } finally { this.busy = false; }
  }

  async apply(planId: string): Promise<CdlFileListResult> {
    this.expirePlans();
    const plan = this.plans.get(planId);
    if (!plan) return { kind: "failed", path: "", detail: "一覧生成の計画が無効または期限切れです。再度作成してください。", writtenPaths: [] };
    if (this.busy) return { kind: "failed", path: plan.rootListPath, detail: "一覧生成は既に処理中です。", writtenPaths: [] };
    this.busy = true;
    this.plans.delete(planId);
    const writtenPaths: string[] = [];
    let currentPath = plan.rootListPath;
    try {
      // Inspect all preconditions before writing even the first child.
      for (const item of plan.items) {
        currentPath = item.path;
        const bytes = await readExisting(item.path);
        if ((bytes === null ? null : hash(bytes)) !== item.hash) return { kind: "changed", path: item.path };
      }
      for (const item of plan.items) {
        currentPath = item.path;
        if (item.status === "same") continue;
        await writeAtomic(item.path, item.content);
        writtenPaths.push(item.path);
      }
      return { kind: "ok", rootListPath: plan.rootListPath, listCount: plan.items.length - 1,
        skippedSame: plan.items.filter((item) => item.status === "same").length };
    } catch (error) {
      return { kind: "failed", path: currentPath, detail: detail(error), writtenPaths };
    } finally { this.busy = false; }
  }

  private expirePlans(): void {
    const now = this.now();
    for (const [id, plan] of this.plans) if (plan.expiresAt <= now) this.plans.delete(id);
  }
}
