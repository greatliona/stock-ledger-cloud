const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const css=fs.readFileSync(__dirname+'/styles.css','utf8'),source=fs.readFileSync(__dirname+'/app.js','utf8');
for(const [selector,variable] of [['.gain','red'],['.loss','green'],['.profit-values em.gain','red'],['.profit-values em.loss','green'],['.trade-record-field.gain','red'],['.trade-record-field.loss','green'],['.trade-dialog-preview strong.gain','red'],['.trade-dialog-preview strong.loss','green'],['.crypto-card .crypto-position-details strong.gain','red'],['.crypto-card .crypto-position-details strong.loss','green']]) {
  assert(css.includes(`${selector} {\n  color: var(--${variable});` )||css.includes(`${selector} { color: var(--${variable});`),selector);
}
assert.match(css,/\.pnl-cell \.stock-name \{ color: inherit; \}/);
assert.match(css,/\.trade-record-field \.trade-record-native \{ color: inherit; \}/);
assert.match(source,/未實現損益 <strong class="\$\{position.pnlUsdt >= 0 \? "gain" : "loss"\}"/);
const scope=vm.createContext({});
vm.runInContext(source.match(/^function \w+\([^]*?^}/gm).join('\n'),scope);
assert.match(scope.formatTradeFilterStatsMarkup([{pnlTwd:10,pnlPct:10}]),/class="gain"/);
assert.match(scope.formatTradeFilterStatsMarkup([{pnlTwd:-10,pnlPct:-10}]),/class="loss"/);
// Daily history remains neutral up to 15%; only larger moves are sign-colored.
assert.match(css,/\.history-daily-pnl \{[^}]*color: var\(--history-daily-neutral\);/);
assert.match(css,/\.history-daily-pnl.is-large-change.is-up \{ color: var\(--red\); \}/);
assert.match(css,/\.history-daily-pnl.is-large-change.is-down \{ color: var\(--green\); \}/);
assert.match(source,/Math.abs\(percent\) > 15/);
assert.match(source,/class="history-daily-pnl history-inline-daily\$\{largeChangeClass\}"/);
assert(!css.includes('.history-daily-pnl.gain'));
assert.match(css,/\.history-extrema-badge.is-atl \{\s+background: var\(--history-low\);/);
assert.match(css,/\.history-total-line.is-atl > strong \{\s+color: var\(--history-low\);/);
assert.match(css,/\.history-total-line.is-atl:not\(\.is-ath\) > strong \{ font-weight: 400; \}/);
assert.match(css,/\.crypto-direction.is-long \{ color: var\(--red\); \}/);
assert.match(css,/\.crypto-direction.is-short \{ color: var\(--green\); \}/);
console.log('PASS: red gains / green losses, nested/native values, unrealized P&L, daily-history exception and stronger L/low values');
