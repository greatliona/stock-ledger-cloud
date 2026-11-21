const fs=require('node:fs'),assert=require('node:assert/strict');
const css=fs.readFileSync(__dirname+'/styles.css','utf8');
const fish=css.match(/:root\[data-theme="redfish"\] \{([\s\S]*?)\n\}/)[1];
for(const [key,value] of Object.entries({panel:'rgba(255, 252, 244, 0.20)',field:'rgba(255, 253, 247, 0.20)',line:'rgba(91, 64, 43, 0.20)',shadow:'none',ink:'#30261f',green:'#096143',red:'#a12436'})) {
  assert(fish.includes(`--${key}: ${value};`));
}
assert.match(css,/:root\[data-theme="redfish"\] textarea \{ background: var\(--field\); \}/);
assert(!/:root\[data-theme="redfish"\][^{]*\{[^}]*\bopacity\s*:/.test(css),'never fade the text with the card');
assert.match(css,/--panel: #202831;/); // dark unchanged
assert.match(css,/--panel: #ffffff;/); // light unchanged
console.log('PASS: 80% transparent redfish surfaces, no card shadows, unchanged text and other themes');
