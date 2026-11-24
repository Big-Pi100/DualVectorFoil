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
  // 停在缝正中间：x = 12*48 + 21 = 597（身宽 6，中心 600）
  await page.evaluate(() => window.__sk.place(12 * 48 + 21, 620));
  await sleep(300);
  await page.keyboard.down('f');
  await sleep(500);
  const st = await page.evaluate(() => window.__sk.state());
  console.log('still:', JSON.stringify({ x: st.x, cw: st.cw, state: st.state, vx: st.vx }));
  const g = await page.evaluate(() => {
    const el = document.getElementById('stage');
    const r = el.getBoundingClientRect();
    const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(el).transform);
    const cam = window.__sk.cam();
    return { left: r.left, top: r.top, s: m ? parseFloat(m[1].split(',')[0]) : 1, camX: cam.x, camY: cam.y };
  });
  const sx = cx => g.left + (cx - g.camX) * g.s, sy = cy => g.top + (cy - g.camY) * g.s;
  const clip = { x: Math.round(sx(12 * 48 - 24)), y: Math.round(sy(12 * 48)),
                 width: Math.round(sx(12 * 48 + 72) - sx(12 * 48 - 24)),
                 height: Math.round(sy(15 * 48 + 8) - sy(12 * 48)) };
  await page.screenshot({ path: path.join(__dirname, 'shots', 'zoom_inside_still.png'), clip });
  await page.keyboard.up('f');
  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
