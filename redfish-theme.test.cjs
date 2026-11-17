// The preview contains only synthetic data and never connects to a cloud ledger.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
for (const stored of ['dark', 'light', 'redfish', 'invalid', null]) {
  const data = new Map([['stock-ledger-theme', stored], ['stock-ledger-v1', 'unchanged']]);
  const handlers = {};
  const select = {value:'',addEventListener:(event,fn)=>handlers[event]=fn};
  const scope = {
    document:{documentElement:{dataset:{}},getElementById:()=>select,addEventListener:(event,fn)=>handlers[event]=fn},
    localStorage:{getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)},
  };
  vm.createContext(scope);
  vm.runInContext(source.slice(0,source.indexOf('const CLOUD_CONFIG')),scope);
  handlers.DOMContentLoaded();
  assert.equal(select.value,['dark','light','redfish'].includes(stored)?stored:'dark');
  for (const theme of ['redfish','dark','light']) {
    handlers.change({target:{value:theme}});
    assert.equal(scope.document.documentElement.dataset.theme,theme);
    assert.equal(data.get('stock-ledger-theme'),theme);
    assert.equal(data.get('stock-ledger-v1'),'unchanged');
  }
}
const scope={document:{documentElement:{dataset:{theme:'redfish'}}},assetChartColors:{cashFill:'#fee2e2',stockFill:'#ffedd5',cryptoFill:'#fff2b8',fundFill:'#dcfce7',usStockFill:'#bfdbfe'}};
vm.createContext(scope);
vm.runInContext(source.match(/^function \w+\([^]*?^}/gm).join('\n'),scope);
for (const color of Object.values(scope.assetChartColors)) assert.match(scope.assetChartAreaColor(color),/^rgba\(/);
assert.equal(scope.pieThemeColor('#abcd12'),'#abcd12b8');
scope.document.documentElement.dataset.theme='dark';
assert.equal(scope.pieThemeColor('#abcd12'),'#abcd12');
console.log('PASS: themes select/persist without altering ledger; translucent redfish charts');

if(process.argv.includes('--serve')) {
  const http=require('node:http');
  const sample={holdings:[{id:'t1',symbol:'2330.TW',name:'台積電',shares:1000,avgCost:850,currentPrice:920,side:'long'}],
    usHoldings:[{id:'u1',symbol:'VOO',shares:10,avgCost:500,currentPrice:530,side:'long'}],
    funds:[{id:'f1',name:'測試基金',cost:100000,currentValue:125000}],
    cryptoContracts:[{id:'c1',name:'BTCUSDT',side:'long',leverage:4,marginUsdt:1000,quantity:.05,entryPrice:80000,currentPrice:84000}],
    cash:120000,cryptoCashUsdt:500,usdTwdRate:32,usCashUsd:0,tradeHistory:[],
    history:Array.from({length:12},(_,i)=>({date:`2026-11-${String(i+1).padStart(2,'0')}`,stockTotal:800000+i*9000,usStockTotal:160000,fundTotal:110000+i*1000,cryptoTotal:45000+i*700,cash:120000,cashRecorded:true}))};
  let page=execFileSync('python3',['redfish_page_test.py','--html'],{cwd:__dirname,maxBuffer:5*1024*1024}).toString();
  page=page.replace('<head>', '<head><base href="/component/streamlit_app.ledger_quote_bridge/index.html">');
  page=page.replaceAll('stock-ledger-v1','redfish-preview-ledger').replaceAll('stock-ledger-theme','redfish-preview-theme');
  page=page.replace('<body>',`<body><script>localStorage.setItem('redfish-preview-ledger',${JSON.stringify(JSON.stringify(sample))});</script><p style="margin:0;padding:8px;text-align:center;background:#fff6d9;color:#422">隔離外觀預覽・僅測試資料</p>`);
  const bridge=fs.readFileSync(__dirname+'/quote_bridge/index.html','utf8');
  const embedded='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{display:block;width:100%;border:0;height:1px}</style><iframe id="outer" src="/bridge"></iframe><script>const f=document.getElementById("outer");addEventListener("message",e=>{if(e.source!==f.contentWindow)return;if(e.data.type==="streamlit:setFrameHeight")f.style.height=e.data.height+"px";if(e.data.type==="streamlit:componentReady")f.contentWindow.postMessage({type:"streamlit:render",args:{html:'+JSON.stringify(page).replace(/</g,'\\u003c')+'}},"*")});</script>';
  http.createServer((req,res)=>{
    if(req.url.startsWith('/component/streamlit_app.ledger_assets/background.webp')){res.writeHead(200,{'Content-Type':'image/webp'});return res.end(fs.readFileSync(__dirname+'/assets/background.webp'));}
    const routes={'/':page,'/missing':page.replaceAll('../streamlit_app.ledger_assets/background.webp','/missing-background.webp'),'/embedded':embedded,'/bridge':bridge};
    const body=routes[req.url];
    res.writeHead(body?200:404,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'"});
    res.end(body||'Not found');
  }).listen(8897,'127.0.0.1',()=>console.log('Isolated preview: http://127.0.0.1:8897/'));
}
