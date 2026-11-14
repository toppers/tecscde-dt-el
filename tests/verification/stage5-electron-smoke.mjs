// Standalone real-Electron smoke test for Stage 5 (診断ログ).
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const prefix = join(repo, "tests/verification/stage5-electron-smoke");
const temp = await mkdtemp(join(tmpdir(), "tecscde-stage5-smoke-"));
const results = { date: new Date().toISOString(), isolation: temp, checks: [], logs: [], success: false };
const processes = new Set();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(value, message, detail) {
  results.checks.push({ name: message, passed: !!value, detail });
  if (!value) throw new Error(message + (detail ? `: ${JSON.stringify(detail)}` : ""));
}

async function eventually(operation, label, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await operation();
      if (last) return last;
    } catch (error) {
      last = String(error);
    }
    await delay(80);
  }
  throw new Error(`Timeout: ${label}; last=${JSON.stringify(last)}`);
}

async function unusedPort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.next = 0;
    this.pending = new Map();
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timed out: ${method}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`Evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
    }
    return result.result?.value;
  }
}

async function launchElectron(port, envVars = {}) {
  const electronBinary = resolve(repo, "node_modules/electron/dist/electron.exe");
  const child = spawn(electronBinary, [".", `--remote-debugging-port=${port}`], {
    cwd: repo,
    env: {
      ...process.env,
      LOCALAPPDATA: temp,
      APPDATA: temp,
      ...envVars,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  processes.add(child);
  child.stdout.on("data", (d) => results.logs.push(`[stdout] ${d.toString().trim()}`));
  child.stderr.on("data", (d) => results.logs.push(`[stderr] ${d.toString().trim()}`));

  const pages = await eventually(async () => {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    const list = await res.json();
    return list.find((p) => p.type === "page" && p.webSocketDebuggerUrl) ? list : null;
  }, "CDP targets");

  const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, reject) => {
    ws.addEventListener("open", r, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const cdp = new CDP(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  return {
    child,
    cdp,
    async stop() {
      ws.close();
      child.kill();
      processes.delete(child);
      await delay(200);
    },
  };
}

try {
  const port = await unusedPort();
  const app = await launchElectron(port);
  const renderer = app.cdp;

  // 1. レンダラーがロードされ window.tecscde が利用可能か確認
  await eventually(async () => {
    const ready = await renderer.evaluate("typeof window.tecscde !== 'undefined'");
    return ready === true;
  }, "window.tecscde ready");

  assert(true, "Electron and renderer loaded with window.tecscde");

  // 2. ログディレクトリの特定（Windows では LOCALAPPDATA/tecscde-dt-el/logs）
  const expectedLogsDir = join(temp, "tecscde-dt-el", "logs");

  // 起動直後: サンプルのロードのみでエラーがない場合、空の区切り行だけのファイルは作成されない（監査#67）
  await delay(500);
  let files = [];
  try {
    files = await readdir(expectedLogsDir);
  } catch {
    // フォルダ未作成も許容
    files = [];
  }
  assert(files.length === 0, "no log file created when there are no diagnostics (audit #67)", { files });

  // 3. 診断ログの追記（区切り行保留と実記録の連携、および改行エスケープ: 監査#67, #68）
  const appendResult = await renderer.evaluate(`window.tecscde.log.append([
    "--- /virtual/test.cdl ---",
    "[W-TEST] sample warning line 1\\\\nline 2"
  ])`);
  assert(appendResult?.success === true, "log.append succeeded", { appendResult });

  // ログファイルが作成されたことを確認
  const createdFiles = await eventually(async () => {
    const f = await readdir(expectedLogsDir);
    return f.length > 0 ? f : null;
  }, "log file created in logs directory");

  assert(createdFiles.length === 1, "exactly one log file created in logs directory", { createdFiles });
  const logPath = join(expectedLogsDir, createdFiles[0]);
  const logContent = await readFile(logPath, "utf8");
  const lines = logContent.trimEnd().split("\n");

  assert(lines[0].startsWith("# TECSCDE 診断ログ"), "log file contains header line with version and start time", {
    firstLine: lines[0],
  });
  assert(lines[1] === "--- /virtual/test.cdl ---", "delimiter line prepended before first diagnostic record", {
    secondLine: lines[1],
  });
  assert(lines[2] === "[W-TEST] sample warning line 1\\nline 2", "diagnostic line is escaped to single line (audit #68)", {
    thirdLine: lines[2],
  });

  // 4. スクリーンショット保存
  const screenshot = await renderer.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${prefix}.png`, Buffer.from(screenshot.data, "base64"));
  results.checks.push({ name: "screenshot captured", passed: true, path: `${prefix}.png` });

  results.success = results.checks.every((c) => c.passed);
  await writeFile(`${prefix}.json`, JSON.stringify(results, null, 2));

  await app.stop();
  console.log("Stage 5 smoke test passed successfully!");
} catch (error) {
  results.success = false;
  results.error = String(error);
  await writeFile(`${prefix}.json`, JSON.stringify(results, null, 2)).catch(() => {});
  for (const p of processes) p.kill();
  console.error("Stage 5 smoke test failed:", error);
  process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
