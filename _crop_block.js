// _crop_block.js — 1:1 裁剪：144px 矮墙（缝 + 缝后的东西）与纸灯笼
// 舞台有 transform scale，必须用 CSS matrix 算屏幕坐标，否则裁出来的位置全错。
'use strict';
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/') + '?room=paper';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3 });
  await page.goto(FILE, { waitUntil: 'load' });
  await sleep(700); await page.keyboard.press('Enter'); await sleep(400);

  const geo = () => page.evaluate(() => {
    const st = document.getElementById('stage');
    const r = st.getBoundingClientRect();
    const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(st).transform);
    const s = m ? parseFloat(m[1].split(',')[0]) : 1;
    const cam = window.__sk.cam();
    return { left: r.left, top: r.top, s, camX: cam.x, camY: cam.y };
  });
  const crop = async (name, g, x0, y0, x1, y1) => {
    const sx = (cx) => g.left + (cx - g.camX) * g.s;
    const sy = (cy) => g.top + (cy - g.camY) * g.s;
    const clip = { x: Math.round(sx(x0)), y: Math.round(sy(y0)),
                   width: Math.round(sx(x1) - sx(x0)), height: Math.round(sy(y1) - sy(y0)) };
    await page.screenshot({ path: path.join(__dirname, 'shots', name), clip });
    return clip;
  };

  // 矮墙：x 11..17 格，y 11..16 格
  await page.evaluate(() => window.__sk.place(10 * 48 + 8, 620));
  await sleep(600);
  let g = await geo();
  console.log('block clip', JSON.stringify(await crop('zoom_block.png', g, 11 * 48, 11 * 48, 17 * 48, 16 * 48)));

  // 灯笼：出生点那盏
  await page.evaluate(() => window.__sk.place(4 * 48 + 60, 620));
  await sleep(600);
  g = await geo();
  console.log('lamp clip', JSON.stringify(await crop('zoom_lamp.png', g, 4 * 48 - 90, 720 - 210, 4 * 48 + 90, 730)));

  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
