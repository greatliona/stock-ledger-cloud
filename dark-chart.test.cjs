const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end);
}
for (const theme of ['dark', 'light']) {
  const fills = [];
  const context = {
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { fills.push(this.fillStyle); },
  };
  const scope = {document:{documentElement:{dataset:{theme}}}, context,
    assetChartColors:{cashFill:'#fee2e2',stockFill:'#ffedd5',cryptoFill:'#fff2b8',fundFill:'#dcfce7',usStockFill:'#bfdbfe'}};
  vm.createContext(scope);
  vm.runInContext(extract('fillStackedArea') + extract('fillStackedBand') + extract('assetChartAreaColor'), scope);
  vm.runInContext('fillStackedArea(context,[{x:0,y:1}],2,"y",assetChartColors.stockFill);fillStackedBand(context,[{x:0,top:1,bottom:2}],"top","bottom",assetChartColors.cryptoFill)', scope);
  assert.deepEqual(fills, theme === 'dark' ? ['#80512f','#72611f'] : ['#ffedd5','#fff2b8']);
  assert.equal(vm.runInContext('assetChartAreaColor(assetChartColors.cashFill)',scope),theme === 'dark' ? '#632b4a' : '#fee2e2');
}
const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
assert(css.includes('--chart-marker: #27323c'));
assert(css.includes('--chart-grid: rgba(219, 228, 233, 0.15)'));
assert(extract('drawAssetLine').includes('assetChartMarkerColor(color)'));
assert(extract('drawAssetLine').includes('"#ef5b91"'));
assert(extract('drawAssetLine').includes('canvasThemeColor("--chart-marker-outline")'));
assert(css.includes('--button-bg: #344453'));
for (const spacing of [8,3]) {
  const dots = [];
  const context = {beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(x,y,r){dots.push({r,stroke:this.strokeStyle,fill:this.fillStyle});}};
  const scope = {document:{documentElement:{dataset:{theme:'dark'}}},context,canvasThemeColor:()=> '#172129',assetChartColors:{stockLine:'#fb923c'}};
  vm.createContext(scope);
  vm.runInContext(extract('drawAssetLine') + extract('assetChartMarkerColor'),scope);
  const points = Array.from({length:5},(_,i)=>({x:i*spacing,y:4}));
  scope.points=points;
  vm.runInContext('drawAssetLine(context,points,"y","#fb923c",4.5)',scope);
  assert.equal(dots.length,5);
  assert(dots.every(dot=>dot.r===4.5 && dot.stroke==='#172129' && dot.fill==='#ffd0a0'));
}
console.log('PASS: dark area hues distinct, full-size light-centered framed markers, light colors unchanged');
