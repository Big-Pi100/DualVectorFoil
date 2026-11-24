'use strict';
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/') + '?room=hall';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.goto(FILE, { waitUntil: 'load' }); await sleep(700);
  await page.keyboard.press('Enter'); await sleep(1400);
  await page.keyboard.down('d'); await sleep(600); await page.keyboard.up('d'); await sleep(400);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'hud_legend_full.png') });
  const box = await page.evaluate(() => {
    const r = document.querySelector('#keys').getBoundingClientRect();
    const l = document.querySelector('#log').getBoundingClientRect();
    return { keys:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width)},
             log:{x:Math.round(l.x),y:Math.round(l.y),w:Math.round(l.width)},
             collide: !(r.x > l.x + l.width || l.x > r.x + r.width) };
  });
  console.log(JSON.stringify(box));
  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
