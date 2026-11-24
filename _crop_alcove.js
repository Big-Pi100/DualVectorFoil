// _crop_alcove.js — 按"游戏自己的镜头 + CSS 缩放"算坐标，精确裁出壁龛那一块（1:1，DSF=2）
'use strict';
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/') + '?room=paper';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.goto(FILE, { waitUntil: 'load' });
  await sleep(700);
  await page.keyboard.press('Enter');
  await sleep(300);

  // 走过去站在壁龛前
  await page.keyboard.down('d');
  await sleep(2400);
  await page.keyboard.up('d');
  await sleep(400);

  const info = await page.evaluate(() => {
    const st = document.getElementById('stage');
    const r = st.getBoundingClientRect();
    const cs = getComputedStyle(st);
    const m = /matrix\(([^)]+)\)/.exec(cs.transform);
    const s = m ? parseFloat(m[1].split(',')[0]) : 1;
    const cam = window.__sk.cam();
    const p = window.__sk.state();
    return { left: r.left, top: r.top, s, camX: cam.x, camY: cam.y,
             px: p.x, py: p.y, state: p.state, room: p.room };
  });
  console.log(JSON.stringify(info));
  /* 逻辑坐标 -> 视口坐标：先减镜头，再乘缩放，再加 stage 左上角 */
  const toScreen = (cx, cy) => [info.left + (cx - info.camX) * info.s,
                                info.top + (cy - info.camY) * info.s];
  const TILES = 48;
  const [x0, y0] = toScreen(11 * TILES, 10 * TILES);
  const [x1, y1] = toScreen(17 * TILES, 16 * TILES);
  const clip = { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
  console.log('clip', JSON.stringify(clip));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'flat_alcove_1to1.png'), clip });
  await page.screenshot({ path: path.join(__dirname, 'shots', 'flat_full.png') });
  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
