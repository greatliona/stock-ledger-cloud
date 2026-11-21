const fs=require('node:fs'), assert=require('node:assert/strict');
const python=fs.readFileSync(__dirname+'/streamlit_app.py','utf8');
const bridge=fs.readFileSync(__dirname+'/quote_bridge/index.html','utf8');
for(const source of [python,bridge]) {
  assert.match(source,/\[data-testid="stTextInput"\] :is\(div, input, button\)/);
  assert.match(source,/\[data-testid="stTextInputRootElement"\]/);
  assert.match(source,/\[data-baseweb="input"\]/);
  assert.match(source,/background-image: none !important/);
  assert.match(source,/box-shadow: none !important/);
  assert.match(source,/rgba\(255, 250, 240, \.24\)/);
}
assert(python.indexOf('stTextInputRootElement')<python.indexOf('if check_password():'),'login style must be emitted before password widget');
console.log('PASS: new/native and old/BaseWeb wrappers, nested surfaces, direct pre-login CSS, no opaque shadows');
