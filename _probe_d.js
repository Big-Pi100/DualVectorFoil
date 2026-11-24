const path=require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL||'D:/node-dev/npm-global','node_modules/playwright-core'));
const EXE=path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE='file:///'+path.resolve(__dirname,'SoulKeep.html').replace(/\\/g,'/');
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  const ctx=await b.newContext({viewport:{width:1366,height:768}});
  const p=await ctx.newPage();
  await p.goto(FILE,{waitUntil:'load'}); await p.waitForTimeout(1200);
  const r = await p.evaluate(()=>{
    const st=document.getElementById('stage').getBoundingClientRect();
    const sl=document.getElementById('slots').getBoundingClientRect();
    const o={stage:{l:st.left,t:st.top,w:st.width,h:st.height},
             slots:{l:sl.left,t:sl.top,w:sl.width,h:sl.height},
             scale:getComputedStyle(document.getElementById('stage')).getPropertyValue('--s')};
    for (const id of ['slotw1','slotw2','slotred','slotblue']){
      const q=document.getElementById(id).getBoundingClientRect();
      o[id]={l:Math.round(q.left),t:Math.round(q.top),w:Math.round(q.width),h:Math.round(q.height),
             r:Math.round(st.right-q.right), b:Math.round(st.bottom-q.bottom)};
    }
    o.slotsCS = {pos:getComputedStyle(document.getElementById('slots')).position,
                 bottom:getComputedStyle(document.getElementById('slots')).bottom};
    return o;
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})();
