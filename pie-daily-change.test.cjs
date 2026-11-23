const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/app.js','utf8');
const now=new Date('2026-11-23T02:00:00Z');
const previous={date:'2026-11-22',cash:180000,cashRecorded:true,stockTotal:930000,usStockTotal:182400,usStockMarketValue:166400,usCashTwd:16000,fundTotal:169000,cryptoTotal:80000,cryptoCashTwd:16000};
const state={cash:120000,usdTwdRate:32,usCashUsd:500,cryptoCashUsdt:500,
 holdings:[{id:'t',symbol:'TW',shares:1000,avgCost:850,currentPrice:920}],
 usHoldings:[{id:'u',symbol:'US',shares:10,avgCost:500,currentPrice:530}],
 funds:[{id:'f',cost:150000,currentValue:173000}],
 cryptoContracts:[{id:'c',name:'TESTUSDT',quantity:1,entryPrice:100,currentPrice:100,marginUsdt:2000,leverage:1}],
 history:[previous],dailyPriceHistory:[{date:'2026-11-22',prices:{'["tw","t","TW"]':{price:930}}}]};
const nodes=['pie-stock','pie-category','pie-crypto','pie-usStock','tw','cash'].map(market=>({dataset:{categoryDaily:market}}));
const scope=vm.createContext({state,document:{querySelectorAll:()=>nodes}});
vm.runInContext(source.match(/^function \w+\([^]*?^}/gm).join('\n'),scope);
let pie=scope.getPieDailyChange('stock',now);
assert.equal(pie.current,1040000);assert.equal(pie.basis,1110000);assert.equal(pie.amount,-70000);
assert.equal(scope.categoryDailyChangeContent('pie-stock',now).text,'DPnL -$70.0K -6.31%');
assert.equal(scope.categoryDailyChangeContent('tw',now).text,'DPnL -$10.0K -1.08%','line remains pure stock');
assert.equal(scope.categoryDailyChangeContent('cash',now).text,'DPnL -$60.0K -33.33%');
assert.notEqual(scope.categoryDailyChangeContent('pie-stock',now).text,scope.categoryDailyChangeContent('tw',now).text);
state.holdings[0].shares-=10;state.cash+=9200;
assert.equal(scope.getPieDailyChange('stock',now).amount,-70000,'selling stock into cash does not change the combined pie');
state.holdings[0].shares+=10;state.cash-=9200;
const category=scope.getPieDailyChange('category',now);
assert.equal(category.amount,-62800,'asset pie includes TWD cash once');
assert.ok(Math.abs(category.pct-category.amount/1541400*100)<1e-10);
assert.equal(scope.getPieDailyChange('usStock',now).amount,3200);
state.usCashUsd=99999;
assert.equal(scope.getPieDailyChange('usStock',now).amount,3200,'holdings-only US pie excludes USD cash');
state.cryptoCashUsdt=600;
assert.equal(scope.getPieDailyChange('crypto',now).amount,3200,'USDT movement included exactly once');
assert.equal(scope.categoryDailyChangeContent('pie-crypto',now).text,'DPnL +$3.2K +4%');
assert.match(scope.categoryDailyChangeContent('pie-crypto',now).className,/gain/);
state.cash+=10000;state.holdings[0].currentPrice-=10;
assert.equal(scope.getPieDailyChange('stock',now).amount,-70000,'equal stock/cash reallocation cancels');
scope.renderCategoryDailyChanges(now);
assert.equal(nodes[0].textContent,'DPnL -$70.0K -6.31%');assert.match(nodes[0].className,/loss/);
assert.match(nodes[0].title,/台股＋台幣現金/);
previous.cashRecorded=false;previous.cash=0;
assert.equal(scope.getPieDailyChange('stock',now).available,false,'missing cash never masquerades as stock-only pie change');
assert.equal(scope.getPieDailyChange('category',now).available,false);
previous.cashRecorded=true;previous.stockTotal=0;
assert.equal(scope.categoryDailyChangeContent('pie-stock',now).text,'DPnL +$1040.0K —');
state.cash=0;state.holdings=[];
assert.equal(scope.categoryDailyChangeContent('pie-stock',now).text,'DPnL +$0.0K +0%');
previous.date='2026-11-21';
assert.equal(scope.getPieDailyChange('stock',now).available,false,'strict previous Taiwan day, no older fallback');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
assert.equal((html.match(/data-category-daily="pie-/g)||[]).length,4,'four independently bound pie labels');
console.log('PASS: pie DPnL independently includes cash/USDT, correct combined %, no double counts, internal transfers cancel, line unchanged, missing/zero baselines and live labels');
