'use strict';
const path=require('path');
const {chromium}=require(path.join(process.env.NPM_GLOBAL||'D:/node-dev/npm-global','node_modules/playwright-core'));
const EXE=path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE='file:///'+path.resolve(__dirname,'style_proto.html').replace(/\\/g,'/');
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  const p=await (await b.newContext({viewport:{width:1280,height:720},deviceScaleFactor:2})).newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  await p.goto(FILE,{waitUntil:'load'});
  await p.waitForTimeout(900);
  // 出招到 0.16s（已过前摇，刀光最长）
  await p.evaluate(()=>window.__proto.freezeAt(3.1, 0.17));
  await p.waitForTimeout(250);
  await p.screenshot({path:'shots/proto_n1_attack.png'});
  // 不出招
  await p.evaluate(()=>window.__proto.freezeAt(3.1, null));
  await p.waitForTimeout(200);
  await p.screenshot({path:'shots/proto_n1_idle.png'});
  console.log('errs:', errs.slice(0,4));
  await b.close();
})();
