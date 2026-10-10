// Isolated browser, fake contracts and intercepted quotes; never loads production.
const fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const files={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/xlsx.mini.min.js':'xlsx.mini.min.js'};
const server=http.createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname,file=files[path];if(!file){res.writeHead(404);return res.end();}res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(__dirname+'/'+file));});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  if(process.argv.includes('--serve')){console.log(origin);return;}
  let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});
    for(const width of [320,390,430,1280]){
      const context=await browser.newContext({viewport:{width,height:900}});
      let requests=0;
      await context.route('**/*',route=>{
        const url=route.request().url();
        if(url.startsWith(origin))return route.continue();
        if(url==='https://fapi.binance.com/fapi/v2/ticker/price'){requests++;return route.fulfill({contentType:'application/json',body:JSON.stringify([{symbol:'BTCUSDT',price:'110',time:Date.now()}])});}
        return route.abort();
      });
      const page=await context.newPage();
      await page.goto(origin);
      await page.locator('#reloadCryptoPrices svg').waitFor({state:'attached'});
      await page.evaluate(()=>{state.cryptoContracts=[{id:'fake-long',name:'BTCUSDT',side:'long',marginUsdt:1000,leverage:1,quantity:1,entryPrice:100,currentPrice:100},{id:'fake-short',name:'BTCUSDT',side:'short',marginUsdt:1000,leverage:1,quantity:1,entryPrice:100,currentPrice:100}];renderCryptoContracts();});
      assert.equal(await page.locator('[data-refresh-crypto], .crypto-reload').count(),0);
      const box=await page.locator('#cryptoForm').evaluate(form=>{const add=form.querySelector('.add-button').getBoundingClientRect(),reload=form.querySelector('#reloadCryptoPrices').getBoundingClientRect(),bounds=form.getBoundingClientRect();return {add:{x:add.x,y:add.y,right:add.right},reload:{x:reload.x,y:reload.y,right:reload.right},right:bounds.right};});
      assert(Math.abs(box.add.y-box.reload.y)<1,JSON.stringify({width,box}));
      assert(box.reload.x>=box.add.right && box.reload.right<=box.right+1,JSON.stringify({width,box}));
      await page.locator('#reloadCryptoPrices').click();
      await page.waitForFunction(()=>document.querySelector('#cryptoQuoteStatus').textContent.includes('已更新 2 筆'));
      assert.equal(requests,1);
      assert.deepEqual(await page.evaluate(()=>state.cryptoContracts.map(c=>({price:c.currentPrice,pnl:calculateCryptoPosition(c).pnlUsdt}))),[{price:110,pnl:10},{price:110,pnl:-10}]);
      if(width===390){await page.locator('.crypto-panel').screenshot({path:'/tmp/crypto-batch-mobile.png'});}
      console.log('PASS: '+width+'px +/reload same row, within form; one request updates both directions');
      await context.close();
    }
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
