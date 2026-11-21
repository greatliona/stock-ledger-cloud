const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/app.js','utf8');
function fn(name) {
  const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+1);
  return source.slice(start,end<0?undefined:end);
}
const scope=vm.createContext({});
vm.runInContext(fn('getStockPieLayout'),scope);
for(const width of [280,320,390,600,719,720,1280]) {
  for(const count of [0,1,5,6,12,40]) {
    const layout=scope.getStockPieLayout(width,count),compact=width<720;
    assert.equal(layout.large,count<=5);
    assert(layout.radius>0);
    if(count>5) {
      assert.equal(layout.chartHeight,compact?640:880);
      assert.equal(layout.radius,compact?Math.min((width-208)/2,76):Math.min((width-360)/2,880*.34,210));
    } else if(compact) {
      assert.equal(layout.radius,Math.min(width/2-12,180),'same large circle as US/other compact pies');
      assert.equal(layout.chartHeight,Math.max(320,width));
    }
  }
}
function draw(count,cash=0,width=390) {
  const arcs=[],labels=[];
  const context=new Proxy({arc:(...args)=>arcs.push(args)}, {get:(target,key)=>key in target?target[key]:()=>{}});
  const canvas={style:{},getContext:()=>context,getBoundingClientRect:()=>({width})};
  const state={holdings:Array.from({length:count},(_,i)=>({id:String(i),name:'股票'+i,symbol:'TEST'+i,shares:1,avgCost:100,currentPrice:100})),cash};
  const ctx=vm.createContext({state,els:{pieChart:canvas},window:{devicePixelRatio:2},
    stockBookValue:h=>h.currentPrice,stockDisplaySymbol:h=>h.symbol,getHoldingGroupName:h=>h.name,
    chineseNameSorter:new Intl.Collator('zh-TW'),toNumber:Number,
    assignPieColorFamilies:()=>new Map(),getGroupedPieColor:()=>'#ff0000',
    buildPieGroupSummary:slices=>slices,getPieGroupSummaryHeight:()=>80,pieThemeColor:c=>c,
    formatNumber:n=>String(n),money:n=>'$'+n,getInsidePieLabelRadiusFactor:()=>.58,
    drawPieLabelLines:()=>{},drawSeparatedInsidePieLabels:(_,items)=>labels.push(items.length),
    drawMobileOutsidePieLabels:()=>{},drawOutsidePieLabels:()=>{},drawPieGroupSummary:()=>{}});
  vm.runInContext(fn('getStockPieLayout')+fn('drawPieChart'),ctx);
  ctx.drawPieChart();
  assert.equal(arcs.length,count+(cash>0?1:0),'no holdings dropped while changing layout');
  if(count===5) {assert.equal(arcs[0][2],Math.min(width/2-12,180));assert.equal(labels[0],count+(cash>0?1:0));}
  if(count>5) {assert.equal(arcs[0][2],Math.min((width-208)/2,76));assert.equal(labels.length,0);}
  return canvas;
}
draw(5);draw(5,100);draw(6,100);draw(20);draw(0);
console.log('PASS: adaptive 0–5 vs 6+ layouts, cash excluded from count, all slices preserved, narrow/desktop widths and dense layout unchanged');
