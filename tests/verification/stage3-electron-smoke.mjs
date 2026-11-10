// Standalone real-Electron smoke test. All user data, settings, fixtures and app
// logs live in one temporary directory; no production code is instrumented.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const prefix = join(repo, "tests/verification/stage3-electron-smoke");
const temp = await mkdtemp(join(tmpdir(), "tecscde-stage3-smoke-"));
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
  await main.evaluate("(()=>{const win=__electron.BrowserWindow.getAllWindows()[0];win.restore();win.show();win.focus();return true;})()");
  await eventually(() => renderer.evaluate("document.readyState === 'complete' && !!document.querySelector('[data-action=save]')"), `${name}: DOM`);
  return { child, main, renderer, work, settings: join(settingsDir, "settings.json"),
    async stop() { main.close(); renderer.close(); child.kill(); await delay(100); } };
}
async function click(cdp, selector) {
  if (selector.startsWith("[data-action=")) {
    await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).click(); true`);
    return;
  }
  await cdp.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('missing element');el.scrollIntoView({block:'center',inline:'center'});return true;})()`);
  // An occluded Electron window can suspend rAF; wait for its queued scroll
  // event on the test host, then measure the updated screen position.
  await delay(120);
  const point = await cdp.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
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

async function key(cdp, name, code, modifiers = 0) {
  const windowsVirtualKeyCode = ({ Escape: 27, Delete: 46, Space: 32, KeyZ: 90, KeyY: 89 })[code];
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code, modifiers, windowsVirtualKeyCode });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, modifiers, windowsVirtualKeyCode });
}
async function drag(cdp, from, to) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, ...from });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, ...to });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, ...to });
}
async function moveDialog(cdp, id, left, top) {
  // Activate the requested window first: another floating dialog may cover its
  // header after a resize. This is the same toolbar action a user can take.
  const action = id === "file-browser-dialog" ? "openFileBrowser" : "openCelltypes";
  await cdp.evaluate(`document.querySelector('[data-action=${action}]').click();true`);
  const from = await cdp.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(`#${id} .modeless-dialog-header h2`)}).getBoundingClientRect();return{x:r.x+25,y:r.y+r.height/2};})()`);
  const rect = await cdp.evaluate(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return{x:r.x,y:r.y};})()`);
  await drag(cdp, from, { x: from.x + left - rect.x, y: from.y + top - rect.y });
}


// Only native folder choices and confirmation answers are stubbed. File reads,
// writes, list planning/application and renderer/store behavior remain real.
try {
  const sources = join(temp, '日本語資料');
  await mkdir(sources, { recursive: true });
  const typesPath = join(sources, 'TYPES.CDL');
  const primaryPath = join(sources, 'MAIN.CDE');
  const optsPath = join(sources, 'PROJECT.TECSGEN-OPTS');
  const typesText = 'signature sSmoke { void run(void); };\ncelltype tSmoke { entry sSmoke e; };\ncell tSmoke Reference {};\n';
  const primaryText = '// <img src=x onerror=alert(1)>\ncell tSmoke Primary {};\n';
  await writeFile(typesPath, typesText);
  await writeFile(primaryPath, primaryText);
  await writeFile(optsPath, 'TYPES.CDL MAIN.CDE\n');
  const tree = join(temp, '一覧対象');
  await mkdir(join(tree, 'child'), { recursive: true });
  await mkdir(join(tree, 'empty'), { recursive: true });
  await writeFile(join(tree, 'a.CDL'), '// a\n');
  await writeFile(join(tree, 'b.cdl'), '// b\n');
  await writeFile(join(tree, 'child', 'Child.CDL'), '// child\n');
  const app = await launch('views-and-lists', { fixture: optsPath });
  await app.main.evaluate(`__smoke.confirmAnswer=1; __smoke.chosen=[];
    __electron.dialog.showOpenDialog=async (_window, options)=>{__smoke.chosen.push(options?.title??'folder');return {canceled:false,filePaths:[${JSON.stringify(tree)}]}};
    __electron.dialog.showMessageBox=async (_window,options)=>{__smoke.dialogs.push(options);return {response:__smoke.confirmAnswer,checkboxChecked:false}};true`);
  await eventually(() => app.renderer.evaluate("document.querySelectorAll('#canvas .cell-rect').length===2"), 'uppercase opts/CDL/CDE bootstrap');
  const startupSession = JSON.parse(await readFile(app.settings, 'utf8')).lastSession;
  assert(startupSession.editablePath === primaryPath && startupSession.optionsFilePath === optsPath && startupSession.referencePaths.includes(typesPath), 'uppercase .TECSGEN-OPTS, .CDL and .CDE inputs open with their expected source roles');
  await click(app.renderer, '#canvas [data-cell-id="Primary"] .cell-rect');
  await eventually(() => app.renderer.evaluate("document.querySelector('#property-panel .definition-path')?.textContent?.endsWith('MAIN.CDE')"), 'single-cell path');
  assert(await app.renderer.evaluate(`document.querySelector('#property-panel .definition-path').textContent===${JSON.stringify(primaryPath)}`), 'single-cell property footer shows its full defining path, including non-ASCII directories');
  await rename(app.renderer, 'Edited');
  await eventually(() => app.main.evaluate('__smoke.dirty===true'), 'unsaved rename');
  const viewState = await app.renderer.evaluate("({label:document.querySelector('#canvas [data-cell-id=Primary] .cell-label').textContent,undo:document.querySelector('[data-action=undo]').disabled,redo:document.querySelector('[data-action=redo]').disabled,status:document.querySelector('#status-file').textContent,selected:document.querySelectorAll('#selection-overlay .selection-outline').length,mode:document.querySelector('#palette [data-mode][aria-pressed=true]')?.dataset.mode})");
  const preservedSession = JSON.stringify(JSON.parse(await readFile(app.settings, 'utf8')).lastSession);
  await app.renderer.evaluate("document.querySelector('#property-panel [data-show-definition]').click();true");
  await eventually(() => app.renderer.evaluate("document.querySelector('.definition-file-window pre')?.textContent.includes('cell tSmoke Primary')"), 'cell disk content');
  assert(await app.renderer.evaluate("document.querySelector('.definition-file-window').open && !document.querySelector('.definition-file-window').matches(':modal') && document.querySelector('.definition-file-window pre').textContent.includes('<img src=x') && !document.querySelector('.definition-file-window img')"), 'cell definition opens as a modeless readonly disk view and treats source text literally');
  assert(await app.renderer.evaluate("document.querySelector('#canvas [data-cell-id=Primary] .cell-label').textContent==='Edited' && !document.querySelector('.definition-file-window pre').textContent.includes('cell tSmoke Edited')"), 'definition view shows the disk version while retaining the unsaved diagram edit');
  const cellDefinitionCapture = await app.renderer.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${prefix}-cell-definition.png`, Buffer.from(cellDefinitionCapture.data, 'base64'));
  await app.renderer.evaluate("document.querySelector('.definition-file-window [data-close-definition]').click();true");
  await click(app.renderer, '[data-action=openCelltypes]');
  await app.renderer.evaluate("document.querySelector('[data-celltype-details=tSmoke]').click();true");
  await eventually(() => app.renderer.evaluate("document.querySelector('#celltype-details-dialog').matches(':modal')"), 'celltype details modal');
  assert(await app.renderer.evaluate(`document.querySelector('#celltype-details-dialog .definition-path').textContent===${JSON.stringify(typesPath)} && document.querySelector('#celltype-details-dialog').textContent.includes('TYPES.CDL')`), 'celltype details retain the basename field and show the type definition full path independently of the primary file');
  const detailsCapture = await app.renderer.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${prefix}-celltype-details.png`, Buffer.from(detailsCapture.data, 'base64'));
  await app.renderer.evaluate("document.querySelector('#celltype-details-dialog [data-show-definition]').click();true");
  await eventually(() => app.renderer.evaluate("!document.querySelector('#celltype-details-dialog').open && document.querySelector('.definition-file-window').open && document.querySelector('.definition-file-window pre').textContent.includes('celltype tSmoke')"), 'celltype definition transition');
  assert(await app.renderer.evaluate(`document.querySelector('.definition-file-window h2').textContent==='セルタイプ定義ファイルウィンドウ' && document.querySelector('.definition-file-origin').textContent.includes(${JSON.stringify(typesPath)})`), 'celltype details close before opening their separate accessible definition window');
  await app.renderer.evaluate("document.querySelector('.definition-file-window [data-close-definition]').click();document.querySelector('[data-celltype-details=tSmoke]').click();true");
  assert(await app.renderer.evaluate("document.querySelector('#celltype-details-dialog').open && document.querySelectorAll('#celltype-details-dialog').length===1"), 'celltype details can be reopened without duplicate views or placement changes');
  await app.renderer.evaluate("Array.from(document.querySelectorAll('#celltype-details-dialog button')).find(button=>button.textContent==='閉じる').click();true");
  await click(app.renderer, '[data-action=information]');
  await eventually(() => app.renderer.evaluate("!!document.querySelector('#cdl-list-root')"), 'information list controls');
  await app.renderer.evaluate("document.querySelector('[data-list-action=browse]').click();true");
  await eventually(() => app.renderer.evaluate(`document.querySelector('#cdl-list-root').value===${JSON.stringify(tree)}`), 'folder chosen through native chooser boundary');
  const listStatus = "document.querySelector('#cdl-list-root').closest('section').querySelector('[role=status]').textContent";
  const runList = () => app.renderer.evaluate("document.querySelector('[data-list-action=generate]').click();true");
  const rootList = join(tree, '_ROOT_CDL_FILES.txt');
  const childList = join(tree, 'child', '_CDL_FILES.txt');
  const directList = join(tree, '_CDL_FILES.txt');
  await runList();
  await eventually(async () => (await readFile(rootList, 'utf8')).includes(childList) && await app.renderer.evaluate(listStatus + ".includes('子一覧: 2件')"), 'real list generation');
  assert((await readFile(directList, 'utf8')) === 'a.CDL\nb.cdl\n' && (await readFile(childList, 'utf8')) === 'Child.CDL\n', 'information list creation writes ordered _CDL_FILES.txt entries for uppercase and lowercase CDL files');
  assert((await readFile(rootList, 'utf8')).split('\n').filter(Boolean).length === 2 && await app.renderer.evaluate(listStatus + ".includes('_ROOT_CDL_FILES.txt')"), 'root list contains child list full paths and the UI reports its location and count');
  const rootBefore = await readFile(rootList, 'utf8');
  const childBefore = await readFile(childList, 'utf8');
  await writeFile(directList, 'keep this existing list\n');
  await runList();
  await eventually(() => app.renderer.evaluate(listStatus + ".includes('キャンセル')"), 'overwrite cancellation');
  assert((await readFile(directList, 'utf8')) === 'keep this existing list\n' && (await readFile(rootList, 'utf8')) === rootBefore && (await readFile(childList, 'utf8')) === childBefore, 'cancelled overwrite confirmation leaves every existing list byte unchanged');
  await app.main.evaluate('__smoke.confirmAnswer=0;true');
  await runList();
  await eventually(async () => (await readFile(directList, 'utf8')) === 'a.CDL\nb.cdl\n' && await app.renderer.evaluate(listStatus + ".includes('子一覧: 2件')"), 'accepted overwrite');
  const confirmations = await app.main.evaluate("__smoke.dialogs.filter(dialog=>dialog.message.includes('一覧'))");
  assert(confirmations.length === 2 && confirmations.every(dialog=>dialog.defaultId===1 && dialog.cancelId===1 && dialog.buttons.includes('キャンセル')), 'different existing lists trigger one overwrite confirmation per operation with cancel as the default', { confirmations });
  const capture = await app.renderer.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(tree, 'hidden.cdl'), '// hidden\n');
  const listed = await app.renderer.evaluate(`window.tecscde.file.resolveImports(${JSON.stringify(primaryPath)},
    [{kind:'import',specifier:'a.CDL'},{kind:'import',specifier:'hidden.cdl'},{kind:'import',specifier:'child/Child.CDL'}],
    {importPaths:[${JSON.stringify(tree)}],systemDirs:[${JSON.stringify(tree)}]})`);
  assert(listed[0].content === '// a\n' && listed[1].error === 'not-found' && listed[2].content === '// child\n',
    'generated LF lists authorize their own directory entries and exclude an unlisted file through real import IPC');
  const absolute = await app.renderer.evaluate(`window.tecscde.file.resolveImports(${JSON.stringify(primaryPath)},
    [{kind:'import',specifier:'Child.CDL'}],{importPaths:[${JSON.stringify(join(tree, 'child'))}]})`);
  assert(absolute[0].content === '// child\n', 'an absolute import directory resolves without being prefixed by the source directory');
  for (const name of ['A','B']) { await mkdir(join(tree,name)); await writeFile(join(tree,name,'same.cdl'),name); }
  const distinct = await app.renderer.evaluate(`window.tecscde.file.resolveImports(${JSON.stringify(primaryPath)},
    [{kind:'import',specifier:'A/same.cdl'},{kind:'import',specifier:'B/same.cdl'}],{importPaths:[${JSON.stringify(tree)}]})`);
  assert(distinct[0].content === 'A' && distinct[1].content === 'B' && distinct[0].canonicalPath !== distinct[1].canonicalPath,
    'same-named CDL files in separate directories resolve to separate canonical sources');
  await writeFile(`${prefix}.png`, Buffer.from(capture.data, 'base64'));
  await app.renderer.evaluate("document.querySelector('[data-information-action=close]').click();true");
  const after = await app.renderer.evaluate("({label:document.querySelector('#canvas [data-cell-id=Primary] .cell-label').textContent,undo:document.querySelector('[data-action=undo]').disabled,redo:document.querySelector('[data-action=redo]').disabled,status:document.querySelector('#status-file').textContent,selected:document.querySelectorAll('#selection-overlay .selection-outline').length,mode:document.querySelector('#palette [data-mode][aria-pressed=true]')?.dataset.mode})");
  assert(JSON.stringify(after) === JSON.stringify(viewState) && await app.main.evaluate('__smoke.dirty===true'), 'definition viewing, details and list creation preserve the diagram selection, mode, dirty status and undo/redo availability', { before: viewState, after });
  assert(JSON.stringify(JSON.parse(await readFile(app.settings, 'utf8')).lastSession) === preservedSession, 'list settings updates and definition reads preserve the open-file session');
  await click(app.renderer, '[data-action=undo]');
  await eventually(() => app.renderer.evaluate("document.querySelector('#canvas [data-cell-id=Primary] .cell-label').textContent==='Primary'"), 'one undo reverses only the original rename');
  assert(await app.main.evaluate('__smoke.dirty===false') && await app.renderer.evaluate("document.querySelector('[data-action=undo]').disabled && !document.querySelector('[data-action=redo]').disabled"), 'one Undo after all view operations returns exactly to the original clean history state');
  await click(app.renderer, '[data-action=redo]');
  await eventually(() => app.renderer.evaluate("document.querySelector('#canvas [data-cell-id=Primary] .cell-label').textContent==='Edited'"), 'redo original rename');
  assert(await app.main.evaluate('__smoke.dirty===true'), 'Redo restores the preserved unsaved rename');
  await click(app.renderer, '[data-action=save]');
  await eventually(() => app.main.evaluate('__smoke.dirty===false'), 'saved fixture for clean close');
  await cleanClose(app);
  results.success = true;
  results.scope = 'Real Electron DOM/mouse/IPC/filesystem checks for stage3 #10/#18/#37/#38. Only native folder chooser and confirmation answers are stubbed. The child has isolated local/profile settings; host PATH and user settings are untouched. Node.exe is an external-version substitute inherited from the stage2 harness, so this is not an external tecsgen compatibility test.';
} catch (error) {
  results.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  for (const child of processes) child.kill();
  await delay(150);
  await writeFile(`${prefix}.json`, JSON.stringify({ ...results, logs: undefined }, (_key, value) =>
    typeof value === 'string' ? value.replaceAll(temp, '<isolated-temp>').replaceAll(repo, '<workspace>')
      .replaceAll(process.execPath, '<node-executable>') : value, 2));
  await writeFile(`${prefix}.log`, results.logs.map(({name,output})=>`=== ${name} ===\n${output}`).join('\n'));
  console.log(JSON.stringify({ success:results.success,checks:results.checks.length,passed:results.checks.filter(check=>check.passed).length,error:results.error,evidence:`${prefix}.json` },null,2));
}
