const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/quote_bridge/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const origin = 'https://ledger.example';
const href = origin + '/~/+/component/streamlit_app.ledger_quote_bridge/index.html';
const target = '../streamlit_app.ledger_assets/background.webp?v=1';
const frame = {addEventListener(){}};
const messages = [];
const listeners = {};
let image, appends = 0;
const ownerDocument = {
  getElementById:id=>image?.id===id?image:null,
  createElement:tag=>{assert.equal(tag,'img'); return {};},
  body:{append:node=>{image=node; appends++;}},
};
const parent = {postMessage:message=>messages.push(message)};
vm.runInNewContext(script, {
  URL,parent,document:{getElementById:()=>frame},
  window:{location:{href,origin},frameElement:{ownerDocument},
    addEventListener:(event,fn)=>listeners[event]=fn},
  requestAnimationFrame:()=>{throw Error('preload must not schedule ledger resizing');}
});
const render = (preloadBackground, source = parent) => listeners.message({
  source,data:{type:'streamlit:render',args:{preloadBackground}},
});
render(target,{});
render('https://other.example/not-our-image.webp');
assert.equal(image,undefined);
render(target);
render(target);
assert.equal(appends,1);
assert.equal(image.src,origin+'/~/+/component/streamlit_app.ledger_assets/background.webp?v=1');
assert.equal(image.hidden,true);
assert.equal(frame.hidden,true);
assert.equal(frame.srcdoc,undefined);
assert.equal(messages.at(-1).height,0);
assert.ok(messages.every(v=>v.type !== 'streamlit:setComponentValue'));
console.log('PASS: login loads one same-origin public image; no ledger iframe content or quote calls');
