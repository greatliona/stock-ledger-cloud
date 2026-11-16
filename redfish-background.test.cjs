const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/quote_bridge/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function events(extra = {}) {
  const listeners = new Map();
  return Object.assign({listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); }
  }, extra);
}
const values = new Map();
const style = {getPropertyValue: key => values.get(key), setProperty: (key, value) => values.set(key, value)};
const body = {scrollHeight:6000, getBoundingClientRect:()=>({height:6000})};
const frame = events({clientTop:0, style:{}, getBoundingClientRect:()=>({top:0}),
  contentDocument:{documentElement:{style}, body}, contentWindow:{postMessage(){}}});
const top = events({innerHeight:900, visualViewport:events({height:900, offsetTop:0})});
top.parent = top;
let componentTop = 120;
const app = events({innerHeight:900, parent:top,
  frameElement:{clientTop:0, getBoundingClientRect:()=>({top:0})}});
const bridge = events({innerHeight:6000, parent:app,
  frameElement:{clientTop:0, getBoundingClientRect:()=>({top:componentTop})}});
let messages = 0;
app.postMessage = () => messages++;
const scheduled = [];
const scope = {window:bridge, parent:app, document:{getElementById:()=>frame},
  requestAnimationFrame:fn=>(scheduled.push(fn),scheduled.length), cancelAnimationFrame(){}};
vm.createContext(scope);
vm.runInContext(script, scope);
const run = code => vm.runInContext(code, scope);
run('syncBackground()');
assert.equal(values.get('--redfish-viewport-height'),'900px');
assert.equal(values.get('--redfish-viewport-top'),'-120px');
assert.equal(body.scrollHeight,6000);
assert.equal(app.listeners.get('scroll').size,1);
assert.equal(top.listeners.get('scroll').size,1);
// The foreground moves 2,000px, but background top in the host stays exactly zero.
componentTop = -1880;
for (const fn of app.listeners.get('scroll')) fn();
scheduled.splice(0).forEach(fn=>fn());
assert.equal(values.get('--redfish-viewport-top'),'1880px');
assert.equal(componentTop + parseFloat(values.get('--redfish-viewport-top')),0);
assert.equal(body.scrollHeight,6000);
run('syncBackground(); syncBackground()');
assert.equal(app.listeners.get('scroll').size,1, 'no duplicate host listeners');
top.visualViewport.height=640;
top.visualViewport.offsetTop=20;
run('syncBackground()');
assert.equal(values.get('--redfish-viewport-height'),'640px');
assert.equal(componentTop + parseFloat(values.get('--redfish-viewport-top')),20);
assert.equal(messages,2,'background updates never send quote or ledger changes');
for (const fn of bridge.listeners.get('pagehide')) fn();
assert.equal(top.listeners.get('scroll').size,0,'remove ancestor listeners on unload');
// Cross-origin boundaries cannot throw or prevent the ledger from loading.
Object.defineProperty(app,'frameElement',{get(){throw new Error('cross-origin');}});
run('syncBackground()');
assert.equal(values.get('--redfish-viewport-height'),'900px');
const css=fs.readFileSync(__dirname+'/styles.css','utf8');
const background=css.match(/:root\[data-theme="redfish"\] body::before\s*\{([^}]+)\}/)[1];
assert.match(background,/position: fixed/);
assert.match(background,/background-repeat: no-repeat/);
assert.match(background,/background-size: contain/);
assert.match(background,/pointer-events: none/);
assert.match(background,/assets\/background\.png/);
assert.doesNotMatch(background,/base64|repeat-y|100% auto/);
assert.match(css,/--panel: rgba\(255, 252, 244, 0\.48\)/);
assert.match(css,/textarea \{ background: rgba\(255, 253, 247, 0\.34\)/);
console.log('PASS: single fixed fish; outer scroll/resize/visual viewport; no height or data mutation; cleanup; transparent fields');
