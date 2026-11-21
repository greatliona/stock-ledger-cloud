const fs=require('node:fs'), assert=require('node:assert/strict');
const python=fs.readFileSync(__dirname+'/streamlit_app.py','utf8');
const bridge=fs.readFileSync(__dirname+'/quote_bridge/index.html','utf8');
const css=fs.readFileSync(__dirname+'/styles.css','utf8');
assert.match(css,/:root\[data-theme="redfish"\] :is\(input, select, textarea\) \{\s+transition: border-color \.18s ease, box-shadow \.18s ease, background-color \.18s ease;/);
for(const source of [python,bridge]) {
  assert.match(source,/\[data-testid="stTextInput"\] :is\(div, input, button\)/);
  assert.match(source,/\[data-testid="stTextInputRootElement"\]/);
  assert.match(source,/\[data-baseweb="input"\]/);
  assert.match(source,/background-image: none !important/);
  assert.match(source,/box-shadow: none !important/);
  assert.match(source,/rgba\(255, 253, 247, \.20\)/);
  assert.match(source,/:focus-within/);
  assert.match(source,/transition: border-color \.18s ease, box-shadow \.18s ease, background-color \.18s ease/);
  assert.match(source,/prefers-reduced-motion: reduce/);
}
assert(python.indexOf('stTextInputRootElement')<python.indexOf('if check_password():'),'login style must be emitted before password widget');
console.log('PASS: new/native and old/BaseWeb wrappers, nested surfaces, direct pre-login CSS, no opaque shadows');
