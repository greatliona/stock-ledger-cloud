// Real Streamlit + browser round trip. Isolated fake quotes; no user data or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-quote-test-'));
  const portServer = net.createServer();
  await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  for (const name of ['streamlit_app.py','index.html','app.js','styles.css','xlsx.mini.min.js'])
    fs.copyFileSync(path.join(__dirname,name),path.join(root,name));
  fs.cpSync(path.join(__dirname,'quote_bridge'),path.join(root,'quote_bridge'),{recursive:true});
  fs.mkdirSync(path.join(root,'.streamlit'));
  fs.writeFileSync(path.join(root,'.streamlit','secrets.toml'),'[app]\npassword="test-only"\n');
  fs.writeFileSync(path.join(root,'quote_backend.py'), `
import time, json
from pathlib import Path
from datetime import datetime, timezone
def fetch_us_quotes(symbols, config=None):
    with Path(__file__).with_name("calls.jsonl").open("a") as f:
        f.write(json.dumps(symbols)+"\\n")
    time.sleep(5 if "SLOW" in (symbols or []) else 0.2)
    if symbols == ["ERROR"]:
        raise ValueError("測試服務失敗")
    return {"quoteProtocol":"futu-snapshot-v5","quotes":{
        s:{"price":123.45,"currency":"USD","time":datetime.now(timezone.utc).isoformat(),
        "ageSeconds":0,"timeKind":"quote","session":"正常盤","checkedPeriods":["NORMAL"]}
        for s in symbols},"errors":{},"warnings":{}}
`);
  const server = spawn(process.env.PYTHON || 'python3', ['-m','streamlit','run',path.join(root,'streamlit_app.py'),
    '--server.address','127.0.0.1','--server.port',String(port),'--server.headless','true',
    '--browser.gatherUsageStats','false'],{cwd:root,stdio:['ignore','pipe','pipe']});
  let logs='';
  server.stdout.on('data',d=>logs+=d);
  server.stderr.on('data',d=>logs+=d);
  let browser;
  try {
    const origin='http://127.0.0.1:'+port;
    let ready=false;
    for(let i=0;i<100;i++){
      try { if((await fetch(origin+'/_stcore/health')).ok){ready=true;break;} } catch {}
      await new Promise(r=>setTimeout(r,100));
    }
    assert(ready,'test Streamlit failed to start: '+logs);
    browser=await chromium.launch({headless:true,channel:'chrome'});
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    const page=await context.newPage();
    await page.goto(origin);
    await page.getByLabel('Ledger, passwords please!').fill('test-only');
    await page.getByLabel('Ledger, passwords please!').press('Enter');
    const ledger=page.frameLocator('iframe').frameLocator('#ledger');
    await ledger.locator('#reloadUsPrices').waitFor();
    const seed=async symbol=>ledger.locator('body').evaluate((_,symbol)=>{
      window.__quoteTestMount ||= 'same-document';
      state.usHoldings=[{id:'fixture',symbol,shares:1,cost:1,currentPrice:1,side:'long'}];
    },symbol);
    await seed('SLOW');
    const start=Date.now();
    await ledger.locator('#reloadUsPrices').click();
    await ledger.locator('body').evaluate(()=>new Promise(resolve=>setTimeout(()=>resolve(true),50)));
    assert(await ledger.locator('#reloadUsPrices').isDisabled(),'in-flight reload must stay disabled');
    await ledger.locator('#usQuoteStatus').filter({hasText:'SLOW 已更新'}).waitFor({timeout:15000});
    const elapsed=Date.now()-start;
    assert(elapsed<12000,'five-second provider took '+elapsed+'ms');
    assert.equal(await ledger.locator('body').evaluate(()=>window.__quoteTestMount),'same-document');
    assert.equal(await ledger.locator('body').evaluate(()=>state.usHoldings[0].currentPrice),123.45);
    await seed('FAST');
    await ledger.locator('#reloadUsPrices').click();
    await ledger.locator('#usQuoteStatus').filter({hasText:'FAST 已更新'}).waitFor({timeout:7000});
    await seed('ERROR');
    await ledger.locator('#reloadUsPrices').click();
    await ledger.locator('#usQuoteStatus').filter({hasText:'測試服務失敗'}).waitFor({timeout:7000});
    assert.equal(await ledger.locator('body').evaluate(()=>state.usHoldings[0].currentPrice),1);
    assert.deepEqual(fs.readFileSync(path.join(root,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse),
      [['SLOW'],['FAST'],['ERROR']]);
    console.log('PASS: real Streamlit/browser, 5s quote delivered in '+elapsed+'ms; no remount, duplicate or cooldown; error retains price');
  } catch(error){ console.error(logs); throw error; }
  finally {
    if(browser) await browser.close();
    server.kill('SIGTERM');
    await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));
    fs.rmSync(root,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
