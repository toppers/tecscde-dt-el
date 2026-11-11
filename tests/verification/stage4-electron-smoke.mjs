// Standalone real-Electron smoke test for Stage 4 (V0.2.0 表示と配置).
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const prefix = join(repo, "tests/verification/stage4-electron-smoke");
const temp = await mkdtemp(join(tmpdir(), "tecscde-stage4-smoke-"));
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

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CDP(socket);
  }

  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }

  close() {
    this.socket.close();
  }
}

async function launch(name, { fixture, snapshot, files = {} } = {}) {
  const work = join(temp, name);
  await mkdir(work, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, content);
  }
  const local = join(work, "local");
  const settingsDir = join(local, "tecscde-dt-el");
  await mkdir(settingsDir, { recursive: true });
  if (snapshot) await writeFile(join(settingsDir, "settings.json"), JSON.stringify({ lastSession: snapshot }));
  const port = await unusedPort();
  const childEnvironment = { ...process.env, LOCALAPPDATA: local, APPDATA: join(work, "roaming") };
  delete childEnvironment["TECSGEN_COMMAND"];

  const child = spawn(
    join(repo, "node_modules/electron/dist/electron.exe"),
    [
      "--inspect=0",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${join(work, "userdata")}`,
      repo,
      ...(fixture ? [fixture] : []),
    ],
    { cwd: work, windowsHide: true, env: childEnvironment, stdio: ["ignore", "pipe", "pipe"] },
  );
  processes.add(child);
  let log = "";
  const record = (chunk) => {
    log += chunk.toString();
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  child.once("exit", () => {
    processes.delete(child);
    results.logs.push({ name, output: log });
  });

  const inspectorUrl = await eventually(
    () => /Debugger listening on (ws:\/\/[^\s]+)/.exec(log)?.[1],
    `${name}: main inspector`,
  );
  const main = await CDP.connect(inspectorUrl);
  const target = await eventually(async () => {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return list.find((target) => target.type === "page" && target.url.startsWith("file:"));
  }, `${name}: renderer target`);
  const renderer = await CDP.connect(target.webSocketDebuggerUrl);

  await main.evaluate(`globalThis.__smoke = { dialogs: [] };
    globalThis.__electron = process.getBuiltinModule('module').createRequire(${JSON.stringify(join(repo, "package.json"))})('electron');
    __electron.dialog.showMessageBox = async (_win, options) => { __smoke.dialogs.push(options); return {response:1, checkboxChecked:false}; }; true`);
  await main.evaluate(
    "(()=>{const win=__electron.BrowserWindow.getAllWindows()[0];win.restore();win.show();win.focus();return true;})()",
  );
  await eventually(
    () => renderer.evaluate("document.readyState === 'complete' && !!document.querySelector('[data-action=save]')"),
    `${name}: DOM`,
  );
  return {
    child,
    main,
    renderer,
    work,
    async stop() {
      main.close();
      renderer.close();
      child.kill();
      await delay(100);
    },
  };
}

const CDL_FIXTURE = `
signature sSig {
  void hello();
};

[active]
celltype tActive {
  call sSig cCall;
  entry sSig eEntry;
};

celltype tPassive {
  call sSig cCall;
  entry sSig eEntry;
};

region rSub {
  cell tActive a1 {
  };
  cell tPassive p1 {
    cCall = a1.eEntry;
  };
};

cell tPassive pRoot {
};
`;

try {
  const fixturePath = join(temp, "stage4.cdl");
  await writeFile(fixturePath, CDL_FIXTURE);

  const app = await launch("stage4-smoke", { fixture: fixturePath });
  const { renderer } = app;

  // 1. セルの描画と active 背景クラスの検証
  await eventually(
    () => renderer.evaluate("document.querySelectorAll('#canvas .cell-rect').length >= 3"),
    "cells rendered",
  );
  const activeRectCount = await renderer.evaluate("document.querySelectorAll('#canvas .cell-rect.active').length");
  assert(activeRectCount === 1, "active cell rect has .active class", { activeRectCount });

  // 2. 状態バッジと凡例の存在検証
  const badgesCount = await renderer.evaluate("document.querySelectorAll('#canvas .cell-status-badges').length");
  assert(badgesCount === 2, "status badges rendered on cells with issues/unconnected ports", { badgesCount });
  const legendPresent = await renderer.evaluate("!!document.querySelector('#status-legend')");
  assert(legendPresent, "status-legend present in DOM");

  // 3. リージョン矩形モードのトグル
  await renderer.evaluate("document.querySelector('[data-action=toggleRegionOutlineMode]').click()");
  await delay(200);
  const outlineAria = await renderer.evaluate(
    "document.querySelector('[data-action=toggleRegionOutlineMode]').getAttribute('aria-pressed')",
  );
  assert(outlineAria === "true", "region outline mode toggled on", { outlineAria });
  const regionOutlinesDrawn = await renderer.evaluate(
    "document.querySelectorAll('#region-outlines .region-outline').length",
  );
  assert(regionOutlinesDrawn > 0, "region outlines rendered in SVG", { regionOutlinesDrawn });

  // 4. アクティブのみフィルタの動作
  await renderer.evaluate(`(()=>{
    const ao = document.querySelector('#filter-active-only');
    ao.checked = true;
    ao.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await delay(200);

  const visibleCellsActiveOnly = await renderer.evaluate(
    "[...document.querySelectorAll('#cells > g[data-cell-id]')].filter(g => g.style.display !== 'none').length",
  );
  assert(visibleCellsActiveOnly === 1, "only active cell is visible with activeOnly filter", {
    visibleCellsActiveOnly,
  });

  // フィルタを戻す
  await renderer.evaluate(`(()=>{
    const ao = document.querySelector('#filter-active-only');
    ao.checked = false;
    ao.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await delay(200);

  // 5. 結合強調トグル
  await renderer.evaluate("document.querySelector('[data-action=toggleConnectionFocus]').click()");
  await delay(100);
  const cfAria = await renderer.evaluate(
    "document.querySelector('[data-action=toggleConnectionFocus]').getAttribute('aria-pressed')",
  );
  assert(cfAria === "true", "connection focus toggled on", { cfAria });

  // 6. 最上段配置コマンドの実行
  const initialY = await renderer.evaluate(`(()=>{
    const rect = document.querySelector('#canvas .cell-rect.active');
    return rect ? Number(rect.getAttribute('y')) : null;
  })()`);
  await renderer.evaluate("document.querySelector('[data-action=moveActiveToTop]').click()");
  await delay(200);
  const statusText = await renderer.evaluate("document.querySelector('#status-region').textContent");
  assert(statusText.includes("最上段へ配置しました"), "move active to top status message displayed", { statusText });

  // 7. スクリーンショット保存
  const screenshot = await renderer.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${prefix}.png`, Buffer.from(screenshot.data, "base64"));
  results.checks.push({ name: "screenshot captured", passed: true, path: `${prefix}.png` });

  results.success = results.checks.every((c) => c.passed);
  await writeFile(`${prefix}.json`, JSON.stringify(results, null, 2));

  await app.stop();
  console.log("Stage 4 smoke test passed successfully!");
} catch (error) {
  results.success = false;
  results.error = String(error);
  await writeFile(`${prefix}.json`, JSON.stringify(results, null, 2)).catch(() => {});
  for (const p of processes) p.kill();
  console.error("Stage 4 smoke test failed:", error);
  process.exitCode = 1;
}
