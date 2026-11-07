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
    globalAlpha: 1,
    save() { this.previousAlpha = this.globalAlpha; },
    restore() { this.globalAlpha = this.previousAlpha; },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { fills.push(this.globalAlpha); },
  };
  const scope = {document:{documentElement:{dataset:{theme}}}, context};
  vm.createContext(scope);
  vm.runInContext(extract('fillStackedArea') + extract('fillStackedBand'), scope);
  vm.runInContext('fillStackedArea(context,[{x:0,y:1}],2,"y","#fff");fillStackedBand(context,[{x:0,top:1,bottom:2}],"top","bottom","#fff")', scope);
  assert.deepEqual(fills, theme === 'dark' ? [0.26,0.26] : [1,1]);
  assert.equal(context.globalAlpha, 1);
}
const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
assert(css.includes('--chart-marker: #27323c'));
assert(css.includes('--chart-grid: rgba(219, 228, 233, 0.15)'));
console.log('PASS: dark chart fill muted, light fill unchanged, opacity restored');
