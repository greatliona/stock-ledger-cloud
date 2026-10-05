const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync("app.js", "utf8");
const fn = source.slice(source.indexOf("async function fetchBinanceContractPrice("), source.indexOf("async function refreshCryptoPrice("));
let calls = 0;
let payload = { symbol: "BTCUSDT", price: "84500.25" };
let status = 200;
const context = vm.createContext({
  AbortController, setTimeout, clearTimeout,
  fetch: async (url, options) => {
    calls++;
    assert.equal(url, "https://fapi.binance.com/fapi/v2/ticker/price?symbol=BTCUSDT");
    assert.equal(options.credentials, "omit");
    return { ok: status === 200, status, json: async () => payload };
  }
});
vm.runInContext(fn, context);
(async () => {
  assert.equal(await context.fetchBinanceContractPrice("BTCUSDT"), 84500.25);
  assert.equal(calls, 1);
  await assert.rejects(context.fetchBinanceContractPrice("BTC"), /完整/);
  assert.equal(calls, 1);
  payload = { symbol: "ETHUSDT", price: "100" };
  await assert.rejects(context.fetchBinanceContractPrice("BTCUSDT"), /無效/);
  payload = { symbol: "BTCUSDT", price: "0" };
  await assert.rejects(context.fetchBinanceContractPrice("BTCUSDT"), /無效/);
  status = 429;
  await assert.rejects(context.fetchBinanceContractPrice("BTCUSDT"), /受限/);
  console.log("PASS: public endpoint, no credentials, valid price, invalid symbol/price and rate limit");
})().catch(error => { console.error(error); process.exitCode = 1; });
