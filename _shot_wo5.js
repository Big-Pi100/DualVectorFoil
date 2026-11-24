const path=require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL||'D:/node-dev/npm-global','node_modules/playwright-core'));
const EXE=path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE='file:///'+path.resolve(__dirname,'SoulKeep.html').replace(/\\/g,'/');
const out=n=>path.join(__dirname,'shots',n);
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  {
    const ctx=await b.newContext({viewport:{width:1366,height:768}});
    const p=await ctx.newPage();
    await p.goto(FILE,{waitUntil:'load'}); await p.waitForTimeout(1400);
    await p.screenshot({path:out('wo5_a_desktop.png')});
    await ctx.close();
  }
  {
    const ctx=await b.newContext({viewport:{width:844,height:390},hasTouch:true,deviceScaleFactor:2});
    const p=await ctx.newPage();
    await p.goto(FILE+'?touch=1',{waitUntil:'load'}); await p.waitForTimeout(1800);
    await p.evaluate(()=>{const h=document.getElementById('touchhint'); if(h) h.classList.add('off');});
    await p.waitForTimeout(700);
    await p.screenshot({path:out('wo5_b_touch.png')});
    // 元素包围盒，用来核对锚点
    const box = await p.evaluate(()=>{
      const ids=['slotw1','slotw2','slotred','slotblue','pbJump','pbRoll','pbUse'];
      const o={};
      for (const id of ids){ const r=document.getElementById(id).getBoundingClientRect();
        o[id]={l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),
               r:Math.round(innerWidth-r.right), b:Math.round(innerHeight-r.bottom)}; }
      o.view=[innerWidth,innerHeight];
      return o;
    });
    console.log(JSON.stringify(box,null,1));
    await ctx.close();
  }
  await b.close(); console.log('ok');
})();
