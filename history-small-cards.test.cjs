const fs=require('node:fs'),assert=require('node:assert/strict');
const css=fs.readFileSync(__dirname+'/styles.css','utf8');
// Values checked directly against the L1.5.81 source backup during this edit:
// history-item fill rgba(255,253,247,.08), inherited line rgba(91,64,43,.23).
assert.match(css,/:root\[data-theme="redfish"\] \.history-item \{\s+background: rgba\(255, 253, 247, 0\.08\);\s+border-color: rgba\(91, 64, 43, 0\.23\);/);
assert.match(css,/--panel: rgba\(255, 252, 244, 0\.20\);/,'large panels stay at their current setting');
assert.match(css,/\.history-month-list,\s+:root\[data-theme="redfish"\] \.settlement-summary \{ background: rgba\(255, 253, 247, 0\.03\);/,'month container unchanged');
assert.match(css,/\.history-total-line.is-atl:not\(\.is-ath\) > strong \{ font-weight: 400; \}/);
assert.match(css,/\.history-daily-pnl.is-large-change \{\s+color: #d97706;/);
console.log('PASS: only daily small-card surfaces restored to L1.5.81, large/month panels unchanged, green low values normal weight');
