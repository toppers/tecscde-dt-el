// [[TECSCDE-DT-EL内部仕様]] 第9章9.1節: TecsgenRunner（mainプロセス）。
// child_process.execFile で tecsgen をサブプロセスとして直接実行する。
// コマンド文字列の組み立て（TecsgenCommandBuilder）はrenderer側（純粋な文字列処理）に残る——
// ここが担うのは実際の起動のみ。

import { execFile, type ExecFileException } from "node:child_process";
import { promisify } from "node:util";
import type { TecsgenResult } from "../shared/ipc-types.js";

const execFileAsync = promisify(execFile);

export class TecsgenRunner {
  async run(args: readonly string[]): Promise<TecsgenResult> {
    try {
      const { stdout, stderr } = await execFileAsync("tecsgen", args, { timeout: 30_000 });
      return { stdout, stderr, exitCode: 0, executableFound: true };
    } catch (err) {
      const e = err as ExecFileException & { stdout?: string; stderr?: string };
      if (e.code === "ENOENT") {
        // 実行ファイルが見つからない（第2章2.4節の新規制約、11.2節#3の未決事項）
        return { stdout: "", stderr: "", exitCode: null, executableFound: false };
      }
      const exitCode = typeof e.code === "number" ? e.code : 1;
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode, executableFound: true };
    }
  }

  async version(): Promise<string | null> {
    const result = await this.run(["--version"]);
    return result.executableFound ? result.stdout.trim() : null;
  }
}
