const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const origin = 'https://ledger.example';
const href = origin + '/~/+/component/streamlit_app.ledger_quote_bridge/index.html';
const target = '../streamlit_app.ledger_assets/background.webp?v=1';
const url = new URL(target, href).href;
const script = fs.readFileSync(__dirname+'/quote_bridge/index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const flush = () => new Promise(resolve=>setImmediate(resolve));

function createHost() {
  let resolve, reject, imageCount = 0;
  const nodes = new Map(), timer = new Map();
  const decode = new Promise((yes,no)=>{resolve=yes; reject=no;});
  const append = node => nodes.set(node.id,node);
  const host = {
    documentElement:{dataset:{}}, head:{append}, body:{append},
    getElementById:id=>nodes.get(id),
    createElement:tag=>tag==='img' ? (imageCount++,{dataset:{},addEventListener(){},decode:()=>decode})
      : {sheet:{cssRules:[{style:{setProperty(){}}}]}},
  };
  function bridge(savedTheme) {
    const messages = [], handlers = {};
    const parent = {postMessage:message=>messages.push(message)};
    const root = {dataset:{theme:savedTheme},removeAttribute(){},setAttribute(){}};
    const frame = {addEventListener(){},contentDocument:{documentElement:root,body:{}},
      contentWindow:{getComputedStyle:(_,pseudo)=>pseudo?{backgroundImage:`url("${url}")`}
        :{getPropertyValue:()=>''}}};
    const scope = vm.createContext({
      URL,parent,document:{getElementById:()=>frame},
      window:{location:{href,origin},frameElement:{ownerDocument:host,closest:()=>true},
        localStorage:{getItem:()=>savedTheme},addEventListener:(event,fn)=>handlers[event]=fn},
      setTimeout:(fn,ms)=>{assert.equal(ms,5000);timer.set(1,fn);return 1;},
      clearTimeout:id=>timer.delete(id),
      requestAnimationFrame:()=>{throw Error('preload must not schedule ledger resizing');}
    });
    vm.runInContext(script,scope);
    const render = (preloadBackground,source=parent) => handlers.message({
      source,data:{type:'streamlit:render',args:{preloadBackground,themeStorageKey:'theme'}},
    });
    return {render, messages,handlers,frame,sync:()=>vm.runInContext('syncHostTheme()',scope),
      ready:()=>messages.filter(m=>m.type==='streamlit:setComponentValue'&&m.value===true).length};
  }
  return {host, nodes, timer, bridge, resolve,reject,imageCount:()=>imageCount};
}

(async()=>{
  const fixture = createHost();
  const login = fixture.bridge('redfish');
  login.render(target,{});
  assert.equal(fixture.imageCount(),0);
  login.render(target);
  login.render(target);
  const image = fixture.nodes.get('ledger-background-preload-image');
  assert.equal(fixture.imageCount(),1);
  assert.equal(image.src,url);
  assert.equal(login.frame.hidden,true);
  assert.equal(login.frame.srcdoc,undefined,'never mount ledger HTML while locked');
  assert.equal(login.messages.at(-1).height,0);
  assert.equal(login.ready(),0,'keep input disabled while redfish is decoding');
  fixture.resolve();
  await flush();
  assert.equal(image.dataset.ready,'');
  assert.equal(login.ready(),1);
  login.handlers.pagehide();
  assert.equal(fixture.host.documentElement.dataset.stockLedgerTheme,'redfish',
    'removing the password component must not reset the background');
  fixture.bridge('redfish').sync();
  assert.equal(fixture.nodes.get(image.id),image,'logged-in theme reuses the same image element');
  assert.equal(fixture.imageCount(),1);
  const failed = createHost();
  const failedLogin = failed.bridge('redfish');
  failedLogin.render(target);
  failed.reject(Error('missing'));
  await flush();
  assert.equal(failedLogin.ready(),1);
  const stalled = createHost();
  const stalledLogin = stalled.bridge('redfish');
  stalledLogin.render(target);
  stalled.timer.get(1)();
  await flush();
  assert.equal(stalledLogin.ready(),1);
  const dark = createHost();
  const darkLogin = dark.bridge('dark');
  darkLogin.render(target);
  await flush();
  assert.equal(darkLogin.ready(),1,'non-redfish themes do not wait for the image');
  const external = createHost();
  const externalLogin = external.bridge('redfish');
  externalLogin.render('https://other.example/not-our-image.webp');
  await flush();
  assert.equal(external.imageCount(),0);
  console.log('PASS: login holds for decode, transfers the same attached image, and allows login if missing or stalled');
})().catch(error=>{console.error(error);process.exitCode=1;});
