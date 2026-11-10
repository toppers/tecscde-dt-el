// Standalone real-Electron smoke test. All user data, settings, fixtures and app
// logs live in one temporary directory; no production code is instrumented.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const prefix = join(repo, "tests/verification/stage2-electron-smoke");
const temp = await mkdtemp(join(tmpdir(), "tecscde-stage2-smoke-"));
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

try {
  const fixture = join(temp, "stage2-main.cdl");
  const root = join(temp, "project");
  const nested = join(root, "nested");
  const changed = join(nested, "changed.cdl");
  await mkdir(nested, { recursive: true });
  await writeFile(fixture, "signature sSmoke { void run(void); };\ncelltype tSmoke { entry sSmoke e; };\ncell tSmoke Smoke {};\n");
  await writeFile(changed, "signature sChanged { void run(void); };\ncelltype tChanged { entry sChanged e; };\ncell tChanged Changed {};\n");
  const app = await launch("panels", { fixture, environment: { TECSGEN_COMMAND: join(temp, "missing-tecsgen.exe"), TECSPATH: undefined } });
  await app.main.evaluate(`__smoke.chooseCount=0;__smoke.saveChoice=null;
    __electron.dialog.showOpenDialog=async()=>{__smoke.chooseCount++;return {canceled:false,filePaths:[${JSON.stringify(root)}]}};
    __electron.dialog.showSaveDialog=async()=>__smoke.saveChoice===null?{canceled:true}:{canceled:false,filePath:__smoke.saveChoice};true`);
  await eventually(() => app.renderer.evaluate("document.querySelector('#canvas .cell-label')?.textContent==='Smoke'"), "fixture diagram");
  assert(await app.renderer.evaluate("!document.querySelector('#display-bar') && ['region-filter','filter-color','filter-signature','filter-emphasize'].every(id=>document.querySelector('#toolbar #display-controls #'+id)) && !document.querySelector('#main #palette,#main #file-browser') && document.querySelectorAll('#main > *').length===2"), "old display bar is absent, display filters are inside toolbar and sidebars no longer shrink the canvas");
  assert(await app.renderer.evaluate("document.querySelector('#status-mode').textContent==='選択' && document.querySelector('#palette-mode [data-mode=select]').getAttribute('aria-pressed')==='true' && document.querySelector('#palette-mode [data-mode=newCell]').getAttribute('aria-pressed')==='false'"), "initial status and palette show exactly one selected mode");
  let title = await app.main.evaluate("__electron.BrowserWindow.getAllWindows()[0].getTitle()");
  assert(title === "stage2-main.cdl — TECSCDE", "real BrowserWindow begins with a clean filename title", { title });
  await click(app.renderer, "[data-action=openFileBrowser]");
  await click(app.renderer, "[data-action=openCelltypes]");
  assert(await app.renderer.evaluate("['file-browser-dialog','celltypes-dialog'].every(id=>{const el=document.getElementById(id);return el.open&&!el.matches(':modal')})"), "both lists open simultaneously as real nonmodal dialogs");
  await moveDialog(app.renderer, "file-browser-dialog", 700, 150);
  await moveDialog(app.renderer, "celltypes-dialog", 970, 150);
  const panelPosition = await app.renderer.evaluate("(()=>{const r=document.querySelector('#file-browser-dialog').getBoundingClientRect();return{x:r.x,y:r.y};})()");
  await click(app.renderer, "#file-browser-dialog [data-action=chooseFolder]");
  await eventually(() => app.renderer.evaluate("document.querySelectorAll('#file-browser .file-browser-dir').length===2"), "chosen folder tree");
  const folder = await app.main.evaluate("__smoke.chooseCount");
  assert(folder === 1 && await app.renderer.evaluate("!!document.querySelector('#file-browser-dialog [data-action=chooseFolder]') && !document.querySelector('#toolbar [data-action=openFolder]')"), "native folder selection is exposed inside the file dialog only", { calls: folder });
  await click(app.renderer, `#file-browser [data-path=${JSON.stringify(nested)}]`);
  await eventually(() => app.renderer.evaluate(`!!document.querySelector('#file-browser [data-path='+${JSON.stringify(JSON.stringify(changed))}+']')`), "expanded nested directory");
  await click(app.renderer, "#file-browser-dialog [data-modeless-close]");
  await click(app.renderer, "[data-action=openFileBrowser]");
  assert(await app.renderer.evaluate(`!!document.querySelector('#file-browser [data-path='+${JSON.stringify(JSON.stringify(changed))}+']')`), "closing and reopening preserves the expanded tree");
  const afterPosition = await app.renderer.evaluate("(()=>{const r=document.querySelector('#file-browser-dialog').getBoundingClientRect();return{x:r.x,y:r.y};})()");
  assert(Math.abs(afterPosition.x - panelPosition.x) < 1 && Math.abs(afterPosition.y - panelPosition.y) < 1,
    "dragged dialog position survives close and reopen", { before: panelPosition, after: afterPosition });
  await click(app.renderer, "[data-action=openFileBrowser]");
  await click(app.renderer, "[data-action=openCelltypes]");
  assert(await app.renderer.evaluate("document.querySelectorAll('.modeless-dialog').length===2"), "reopening existing dialogs does not duplicate their DOM instances");

  // Canvas geometry is read from the live SVG, then exercised with actual CDP input.
  await app.renderer.evaluate("window.__stage2PointerTrace=[];for(const type of ['mousedown','mouseup'])document.addEventListener(type,event=>{if(!event.target.closest?.('#canvas'))return;const capture=()=>({type,x:event.clientX,y:event.clientY,svgY:document.querySelector('#canvas').getBoundingClientRect().y,scrollTop:document.querySelector('#canvas-scroll').scrollTop,viewport:document.querySelector('#canvas-scroll').clientHeight});__stage2PointerTrace.push(capture());queueMicrotask(()=>__stage2PointerTrace.push({...capture(),after:true}));},true);true");
  results.beforeSelect = await app.renderer.evaluate("({title:document.title,rect:document.querySelector('#canvas .cell-rect').outerHTML})");
  await click(app.renderer, "#canvas [data-cell-id] .cell-rect");
  results.afterSelect = await app.renderer.evaluate("({title:document.title,rect:document.querySelector('#canvas .cell-rect').outerHTML})");
  assert(results.beforeSelect.title === results.afterSelect.title && results.beforeSelect.rect === results.afterSelect.rect,
    "returning from a modeless control to a canvas selection does not move or dirty the cell");
  results.pointerTrace = await app.renderer.evaluate("__stage2PointerTrace");
  await eventually(() => app.renderer.evaluate("!!document.querySelector('#property-panel input')"), "selection with two modeless dialogs");
  await rename(app.renderer, "Edited");
  title = await app.main.evaluate("__electron.BrowserWindow.getAllWindows()[0].getTitle()");
  assert(title === "* stage2-main.cdl — TECSCDE" && await app.renderer.evaluate("document.querySelector('#status-file').textContent.includes('未保存の変更')"), "canvas editing with both dialogs open updates real window title and shared dirty status", { title });
  await click(app.renderer, "[data-action=undo]");
  await eventually(() => app.renderer.evaluate("document.querySelector('#canvas .cell-label')?.textContent==='Smoke'"), "undo rename");
  results.undoState = { title: await app.main.evaluate("__electron.BrowserWindow.getAllWindows()[0].getTitle()"),
    dirty: await app.main.evaluate("__smoke.dirty"),
    renderer: await app.renderer.evaluate("({title:document.title,status:document.querySelector('#status-file').textContent,cells:[...document.querySelectorAll('#canvas [data-cell-id]')].map(e=>({id:e.dataset.cellId,html:e.outerHTML})),undo:document.querySelector('[data-action=undo]').disabled,redo:document.querySelector('[data-action=redo]').disabled})") };
  await eventually(() => app.main.evaluate("__electron.BrowserWindow.getAllWindows()[0].getTitle()==='stage2-main.cdl — TECSCDE'"), "native clean title after Undo", 1500);
  assert(true, "Undo back to checkpoint clears title dirty prefix");
  await click(app.renderer, "[data-action=redo]");
  await click(app.renderer, "[data-action=save]");
  await eventually(() => app.main.evaluate("__smoke.dirty===false"), "save checkpoint");
  assert((await app.main.evaluate("__electron.BrowserWindow.getAllWindows()[0].getTitle()")) === "stage2-main.cdl — TECSCDE" && (await readFile(fixture,"utf8")).includes("Edited"), "Redo and real file save update the title only after checkpoint success");
  const scrollBefore = await app.renderer.evaluate("(()=>{const e=document.querySelector('#canvas-scroll');return{x:e.scrollLeft,y:e.scrollTop}})()");
  await app.renderer.send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await drag(app.renderer, { x: 570, y: 450 }, { x: 510, y: 390 });
  await app.renderer.send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  const scrollAfter = await app.renderer.evaluate("(()=>{const e=document.querySelector('#canvas-scroll');return{x:e.scrollLeft,y:e.scrollTop}})()");
  assert(JSON.stringify(scrollBefore)!==JSON.stringify(scrollAfter) && !await app.main.evaluate("__smoke.dirty"), "Space plus pointer drag pans the canvas while both lists remain open without editing the document", { before: scrollBefore, after: scrollAfter });
  await click(app.renderer, "#palette [data-celltype=tSmoke]");
  assert(await app.renderer.evaluate("document.querySelector('#status-mode').textContent==='セル新規作成' && document.querySelector('#palette-mode [data-mode=newCell]').getAttribute('aria-pressed')==='true' && document.querySelector('#palette-mode [data-mode=select]').getAttribute('aria-pressed')==='false'"), "type selection updates the Japanese status mode and both exclusive mode buttons");
  const canvasPoint = await app.renderer.evaluate("(()=>{const svg=document.querySelector('#canvas');const p=svg.createSVGPoint();p.x=300;p.y=220;const s=p.matrixTransform(svg.getScreenCTM());return{x:s.x,y:s.y};})()");
  results.placementProbe = await app.renderer.evaluate(`(()=>{const point=${JSON.stringify(canvasPoint)};const target=document.elementFromPoint(point.x,point.y);return{point,target:target?.outerHTML.slice(0,700),svg:document.querySelector('#canvas').getBoundingClientRect().toJSON(),viewport:document.querySelector('#canvas-scroll').getBoundingClientRect().toJSON(),mode:document.querySelector('#status-mode').textContent,trace:window.__stage2PointerTrace};})()`);
  await app.renderer.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...canvasPoint });
  await app.renderer.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...canvasPoint });
  await delay(120);
  results.afterPlacement = await app.renderer.evaluate("({count:document.querySelectorAll('#canvas .cell-rect').length,labels:[...document.querySelectorAll('#canvas .cell-label')].map(e=>e.textContent),mode:document.querySelector('#status-mode').textContent,trace:window.__stage2PointerTrace,title:document.title,active:[...document.querySelectorAll('#palette .palette-celltype.active')].map(e=>e.textContent)})");
  await eventually(() => app.renderer.evaluate("document.querySelectorAll('#canvas .cell-rect').length===2"), "palette canvas placement");
  assert(true, "a chosen celltype can be placed by a real canvas pointer while its modeless list stays open");
  await click(app.renderer, "[data-action=undo]");
  await eventually(() => app.renderer.evaluate("document.querySelectorAll('#canvas .cell-rect').length===1"), "undo placement");
  await app.renderer.evaluate("document.querySelector('#search-input').value='Edited';document.querySelector('#search-input').dispatchEvent(new Event('input',{bubbles:true}));true");
  await click(app.renderer, "#celltypes-dialog h2");
  await app.renderer.evaluate("document.querySelector('#celltypes-dialog').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,isComposing:true}));true");
  assert(await app.renderer.evaluate("document.querySelector('#celltypes-dialog').open && document.querySelector('#search-input').value==='Edited'"), "IME-composing Escape does not close the modeless dialog or clear search");
  await key(app.renderer, "Escape", "Escape");
  assert(await app.renderer.evaluate("!document.querySelector('#celltypes-dialog').open && document.querySelector('#search-input').value==='Edited'"), "Escape in the modeless dialog closes that dialog and preserves canvas search");
  await app.main.evaluate("__electron.dialog.showMessageBox=async(_win,options)=>{__smoke.dialogs.push(options);return{response:0,checkboxChecked:false}};true");
  await click(app.renderer, `#file-browser [data-path=${JSON.stringify(changed)}]`);
  await eventually(() => app.renderer.evaluate("document.querySelector('#canvas .cell-label')?.textContent==='Changed'"), "open different source through file tree");
  await click(app.renderer, "[data-action=openCelltypes]");
  assert(await app.renderer.evaluate("!!document.querySelector('#palette [data-celltype=tChanged]') && !document.querySelector('#palette [data-celltype=tSmoke]')"), "hidden palette stays synchronized when the loaded source changes");
  await click(app.renderer, "[data-action=clear]");
  await eventually(() => app.renderer.evaluate("document.querySelectorAll('#canvas .cell-rect').length===0"), "new empty primary");
  assert((await app.main.evaluate("__electron.BrowserWindow.getAllWindows()[0].getTitle()")) === "(未保存) — TECSCDE", "new untitled empty document is clean rather than dirty merely because its path is null");
  // Reload a type, then cancel Save As and fault-inject only its native write.
  await click(app.renderer, `#file-browser [data-path=${JSON.stringify(changed)}]`);
  await eventually(() => app.renderer.evaluate("document.querySelector('#canvas .cell-label')?.textContent==='Changed'"), "reload editable fixture");
  await click(app.renderer, "#palette [data-mode=select]");
  await click(app.renderer, "#canvas [data-cell-id] .cell-rect");
  await rename(app.renderer, "Retained");
  await click(app.renderer, "[data-action=saveAs]");
  await delay(120);
  assert((await app.main.evaluate("__electron.BrowserWindow.getAllWindows()[0].getTitle()")) === "* changed.cdl — TECSCDE", "cancelled native Save As retains the real title dirty marker");
  await app.main.evaluate(`globalThis.__smokeFs=process.getBuiltinModule('fs').promises;__smoke.originalRename=__smokeFs.rename;
    __smokeFs.rename=async(from,to)=>{if(String(to).toLowerCase()===${JSON.stringify(changed.toLowerCase())})throw Error('stage2 write denied');return __smoke.originalRename(from,to)};true`);
  await click(app.renderer, "[data-action=save]");
  await delay(180);
  assert((await app.main.evaluate("__electron.BrowserWindow.getAllWindows()[0].getTitle()")) === "* changed.cdl — TECSCDE", "failed real atomic file write retains the title dirty marker");
  await app.main.evaluate("__smokeFs.rename=__smoke.originalRename;true");
  await click(app.renderer, "[data-action=information]");
  await eventually(() => app.renderer.evaluate("document.querySelector('#information-dialog').matches(':modal')"), "information remains modal");
  await key(app.renderer,"Delete","Delete");
  await key(app.renderer,"z","KeyZ",2);
  assert(await app.renderer.evaluate("document.querySelector('#canvas .cell-label')?.textContent==='Retained' && document.querySelector('#information-dialog').open"), "the existing information modal continues to block canvas Delete and Undo");
  await app.renderer.evaluate("document.querySelector('[data-information-action=close]').click();true");
  await click(app.renderer, "[data-action=openFileBrowser]");
  await click(app.renderer, "[data-action=openCelltypes]");
  await app.main.evaluate("__electron.BrowserWindow.getAllWindows()[0].setSize(820,600);true");
  await eventually(() => app.renderer.evaluate("[...document.querySelectorAll('.modeless-dialog')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.left<=innerWidth-47&&r.top<=innerHeight-31})"), "modeless headers remain reachable after viewport shrink");
  assert(true, "window shrinking keeps both modeless dialog headers reachable");
  await app.main.evaluate("__electron.BrowserWindow.getAllWindows()[0].setSize(1280,800);true");
  await delay(120);
  await moveDialog(app.renderer, "file-browser-dialog", 700, 150);
  await moveDialog(app.renderer, "celltypes-dialog", 970, 150);
  const screenshot = await app.renderer.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${prefix}.png`, Buffer.from(screenshot.data, "base64"));
  results.ui = await app.renderer.evaluate("({ title:document.title,status:document.querySelector('#statusbar').innerText,buttons:[...document.querySelectorAll('#toolbar > button')].map(e=>e.textContent),dialogs:[...document.querySelectorAll('.modeless-dialog')].map(e=>({title:e.querySelector('h2').textContent,open:e.open,modal:e.matches(':modal'),text:e.innerText}))})");
  results.success = true;
  results.scope = "Real Electron/BrowserWindow/DOM/CDP keyboard+pointer/IPC/filesystem. Native folder/save/discard responses and one atomic rename failure are stubbed in isolated main only. Production app/core/DOM are real; user settings and clipboard are untouched. No external TECS compatibility claim.";
  await app.stop();
} catch(error) {
  results.error=error.stack??String(error);process.exitCode=1;
} finally {
  for(const child of processes)child.kill();
  await delay(150);
  const scrub=(value)=>typeof value==='string'?value.replaceAll(temp,'<isolated-temp>').replaceAll(repo,'<workspace>'):value;
  await writeFile(`${prefix}.json`,JSON.stringify({...results,logs:undefined},(_key,value)=>scrub(value),2));
  await writeFile(`${prefix}.log`,results.logs.map(({name,output})=>`=== ${name} ===\n${scrub(output)}`).join('\n'));
  console.log(JSON.stringify({success:results.success,checks:results.checks.length,error:results.error}));
}
