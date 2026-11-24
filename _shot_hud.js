const path=require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL||'D:/node-dev/npm-global','node_modules/playwright-core'));
const EXE=path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE='file:///'+path.resolve(__dirname,'SoulKeep.html').replace(/\\/g,'/');
const out=n=>path.join(__dirname,'shots',n);
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  {
    const ctx=await b.newContext({viewport:{width:1440,height:810}});
    const p=await ctx.newPage();
    await p.goto(FILE,{waitUntil:'load'}); await p.waitForTimeout(1600);
    await p.screenshot({path:out('hud_desktop.png')});
    const info = await p.evaluate(()=>{
      const g=id=>{const e=document.getElementById(id); if(!e) return null; const r=e.getBoundingClientRect();
        return {l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};};
      return {flask:g('flask'), mm:g('mm'), flaskn:document.getElementById('flaskn')?.textContent,
              stage:g('stage'), bars:g('bars'), hp:window.__sk.state?.hp};
    });
    console.log(JSON.stringify(info));
    await ctx.close();
  }
  {
    const ctx=await b.newContext({viewport:{width:844,height:390},hasTouch:true,deviceScaleFactor:2});
    const p=await ctx.newPage();
    await p.goto(FILE+'?touch=1',{waitUntil:'load'}); await p.waitForTimeout(1800);
    await p.evaluate(()=>{const h=document.getElementById('touchhint'); if(h) h.classList.add('off');});
    await p.waitForTimeout(600);
    await p.screenshot({path:out('hud_touch.png')});
    await ctx.close();
  }
  await b.close(); console.log('ok');
})();
