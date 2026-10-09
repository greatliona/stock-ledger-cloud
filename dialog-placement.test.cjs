const fs=require("fs"),vm=require("vm"),assert=require("assert");
const source=fs.readFileSync(__dirname+"/app.js","utf8");
const fn=source.slice(source.indexOf("function getTradeDialogPlacement()"),source.indexOf("function positionTradeDialog("));
const top={innerWidth:390,innerHeight:844};top.parent=top;
const bridge={innerWidth:390,innerHeight:6000,parent:top,
  frameElement:{getBoundingClientRect:()=>({left:0,top:-2500})}};
const window={innerWidth:390,innerHeight:6000,parent:bridge,
  frameElement:{getBoundingClientRect:()=>({left:0,top:0})}};
const context={window};vm.createContext(context);
vm.runInContext(fn+";result=getTradeDialogPlacement()",context);
assert.equal(context.result.centerY,2922);
assert.equal(context.result.centerX,195);
assert.equal(context.result.visibleHeight,844);
console.log("PASS: dialog stays in top-level visible viewport through two tall frames");
