const fs=require('node:fs'),assert=require('node:assert/strict');
const css=fs.readFileSync(__dirname+'/styles.css','utf8');
// The user selected 80% transparency for daily cards only; retain the
// L1.5.81 border while leaving the enclosing surfaces unchanged.
assert.match(css,/:root\[data-theme="redfish"\] \.history-item \{\s+background: rgba\(255, 253, 247, 0\.20\);\s+border-color: rgba\(91, 64, 43, 0\.23\);/);
assert.match(css,/--panel: rgba\(255, 252, 244, 0\.20\);/,'large panels stay at their current setting');
assert.match(css,/\.history-month-list,\s+:root\[data-theme="redfish"\] \.settlement-summary \{ background: rgba\(255, 253, 247, 0\.03\);/,'month container unchanged');
assert.match(css,/\.history-total-line.is-atl:not\(\.is-ath\) > strong \{ font-weight: 400; \}/);
assert.match(css,/\.history-daily-pnl.is-large-change.is-up \{ color: var\(--red\); \}/);
assert.match(css,/\.history-daily-pnl.is-large-change.is-down \{ color: var\(--green\); \}/);
console.log('PASS: daily small cards 80% transparent, large/month panels unchanged, green low values normal weight');
