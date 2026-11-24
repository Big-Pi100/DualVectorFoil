'use strict';
const path=require('path');
const {chromium}=require(path.join(process.env.NPM_GLOBAL||'D:/node-dev/npm-global','node_modules/playwright-core'));
const EXE=path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE='file:///'+path.resolve(__dirname,'SoulKeep.html').replace(/\\/g,'/');
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  const c1=await b.newContext({viewport:{width:1366,height:768}});
  const p1=await c1.newPage(); await p1.goto(FILE,{waitUntil:'load'}); await p1.waitForTimeout(2200);
  await p1.screenshot({path:'shots/unflat_desktop.png'});
  const c2=await b.newContext({viewport:{width:900,height:600},hasTouch:true,isMobile:true});
  const p2=await c2.newPage(); await p2.goto(FILE,{waitUntil:'load'}); await p2.waitForTimeout(2200);
  await p2.screenshot({path:'shots/unflat_touch.png'});
  await b.close(); console.log('ok');
})();
