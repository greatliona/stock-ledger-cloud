const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const source = fs.readFileSync(__dirname + "/app.js", "utf8").split("const state = loadState();")[0];
function run(extra, session = "夜盤") {
  let handler;
  const status = {};
  const context = {window:{STOCK_LEDGER_QUOTE_BRIDGE:true,parent:{},addEventListener:(t,f)=>handler=f},
    document:{querySelector:s=>s==="#usQuoteStatus"?status:{removeAttribute(){}}},clearTimeout(){},Date};
  vm.createContext(context);
  vm.runInContext(source + `const state={usHoldings:[{id:"1",symbol:"SOXL",currentPrice:165.4}]};
    let editingUsHoldingId="";function saveAndRender(){};
    pendingUsQuoteRequest={id:"test",holdings:[{id:"1",symbol:"SOXL",price:165.4}]};`,context);
  handler({source:context.window.parent,data:{type:"ledger-us-quotes-result",id:"test",
    quotes:{SOXL:{price:163.92,currency:"USD",time:"2026-10-06T02:05:49Z",session}},...extra}});
  return {price:vm.runInContext("state.usHoldings[0].currentPrice",context),text:status.textContent};
}
assert.equal(run({}).price,165.4);
assert.equal(run({quoteProtocol:"overnight-v1"}).price,165.4);
assert(run({}).text.includes("舊版"));
assert.equal(run({quoteProtocol:"futu-v1"}).price,163.92);
assert(run({quoteProtocol:"futu-v1"}).text.includes("SOXL 夜盤"));
assert.equal(run({quoteProtocol:"futu-v1"}, undefined).price,163.92);
assert.equal(run({quoteProtocol:"futu-v1"}, "").price,165.4);
assert.equal(run({error:"查價失敗"}).price,165.4);
console.log("PASS: old protocol blocked, valid quote applied, session required, errors preserve price");
