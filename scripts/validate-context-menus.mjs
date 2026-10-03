import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.LUMISEQ_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const browserErrors = [];
page.on('pageerror', error => browserErrors.push(error.message));
try {
  await page.goto(process.env.LUMISEQ_VITE_URL || 'http://127.0.0.1:5173');
  await page.evaluate(async () => {
    const ReactModule = await import('/node_modules/.vite/deps/react.js');
    const React = ReactModule.default ?? ReactModule;
    const RootModule = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { createRoot } = RootModule.default ?? RootModule;
    const { useContextMenu } = await import('/src/ui/shared/ContextMenu.tsx');
    document.body.innerHTML = '<div id="test-root"></div>';
    window.menuWrites = 0;
    function Harness() {
      const menu = useContextMenu('test');
      const items = [
        { id: 'disabled', label: 'Disabled', disabled: true, reason: 'Locked', run: () => window.menuWrites++ },
        { id: 'one', label: 'First', run: () => window.menuWrites++ },
        { id: 'child', label: 'Submenu', children: [{id:'nested',label:'Nested',run:()=>window.menuWrites++}] },
        { id: 'many-children', label: 'Long submenu', children: Array.from({length:8},(_,i)=>({id:`group-${i}`,label:`Group ${i}`,run:()=>window.menuWrites++})) },
        { id: 'few-children', label: 'Short submenu', children: [{id:'short-first',label:'Short first',run:()=>window.menuWrites++},{id:'short-second',label:'Short second',run:()=>window.menuWrites++}] },
        ...Array.from({length:30},(_,i)=>({id:`long-${i}`,label:`Long row ${i}`,run:()=>window.menuWrites++})),
      ];
      return React.createElement('button',{id:'trigger',style:{position:'fixed',left:750,top:550},onContextMenu:e=>menu.open(e,items),onKeyDown:e=>menu.key(e,()=>items)},'Open',menu.node);
    }
    window.testRoot = createRoot(document.getElementById('test-root'));
    window.testRoot.render(React.createElement(Harness));
  });
  await page.locator('#trigger').focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menu').waitFor();
  if (await page.evaluate(()=>document.activeElement.textContent) !== 'First') throw new Error('First enabled item did not get focus');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.getByRole('menuitem',{name:'Nested'}).waitFor();
  if (await page.evaluate(()=>document.activeElement.textContent) !== 'Nested') throw new Error('Submenu did not get keyboard focus');
  await page.keyboard.press('ArrowLeft');
  if (await page.evaluate(()=>document.activeElement.textContent) !== 'Submenu') throw new Error('Submenu back did not restore parent focus');
  await page.keyboard.press('Escape');
  if (await page.evaluate(()=>document.activeElement.id) !== 'trigger') throw new Error('Escape did not restore trigger focus');
  await page.locator('#trigger').click({button:'right'});
  await page.getByRole('menu').waitFor();
  await page.waitForTimeout(150);
  const box = await page.getByRole('menu').boundingBox();
  if (box.x < 5 || box.y < 5 || box.x+box.width > 795 || box.y+box.height > 595) throw new Error('Menu exceeded viewport '+JSON.stringify(box));
  await page.getByRole('menuitem',{name:'Disabled Locked'}).click({force:true});
  if (await page.evaluate(()=>window.menuWrites) !== 0) throw new Error('Disabled item executed');
  await page.getByRole('menuitem',{name:'First',exact:true}).click();
  if (await page.evaluate(()=>window.menuWrites) !== 1) throw new Error('Enabled action did not execute');
  await page.locator('#trigger').click({button:'right'});
  await page.mouse.click(10,10);
  if (await page.getByRole('menu').count()) throw new Error('Outside click did not close');
  console.log('PASS: menu keyboard, submenu, focus restoration, viewport clamp, disabled commands and outside click');
  await page.locator('#trigger').click({button:'right'});
  await page.getByRole('menuitem',{name:'Long submenu',exact:true}).dispatchEvent('pointerover',{pointerType:'mouse'});
  await page.getByRole('menuitem',{name:'Group 0',exact:true}).waitFor();
  await page.keyboard.press('End');
  if (await page.evaluate(()=>document.activeElement.textContent) !== 'Group 7') throw new Error('Long submenu did not focus its final item');
  await page.getByRole('menuitem',{name:'Short submenu',exact:true}).dispatchEvent('pointerover',{pointerType:'mouse'});
  const shortMenu = page.getByRole('menu',{name:'Short submenu',exact:true});
  await shortMenu.waitFor();
  await shortMenu.dispatchEvent('keydown',{key:'ArrowRight',bubbles:true});
  if (await page.evaluate(()=>document.activeElement.textContent) !== 'Short first') throw new Error('Switching submenu retained stale focus: '+JSON.stringify(browserErrors));
  await page.keyboard.press('Enter');
  if (await page.evaluate(()=>window.menuWrites) !== 2) throw new Error('Enter did not execute the new submenu action exactly once');
  if (await page.getByRole('menu').count()) throw new Error('New submenu action did not close its menu');
  if (browserErrors.length) throw new Error('Submenu keyboard errors: '+JSON.stringify(browserErrors));
  console.log('PASS: switching differently sized submenus resets focus and safely handles ArrowRight/Enter');
  await page.evaluate(async () => {
    const {default: React} = await import('/node_modules/.vite/deps/react.js');
    const {ScrubbableInput} = await import('/src/ui/shared/ScrubbableInput.tsx');
    const {CurveEditor} = await import('/src/ui/workspaces/develop/CurveEditor.tsx');
    const {PARAM_DEFINITIONS} = await import('/src/ui/shared/parameterDefinitions.ts');
    window.parameterChanges = [];
    window.curveChanges = [];
    const identity = [{x:0,y:0},{x:.5,y:.5},{x:1,y:1}];
    const curves = {rgb:identity,red:identity,green:identity,blue:identity};
    function Controls() {
      const [value,setValue] = React.useState(23);
      const [curve,setCurve] = React.useState(curves);
      return React.createElement('div',{style:{width:300}},
        React.createElement(ScrubbableInput,{param:PARAM_DEFINITIONS.clarity,value,onStartDrag:()=>window.parameterChanges.push('start'),onPreviewDrag:v=>{setValue(v);window.parameterChanges.push(v)},onCommitDrag:()=>window.parameterChanges.push('commit')}),
        React.createElement(CurveEditor,{curves:curve,width:274,height:190,onChangeCurves:v=>{setCurve(v);window.curveChanges.push(v)}}));
    }
    window.testRoot.render(React.createElement(Controls));
  });
  await page.locator('.scrubbable-label').click({button:'right'});
  if (await page.evaluate(()=>window.parameterChanges.length)) throw new Error('Label right click began a transaction');
  await page.getByRole('menuitem',{name:'重置此参数'}).click();
  if (JSON.stringify(await page.evaluate(()=>window.parameterChanges)) !== JSON.stringify(['start',0,'commit'])) throw new Error('Reset did not commit exactly one transaction');
  await page.locator('input[type=range]').click({button:'right'});
  if ((await page.evaluate(()=>window.parameterChanges.length)) !== 3) throw new Error('Range right click began a transaction');
  await page.keyboard.press('Escape');
  await page.locator('.scrubbable-value').click();
  await page.locator('input[type=text]').dispatchEvent('contextmenu');
  if (await page.getByRole('menu').count()) throw new Error('Text editing native context menu intercepted');
  await page.keyboard.press('Escape');
  const curveCanvas = page.locator('.curve-editor canvas');
  const curveBox = await curveCanvas.boundingBox();
  await page.mouse.click(curveBox.x+curveBox.width/2,curveBox.y+curveBox.height/2,{button:'right'});
  if (await page.evaluate(()=>window.curveChanges.length)) throw new Error('Curve right click deleted a point');
  await page.getByRole('menuitem',{name:'删除控制点'}).click();
  if ((await page.evaluate(()=>window.curveChanges.at(-1).rgb.length)) !== 2) throw new Error('Curve menu deletion failed');
  await page.mouse.click(curveBox.x+12,curveBox.y+curveBox.height-12,{button:'right'});
  if (!(await page.getByRole('menuitem',{name:'删除控制点'}).getAttribute('aria-disabled'))) throw new Error('Curve endpoint deletion not disabled');
  await page.keyboard.press('Escape');
  console.log('PASS: parameter right clicks, one reset transaction, native text menus, curve point deletion and endpoint protection');
  await page.evaluate(async () => {
    const {default:React} = await import('/node_modules/.vite/deps/react.js');
    const {LayersPanel} = await import('/src/ui/workspaces/edit/LayersPanel.tsx');
    const {createEditDocument,createTextLayer,createGroupLayer} = await import('/src/document/EditDocument.ts');
    const {defaultDocumentManager} = await import('/src/document/DocumentManager.ts');
    const {useEditStore} = await import('/src/stores/useEditStore.ts');
    const selected = createTextLayer({id:'selected',text:'Selected',name:'Selected'});
    const target = createTextLayer({id:'target',text:'Target',name:'Target'});
    const child = createTextLayer({id:'child',text:'Child',name:'Child'});
    const group = {...createGroupLayer({id:'group',name:'Locked group',children:[child]}),locked:true};
    const doc = createEditDocument({id:'context-browser-edit',layers:[selected,target,group]});
    defaultDocumentManager.openDocument(doc);
    useEditStore.getState().selectLayer(selected.id);
    window.editStore = useEditStore;
    window.editDocuments = defaultDocumentManager;
    window.testRoot.render(React.createElement(LayersPanel,{document:doc,selectedLayer:selected,selectedLayerId:selected.id,newTextPrompt:'',onChangeNewTextPrompt:()=>{},onAddImageLayer:()=>{},onShowProperties:()=>{}}));
  });
  await page.getByRole('treeitem',{name:'图层 Target（文字）'}).click({button:'right'});
  if ((await page.evaluate(()=>window.editStore.getState().selectedLayerId)) !== 'selected') throw new Error('Right click changed layer selection');
  await page.keyboard.press('Escape');
  await page.getByRole('treeitem',{name:'图层 Child（文字）'}).click({button:'right'});
  if (!(await page.getByRole('menuitem',{name:'删除图层'}).getAttribute('aria-disabled'))) throw new Error('Inherited locked delete not disabled');
  await page.keyboard.press('Escape');
  await page.getByRole('treeitem',{name:'图层 Target（文字）'}).click({button:'right'});
  await page.evaluate(()=>window.editDocuments.closeDocument('context-browser-edit'));
  if (await page.getByRole('menu').count()) throw new Error('Document close did not dismiss menu');
  console.log('PASS: layer context target preserves selection, inherited lock disables delete, document close dismisses menu');
} finally { await browser.close(); }
