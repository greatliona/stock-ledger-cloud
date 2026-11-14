const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
const functions = source.match(/^function \w+\([^]*?^}/gm).join('\n');
const context = vm.createContext({console, crypto: require('node:crypto').webcrypto});
vm.runInContext('const LEGACY_PURCHASE_DATE = "2026-09-05"; const expandedTradeGroups = new Set(); let editingTradeId = "";\n' + functions, context);

const base = {symbol: 'BTCUSDT', buyDate: '2026-11-01', sellDate: '2026-11-14', side: 'long', leverage: 4, fxRate: 32};
const first = context.createCryptoTradeRecord({...base, shares: 2, avgCost: 100, sellPrice: 110, marginUsdt: 50});
const second = context.createCryptoTradeRecord({...base, shares: 3, avgCost: 100, sellPrice: 90, marginUsdt: 75});
assert.equal(first.pnlNative, 20);
assert.equal(first.proceedsNative, 70);
assert.equal(first.pnlPct, 40);
assert.equal(second.pnlNative, -30);
const grouped = context.aggregateTradeRecords([first, second]);
assert.equal(grouped.length, 1);
assert.equal(grouped[0].groupType, 'daily');
assert.equal(grouped[0].costTwd, 4000);
assert.equal(grouped[0].pnlTwd, -320);
assert.equal(grouped[0].sourceIds.length, 2);
assert.ok(context.renderTradeDaySummary(grouped[0]).includes('2 筆 · 多'));
assert.ok(context.renderTradeDaySummary(grouped[0]).includes('平均成本</small>—'));

const shortTrade = context.createCryptoTradeRecord({...base, side: 'short', sellDate: '2026-11-13', shares: 1, avgCost: 100, sellPrice: 80, marginUsdt: 25});
assert.equal(shortTrade.pnlNative, 20);
assert.equal(shortTrade.proceedsNative, 45);
const wipedOut = context.createCryptoTradeRecord({...base, sellDate: '2026-11-12', shares: 10, avgCost: 100, sellPrice: 0, marginUsdt: 25});
assert.equal(wipedOut.pnlNative, -25);
assert.equal(wipedOut.proceedsNative, 0);
assert.equal(context.validateCryptoCloseValues({...base, shares: 1, avgCost: 100, sellPrice: 90, marginUsdt: 25}), '');
assert.ok(context.validateCryptoCloseValues({...base, shares: 1, avgCost: 100, sellPrice: 90, marginUsdt: 25, fxRate: 0}));

const tw = context.createTradeRecord({market: 'tw', symbol: '2330', name: '台積電', shares: 10, avgCost: 100, sellPrice: 110, buyDate: '2026-11-01', sellDate: '2026-11-14'});
const us = context.createTradeRecord({market: 'us', symbol: 'VOO', shares: 2, avgCost: 100, sellPrice: 110, fxRate: 32, buyDate: '2026-11-01', sellDate: '2026-11-14'});
const twSecond = context.createTradeRecord({market: 'tw', symbol: '2330.TW', name: '', shares: 5, avgCost: 120, sellPrice: 110, buyDate: '2026-11-03', sellDate: '2026-11-14'});
const usSecond = context.createTradeRecord({market: 'us', symbol: 'VOO', shares: 3, avgCost: 120, sellPrice: 130, fxRate: 32, buyDate: '2026-11-03', sellDate: '2026-11-14'});
const allGroups = context.aggregateTradeRecords([tw, twSecond, us, usSecond, first, second]);
assert.equal(allGroups.length, 1);
assert.equal(allGroups[0].sourceIds.length, 6);
assert.equal(allGroups[0].costTwd, [tw, twSecond, us, usSecond, first, second].reduce((sum, trade) => sum + trade.costTwd, 0));
const sameNameOtherCode = context.createTradeRecord({market: 'tw', symbol: 'ALT', name: '台積電', shares: 1, avgCost: 100, sellPrice: 110, buyDate: '2026-11-01', sellDate: '2026-11-14'});
assert.equal(context.aggregateTradeRecords([tw, twSecond, sameNameOtherCode]).length, 1);
const shortSameDay = context.createCryptoTradeRecord({...base, side: 'short', shares: 1, avgCost: 100, sellPrice: 80, marginUsdt: 25});
const separateDirections = context.aggregateTradeRecords([first, second, shortSameDay]);
assert.equal(separateDirections.length, 2);
assert.equal(separateDirections.find((group) => group.side === 'long').sourceIds.length, 2);
assert.equal(separateDirections.find((group) => group.side === 'short').sourceIds.length, 1);
assert.equal(context.aggregateTradeRecords([first, shortTrade]).length, 2);
const stockShort = context.createTradeRecord({market: 'tw', symbol: '2330', name: '台積電', side: 'short', shares: 1, avgCost: 100, sellPrice: 90, buyDate: '2026-11-01', sellDate: '2026-11-14'});
assert.equal(context.aggregateTradeRecords([tw, twSecond, stockShort]).length, 2);
const restored = context.migrateState({holdings: [], history: [], tradeHistory: [first, second, tw, twSecond, us], cryptoContracts: [{...base, id: 'open', name: 'BTCUSDT', quantity: 2, entryPrice: 100, currentPrice: 110, marginUsdt: 50}]});
assert.equal(restored.tradeHistory.length, 5);
assert.equal(restored.tradeHistory[0].market, 'crypto');
assert.equal(restored.tradeHistory[0].pnlTwd, first.pnlTwd);
assert.ok(restored.cryptoContracts[0].openDate);
assert.equal(context.aggregateTradeRecords(restored.tradeHistory).length, 1);

const colors = new Map([['USDT', 0], ['BTCUSDT', 1]]);
vm.runInContext('const pieColorFamilies = [["#fff"],["#000"]]; const chineseNameSorter = new Intl.Collator("zh-TW");', context);
const summary = context.buildPieGroupSummary([{group: 'BTCUSDT', value: 100}, {group: 'USDT', value: 5}], ['BTCUSDT', 'USDT'], colors, 105);
assert.equal(summary[0].group, 'USDT');

const screenshotTrades = ['聯詠', '零壹', '群聯', '智通', '南亞科', '南亞科二'].map((name, index) => context.createTradeRecord({
  market: 'tw', symbol: String(7000 + index), name, shares: 10, avgCost: 100,
  sellPrice: 90, buyDate: '2026-10-01', sellDate: '2026-11-03',
}));
const cards = [];
context.document = {createElement: () => ({className: '', classList: {add() {}}, dataset: {}, innerHTML: ''})};
context.state = {tradeHistory: screenshotTrades};
context.els = {
  tradeHistorySummary: {textContent: ''}, exportTradesBtn: {disabled: false},
  tradeMarketFilter: {value: 'all'}, tradeMonthFilter: {value: ''}, tradeFilterStats: {textContent: ''},
  tradeHistoryList: {innerHTML: '', append: (card) => cards.push(card)},
};
context.renderTradeHistory();
assert.equal(cards.length, 1);
assert.match(cards[0].innerHTML, /6 筆 · 多/);
assert.match(cards[0].innerHTML, /aria-expanded="false"[^]*?>展開<\/button>/);
assert.match(context.els.tradeFilterStats.textContent, /0／6/);
context.groupIdForTest = cards[0].dataset.tradeRecord;
vm.runInContext('expandedTradeGroups.add(groupIdForTest)', context);
cards.length = 0;
context.renderTradeHistory();
assert.equal(cards.length, 7); // one daily row plus six editable originals
cards.length = 0;
context.els.tradeMarketFilter.value = 'us';
context.renderTradeHistory();
assert.equal(cards.length, 1); // filtered empty-state card

const excelSheets = [];
const excelNames = [];
let downloaded = false;
context.window = {XLSX: {utils: {
  aoa_to_sheet: (rows) => {
    excelSheets.push(rows);
    const sheet = {};
    rows.forEach((row, r) => row.forEach((value, c) => { if (value !== '') sheet[`${String.fromCharCode(65 + c)}${r + 1}`] = {v: value}; }));
    return sheet;
  },
  book_new: () => ({}), book_append_sheet: (book, sheet, name) => { excelNames.push(name); }, sheet_add_aoa: () => {},
}, write: () => new Uint8Array([1])}};
context.state = {tradeHistory: [tw, twSecond, us, usSecond, first, second, shortSameDay]};
context.els = {exportTradesBtn: {disabled: false}};
context.Blob = Blob;
context.markDownloaded = () => { downloaded = true; };
vm.runInContext('downloadBlob = markDownloaded; setStatus = () => {}; showTradeExportFeedback = () => {};', context);
context.exportTradeHistoryExcel();
assert.equal(downloaded, true);
assert.equal(excelSheets[0].length, 5); // header + two daily directions + blank + total
assert.equal(excelSheets[1].length, 8); // original seven trades remain available
assert.equal(excelSheets[2].length, 2); // monthly header + one month
assert.equal(excelSheets[2][1][1], 7); // win rate counts individual trades
assert.deepEqual(excelNames, ['交易紀錄', '逐筆明細', '每月績效']);
console.log('PASS: crypto close, all same-day assets grouped, long/short split, original records and Excel details preserved');
