const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/app.js','utf8'), html=fs.readFileSync(__dirname+'/index.html','utf8');
const state={cash:100,usdTwdRate:32,usCashUsd:50,cryptoCashUsdt:5,
  holdings:[{shares:10,avgCost:100,currentPrice:110},{shares:1,avgCost:100,currentPrice:250,side:'short'}],
  usHoldings:[{shares:2,avgCost:100,currentPrice:120},{shares:1,avgCost:100,currentPrice:300,side:'short'}],
  funds:[{cost:40,currentValue:50}],cryptoContracts:[{quantity:1,entryPrice:100,currentPrice:110,marginUsdt:20,leverage:5}]};
const dailyNodes=[...html.matchAll(/data-category-daily="([^"]+)"/g)].map(m=>({dataset:{categoryDaily:m[1]}}));
const pieNodes=[...html.matchAll(/data-pie-total="([^"]+)"/g)].map(m=>({dataset:{pieTotal:m[1]}}));
const scope=vm.createContext({state,els:new Proxy({},{get:()=>({})}),document:{querySelectorAll:s=>s==='[data-category-daily]'?dailyNodes:s==='[data-pie-total]'?pieNodes:[]}});
vm.runInContext(source.match(/^function \w+\([^]*?^}/gm).join('\n'),scope);
const totals=scope.getPortfolioTotals(), pies=scope.getPieChartTotals(totals);
assert.equal(pies.stock,1200,'cash + positive holding slices only');
assert.equal(pies.usStock,7680,'US pie excludes USD cash and negative slices');
assert.equal(pies.crypto,1120,'contract equity plus idle USDT once');
assert.equal(pies.category,[totals.cash,totals.stockTotal,totals.usStockTotal,totals.fundTotal,totals.cryptoTotal].filter(v=>v>0).reduce((s,v)=>s+v,0));
assert.equal(scope.categoryDailyChangeContent('cash').text,'DPnL —');
assert.match(scope.categoryDailyChangeContent('cash').title,/轉入轉出/);
assert.match(scope.categoryDailyChangeContent('cash').className,/daily-neutral/);
scope.renderSummary();
for(const n of pieNodes) assert.equal(n.textContent,'目前總值 '+scope.money(pies[n.dataset.pieTotal]));
for(const n of dailyNodes) assert.equal(n.textContent,'DPnL —','missing prior price is never fabricated');
for(const [id,key,market] of [['stockPieChart','stock','tw'],['categoryPieChart','category','all'],['cryptoPieChart','crypto','crypto'],['usStockPieChart','usStock','us']]) {
  const article=html.slice(html.lastIndexOf('<article',html.indexOf('id="'+id+'"')),html.indexOf('</article>',html.indexOf('id="'+id+'"')));
  assert.match(article,new RegExp('data-pie-total="'+key+'"'));
  assert.match(article,new RegExp('data-category-daily="'+market+'"'));
  assert.match(article,/h3 class="category-heading"/);
}
for(const [id,market] of [['assetChart','all'],['cashValueChart','cash'],['stockValueChart','tw'],['cryptoValueChart','crypto'],['fundValueChart','fund'],['usStockValueChart','us']]) {
  const article=html.slice(html.lastIndexOf('<article',html.indexOf('id="'+id+'"')),html.indexOf('</article>',html.indexOf('id="'+id+'"')));
  assert.match(article,/data-category-total=/);
  assert.match(article,new RegExp('data-category-daily="'+market+'"'));
}
state.holdings[0].currentPrice=120;scope.renderSummary();
assert.equal(pieNodes[0].textContent,'目前總值 $1,300','chart totals refresh after a price update');
console.log('PASS: four pie totals match slices and cash rules; all six line/four pie DPnL mappings, missing data and summary refresh');
