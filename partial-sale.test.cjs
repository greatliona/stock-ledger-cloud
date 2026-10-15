const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(__dirname+'/app.js','utf8');
const code=source.slice(source.indexOf('function reducePendingHolding('),source.indexOf('function validateTradeValues('));
for(const market of ['tw','us']) {
 const holding={id:'a',shares:100000,avgCost:20,purchaseDate:'2026-09-05',side:'short'};
 const state={holdings:market==='tw'?[holding]:[],usHoldings:market==='us'?[holding]:[]};
 const ctx={state,pendingHoldingSale:{market,holdingId:'a'},findHolding:id=>state.holdings.find(h=>h.id===id),findUsHolding:id=>state.usHoldings.find(h=>h.id===id),editingHoldingId:'',editingUsHoldingId:''};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 for(const n of [0,-1,100001,NaN,Infinity]) assert(ctx.reducePendingHolding(n));
 assert.equal(holding.shares,100000);
 assert.equal(ctx.reducePendingHolding(50000),'');assert.equal(holding.shares,50000);
 assert.equal(holding.avgCost,20);assert.equal(holding.purchaseDate,'2026-09-05');assert.equal(holding.side,'short');
 assert.equal(ctx.reducePendingHolding(50000),'');assert.equal(state.holdings.length+state.usHoldings.length,0);
}
console.log('PASS: partial/full sale, both markets, invalid quantity, retained cost/date/side');
