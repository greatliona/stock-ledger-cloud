const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
const rows = [
  {date:'2026-10-31',cash:10000},
  {date:'2026-11-01',cash:12000},
  {date:'2026-11-03',cash:11500},
  {date:'2026-11-04',cash:11500},
  {date:'2026-11-05',cash:0,cashRecorded:true},
  {date:'2026-11-06',cash:8000},
  {date:'2026-11-07',cash:0,cashRecorded:false},
  {date:'2026-11-08',cash:9000}
];
const node = () => ({children:[],dataset:{},innerHTML:'',
  setAttribute(){},append(child){this.children.push(child);}});
const historyList = node();
const ctx = vm.createContext({
  els:{historyList}, state:{history:[...rows].reverse()},
  historyExtremaMetrics:[], editingHistoryDate:'', openHistoryMonths:new Set(),
  document:{createElement:node},
  keyIcon:()=>'', money:v=>'$'+v
});
const functions = source.match(/^function \w+\([^]*?^}/gm);
vm.runInContext(functions.join('\n') + '\nrenderHistory();',ctx);
const cards = Object.fromEntries(historyList.children.slice(1)
  .flatMap(panel=>panel.children.map(card=>[card.dataset.historyCard,
    card.innerHTML.match(/<span>現金 .*?<\/em>/s)[0]])));
assert.doesNotMatch(cards['2026-10-31'],/history-inline-daily/);
assert.match(cards['2026-11-01'],/\+\$2K \+20%/);
assert.match(cards['2026-11-01'],/is-large-change is-up/);
assert.match(cards['2026-11-03'],/[−-]\$500 -4\.17%/);
assert.doesNotMatch(cards['2026-11-03'],/is-large-change/);
assert.doesNotMatch(cards['2026-11-04'],/history-inline-daily/);
assert.match(cards['2026-11-05'],/-\$12K -100%/);
assert.match(cards['2026-11-05'],/is-large-change is-down/);
assert.match(cards['2026-11-06'],/\+\$8K —/);
assert.doesNotMatch(cards['2026-11-07'],/history-inline-daily/);
assert.doesNotMatch(cards['2026-11-08'],/history-inline-daily/);
console.log('PASS: cash delta compares previous snapshot across months, with zero and missing cash handled separately');
