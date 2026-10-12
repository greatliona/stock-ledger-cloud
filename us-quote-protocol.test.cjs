const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const source = fs.readFileSync(__dirname + "/app.js", "utf8").split("const state = loadState();")[0];
function run(extra, session = "夜盤", lastUpdated = "") {
  let handler;
  const status = {};
  const context = {window:{STOCK_LEDGER_QUOTE_BRIDGE:true,parent:{},addEventListener:(t,f)=>handler=f},
    document:{querySelector:s=>s==="#usQuoteStatus"?status:{removeAttribute(){}}},clearTimeout(){},Date};
  vm.createContext(context);
  vm.runInContext(source + `const state={usHoldings:[{id:"1",symbol:"SOXL",currentPrice:165.4,lastUpdated:${JSON.stringify(lastUpdated)}}]};
    let editingUsHoldingId="";function saveAndRender(){};
    pendingUsQuoteRequest={id:"test",holdings:[{id:"1",symbol:"SOXL",price:165.4}]};`,context);
  handler({source:context.window.parent,data:{type:"ledger-us-quotes-result",id:"test",
    quotes:{SOXL:{price:163.92,currency:"USD",time:"2026-10-06T02:05:49Z",timeKind:"trade",ageSeconds:1,checkedPeriods:["NORMAL","BEFORE","AFTER","OVERNIGHT"],session}},...extra}});
  return {price:vm.runInContext("state.usHoldings[0].currentPrice",context),text:status.textContent};
}
assert.equal(run({}).price,165.4);
assert.equal(run({quoteProtocol:"futu-v1"}).price,165.4);
assert.equal(run({quoteProtocol:"futu-tick-v2",quotes:{SOXL:{price:163.92,currency:"USD",time:"2026-10-06T02:05:49Z",session:"盤後"}}}).price,165.4);
assert.equal(run({quoteProtocol:"overnight-v1"}).price,165.4);
assert(run({}).text.includes("舊版"));
assert.equal(run({quoteProtocol:"futu-tick-v2"}).price,165.4);
assert.equal(run({quoteProtocol:"futu-snapshot-v5"}).price,163.92);
assert.equal(run({quoteProtocol:"futu-snapshot-v5"}).text,"SOXL 已更新 · 夜盤");
assert.equal(run({quoteProtocol:"futu-snapshot-v5"}, undefined).price,163.92);
assert.equal(run({quoteProtocol:"futu-snapshot-v5"}, "").price,165.4);
assert.equal(run({quoteProtocol:"futu-snapshot-v5"}, "夜盤", "Futu 正常盤 2026-10-07T02:05:49Z").price,165.4);
assert(run({quoteProtocol:"futu-snapshot-v5",warnings:{SOXL:"最新回傳成交距查詢已 14 分鐘；未證實即時或延遲原因"}}).text.includes("部分行情待確認"));
assert.equal(run({quoteProtocol:"futu-session-v3"}).price,165.4);
for (const kind of ["quote", "minute"]) {
  const result = run({quoteProtocol:"futu-snapshot-v5", quotes:{SOXL:{price:163.92,currency:"USD",time:"2026-10-06T02:05:49Z",timeKind:kind,ageSeconds:2,checkedPeriods:["NORMAL"],session:"正常盤"}}});
  assert.equal(result.price,163.92);
  assert.equal(result.text,"SOXL 已更新 · 正常盤");
}
assert.equal(run({quoteProtocol:"futu-snapshot-v5"}, "正常盤", "Futu 正常盤 報價 2026-10-07T02:05:49Z").price,165.4);
assert.equal(run({error:"查價失敗"}).price,165.4);
const snapshot={price:141.17,currency:"USD",time:null,ageSeconds:null,timeKind:"sessionSnapshot",session:"夜盤",priceField:"overnight_price",checkedPeriods:["OVERNIGHT"],fetchedAt:"2026-10-12T02:00:00Z"};
const night=run({quoteProtocol:"futu-snapshot-v5",quotes:{SOXL:snapshot}});
assert.equal(night.price,141.17);
assert(night.text.includes("成交時間未提供"));
assert.equal(run({quoteProtocol:"futu-snapshot-v5",quotes:{SOXL:{...snapshot,priceField:"last_price"}}}).price,165.4);
assert.equal(run({quoteProtocol:"futu-smart-v4"}).price,165.4);
console.log("PASS: old protocol blocked, valid quote applied, session required, errors preserve price");
const failure=run({quoteProtocol:"futu-snapshot-v5",quotes:{},errors:{SOXL:"夜盤價格欄位缺漏；保留原價；保留原價"}});
assert(failure.text.includes("SOXL 未更新：夜盤價格欄位缺漏"));
assert.equal((failure.text.match(/保留原價/g)||[]).length,1);
const html=fs.readFileSync(__dirname+"/index.html","utf8");
assert(html.indexOf('id="usQuoteStatus"')>html.indexOf('id="usHoldingsBody"'));
