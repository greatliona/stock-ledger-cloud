const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const XLSX = require('./xlsx.mini.min.js');
const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
const functions = source.match(/^function \w+\([^]*?^}/gm).join('\n');
const context = vm.createContext({console, crypto: require('node:crypto').webcrypto, Blob});
vm.runInContext('const LEGACY_PURCHASE_DATE="2026-09-05"; const expandedTradeGroups=new Set(); let editingTradeId="";\n' + functions, context);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);
const make = (name, symbol, shares, avgCost, sellPrice, extra = {}) => context.createTradeRecord({
  market: 'tw', name, symbol, shares, avgCost, sellPrice,
  buyDate: '2026-09-21', sellDate: '2026-11-03', side: 'long', ...extra,
});

const originals = [
  make('南亞科元大6505', '070475', 160000, .99, .57),
  make('南亞科元大6403', '073921', 120000, 1.72, .95),
  make('中砂元大6601', '073913', 70000, 2.35, 1.55),
  make('中砂元大6401', '070047', 90000, 1.29, .74),
  make('聯詠元大6405', '030267', 70000, 1.83, 1.63),
  make('聯詠元大6309', '086214', 150000, 1.46, 1.35),
];
const before = JSON.stringify(originals);
const grouped = context.aggregateTradeRecords(originals);
assert.equal(grouped.length, 3);
assert.deepEqual(Array.from(grouped, item => item.name).sort(), ['中砂', '南亞科', '聯詠']);
assert.ok(grouped.every(item => item.sourceIds.length === 2));
const nanya = grouped.find(item => item.name === '南亞科');
near(nanya.shares, 280000);
near(nanya.costTwd, 364800);
near(nanya.proceedsTwd, 205200);
near(nanya.pnlTwd, -159600);
near(nanya.pnlPct, -43.75);
near(nanya.avgCost, 364800 / 280000);
near(nanya.sellPrice, 205200 / 280000);
near(grouped.find(item => item.name === '中砂').pnlTwd, -105500);
near(grouped.find(item => item.name === '聯詠').pnlTwd, -30500);
assert.equal(JSON.stringify(originals), before);

assert.equal(context.tradeGroupName({market:'tw', name:'南亞科凱基6401'}), '南亞科');
assert.equal(context.tradeGroupName({market:'tw', name:'智通*元大6401'}), '智通*');
assert.equal(context.tradeGroupName({market:'tw', name:'台新金元大6401'}), '台新金');
assert.equal(context.tradeGroupName({market:'tw', name:'元大金凱基6401'}), '元大金');
assert.equal(context.tradeGroupName({market:'tw', name:'元大金'}), '元大金');
const extras = [
  make('零壹元大6401', '033217', 205000, .78, .75),
  make('南亞科元大6403', '073921', 1000, 1.72, .95, {side:'short'}),
  make('聯詠元大6309', '086214', 3000, 1.46, 1.66, {sellDate:'2026-10-19'}),
];
assert.equal(context.aggregateTradeRecords([...originals, ...extras]).length, 6);
const restored = context.migrateState({holdings:[], history:[], tradeHistory: JSON.parse(before)});
assert.equal(restored.tradeHistory.length, 6);
assert.equal(context.aggregateTradeRecords(restored.tradeHistory).length, 3);

const cards = [];
context.document = {createElement: () => ({className:'', classList:{add(){}}, dataset:{}, innerHTML:''})};
context.state = {tradeHistory:originals};
context.els = {tradeHistorySummary:{}, exportTradesBtn:{}, tradeMarketFilter:{value:'all'}, tradeMonthFilter:{value:''}, tradeFilterStats:{},
  tradeHistoryList:{innerHTML:'', append:card=>cards.push(card)}};
context.renderTradeHistory();
assert.equal(cards.length, 3);
assert.ok(cards.every(card => card.innerHTML.includes('2筆')));
assert.ok(cards.some(card => card.innerHTML.includes('>南亞科</span>')));
assert.ok(cards.every(card => !card.innerHTML.includes('南亞科元大')));
context.expandId = nanya.id;
vm.runInContext('expandedTradeGroups.add(expandId)', context);
cards.length = 0;
context.renderTradeHistory();
assert.equal(cards.length, 5);
assert.ok(cards.some(card => card.innerHTML.includes('南亞科元大6505')));
assert.ok(cards.some(card => card.innerHTML.includes('南亞科元大6403')));

let exported;
context.window = {XLSX};
context.captureDownload = blob => { exported = blob; };
vm.runInContext('downloadBlob=captureDownload; setStatus=()=>{}; showTradeExportFeedback=()=>{};', context);
context.exportTradeHistoryExcel();
assert.ok(exported);
(async () => {
  const workbook = XLSX.read(new Uint8Array(await exported.arrayBuffer()), {type:'array'});
  assert.deepEqual(workbook.SheetNames, ['交易紀錄', '逐筆明細', '每月績效']);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['交易紀錄'], {header:1, defval:''});
  const companyRows = rows.slice(1).filter(row => ['南亞科', '中砂', '聯詠'].includes(row[3]));
  assert.equal(companyRows.length, 3);
  const nanyaRow = companyRows.find(row => row[3] === '南亞科');
  near(nanyaRow[5], 280000);
  near(nanyaRow[15], -159600);
  near(nanyaRow[16], -.4375);
  const detail = XLSX.utils.sheet_to_json(workbook.Sheets['逐筆明細'], {header:1});
  assert.equal(detail.length, 7);
  assert.ok(detail.some(row => row[3] === '南亞科元大6505'));
  const monthly = XLSX.utils.sheet_to_json(workbook.Sheets['每月績效'], {header:1});
  assert.equal(monthly[1][1], 3);
  assert.equal(JSON.stringify(originals), before);
  console.log('PASS: screenshot company names merge correctly; date/side stay separate; original details preserved; real XLSX generated and read back');
})().catch(error => { console.error(error); process.exitCode=1; });
