const path=require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL||'D:/node-dev/npm-global','node_modules/playwright-core'));
const EXE=path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE='file:///'+path.resolve(__dirname,'SoulKeep.html').replace(/\\/g,'/');
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  const p=await (await b.newContext({viewport:{width:1440,height:810}})).newPage();
  await p.goto(FILE,{waitUntil:'load'}); await p.waitForTimeout(1500);
  const r = await p.evaluate(()=>{
    const fs = window.__sk.foes();
    const st = window.__sk.state();
    return { st:{x:st.x,y:st.y,hp:st.hp}, foes:fs };
  });
  console.log('初始', JSON.stringify(r));
  const d0 = r.foes[0];
  const px = d0.x - 130, py = d0.y + d0.h - 100;
  const r2 = await p.evaluate(([x,y])=>{
    window.__sk.place(x,y); window.__sk.setHp(120);
    return { st:window.__sk.state(), foes:window.__sk.foes() };
  },[px,py]);
  console.log('place 后', JSON.stringify({st:r2.st.x+','+r2.st.y, foes:r2.foes}));
  await p.waitForTimeout(1000);
  await p.evaluate(()=>{ window.__sk.hurt(80); });
  await p.waitForTimeout(1000);
  const r3 = await p.evaluate(()=>{
    const before = { st:window.__sk.state(), foes:window.__sk.foes() };
    window.__sk.hurt(9999);
    return { before, after:{st:window.__sk.state(), foes:window.__sk.foes()} };
  });
  const P = r3.after.st;
  console.log('打之前', JSON.stringify({p:[P.x,P.y], foes:r3.before.foes, hp:r3.before.st.hp}));
  console.log('hurt80 后', JSON.stringify({hp:r3.before.st.hp, invuln:r3.before.st.invuln}));
  console.log('致死刀后', JSON.stringify({hp:r3.after.st.hp, cd:r3.after.st.ohpCd, foes:r3.after.foes}));
  await b.close();
})();
