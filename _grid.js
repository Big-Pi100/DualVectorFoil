const path=require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL||'D:/node-dev/npm-global','node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE='file:///'+path.resolve(__dirname,'SoulKeep.html').replace(/\\/g,'/')+'?room=paper';
(async()=>{
  const b=await chromium.launch({executablePath:EXE,headless:true});
  const p=await b.newPage();
  await p.goto(FILE,{waitUntil:'load'});
  await new Promise(r=>setTimeout(r,600));
  const g=await p.evaluate(()=>window.__sk.grid());
  g.forEach((row,i)=>console.log(String(i).padStart(2)+' '+row));
  await b.close();
})();
