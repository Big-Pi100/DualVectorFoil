'use strict';
const path=require('path'),fs=require('fs');
const {chromium}=require(path.join(process.env.NPM_GLOBAL||'D:/node-dev/npm-global','node_modules/playwright-core'));
const EXE=path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE='file:///'+path.resolve(__dirname,'SoulKeep.html').replace(/\\/g,'/');
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  const p=await (await b.newContext({viewport:{width:1280,height:760},deviceScaleFactor:2})).newPage();
  await p.goto(FILE,{waitUntil:'load'}); await p.waitForTimeout(1500);
  const url=await p.evaluate(()=>{
    P.state='stand';P.animT=0;P.sq=1;render(0);
    msg='所以他还没被拍死。'; msgT=1.9;      // 满 alpha，量"最好情况"能不能读
    render(0);
    const cv=document.getElementById('cv'),c=cv.getContext('2d');
    const RSv=cv.width/VIEW_W;
    const off=document.createElement('canvas'); off.width=Math.round(620*RSv); off.height=Math.round(120*RSv);
    off.getContext('2d').drawImage(cv,Math.round(170*RSv),Math.round(40*RSv),off.width,off.height,0,0,off.width,off.height);
    return off.toDataURL();
  });
  fs.writeFileSync(path.join(__dirname,'shots','msg_check.png'),Buffer.from(url.split(',')[1],'base64'));
  console.log('→ shots/msg_check.png'); await b.close();
})();
