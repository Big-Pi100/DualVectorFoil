const path=require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL||'D:/node-dev/npm-global','node_modules/playwright-core'));
const EXE=path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE='file:///'+path.resolve(__dirname,'SoulKeep.html').replace(/\\/g,'/');
const out=n=>path.join(__dirname,'shots',n);
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  // 桌面
  {
    const ctx=await b.newContext({viewport:{width:1366,height:768}});
    const p=await ctx.newPage();
    await p.goto(FILE,{waitUntil:'load'}); await p.waitForTimeout(1200);
    await p.locator('#stage').screenshot({path:out('wo4_a_desktop.png')});
    await p.keyboard.press('o'); await p.waitForTimeout(300);
    await p.evaluate(()=>document.querySelector('.tab[data-pane="Ops"]').click()); await p.waitForTimeout(250);
    await p.locator('#stage').screenshot({path:out('wo4_b_desktop_ops.png')});
    await ctx.close();
  }
  // 触屏
  {
    const ctx=await b.newContext({viewport:{width:844,height:390},hasTouch:true,deviceScaleFactor:2});
    const p=await ctx.newPage();
    await p.goto(FILE+'?touch=1',{waitUntil:'load'}); await p.waitForTimeout(1600);
    await p.screenshot({path:out('wo4_c_touch_play.png')});
    await p.keyboard.press('o'); await p.waitForTimeout(320);
    await p.evaluate(()=>document.querySelector('.tab[data-pane="Ops"]').click()); await p.waitForTimeout(280);
    await p.screenshot({path:out('wo4_d_touch_ops.png')});
    await p.evaluate(()=>document.getElementById('layedit').click()); await p.waitForTimeout(400);
    await p.screenshot({path:out('wo4_e_touch_edit.png')});
    // 把剑格拖高一点、把交互键拖走
    const s=await p.evaluate(()=>{const r=document.getElementById('slotw1').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
    await p.mouse.move(s.x,s.y); await p.mouse.down(); await p.mouse.move(s.x-30,s.y-120,{steps:8}); await p.mouse.up();
    await p.waitForTimeout(250);
    await p.screenshot({path:out('wo4_f_touch_edit_dragged.png')});
    await ctx.close();
  }
  await b.close(); console.log('ok');
})();
