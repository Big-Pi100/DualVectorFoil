'use strict';
const path=require('path');
const {chromium}=require(path.join(process.env.NPM_GLOBAL||'D:/node-dev/npm-global','node_modules/playwright-core'));
const EXE=path.join(process.env.USERPROFILE,'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE='file:///'+path.resolve(__dirname,'SoulKeep.html').replace(/\\/g,'/');
(async()=>{
  const b=await chromium.launch({executablePath:EXE});
  for (const vp of [{width:1440,height:810,name:'桌面'},{width:900,height:600,name:'触屏',touch:true}]) {
    const ctx=await b.newContext({viewport:{width:vp.width,height:vp.height},hasTouch:!!vp.touch,isMobile:!!vp.touch});
    const p=await ctx.newPage();
    const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
    await p.goto(FILE,{waitUntil:'load'});
    await p.waitForTimeout(1600);
    const r=await p.evaluate(()=>{
      const bb=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return [Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)];};
      const cs=s=>{const e=document.querySelector(s);if(!e)return null;const c=getComputedStyle(e);return c.top+'|'+c.left+'|'+c.visibility+'|'+c.display;};
      const off=s=>{const e=document.querySelector(s);return e?[e.offsetTop,e.offsetHeight,e.offsetLeft]:null;};
      return {barsOff:off('#bars'),flaskOff:off('#flask'),barsBottom:off('#bars')[0]+off('#bars')[1],
              flaskTop:off('#flask')[0],gap:off('#flask')[0]-(off('#bars')[0]+off('#bars')[1]),
              flaskCss:cs('#flask'), barsCss:cs('#bars'), inkrow:!!document.getElementById('inkrow')};
    });
    console.log(vp.name, JSON.stringify(r));
    if(errs.length) console.log('  ERR', errs.slice(0,2));
    await ctx.close();
  }
  await b.close();
})();
