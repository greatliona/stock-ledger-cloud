const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/app.js','utf8').split('const state = loadState();')[0];
for (const [phase,expected] of [['sent','未收到頁面橋接確認'],['bridge','未收到後端確認'],['accepted','後端已接收']]) {
 let listener,timer;
 const status={},button={setAttribute(){},removeAttribute(){}};
 const parent={postMessage(){}};
 const ctx={window:{parent,STOCK_LEDGER_QUOTE_BRIDGE:true,addEventListener:(t,f)=>listener=f},document:{querySelector:s=>s==='#usQuoteStatus'?status:button},crypto:{randomUUID:()=> '12345678-test'},setTimeout:f=>(timer=f,1),clearTimeout(){},Date};
 vm.createContext(ctx);
 vm.runInContext(source+'\nconst state={usHoldings:[{id:"1",symbol:"SOXL",currentPrice:1}]};let editingUsHoldingId=null; refreshUsPrices();',ctx);
 listener({source:parent,data:{type:'ledger-us-quotes-progress',id:'wrong',phase:'accepted'}});
 if(phase!=='sent') listener({source:parent,data:{type:'ledger-us-quotes-progress',id:'12345678-test',phase}});
 timer();
 assert(status.textContent.includes(expected),status.textContent);
 assert(status.textContent.includes('診斷 12345678'));
 assert.equal(button.disabled,false);
}
console.log('PASS: missing bridge, missing backend ACK, accepted-but-no-result and foreign request ignored');
