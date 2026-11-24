'use strict';
const path=require('path');
const {chromium}=require(path.join(process.env.NPM_GLOBAL||'D:/node-dev/npm-global','node_modules/playwright-core'));
const EXE=path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE='file:///'+path.resolve(__dirname,'style_lab.html').replace(/\\/g,'/');
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  const p=await (await b.newContext({viewport:{width:1560,height:900},deviceScaleFactor:2})).newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  await p.goto(FILE,{waitUntil:'load'});
  await p.waitForFunction(()=>window.__labReady===true,{timeout:8000}).catch(()=>{});
  await p.waitForTimeout(600);
  await p.screenshot({path:'shots/style_menu.png',fullPage:true});
  // 单张：每格裁出来，方便对比
  const cells = await p.$$('.cell');
  for(let i=0;i<cells.length;i++) await cells[i].screenshot({path:`shots/style_${i}.png`});
  console.log('tiles:', cells.length, 'errs:', errs.slice(0,3));
  await b.close();
})();
