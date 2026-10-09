// Isolated browser test: fresh storage, no cloud credentials, external network blocked.
const fs = require("fs"), http = require("http"), assert = require("assert");
const { chromium } = require("playwright");
const read = name => fs.readFileSync(__dirname + "/" + name, "utf8");
let app = read("index.html").replace(/<link\s+rel="stylesheet"\s+href="styles.css[^"]*"\s*\/>/,
  () => "<style>" + read("styles.css") + "</style>")
  .replace(/<script src="xlsx.mini.min.js[^"]*"><\/script>/, () => "<script>" + read("xlsx.mini.min.js") + "</script>")
  .replace(/<script src="app.js[^"]*"><\/script>/, () => "<script>" + read("app.js") + "</script>");
const shell = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>body{margin:0}iframe{display:block;border:0;width:100%;height:1px}</style>' +
  '<button onclick="scrollTo(0,document.body.scrollHeight)">測試捲到最底</button>' +
  '<iframe id="outer" src="/bridge"></iframe><script>' +
  'const f=document.querySelector("#outer");addEventListener("message",e=>{' +
  'if(e.source!==f.contentWindow)return;if(e.data.type==="streamlit:setFrameHeight")f.style.height=e.data.height+"px";' +
  'if(e.data.type==="streamlit:componentReady")f.contentWindow.postMessage({type:"streamlit:render",args:{html:' +
  JSON.stringify(app).replace(/</g, "\\u003c") + '}}, "*")});</script>';
const server = http.createServer((req,res)=>{res.setHeader("Content-Type","text/html");res.end(req.url==="/bridge"?read("quote_bridge/index.html"):shell);});
(async()=>{
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+server.address().port;
  if(process.argv.includes("--serve")){console.log(origin);return;}
  const browser=await chromium.launch({headless:true, channel:"chrome"});
  try {
    for(const width of [390, 430, 1280]){
      const context=await browser.newContext({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500});
      await context.route("**/*",route=>route.request().url().startsWith(origin)?route.continue():route.abort());
      const page=await context.newPage();
      await page.goto(origin);
      const inner=page.frameLocator("#outer").frameLocator("#ledger");
      await inner.locator("#stockPieChart").waitFor();
      await page.waitForFunction(()=>document.querySelector("#outer").offsetHeight>2000);
      const dimensions=()=>page.evaluate(()=>{
        const outer=document.querySelector("#outer"), frame=outer.contentDocument.querySelector("#ledger");
        return {outer:outer.offsetHeight,inner:frame.offsetHeight,body:frame.contentDocument.body.scrollHeight};
      });
      let d=await dimensions();
      assert(Math.abs(d.outer-d.body)<=2 && d.inner===d.outer, JSON.stringify(d));
      await inner.locator(".app-shell").evaluate(el=>{const x=document.createElement("div");x.id="test-expansion";x.style.height="2400px";el.append(x);});
      await page.waitForFunction(old=>document.querySelector("#outer").offsetHeight>old+2300,d.outer);
      await inner.locator("#test-expansion").evaluate(el=>el.remove());
      await page.waitForFunction(old=>Math.abs(document.querySelector("#outer").offsetHeight-old)<3,d.outer);
      await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
      const bottom=await inner.locator(".backup-tools").evaluate(el=>{
        const outer=window.parent.frameElement.getBoundingClientRect();
        return outer.top+window.frameElement.getBoundingClientRect().top+el.getBoundingClientRect().bottom;
      });
      assert(bottom<=846 && bottom>0, "bottom unreachable: "+bottom);
      console.log("PASS width="+width+": full page "+d.outer+"px; expand/shrink; bottom reachable");
      await context.close();
    }
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
