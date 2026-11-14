const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
const functions = source.match(/^function \w+\([^]*?^}/gm).join('\n');
const cards = [];
const document = {createElement(tag) {
  const actions = {innerHTML: '<button>x</button>', classList: {add() {}}, querySelectorAll: () => []};
  return {tagName: tag.toUpperCase(), innerHTML: '', classList: {add() {}},
    querySelectorAll: () => [], querySelector: (selector) => selector === '.row-actions' ? actions : null,
    addEventListener() {}};
}};
const contract = (id, side) => ({id, name: 'BTCUSDT', side, leverage: 4,
  marginUsdt: 1000, quantity: 0.1, entryPrice: 100, currentPrice: 110, liquidationPrice: null});
const context = vm.createContext({document, crypto: require('node:crypto').webcrypto,
  state: {cryptoContracts: [contract('long', 'long'), contract('short', 'short')], usdTwdRate: 32},
  els: {cryptoList: {innerHTML: '', append: (card) => cards.push(card)}}});
vm.runInContext('const openCryptoCards = new Set(), refreshingCryptoIds = new Set(), cryptoRefreshMessages = new Map(); let editingCryptoId = "", refreshingAllCrypto = false;\n' + functions, context);
context.renderCryptoContracts();
assert.equal(cards.length, 2);
assert.match(cards[0].innerHTML, /crypto-card-identity[^]*?<strong>BTCUSDT<\/strong>[^]*?crypto-direction is-long[^]*?>多<\/span>/);
assert.match(cards[1].innerHTML, /crypto-card-identity[^]*?<strong>BTCUSDT<\/strong>[^]*?crypto-direction is-short[^]*?>空<\/span>/);
assert.match(css, /\.crypto-direction\.is-long\s*\{\s*color:\s*var\(--red\)/);
assert.match(css, /\.crypto-direction\.is-short\s*\{\s*color:\s*var\(--green\)/);
console.log('PASS: contract name is followed by red 多 or green 空 for both directions');
