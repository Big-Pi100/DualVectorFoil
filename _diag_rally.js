const path=require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL||'D:/node-dev/npm-global','node_modules/playwright-core'));
const EXE=path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE='file:///'+path.resolve(__dirname,'SoulKeep.html').replace(/\\/g,'/');
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  const p=await (await b.newContext({viewport:{width:1440,height:810}})).newPage();
  await p.goto(FILE,{waitUntil:'load'}); await p.waitForTimeout(1500);
  await p.evaluate(()=>window.__sk.setHp(120));
  await p.evaluate(()=>window.__sk.hurt(30));
  await p.waitForTimeout(300);
  console.log('受伤后', JSON.stringify(await p.evaluate(()=>{
    const r=document.getElementById('hprally'); const cs=getComputedStyle(r);
    return {rect:r.getBoundingClientRect().width, w:cs.width, left:cs.left, st:r.style.cssText, rally:window.__sk.state().rally};
  })));
  await p.waitForTimeout(3000);
  console.log('过期后', JSON.stringify(await p.evaluate(()=>{
    const r=document.getElementById('hprally'); const cs=getComputedStyle(r);
    return {rect:r.getBoundingClientRect().width, w:cs.width, left:cs.left, st:r.style.cssText, rally:window.__sk.state().rally, t:window.__sk.state().rallyT};
  })));
  await b.close();
})();
