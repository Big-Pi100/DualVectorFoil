const path=require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL||'D:/node-dev/npm-global','node_modules/playwright-core'));
const EXE=path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE='file:///'+path.resolve(__dirname,'SoulKeep.html').replace(/\\/g,'/');
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  const p=await (await b.newContext({viewport:{width:1440,height:810}})).newPage();
  await p.goto(FILE,{waitUntil:'load'}); await p.waitForTimeout(1400);
  const r = await p.evaluate(()=>{
    const el=document.getElementById('flask');
    const cs=getComputedStyle(el);
    const cx=el.getBoundingClientRect().left+el.getBoundingClientRect().width/2;
    const cy=el.getBoundingClientRect().top+el.getBoundingClientRect().height/2;
    const top=document.elementFromPoint(cx,cy);
    return {hasOnclick:typeof el.onclick, pe:cs.pointerEvents, disp:cs.display,
      center:[Math.round(cx),Math.round(cy)], topEl: top ? (top.id||top.className||top.tagName) : null,
      parent: el.parentElement && (el.parentElement.id||el.parentElement.tagName)};
  });
  console.log(JSON.stringify(r));
  await b.close();
})();
