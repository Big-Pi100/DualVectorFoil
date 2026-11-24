const path=require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL||'D:/node-dev/npm-global','node_modules/playwright-core'));
const EXE=path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE='file:///'+path.resolve(__dirname,'SoulKeep.html').replace(/\\/g,'/');
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  const ctx=await b.newContext({viewport:{width:844,height:390},hasTouch:true,deviceScaleFactor:2});
  const p=await ctx.newPage();
  await p.goto(FILE+'?touch=1',{waitUntil:'load'});
  await p.waitForTimeout(1800);
  const info=await p.evaluate(()=>{
    const ids=['pbMenu','slotw1','slotw2','slotred','slotblue','pbJump','pbRoll','pbUse'];
    const o={vw:innerWidth,vh:innerHeight,els:{}};
    ids.forEach(id=>{
      const e=document.getElementById(id); if(!e) return;
      const r=e.getBoundingClientRect();
      o.els[id]={x:+r.left.toFixed(1),y:+r.top.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),
                 right:+(innerWidth-r.right).toFixed(1), bottom:+(innerHeight-r.bottom).toFixed(1),
                 cls:e.className, txt:(e.textContent||'').trim().slice(0,10),
                 br:getComputedStyle(e).borderTopLeftRadius};
    });
    return o;
  });
  require('fs').writeFileSync(path.join(__dirname,'shots','ours_rect.json'), JSON.stringify(info,null,1));
  console.log(JSON.stringify(info,null,1));
  await p.screenshot({path:path.join(__dirname,'shots','ours_touch2.png')});
  await b.close();
})();
