'use strict';
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/') + '?room=hall';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  for (const w of [1280, 1100, 900]) {
    const page = await b.newPage({ viewport: { width: w, height: 720 }, deviceScaleFactor: 3 });
    await page.goto(FILE, { waitUntil: 'load' });
    await sleep(800);
    const el = await page.$('#keys');
    const info = await page.evaluate(() => {
      const k = document.querySelector('#keys');
      const r = k.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height),
        scrollW: k.scrollWidth, sw: window.innerWidth,
        overflow: k.scrollWidth > k.clientWidth + 1 };
    });
    console.log(w, JSON.stringify(info));
    if (el) await el.screenshot({ path: path.join(__dirname, 'shots', 'legend_' + w + '.png') });
    await page.close();
  }
  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
