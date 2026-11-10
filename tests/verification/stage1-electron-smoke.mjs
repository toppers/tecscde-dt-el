// Standalone real-Electron smoke test. All user data, settings, fixtures and app
// logs live in one temporary directory; no production code is instrumented.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const prefix = join(repo, "tests/verification/stage1-electron-smoke");
const temp = await mkdtemp(join(tmpdir(), "tecscde-stage1-smoke-"));
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
async function launch(name, { fixture, snapshot, files = {}, environment = {} } = {}) {
  const work = join(temp, name);
  await mkdir(work, { recursive: true });
  for (const [path, content] of Object.entries(files)) { await mkdir(resolve(path, ".."), { recursive: true }); await writeFile(path, content); }
  const local = join(work, "local");
  const settingsDir = join(local, "tecscde-dt-el");
  await mkdir(settingsDir, { recursive: true });
  if (snapshot) await writeFile(join(settingsDir, "settings.json"), JSON.stringify({ lastSession: snapshot }));
  const port = await unusedPort();
  const childEnvironment = { ...process.env };
  for (const key of Object.keys(childEnvironment)) {
    if (["TECSGEN_COMMAND", "TECSPATH"].includes(key.toUpperCase()) || ("PATH" in environment && key.toUpperCase() === "PATH")) delete childEnvironment[key];
  }
  Object.assign(childEnvironment, { LOCALAPPDATA: local, APPDATA: join(work, "roaming"), TECSGEN_COMMAND: undefined, TECSPATH: process.execPath }, environment);
  const child = spawn(join(repo, "node_modules/electron/dist/electron.exe"), [
    "--inspect=0", `--remote-debugging-port=${port}`, `--user-data-dir=${join(work, "userdata")}`,
    repo, ...(fixture ? [fixture] : []),
  ], { cwd: work, windowsHide: true, env: childEnvironment, stdio: ["ignore", "pipe", "pipe"] });
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


// Node.exe supplies real --version output as a deterministic substitute; this is
// not an external TECS generator compatibility test. Native dialogs and clipboard
// writes are stubbed in the isolated main process only.
try {
  const fixture = join(temp, "fixture.cdl");
  const broken = join(temp, "invalid-program.exe");
  await writeFile(fixture, "signature sSmoke { void run(void); };\ncelltype tSmoke { entry sSmoke e; };\ncell tSmoke Smoke {};\n");
  await writeFile(broken, "This is deliberately not an executable.\n");
  const app = await launch("information", { fixture });
  await app.main.evaluate(`__smoke.copied=''; __smoke.pickerCount=0;
    __electron.clipboard.writeText=(text)=>{__smoke.copied=text};
    __electron.dialog.showOpenDialog=async ()=>{__smoke.pickerCount++;return {canceled:false,filePaths:[${JSON.stringify(process.execPath)}]}}; true`);
  await eventually(() => app.renderer.evaluate("document.querySelector('#canvas .cell-label')?.textContent==='Smoke'"), "fixture cell");
  await click(app.renderer, "#canvas [data-cell-id] .cell-rect");
  await rename(app.renderer, "Edited");
  await app.renderer.evaluate("document.querySelector('#search-input').value='Edited';document.querySelector('#search-input').dispatchEvent(new Event('input',{bubbles:true}));true");
  await click(app.renderer, "[data-action=information]");
  await eventually(() => app.renderer.evaluate("document.querySelector('#information-dialog')?.matches(':modal') && document.querySelector('#information-tecsgen-path')?.value.length>0"), "real modal opened");
  const initial = JSON.parse(await readFile(app.settings, "utf8"));
  const initialToolSettings = await app.renderer.evaluate("window.tecscde.settings.getToolSettings()");
  assert(initial.tecsgenPath === process.execPath && initialToolSettings.override === false, "TECSPATH auto discovery persists the real Node.exe path without TECSGEN_COMMAND override as an isolated test substitute", { path: initial.tecsgenPath });
  const version = await app.renderer.evaluate("document.querySelector('#information-version').textContent");
  const pkg = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
  assert(version.includes(`バージョン: ${pkg.version}`) && /Commit: (?:[a-f0-9]{7,}|unknown)/.test(version) && /CDE形式: \d/.test(version) && version.includes("Electron:") && version.includes("Chrome:") && version.includes("Node.js:") && version.includes("OS: win32"), "modal displays package version, build commit, CDE format and actual runtime fields", { displayed: version });
  assert(await app.renderer.evaluate("document.querySelector('#information-tecspath').readOnly && !Array.from(document.querySelectorAll('#information-dialog label')).some(el=>el.textContent==='PATH')"), "TECSPATH is readonly and PATH is absent");
  for (const event of [
    { type: "keyDown", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 },
    { type: "keyUp", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 },
    { type: "keyDown", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
    { type: "keyUp", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
    { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  ]) await app.renderer.send("Input.dispatchKeyEvent", event);
  await delay(100);
  assert(await app.renderer.evaluate("document.querySelector('#canvas .cell-label')?.textContent==='Edited' && document.querySelectorAll('#canvas .cell-rect').length===1 && document.querySelector('#search-input').value==='Edited' && !document.querySelector('[data-action=undo]').disabled"), "Undo/Delete/Escape inside the modal preserve the diagram, history and search");
  if (!await app.renderer.evaluate("document.querySelector('#information-dialog').open")) await click(app.renderer, "[data-action=information]");
  await eventually(() => app.renderer.evaluate("document.querySelector('#information-dialog').open"), "modal reopened");
  const action = async (name) => app.renderer.evaluate(`document.querySelector('[data-information-action=${name}]').click();true`);
  const enter = async (value) => app.renderer.evaluate(`(()=>{const input=document.querySelector('#information-tecsgen-path');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await action("copy");
  await eventually(() => app.main.evaluate("__smoke.copied.length>0"), "information clipboard stub");
  const copied = await app.main.evaluate("__smoke.copied");
  assert(copied === await app.renderer.evaluate("document.querySelector('#information-version').textContent") && copied.split('\n').every((line) => line.includes(': ')), "information copy uses one labelled plain-text field per line without changing the user's clipboard");
  await action("browse");
  await eventually(() => app.main.evaluate("__smoke.pickerCount===1"), "native picker stub");
  assert(await app.renderer.evaluate(`document.querySelector('#information-tecsgen-path').value===${JSON.stringify(process.execPath)}`), "browse fills the candidate path through the real IPC dialog boundary");
  const beforeCheck = await readFile(app.settings, "utf8");
  await action("check");
  await eventually(() => app.renderer.evaluate("/^v\\d/.test(document.querySelector('#information-check-result').textContent)"), "real Node --version candidate check");
  assert(await readFile(app.settings, "utf8") === beforeCheck, "successful candidate --version check leaves persisted settings unchanged");
  await enter(broken); await action("check");
  await eventually(() => app.renderer.evaluate("document.querySelector('#information-check-result').classList.contains('error')"), "invalid candidate fails");
  const afterCandidate = await app.renderer.evaluate("window.tecscde.settings.getToolSettings()");
  assert(await readFile(app.settings, "utf8") === beforeCheck && afterCandidate.tecsgenPath === initialToolSettings.tecsgenPath && afterCandidate.revision === initialToolSettings.revision, "failed candidate check leaves persisted and active settings unchanged");
  await action("save");
  await eventually(async () => JSON.parse(await readFile(app.settings, "utf8")).tecsgenPath === broken && await app.renderer.evaluate("document.querySelector('#information-settings-result').textContent.includes('保存しました')"), "unverified invalid path saves and rechecks");
  assert(await app.renderer.evaluate("document.querySelector('#information-settings-result').classList.contains('error') && document.querySelector('#diagnostics-panel').textContent.includes('W-TECSGEN-VERSION-UNKNOWN')"), "failed current-command recheck is reported after the failed candidate is nevertheless saved");
  await app.main.evaluate(`globalThis.__smokeFs=process.getBuiltinModule('fs').promises; globalThis.__smokeWrite=__smokeFs.writeFile;
    __smokeFs.writeFile=async function(path,...args){if(String(path).toLowerCase()===${JSON.stringify(app.settings.toLowerCase())})throw Error('smoke settings write denied');return __smokeWrite.call(this,path,...args)};true`);
  await enter(process.execPath); await action("save");
  await eventually(() => app.renderer.evaluate("document.querySelector('#information-settings-result').textContent.includes('smoke settings write denied')"), "settings persistence failure inline");
  assert(await app.renderer.evaluate(`document.querySelector('#information-tecsgen-path').value===${JSON.stringify(process.execPath)}`) && JSON.parse(await readFile(app.settings, "utf8")).tecsgenPath === broken, "persistence failure retains the typed path and previous persisted setting");
  await app.main.evaluate("__smokeFs.writeFile=__smokeWrite;true");
  await action("save");
  await eventually(() => app.renderer.evaluate("document.querySelector('#information-settings-result').textContent.includes('保存しました') && /^tecsgen: v\\d/m.test(document.querySelector('#information-version').textContent)"), "saved Node command immediately rechecked");
  assert(!await app.renderer.evaluate("document.querySelector('#diagnostics-panel').textContent.includes('W-TECSGEN-VERSION-UNKNOWN')"), "saving a valid executable immediately clears the previous version warning");
  await enter(""); await action("save");
  await eventually(async () => JSON.parse(await readFile(app.settings, "utf8")).tecsgenPath === process.execPath && await app.renderer.evaluate(`document.querySelector('#information-tecsgen-path').value===${JSON.stringify(process.execPath)}`), "empty input returns to TECSPATH auto discovery");
  assert(await app.renderer.evaluate("document.querySelector('#information-settings-result').textContent.includes('保存しました')"), "clearing the saved path returns to automatic discovery and immediately reflects its adopted result");
  const screenshot = await app.renderer.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${prefix}.png`, Buffer.from(screenshot.data, "base64"));
  await action("close");
  assert(await app.renderer.evaluate("document.querySelector('#canvas .cell-label')?.textContent==='Edited' && document.querySelector('#status-file').textContent.includes('未保存') && document.querySelector('#search-input').value==='Edited'"), "information settings operations preserve the unsaved diagram and search");
  for (const copyShell of ["powershell7", "powershell5", "cmd"]) {
    await app.renderer.evaluate(`document.querySelector('#tecsgen-copy-shell').value=${JSON.stringify(copyShell)};true`);
    await click(app.renderer, "[data-action=copyTecsgenCommand]");
    const expected = await app.renderer.evaluate(`window.tecscde.tecsgen.commandLine(['-k','utf8',${JSON.stringify(fixture)}],${JSON.stringify(copyShell)})`);
    await eventually(() => app.main.evaluate(`__smoke.copied===${JSON.stringify(expected)}`), `main command copy ${copyShell}`);
    assert(true, `real ${copyShell} selection copies the corresponding main-process command formatter output`, { text: expected });
  }
  await click(app.renderer, "[data-action=save]");
  await eventually(() => app.main.evaluate("__smoke.dirty===false"), "diagram saved before clean shutdown");
  await cleanClose(app);
  const inheritedPath = Object.entries(process.env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  for (const extension of ["bat", "ps1"]) {
    const bin = join(temp, `auto-${extension}`);
    await mkdir(bin, { recursive: true });
    const script = join(bin, `tecsgen.${extension}`);
    const generatedMarker = join(bin, "generated.txt");
    await writeFile(script, extension === "bat"
      ? `@echo off\r\nif "%~1"=="--version" (\r\n echo tecsgen version 1.9.1.0\r\n) else (\r\n echo generated>"${generatedMarker}"\r\n echo stage1 smoke generated\r\n)\r\nexit /b 0\r\n`
      : `if ($args -contains '--version') { Write-Output 'tecsgen version 1.9.1.0'; exit 0 }; [IO.File]::WriteAllText('${generatedMarker.replaceAll("'", "''")}','generated'); Write-Output 'stage1 smoke generated'; exit 0\r\n`);
    const automatic = await launch(`automatic-${extension}`, { fixture, environment: { TECSPATH: undefined, PATH: `${bin};${inheritedPath}` } });
    await eventually(() => automatic.renderer.evaluate("document.querySelectorAll('#canvas .cell-rect').length===1"), `${extension} fixture bootstrap`);
    await click(automatic.renderer, "[data-action=information]");
    await eventually(() => automatic.renderer.evaluate("document.querySelector('#information-version').textContent.includes('tecsgen version 1.9.1.0')"), `${extension} real version`);
    const adopted = JSON.parse(await readFile(automatic.settings, "utf8")).tecsgenPath;
    assert(adopted.toLowerCase() === script.toLowerCase(), `${extension} PATH auto-discovery persists the discovered script and executes its real --version`, { path: adopted });
    await automatic.renderer.evaluate("document.querySelector('[data-information-action=close]').click();true");
    await unlink(generatedMarker).catch(() => {});
    await click(automatic.renderer, "[data-action=generate]");
    await eventually(async () => (await readFile(generatedMarker, "utf8")).includes("generated") && await automatic.renderer.evaluate("!document.querySelector('[data-action=generate]').disabled"), `${extension} UI generation completed`);
    const generated = await automatic.renderer.evaluate("window.tecscde.tecsgen.generate(['--stage1-smoke'])");
    assert(generated.executableFound && generated.exitCode === 0 && generated.stdout.includes("stage1 smoke generated"), `${extension} runs generation through the configured script host`, { result: generated });
    await cleanClose(automatic);
  }
  results.success = true;
  results.scope = "Real Electron, DOM/keyboard/IPC/filesystem. Node.exe substitutes for tecsgen --version; synthetic .bat/.ps1 scripts exercise discovery and execution hosts. This does not validate external TECS generator compatibility. Native chooser and clipboard writes are test stubs; only settings-file write is fault-injected. Actual shell argument round trips are verified separately.";
} catch (error) {
  results.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  for (const child of processes) child.kill();
  await delay(150);
  await writeFile(`${prefix}.json`, JSON.stringify({ ...results, logs: undefined }, (_key, value) =>
    typeof value === "string" ? value.replaceAll(temp, "<isolated-temp>").replaceAll(repo, "<workspace>")
      .replaceAll(process.execPath, "<node-executable>") : value, 2));
  await writeFile(`${prefix}.log`, results.logs.map(({ name, output }) => `=== ${name} ===\n${output}`).join("\n"));
  console.log(JSON.stringify({ success: results.success, checks: results.checks.length, passed: results.checks.filter((c) => c.passed).length, error: results.error, evidence: `${prefix}.json` }, null, 2));
}
