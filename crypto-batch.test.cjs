const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
const code = source.slice(source.indexOf('async function fetchBinanceContractPrices('), source.indexOf('let editingHoldingId'));
const pnl = source.slice(source.indexOf('function calculateCryptoPosition('), source.indexOf('function stockDisplaySymbol('));
const now = Date.now();
const row = (symbol,price,time=now) => ({symbol,price:String(price),time});
function harness(contracts, payload, statusCode=200) {
  let calls=0, saveCount=0;
  const status={}, button={disabled:false,setAttribute(){},removeAttribute(){}};
  const ctx=vm.createContext({Map,Set,Date,AbortController,setTimeout,clearTimeout,TypeError,
    document:{querySelector:s=>s==='#cryptoQuoteStatus'?status:button},
    fetch:async(url,options)=>{calls++;assert.equal(url,'https://fapi.binance.com/fapi/v2/ticker/price');assert.equal(options.credentials,'omit');return {ok:statusCode===200,status:statusCode,json:async()=>typeof payload==='function'?await payload():payload};},
    state:{cryptoContracts:contracts,usdTwdRate:32},normalizeSymbol:s=>s.trim().toUpperCase(),toNumber:v=>Number(v)||0,
    findCryptoContract:id=>contracts.find(c=>c.id===id),renderCryptoContracts(){},saveAndRender(){saveCount++;}});
  vm.runInContext('let refreshingAllCrypto=false,editingCryptoId="";const refreshingCryptoIds=new Set(),cryptoRefreshMessages=new Map();'+code+pnl,ctx);
  return {ctx,status,button,run:()=>ctx.refreshAllCryptoPrices(),calls:()=>calls,saves:()=>saveCount};
}
const contract=(id,name='BTCUSDT',side='long')=>({id,name,side,currentPrice:100,entryPrice:100,marginUsdt:1000,quantity:1,leverage:1});
(async()=>{
  const records=[contract('1'),contract('2','BTCUSDT','short'),contract('3','ETHUSDT')];
  let h=harness(records,[row('BTCUSDT',110),row('ETHUSDT',120),row('OTHERUSDT',999)]);
  await h.run();assert.equal(h.calls(),1);assert.equal(h.saves(),1);assert.deepEqual(records.map(c=>c.currentPrice),[110,110,120]);
  assert.equal(h.ctx.calculateCryptoPosition(records[0]).pnlUsdt,10);assert.equal(h.ctx.calculateCryptoPosition(records[1]).pnlUsdt,-10);
  assert(h.status.textContent.includes('3 筆'));assert.equal(h.button.disabled,false);
  h=harness([contract('1'),contract('2','ETHUSDT'),contract('3','BAD')],[row('BTCUSDT',110),row('ETHUSDT',0)]);await h.run();
  assert.deepEqual(h.ctx.state.cryptoContracts.map(c=>c.currentPrice),[110,100,100]);assert(h.status.textContent.includes('未更新'));
  for(const payload of [{bad:true},[row('BTCUSDT',0)],[row('BTCUSDT',110,now+120000)]]){h=harness([contract('1')],payload);await h.run();assert.equal(h.ctx.state.cryptoContracts[0].currentPrice,100);assert.equal(h.saves(),0);}
  h=harness([contract('1')],[],429);await h.run();assert.equal(h.saves(),0);assert(h.status.textContent.includes('受限'));assert.equal(h.button.disabled,false);
  h=harness([],[]);await h.run();assert.equal(h.calls(),0);
  h=harness([contract('1')],[]);vm.runInContext('editingCryptoId="1"',h.ctx);await h.run();assert.equal(h.calls(),0);
  h=harness([contract('1','BAD')],[]);await h.run();assert.equal(h.calls(),0);
  let release;const pending=new Promise(r=>release=r);h=harness([contract('1')],()=>pending);
  const first=h.run();await h.run();assert.equal(h.calls(),1);assert.equal(h.button.disabled,true);
  h.ctx.state.cryptoContracts[0].currentPrice=123;release([row('BTCUSDT',110)]);await first;
  assert.equal(h.ctx.state.cryptoContracts[0].currentPrice,123);assert.equal(h.saves(),0);assert.equal(h.button.disabled,false);
  console.log('PASS: one batch request, duplicate symbols, long/short P&L, partial failure, invalid/time data, edit locks, double-click and stale response guards');
})().catch(e=>{console.error(e);process.exitCode=1;});
