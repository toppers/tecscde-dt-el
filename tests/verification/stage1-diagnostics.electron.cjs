// Run: node_modules/electron/dist/electron.exe tests/verification/stage1-diagnostics.electron.cjs
// Actual Chromium layout checks; the window stays hidden and no user settings or files are read.
const { app, BrowserWindow } = require("electron");
const { buildSync } = require("esbuild");
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join, basename } = require("node:path");
const assert = require("node:assert/strict");
const root = resolve(__dirname, "../..");
const fixture = mkdtempSync(join(tmpdir(), "tecscde-stage1-layout-"));
let window;

const renderer = `
import { AppShell } from "./src/renderer/app/shell";
import { AppStore } from "./src/renderer/app/store";
import { SelectionState } from "./src/renderer/render/view";
const store = new AppStore();
const shell = new AppShell({ root: document, store, win: window,
  gateway: { onRestoreFileBrowserRoot(cb) { if (location.hash === "#visible") cb("C:/verification/日本語のフォルダ/very-long-selected-directory-path/child"); }, async listDirectory() { return []; } }, tecsgen: {}, clipboard: {} });
shell.start();
window.fixture = { store, shell, SelectionState };
`;

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1, message + ": " + actual + " vs " + expected);
}

async function settled() {
  await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}

async function inspect() {
  return window.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('#diagnostics-panel');
    const scroll = document.querySelector('#canvas-scroll');
    const svg = document.querySelector('#canvas');
    const bounds = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom }; };
    return { panel: bounds(panel), viewport: bounds(scroll), canvas: bounds(svg), hidden: panel.hidden,
      panelClientHeight: panel.clientHeight, panelScrollHeight: panel.scrollHeight,
      rows: [...panel.querySelectorAll('.diag-item')].map(bounds),
      left:scroll.scrollLeft, top:scroll.scrollTop, zoom:fixture.store.view.zoom,
      preserved: fixture.store.getDocument() === window.beforeDocument && fixture.store.selection === window.beforeSelection &&
        fixture.store.history === window.beforeHistory && fixture.store.isDirty() === window.beforeDirty };
  })()`);
}

async function setDiagnostics(count, wrapped = false) {
  await window.webContents.executeJavaScript(`fixture.store.setEnvironmentDiagnostics(Array.from({length:${count}}, (_, i) => ({
    severity:'warning', code:'W-' + i, message:${wrapped ? "'long diagnostic '.repeat(60)" : "'warning ' + i"}
  })))`);
  await settled();
}

app.whenReady().then(async () => {
  buildSync({ stdin: { contents: renderer, resolveDir: root, sourcefile: "stage1-fixture.ts", loader: "ts" },
    bundle: true, outfile: join(fixture, "renderer.js"), platform: "browser", format: "esm",
    external: ["fs/promises", "module"], define: { __TECSCDE_APP_VERSION__: '"test"' } });
  writeFileSync(join(fixture, "index.html"), readFileSync(join(root, "src/renderer/index.html"), "utf8"));
  window = new BrowserWindow({ show: process.env.STAGE1_VISIBLE === "1", width: 1280, height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  await window.loadFile(join(fixture, "index.html"), process.env.STAGE1_VISIBLE === "1" ? { hash: "visible" } : {});
  await settled();
  for (const zoom of [1.5, 0.25]) {
    await setDiagnostics(0);
    await window.webContents.executeJavaScript(`(() => {
      fixture.store.setView(fixture.store.view.zoomAt({x:170,y:140}, ${zoom} / fixture.store.view.zoom).panTo({x:170,y:140}));
      fixture.store.setSelection(fixture.SelectionState.ofCells(['preserved-selection']));
      window.beforeDocument = fixture.store.getDocument(); window.beforeSelection = fixture.store.selection;
      window.beforeHistory = fixture.store.history; window.beforeDirty = fixture.store.isDirty();
    })()`);
    await settled();
    const initial = await inspect();
    await setDiagnostics(3);
    const three = await inspect();
    assert.equal(three.hidden, false);
    assert.ok(three.viewport.bottom <= three.panel.y + 0.5, "auto-open must not overlap canvas viewport");
    near(three.panelClientHeight, three.rows.reduce((sum, row) => sum + row.height, 0), "three rows fit content");
    near(initial.viewport.height - three.viewport.height, three.panel.height, "canvas shrinks by panel height");
    near(three.canvas.x, initial.canvas.x, "canvas x origin is stable");
    near(three.canvas.y, initial.canvas.y, "canvas y origin is stable");
    near(three.left, initial.left, "horizontal scroll is stable");
    near(three.top, initial.top, "vertical scroll is stable");
    assert.equal(three.zoom, initial.zoom);
    assert.equal(three.preserved, true);
    await window.webContents.executeJavaScript("document.querySelector('#status-diag').click()");
    await settled();
    const closed = await inspect();
    assert.equal(closed.hidden, true);
    near(closed.viewport.height, initial.viewport.height, "canvas height restores");
    near(closed.canvas.y, initial.canvas.y, "canvas y stays stable after closing");
    await setDiagnostics(12);
    const twelve = await inspect();
    near(twelve.panelClientHeight, twelve.rows.slice(0, 10).reduce((sum, row) => sum + row.height, 0), "12 diagnostics cap at ten rows");
    assert.ok(twelve.panelScrollHeight > twelve.panelClientHeight, "excess rows scroll within panel");
    assert.ok(twelve.viewport.height >= 120, "canvas keeps minimum height");
    assert.ok(twelve.viewport.bottom <= twelve.panel.y + 0.5, "large list must not overlap viewport");
    console.log(JSON.stringify({ zoom, initial, three, closed, twelve }));
  }
  await setDiagnostics(12, true);
  const wrapped = await inspect();
  const tenRows = wrapped.rows.slice(0, 10).reduce((sum, row) => sum + row.height, 0);
  assert.ok(wrapped.rows[0].height > 27, "long diagnostic wraps");
  assert.ok(wrapped.panelClientHeight <= tenRows + 1, "wrapped cap counts actual diagnostic rows");
  assert.ok(wrapped.viewport.height >= 120, "wrapped diagnostics preserve canvas minimum");
  console.log("PASS: Chromium diagnostics geometry, row cap, wrapping, scroll and state preservation");
  if (process.env.STAGE1_VISIBLE === "1") { await setDiagnostics(12); console.log("VISIBLE_READY"); await new Promise(resolve => window.once("closed", resolve)); }
}).then(() => { window?.destroy(); app.quit(); }).catch(error => {
  console.error(error); window?.destroy(); app.exit(1);
}).finally(() => {
  assert.equal(resolve(fixture, ".."), resolve(tmpdir()));
  assert.ok(basename(fixture).startsWith("tecscde-stage1-layout-"));
  rmSync(fixture, { recursive: true, force: true });
});
