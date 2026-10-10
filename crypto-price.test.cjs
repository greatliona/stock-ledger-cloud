const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync("app.js", "utf8");
const fn = source.slice(source.indexOf("async function fetchBinanceContractPrices("), source.indexOf("async function refreshAllCryptoPrices("));
let calls = 0;
let payload = [{ symbol: "BTCUSDT", price: "84500.25", time: Date.now() }];
let status = 200;
const context = vm.createContext({
  AbortController, setTimeout, clearTimeout,
  fetch: async (url, options) => {
    calls++;
    assert.equal(url, "https://fapi.binance.com/fapi/v2/ticker/price");
    assert.equal(options.credentials, "omit");
    return { ok: status === 200, status, json: async () => payload };
  }
});
vm.runInContext(fn, context);
(async () => {
  assert.equal((await context.fetchBinanceContractPrices(["BTCUSDT"])).get("BTCUSDT").price, 84500.25);
  assert.equal(calls, 1);
  payload = [{ symbol: "ETHUSDT", price: "100", time: Date.now() }];
  assert.equal((await context.fetchBinanceContractPrices(["BTCUSDT"])).size,0);
  payload = [{ symbol: "BTCUSDT", price: "0", time: Date.now() }];
  assert.equal((await context.fetchBinanceContractPrices(["BTCUSDT"])).size,0);
  status = 429;
  await assert.rejects(context.fetchBinanceContractPrices(["BTCUSDT"]), /受限/);
  console.log("PASS: public endpoint, no credentials, valid price, invalid symbol/price and rate limit");
})().catch(error => { console.error(error); process.exitCode = 1; });
