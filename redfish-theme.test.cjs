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
    funds:[{id:'f1',name:'測試基金',cost:100000,currentValue:125000},{id:'f2',name:'虧損測試基金',cost:50000,currentValue:48000}],
    cryptoContracts:[{id:'c1',name:'BTCUSDT',side:'long',leverage:4,marginUsdt:1000,quantity:.05,entryPrice:80000,currentPrice:84000},
      {id:'c2',name:'ETHUSDT',side:'short',leverage:4,marginUsdt:1000,quantity:1,entryPrice:2000,currentPrice:2200}],
    cash:120000,cryptoCashUsdt:500,usdTwdRate:32,usCashUsd:0,tradeHistory:[],
    history:Array.from({length:12},(_,i)=>({date:`2026-11-${String(i+1).padStart(2,'0')}`,stockTotal:800000+i*9000,usStockTotal:160000,fundTotal:110000+i*1000,cryptoTotal:45000+i*700,cash:120000,cashRecorded:true}))};
  sample.history[1].stockTotal=1000000; // >15% up, followed by >15% down
  sample.tradeHistory=[{market:'tw',id:'trade-win',symbol:'TESTWIN',name:'獲利測試',shares:10,avgCost:100,sellPrice:110,buyDate:'2026-11-01',sellDate:'2026-11-20'},
    {market:'tw',id:'trade-loss',symbol:'TESTLOSS',name:'虧損測試',shares:10,avgCost:100,sellPrice:90,buyDate:'2026-11-01',sellDate:'2026-11-20'}];
  const yesterday=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()-86400000));
  sample.history.push({date:yesterday,cash:180000,cashRecorded:true,stockTotal:930000,usStockTotal:166400,fundTotal:169000,cryptoTotal:80000});
  sample.dailyPriceHistory=[{date:yesterday,prices:{
    '["tw","t1","2330.TW"]':{price:930},'["us","u1","VOO"]':{price:520},
    '["crypto","c1","BTCUSDT"]':{price:82000},'["crypto","c2","ETHUSDT"]':{price:2100},
    '["fund","f1",""]':{price:120000,cost:100000},'["fund","f2",""]':{price:49000,cost:50000},
  }}];
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
