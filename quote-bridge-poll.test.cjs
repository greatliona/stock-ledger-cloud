const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync(__dirname + '/quote_bridge/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const messages = [], delivered = [], timers = new Map(), handlers = {};
let timerId = 0;
const frameWindow = {postMessage: message => delivered.push(message)};
const frame = {
  style: {}, contentWindow: frameWindow,
  contentDocument: {body: {getBoundingClientRect: () => ({height: 100}), scrollHeight: 100}, addEventListener() {}},
  addEventListener: (name, handler) => { handlers['frame:' + name] = handler; }
};
const parent = {postMessage: message => messages.push(message)};
const context = {
  parent, document: {getElementById: () => frame},
  window: {addEventListener: (name, handler) => { handlers[name] = handler; }},
  ResizeObserver: class {observe() {} disconnect() {}},
  requestAnimationFrame: () => 1,
  setTimeout: (callback) => { const id = ++timerId; timers.set(id, callback); return id; },
  clearTimeout: id => timers.delete(id),
};
vm.runInNewContext(script, context);
handlers.message({source: parent, data: {type: 'streamlit:render', args: {html: '<p>ledger</p>', reply: null}}});
handlers['frame:load']();
handlers.message({source: frameWindow, data: {type: 'ledger-us-quotes-request', id: 'one', symbols: ['SOXL']}});
assert(messages.some(message => message.type === 'streamlit:setComponentValue' && message.value.id === 'one' && message.value.symbols));
assert.equal(timers.size, 1);
let callback = [...timers.values()][0];
callback();
assert(messages.some(message => message.value?.id === 'one' && message.value.poll === 1));
handlers.message({source: parent, data: {type: 'streamlit:render', args: {html: '<p>ledger</p>', reply: {id: 'old'}}}});
assert.equal(delivered.length, 0);
handlers.message({source: parent, data: {type: 'streamlit:render', args: {html: '<p>ledger</p>', reply: {id: 'one', quotes: {SOXL: {price: 100}}}}}});
assert.equal(delivered.length, 1);
assert.equal(delivered[0].id, 'one');
assert.equal(timers.size, 0);
console.log('PASS: quote bridge polls while pending and delivers only the matching reply');
