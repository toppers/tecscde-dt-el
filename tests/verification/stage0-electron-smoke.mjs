// Standalone real-Electron smoke test. All user data, settings, fixtures and app
// logs live in one temporary directory; no production code is instrumented.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const prefix = join(repo, "tests/verification/stage0-electron-smoke");
const temp = await mkdtemp(join(tmpdir(), "tecscde-stage0-smoke-"));
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
    try { last = await operation(); if (last) return last; } catch (error) { last = String(error); }
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
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    return new CDP(socket);
  }
  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  close() { this.socket.close(); }
}
async function launch(name, { fixture, snapshot, files = {} } = {}) {
  const work = join(temp, name);
  await mkdir(work, { recursive: true });
  for (const [path, content] of Object.entries(files)) { await mkdir(resolve(path, ".."), { recursive: true }); await writeFile(path, content); }
  const local = join(work, "local");
  const settingsDir = join(local, "tecscde-dt-el");
  await mkdir(settingsDir, { recursive: true });
  if (snapshot) await writeFile(join(settingsDir, "settings.json"), JSON.stringify({ lastSession: snapshot }));
  const port = await unusedPort();
  const child = spawn(join(repo, "node_modules/electron/dist/electron.exe"), [
    "--inspect=0", `--remote-debugging-port=${port}`, `--user-data-dir=${join(work, "userdata")}`,
    repo, ...(fixture ? [fixture] : []),
  ], { cwd: work, windowsHide: true, env: { ...process.env, LOCALAPPDATA: local, APPDATA: join(work, "roaming"), TECSGEN_COMMAND: "tecscde-stage0-deliberately-missing-tecsgen" }, stdio: ["ignore", "pipe", "pipe"] });
  processes.add(child);
  let log = "";
  const record = (chunk) => { log += chunk.toString(); };
  child.stdout.on("data", record); child.stderr.on("data", record);
  child.once("exit", () => { processes.delete(child); results.logs.push({ name, output: log }); });
  const inspectorUrl = await eventually(() => /Debugger listening on (ws:\/\/[^\s]+)/.exec(log)?.[1], `${name}: main inspector`);
  const main = await CDP.connect(inspectorUrl);
  const target = await eventually(async () => {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return list.find((target) => target.type === "page" && target.url.startsWith("file:"));
  }, `${name}: renderer target`);
  const renderer = await CDP.connect(target.webSocketDebuggerUrl);
  await main.evaluate(`globalThis.__smoke = { dirty: null, dialogs: [], renameWaiting: 0 };
    globalThis.__electron = process.getBuiltinModule('module').createRequire(${JSON.stringify(join(repo, "package.json"))})('electron');
    __electron.ipcMain.on('window:setDirty', (_e, dirty) => { __smoke.dirty = dirty; });
    __electron.dialog.showMessageBox = async (_win, options) => { __smoke.dialogs.push(options); return {response:1, checkboxChecked:false}; }; true`);
  await eventually(() => renderer.evaluate("document.readyState === 'complete' && !!document.querySelector('[data-action=save]')"), `${name}: DOM`);
  return { child, main, renderer, work, settings: join(settingsDir, "settings.json"),
    async stop() { main.close(); renderer.close(); child.kill(); await delay(100); } };
}
async function click(cdp, selector) {
  if (selector.startsWith("[data-action=")) {
    await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).click(); true`);
    return;
  }
  const point = await cdp.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('missing element');el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}
async function rename(cdp, name) {
  await cdp.evaluate(`(()=>{const field=[...document.querySelectorAll('#property-panel .prop-field')].find(el=>el.querySelector('label')?.textContent==='name')?.querySelector('input');if(!field)throw Error('name input missing');field.value=${JSON.stringify(name)};field.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await eventually(() => cdp.evaluate(`!![...document.querySelectorAll('#canvas .cell-label')].find(el=>el.textContent===${JSON.stringify(name)})`), `rename ${name}`);
}
async function cleanClose(app) {
  const before = await app.main.evaluate("__smoke.dialogs.length");
  await app.main.evaluate("__electron.BrowserWindow.getAllWindows()[0].close(); true");
  // Node's inspector intentionally holds process exit until debugger detach.
  app.main.close(); app.renderer.close();
  await eventually(() => app.child.exitCode !== null || app.child.signalCode !== null, "clean close process exit", 10000);
  assert(app.child.exitCode === 0, "clean close exited successfully", { exitCode: app.child.exitCode, dialogsBefore: before });
  app.main.close(); app.renderer.close();
}

try {
  const fixture = join(temp, "fixture.cdl");
  await writeFile(fixture, "signature sSmoke { void run(void); };\ncelltype tSmoke { entry sSmoke e; };\ncell tSmoke Smoke {};\n");
  const app = await launch("editing", { fixture });
  await eventually(() => app.renderer.evaluate("document.querySelector('#canvas [data-cell-id] .cell-label')?.textContent==='Smoke'"), "initial fixture cell");
  assert(true, "actual Electron opened isolated fixture and rendered its cell");
  await click(app.renderer, "#canvas [data-cell-id] .cell-rect");
  await eventually(() => app.renderer.evaluate("!!document.querySelector('#property-panel input')"), "property selection");
  await rename(app.renderer, "SavedName");
  await eventually(() => app.main.evaluate("__smoke.dirty===true"), "dirty on property edit");
  await click(app.renderer, "[data-action=save]");
  await eventually(async () => (await readFile(fixture, "utf8")).includes("cell tSmoke SavedName") && await app.main.evaluate("__smoke.dirty===false"), "save checkpoint");
  assert(true, "property edit saves through real preload/IPC/filesystem and becomes clean");
  await click(app.renderer, "[data-action=undo]");
  await eventually(() => app.renderer.evaluate("document.querySelector('#canvas .cell-label')?.textContent==='Smoke'"), "undo rename");
  await rename(app.renderer, "Branched");
  await eventually(() => app.main.evaluate("__smoke.dirty===true"), "same-depth branch dirty");
  assert(true, "save then Undo then different edit at the same history depth remains dirty");
  await app.main.evaluate(`globalThis.__smokeFs=process.getBuiltinModule('fs').promises; globalThis.__smokeRename=__smokeFs.rename;
    __smokeFs.rename=async function(from,to){ if(to===${JSON.stringify(fixture)}){__smoke.renameWaiting++; await new Promise(resolve=>{globalThis.__smokeRelease=resolve});} return __smokeRename.call(this,from,to); }; true`);
  await click(app.renderer, "[data-action=save]");
  await eventually(() => app.main.evaluate("__smoke.renameWaiting===1"), "save blocked before atomic rename");
  await rename(app.renderer, "DuringSave");
  await app.main.evaluate("__electron.BrowserWindow.getAllWindows()[0].close(); true");
  await delay(350);
  assert(await app.main.evaluate("__smoke.dialogs.length===0 && __electron.BrowserWindow.getAllWindows().length===1"), "close waits for a started save before confirming or closing");
  await app.main.evaluate("__smokeFs.rename=__smokeRename; __smokeRelease(); true");
  await eventually(() => app.main.evaluate("__smoke.dialogs.length===1"), "dirty close confirmation after save settles");
  await delay(100);
  assert((await readFile(fixture, "utf8")).includes("cell tSmoke Branched"), "completed save wrote its original snapshot");
  assert(await app.renderer.evaluate("document.querySelector('#canvas .cell-label')?.textContent==='DuringSave'"), "save completion preserved the later unsaved edit");
  assert(await app.main.evaluate("__smoke.dirty===true && __electron.BrowserWindow.getAllWindows().length===1"), "cancelled close preserves dirty content and keeps the window open");
  await rename(app.renderer, "AfterCancel");
  const capture = await app.renderer.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${prefix}.png`, Buffer.from(capture.data, "base64"));
  await click(app.renderer, "[data-action=save]");
  await eventually(async () => (await readFile(fixture, "utf8")).includes("cell tSmoke AfterCancel") && await app.main.evaluate("__smoke.dirty===false"), "save after cancel");
  assert(true, "editing and saving resume after close cancellation");
  results.closeDialogs = await app.main.evaluate("__smoke.dialogs.map(({message,buttons,defaultId,cancelId})=>({message,buttons,defaultId,cancelId}))");
  await cleanClose(app);

  const empty = await launch("empty", { snapshot: { editablePath: null, referencePaths: [], extraImportPaths: [], sourceOrder: [] } });
  await delay(500);
  assert(await empty.renderer.evaluate("document.querySelectorAll('#canvas [data-cell-id]').length===0"), "valid empty session starts empty without sample replacement");
  const emptySnapshot = JSON.parse(await readFile(empty.settings, "utf8")).lastSession;
  assert(emptySnapshot.editablePath === null && emptySnapshot.sourceOrder.length === 0, "empty session retains null primary and empty source order", emptySnapshot);
  await cleanClose(empty);

  const ref = join(temp, "system", "reference.cdl");
  await mkdir(join(temp, "system"), { recursive: true });
  await writeFile(ref, "signature sReference { void run(void); };\ncelltype tReference { entry sReference e; };\ncell tReference RefOnly {};\n");
  const references = await launch("references", { snapshot: { editablePath: null, referencePaths: [ref], extraImportPaths: [], sourceOrder: [ref] } });
  await eventually(() => references.renderer.evaluate("document.querySelector('#canvas .cell-label')?.textContent==='RefOnly'"), "references-only bootstrap");
  const referenceSnapshot = JSON.parse(await readFile(references.settings, "utf8")).lastSession;
  assert(referenceSnapshot.editablePath === null && referenceSnapshot.referencePaths.length === 1, "reference-only session restores its cell without promoting it to primary", referenceSnapshot);
  await cleanClose(references);

  const opts = join(temp, "changed.tecsgen-opts");
  await writeFile(opts, "-I fresh -I fresh -S system deliberately-not-the-stored-source.cdl\n");
  const context = await launch("changed-options", { snapshot: { editablePath: fixture, referencePaths: [ref], extraImportPaths: ["stale"], optionsFilePath: opts, sourceOrder: [fixture, ref] } });
  await eventually(() => context.renderer.evaluate("document.querySelectorAll('#canvas .cell-rect').length===2"), "options session restore");
  const contextSnapshot = JSON.parse(await readFile(context.settings, "utf8")).lastSession;
  assert(JSON.stringify(contextSnapshot.extraImportPaths) === JSON.stringify(["fresh", "fresh", "system"]), "changed opts replace saved import context and retain order/duplicates", contextSnapshot);
  assert(contextSnapshot.editablePath.toLowerCase() === fixture.toLowerCase() && contextSnapshot.referencePaths.length === 1, "opts reparse retains the stored source set and primary role");
  assert(await context.renderer.evaluate("document.querySelector('[data-cell-id=RefOnly] .cell-rect')?.classList.contains('readonly') && document.querySelector('[data-cell-id=RefOnly] .cell-rect')?.classList.contains('system-defined')"), "same opts parse supplies system directory context to actual rendered reference cell");
  await cleanClose(context);
  results.success = true;
} catch (error) {
  results.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  for (const child of processes) child.kill();
  await delay(150);
  await writeFile(`${prefix}.json`, JSON.stringify({ ...results, logs: undefined }, (_key, value) =>
    typeof value === "string" ? value.replaceAll(temp, "<isolated-temp>").replaceAll(repo, "<workspace>") : value, 2));
  await writeFile(`${prefix}.log`, results.logs.map(({ name, output }) => `=== ${name} ===\n${output}`).join("\n"));
  console.log(JSON.stringify({ success: results.success, checks: results.checks.length, passed: results.checks.filter((c) => c.passed).length, error: results.error, evidence: `${prefix}.json` }, null, 2));
}
