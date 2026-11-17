const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/quote_bridge/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const handlers = new Map();
const hostAttrs = new Map(), ledgerAttrs = new Set(), styles = new Set();
const cssValues = {};
const root = {dataset:{theme:'redfish'},
  setAttribute:name=>ledgerAttrs.add(name), removeAttribute:name=>ledgerAttrs.delete(name)};
const image = 'url("https://ledger.example/~/+/component/streamlit_app.ledger_assets/background.webp?v=1")';
const host = {
  defaultView:{CSS:{supports:()=>true}},
  head:{append:style=>styles.add(style)},
  createElement:()=>({
    sheet:{cssRules:[{style:{setProperty:(key,value)=>cssValues[key]=value}}]},
    get isConnected(){return styles.has(this);},
    remove(){styles.delete(this);}
  })
};
const embedding = {ownerDocument:host, closest: selector=>selector === '.stApp',
  setAttribute:(name,value)=>hostAttrs.set(name,value), removeAttribute:name=>hostAttrs.delete(name)};
const palettes = {
  redfish: {'--bg':'#f4eddd','--ink':'#30261f'},
  dark: {'--bg':'#141a20','--ink':'#e8edf0'},
  light: {'--bg':'#f6f7f4','--ink':'#17211c'},
};
const frame = {contentDocument:{documentElement:root, body:{}}, contentWindow:{
  getComputedStyle:(element, pseudo)=>{
    if (element === root) return {getPropertyValue:key=>palettes[root.dataset.theme][key]};
    assert.equal(element,frame.contentDocument.body);
    assert.equal(pseudo,'::before');
    return {backgroundImage:image};
  }
}, addEventListener(){}};
let onTheme, disconnected = 0;
const messages = [];
const window = {frameElement:embedding, addEventListener:(name,fn)=>handlers.set(name,fn)};
vm.runInNewContext(script, {window, document:{getElementById:()=>frame},
  parent:{postMessage:m=>messages.push(m)},
  MutationObserver:class {
    constructor(fn){onTheme=fn;}
    observe(target, options){
      assert.equal(target,root);
      assert.equal(options.attributeFilter.join(','),'data-theme');
    }
    disconnect(){disconnected++;}
  }});
handlers.get('pageshow')();
assert.equal(styles.size,1);
assert.equal(cssValues['--ledger-fish-image'],image, 'absolute asset URL preserves Cloud prefix');
const [sheet] = styles;
assert.match(sheet.textContent,/position: fixed; inset: 0; height: 100svh/);
assert.match(sheet.textContent,/background-repeat: no-repeat/);
assert.match(sheet.textContent,/background: var\(--ledger-host-bg\) !important/);
assert.match(sheet.textContent,/iframe\[data-ledger-theme="redfish"\]\)::before/);
assert.match(sheet.textContent,/stAppViewContainer/);
assert.equal(cssValues['--ledger-host-bg'],'#f4eddd');
assert.equal(hostAttrs.get('data-ledger-theme'),'redfish');
assert.equal(ledgerAttrs.has('data-host-wallpaper'),true);
assert.doesNotMatch(script,/addEventListener\(["'](?:scroll|wheel)|getBoundingClientRect\(\)\.top|--redfish-viewport/);
onTheme();
assert.equal(styles.size,1, 'theme observation does not duplicate the layer');
for (const theme of ['dark','light']) {
  root.dataset.theme=theme;
  onTheme();
  assert.deepEqual([...styles],[sheet]);
  assert.equal(hostAttrs.get('data-ledger-theme'),theme);
  assert.equal(ledgerAttrs.size,0);
  assert.equal(cssValues['--ledger-fish-image'],'none');
  assert.equal(cssValues['--ledger-host-bg'],palettes[theme]['--bg']);
  assert.equal(cssValues['--ledger-host-ink'],palettes[theme]['--ink']);
}
root.dataset.theme='redfish';
onTheme();
assert.equal(styles.size,1);
handlers.get('pagehide')();
assert.equal(disconnected,1);
assert.equal(styles.size,0);
assert.equal(hostAttrs.size + ledgerAttrs.size,0);
Object.defineProperty(window,'frameElement',{get(){throw new Error('cross-origin');}});
handlers.get('pageshow')();
assert.equal(styles.size,0);
assert.equal(ledgerAttrs.has('data-host-wallpaper'),false, 'unavailable host keeps local fallback');
assert.equal(messages.length,2, 'wallpaper never sends quote or ledger changes');

const css=fs.readFileSync(__dirname+'/styles.css','utf8');
const background=css.match(/:root\[data-theme="redfish"\] body::before\s*\{([^}]+)\}/)[1];
assert.match(background,/position: fixed/);
assert.match(background,/background-repeat: no-repeat/);
assert.match(background,/background-size: contain/);
assert.match(background,/assets\/background\.png/);
assert.match(css,/\[data-host-wallpaper\] body::before \{ content: none; \}/);
assert.match(css,/--panel: rgba\(255, 252, 244, 0\.48\)/);
console.log('PASS: matching outer background for all themes, fixed redfish only, cleanup and standalone fallback');
