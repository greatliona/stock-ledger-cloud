const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/app.js','utf8');
const functions = source.match(/^(?:async )?function \w+\([^]*?^}/gm).join('\n');
const tw = {id:'tw', symbol:'2330.TW', shares:1000, avgCost:800, currentPrice:100, side:'long'};
const us = {id:'us', symbol:'VOO', shares:2, avgCost:90, currentPrice:100, side:'long'};
const crypto = {id:'crypto', name:'BTCUSDT', quantity:.2, entryPrice:67000, marginUsdt:5000, leverage:4, currentPrice:66000, side:'short'};
const fund = {id:'fund', name:'基金', cost:167000, currentValue:340000};
const state = {holdings:[tw],usHoldings:[us],cryptoContracts:[crypto],funds:[fund],history:[],tradeHistory:[],usdTwdRate:32};
const saved = new Map(); let cloudPayload;
const ctx = vm.createContext({console, state, crypto:require('node:crypto').webcrypto,
  localStorage:{setItem:(k,v)=>saved.set(k,v)},
  cloudClient:{from:()=>({upsert:async payload=>{cloudPayload=payload;return {error:null};}})},
  els:{statusText:{},cryptoCashUsdt:{},cash:{},usdTwdRate:{},usCashUsd:{}},
  document:{querySelectorAll:()=>[]}});
vm.runInContext('const STORAGE_KEY="test-only", CLOUD_TABLE="test-only", CLOUD_ROW_ID="test-only", LEGACY_PURCHASE_DATE="2026-09-05";\n'+functions,ctx);
const day1 = new Date('2026-11-17T15:59:59Z'); // 23:59:59 Taiwan
const day2 = new Date('2026-11-17T16:00:00Z'); // midnight Taiwan
assert.equal(ctx.dailyPriceDate(day1),'2026-11-17');
assert.equal(ctx.dailyPriceDate(day2),'2026-11-18');
assert.equal(ctx.previousPriceDate('2026-03-01'),'2026-02-28');
assert.equal(ctx.previousPriceDate('2028-03-01'),'2028-02-29');
assert.equal(ctx.previousPriceDate('2027-01-01'),'2026-12-31');
assert.equal(ctx.getDailyChange('tw',tw,day1).available,false);
assert.equal(ctx.captureDailyPrices(day1),true);
assert.equal(ctx.captureDailyPrices(day1),false);
tw.currentPrice = 105; // last of several records in the same day
ctx.captureDailyPrices(day1);
assert.equal(state.dailyPriceHistory.length,1);
tw.currentPrice=110; us.currentPrice=90; crypto.currentPrice=64000; fund.currentValue=350000;
ctx.captureDailyPrices(day2);
let result = ctx.getDailyChange('tw',tw,day2);
assert.equal(result.amount,5000);
assert.ok(Math.abs(result.pct-5/105*100)<1e-10);
assert.equal(ctx.getDailyChange('us',us,day2).amount,-640);
assert.equal(ctx.getDailyChange('us',us,day2).pct,-10);
assert.equal(ctx.getDailyChange('crypto',crypto,day2).amount,12800);
assert.ok(Math.abs(ctx.getDailyChange('crypto',crypto,day2).pct-2000/66000*100)<1e-10);
assert.match(ctx.dailyChangeMarkup('crypto',crypto,day2),/今日 \+\$12,800 \+3.03%/);
assert.match(ctx.dailyChangeMarkup('us',us,day2),/daily-change loss/);
assert.match(ctx.dailyChangeMarkup('tw',tw,day2),/今日 \+\$5,000 \+4.76%/);
assert.equal(ctx.getDailyChange('fund',fund,day2).amount,10000);
fund.cost+=10000; fund.currentValue+=10000;
assert.equal(ctx.getDailyChange('fund',fund,day2).available,false,'do not count fund contributions as daily price gain');
fund.cost-=10000; fund.currentValue-=10000;
tw.shares=500; assert.equal(ctx.getDailyChange('tw',tw,day2).amount,2500,'use current qty, not market value subtraction');
tw.shares=2000; assert.equal(ctx.getDailyChange('tw',tw,day2).amount,10000);
tw.side='short'; assert.equal(ctx.getDailyChange('tw',tw,day2).amount,-10000);
assert.equal(ctx.getDailyChange('tw',{...tw,symbol:'OTHER'},day2).available,false);
assert.equal(ctx.getDailyChange('tw',{...tw,id:'new-holding'},day2).available,false);
assert.equal(ctx.getDailyChange('tw',{...tw,currentPrice:null},day2).available,false);
assert.equal(ctx.getDailyChange('crypto',{...crypto,currentPrice:0},day2).available,false);
assert.equal(ctx.getDailyChange('us',{...us,currentPrice:100},day2).amount,0);
assert.equal(ctx.getDailyChange('tw',tw,new Date('2026-11-20T00:00:00Z')).available,false,'never call an older observation yesterday');
state.usdTwdRate=0; assert.equal(ctx.getDailyChange('us',us,day2).available,false); state.usdTwdRate=32;

const legacy = {id:'legacy',symbol:'TEST',shares:3,currentPrice:12};
state.history=[{date:'2026-11-17',prices:{legacy:10},usPrices:{legacy:{price:9,fxRate:33}},fundValues:{legacy:100},cryptoValues:{legacy:1000}}];
state.history[0].prices.tw=80;
assert.equal(ctx.getDailyChange('tw',{...tw,symbol:'OTHER'},day2).available,false,'renamed ticker must not inherit legacy price with the same id');
assert.equal(ctx.getDailyChange('tw',legacy,day2).amount,6);
assert.equal(ctx.getDailyChange('us',legacy,day2).amount,288);
assert.equal(ctx.getDailyChange('fund',{...legacy,currentValue:110},day2).available,false,'old fund data has no comparable cost');
assert.equal(ctx.getDailyChange('crypto',{...crypto,id:'legacy'},day2).available,false,'never reconstruct crypto price from equity');

const migrated = ctx.migrateState(JSON.parse(JSON.stringify(state)));
assert.equal(JSON.stringify(migrated.dailyPriceHistory),JSON.stringify(state.dailyPriceHistory));
ctx.replaceState(migrated);
assert.equal(ctx.getDailyChange('crypto',state.cryptoContracts[0],day2).amount,12800);
assert.equal(ctx.migrateState({holdings:[],history:[]}).dailyPriceHistory.length,0);
const invalid = ctx.migrateDailyPriceHistory([{date:'bad',prices:{}},{date:'2026-11-17',prices:JSON.parse('{"__proto__":{"price":5},"[\\"tw\\",\\"x\\",\\"\\"]":{"price":-1}}')}]);
assert.equal(Object.keys(invalid[0].prices).length,0);
ctx.persistLocalState();
assert.ok(JSON.parse(saved.get('test-only')).dailyPriceHistory.length>=2);

(async()=>{
  await ctx.syncStateToCloud();
  assert.equal(JSON.stringify(cloudPayload.data.dailyPriceHistory),JSON.stringify(state.dailyPriceHistory),'new observations are included in existing JSON cloud payload');
  assert.match(source,/data-daily-market/);
  const cryptoRender = source.slice(source.indexOf('function renderCryptoContracts()'),source.indexOf('function renderSettlementRows()'));
  assert.match(cryptoRender,/dailyChangeMarkup\("crypto", contract\)/);
  console.log('PASS: Taiwan rollover, last save wins, strict previous day, all four assets, short direction, qty changes, fund cash flows, legacy fallback, import/export and synthetic cloud payload');
})().catch(error=>{console.error(error);process.exitCode=1;});
