// Visible integration fixture: real temporary CDL files, production renderer actions.
const { app, BrowserWindow, ipcMain } = require('electron');
const { buildSync } = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tecscde-stage1-sources-'));
app.setPath('userData', path.join(dir, 'profile'));
const files = {
  'main.cdl': 'celltype tMain { attr { int count; }; }; cell tMain Main { count = 1; };',
  'ref.cdl': '// reference original\r\ncelltype tRef { attr { int count; }; };\r\ncell tRef Ref { count = 1; };\r\n',
  'extra.cdl': 'import("nested.cdl"); celltype tExtra { attr { int count; }; }; cell tExtra Extra { count = 1; };',
  'nested.cdl': 'celltype tNested { attr { int count; }; }; cell tNested Nested { count = 1; };',
};
for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
const normalized = p => p.replaceAll('\\', '/');
const base = normalized(dir);
ipcMain.handle('fixture', async (_, operation, args) => {
  if (operation === 'wasm') return [...fs.readFileSync(path.join(root, 'public/wasm', args[0]))];
  const checked = p => { const resolved = path.resolve(p); assert.equal(path.dirname(resolved), dir); return resolved; };
  if (operation === 'read') return fs.readFileSync(checked(args[0]), 'utf8');
  if (operation === 'write') { fs.writeFileSync(checked(args[0]), args[1]); return; }
  if (operation === 'resolve') return args[1].map(request => {
    const candidate = path.isAbsolute(request.specifier) ? request.specifier : path.join(path.dirname(args[0]), request.specifier);
    try { return { request, canonicalPath: normalized(checked(candidate)), content: fs.readFileSync(candidate, 'utf8') }; }
    catch { return { request, error: 'not-found' }; }
  });
});
fs.writeFileSync(path.join(dir, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixtureIo',{call:(op,...args)=>ipcRenderer.invoke('fixture',op,args)});`);
const renderer = `
import { AppShell } from './src/renderer/app/shell';
import { AppStore } from './src/renderer/app/store';
import { CdlGrammar } from './src/renderer/cdl/grammar';
import { applyOpenResult, addAsReference } from './src/renderer/app/file-actions';
import { EditAttrCommand } from './src/renderer/commands/cell-commands';
import { CdlSerializer } from './src/renderer/cdl/serializer';
const base=${JSON.stringify(base)};
const io=window.fixtureIo.call;
await CdlGrammar.init({ runtimeWasm:new Uint8Array(await io('wasm','tree-sitter.wasm')), cdlWasm:new Uint8Array(await io('wasm','tree-sitter-cdl.wasm')) });
const store = new AppStore();
const gateway = { onRestoreFileBrowserRoot(){}, async confirmDiscardChanges(){return true;}, async saveSession(){},
  resolveImports:(source,requests)=>io('resolve',source,requests), save:(p,body)=>io('write',p,body) };
const shell = new AppShell({root:document,store,win:window,gateway,tecsgen:{},clipboard:{}}); shell.start();
await applyOpenResult(store,gateway,{}, {editable:{path:base+'/main.cdl',content:await io('read',base+'/main.cdl')},references:[{path:base+'/ref.cdl',content:await io('read',base+'/ref.cdl')}]});
store.dispatch(new EditAttrCommand('Ref','count','42'));
const body=CdlSerializer.serializeSource(store.getDocument(),base+'/ref.cdl');
window.sourceFixture={store,body,base, async add(){await addAsReference(store,gateway,{},base+'/extra.cdl');}, async saveReference(){await gateway.save(base+'/ref.cdl',CdlSerializer.serializeSource(store.getDocument(),base+'/ref.cdl'));},
 snapshot(){return {primary:store.filePath,cells:store.getDocument().cellValues().map(c=>c.name),value:store.getDocument().getCell('Ref')?.attrs.count,dirty:store.isSourceDirty(base+'/ref.cdl'),body:CdlSerializer.serializeSource(store.getDocument(),base+'/ref.cdl'),references:store.getReferenceFilePaths()};}};
document.title='Stage1 sources — unsaved Ref count=42';
window.SOURCE_READY=true;
`;
let win;
async function screenshot(name) {
  await win.webContents.executeJavaScript('document.querySelector("#canvas-scroll").scrollTo(0,0); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(__dirname,name),(await win.webContents.capturePage()).toPNG());
}
app.whenReady().then(async () => {
  buildSync({stdin:{contents:renderer,resolveDir:root,loader:'ts'},bundle:true,outfile:path.join(dir,'renderer.js'),platform:'browser',format:'esm',external:['fs/promises','module'],define:{__TECSCDE_APP_VERSION__:'"verification"'}});
  fs.writeFileSync(path.join(dir,'index.html'),fs.readFileSync(path.join(root,'src/renderer/index.html')));
  win=new BrowserWindow({show:true,width:1280,height:900,webPreferences:{preload:path.join(dir,'preload.cjs'),contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on('console-message',(_,level,message)=>console.log('renderer:',message));
  await win.loadFile(path.join(dir,'index.html'));
  for(let i=0;i<100;i++){if(await win.webContents.executeJavaScript('window.SOURCE_READY === true')) break; await new Promise(r=>setTimeout(r,100));}
  assert.equal(await win.webContents.executeJavaScript('window.SOURCE_READY'),true);
  console.log('SOURCE_READY', JSON.stringify(await win.webContents.executeJavaScript('sourceFixture.snapshot()')));
  await screenshot('stage1-sources-before.png');
  // Use the actual AppShell button handler; no destructive user files are involved.
  await win.webContents.executeJavaScript('document.querySelector("[data-action=clear]").click()');
  while(await win.webContents.executeJavaScript('sourceFixture.store.filePath !== null')) await new Promise(r=>setTimeout(r,200));
  const cleared=await win.webContents.executeJavaScript('sourceFixture.snapshot()');
  assert.deepEqual(cleared.cells,['Ref']); assert.equal(cleared.value,'42'); assert.equal(cleared.dirty,true);
  assert.equal(cleared.body,await win.webContents.executeJavaScript('sourceFixture.body'));
  console.log('CLEAR_PASS',JSON.stringify(cleared));
  await screenshot('stage1-sources-cleared.png');
  await win.webContents.executeJavaScript('sourceFixture.add()');
  const added=await win.webContents.executeJavaScript('sourceFixture.snapshot()');
  assert.equal(added.primary,null); assert.equal(added.value,'42'); assert.equal(added.dirty,true);
  assert.deepEqual([...added.cells].sort(),['Extra','Nested','Ref']);
  assert.equal(added.body,cleared.body); assert.equal(added.references.length,3);
  await win.webContents.executeJavaScript('sourceFixture.saveReference()');
  assert.equal(fs.readFileSync(path.join(dir,'ref.cdl'),'utf8'),cleared.body);
  assert.equal(fs.readFileSync(path.join(dir,'main.cdl'),'utf8'),files['main.cdl']);
  console.log('PASS: visible clear retains unsaved reference, null-primary recursive reference addition and real reference write');
  console.log('TEMP_EVIDENCE_DIRECTORY',dir);
  await screenshot('stage1-sources-added.png');
  win.destroy();
}).then(()=>app.quit()).catch(error=>{console.error(error);win?.destroy();app.exit(1);});
