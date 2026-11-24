const path=require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL||'D:/node-dev/npm-global','node_modules/playwright-core'));
const EXE=path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE='file:///'+path.resolve(__dirname,'SoulKeep.html').replace(/\\/g,'/');
const out=n=>path.join(__dirname,'shots',n);
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  const ctx=await b.newContext({viewport:{width:1440,height:810}});
  const p=await ctx.newPage();
  await p.goto(FILE,{waitUntil:'load'});
  await p.waitForTimeout(1600);
  await p.evaluate(()=>{const h=document.getElementById('touchhint'); if(h) h.classList.add('off');});
  const bars = async ()=>{ const r=await p.evaluate(()=>{const e=document.getElementById('bars').getBoundingClientRect();
    return {x:Math.round(e.left),y:Math.round(e.top),w:Math.round(e.width),h:Math.round(e.height)};}); return r; };

  // 1) 满血
  await p.evaluate(()=>window.__sk.setHp(120));
  await p.waitForTimeout(300);
  let r = await bars();
  await p.screenshot({path:out('p1_1_full.png'), clip:{x:r.x-10,y:r.y-8,width:r.w+20,height:r.h+16}});

  // 2) 受伤 40 → 斜纹可夺回段
  await p.evaluate(()=>window.__sk.hurt(40));
  await p.waitForTimeout(400);
  r = await bars();
  await p.screenshot({path:out('p1_2_rally.png'), clip:{x:r.x-10,y:r.y-8,width:r.w+20,height:r.h+16}});

  // 3) 打到 1 HP（一击保护）+ 屏幕提示
  /* 先等无敌帧过去：上一次受伤给了 0.9 秒 invuln，这段时间里的伤害会被
   * hurtPlayer 直接 return —— 不等就会截到"还停在 60 血"的画面。 */
  await p.waitForTimeout(1100);
  await p.evaluate(()=>{window.__sk.setHp(60);});
  await p.waitForTimeout(200);
  await p.evaluate(()=>window.__sk.hurt(9999));
  await p.waitForTimeout(260);
  r = await bars();
  await p.screenshot({path:out('p1_3_ohp.png'), clip:{x:r.x-10,y:r.y-8,width:r.w+20,height:r.h+16}});
  await p.screenshot({path:out('p1_3_full.png')});
  console.log('ok');
  await b.close();
})();
