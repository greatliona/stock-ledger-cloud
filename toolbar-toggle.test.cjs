const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/quote_bridge/index.html', 'utf8');
const fn = source.slice(source.indexOf('function installToolbarToggle('), source.indexOf('function clearHostTheme('));
const nodes = new Map(), root = new Map();
function element() {
  const attrs = new Map();
  return { events:{}, setAttribute:(k,v)=>attrs.set(k,v), getAttribute:k=>attrs.get(k),
    addEventListener(k,v){this.events[k]=v;}, focus(){this.focused=true;} };
}
const host = { querySelector(){}, getElementById:k=>nodes.get(k), createElement:element,
  head:{append(){}}, body:{append:n=>nodes.set(n.id,n)},
  documentElement:{toggleAttribute:(k,v)=>v?root.set(k,''):root.delete(k)} };
const ctx = vm.createContext({host});
vm.runInContext(fn + ';installToolbarToggle(host);',ctx);
const button = nodes.get('ledger-toolbar-toggle');
assert.equal(button.getAttribute('aria-expanded'),'false');
button.events.click();
assert.equal(root.has('data-ledger-toolbar-open'),true);
assert.equal(button.getAttribute('aria-expanded'),'true');
vm.runInContext('installToolbarToggle(host)',ctx);
assert.equal(nodes.get('ledger-toolbar-toggle'),button);
assert.equal(button.getAttribute('aria-expanded'),'true');
button.events.keydown({key:'Escape'});
assert.equal(button.getAttribute('aria-expanded'),'false');
button.events.click(); button.events.click();
assert.equal(root.size,0);
assert.match(fs.readFileSync(__dirname+'/streamlit_app.py','utf8'),/html:not\(\[data-ledger-toolbar-open\]\) \[data-testid="stHeader"\]/);
console.log('PASS: default hidden, expand/collapse, Escape, persistent single toggle, early hide CSS');
