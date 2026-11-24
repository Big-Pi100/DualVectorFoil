const path=require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL||'D:/node-dev/npm-global','node_modules/playwright-core'));
const EXE=path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE='file:///'+path.resolve(__dirname,'SoulKeep.html').replace(/\\/g,'/');
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  { // 桌面
    const ctx=await b.newContext({viewport:{width:1366,height:768}});
    const p=await ctx.newPage();
    await p.goto(FILE,{waitUntil:'load'}); await p.waitForTimeout(1400);
    await p.screenshot({path:path.join(__dirname,'shots','lay_desktop.png')});
    await ctx.close();
  }
  { // 触屏
    const ctx=await b.newContext({viewport:{width:844,height:390},hasTouch:true,deviceScaleFactor:2});
    const p=await ctx.newPage();
    await p.goto(FILE+'?touch=1',{waitUntil:'load'}); await p.waitForTimeout(1800);
    await p.screenshot({path:path.join(__dirname,'shots','lay_touch.png')});
    await ctx.close();
  }
  await b.close(); console.log('ok');
})();
