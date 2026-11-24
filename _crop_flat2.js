// _crop_flat2.js — 1:1 放大取证：侧身的人和墙上的纸缝**必须不一样**
// 上一版的问题是"压扁的人"和"静止的墙缝"撞脸，玩家找不到自己。
// 这张图就是用来判这件事的：同一帧里同时出现人和缝。
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
  await sleep(700);
  await page.keyboard.press('Enter');
  await sleep(300);

  // 走到壁龛前，按住 F 挤进缝里，停在缝中间（左右都有墙缝可见）
  await page.keyboard.down('d'); await sleep(2300); await page.keyboard.up('d'); await sleep(300);
  await page.keyboard.down('f'); await sleep(160);
  await page.keyboard.down('d'); await sleep(620); await page.keyboard.up('d'); await sleep(200);

  const info = await page.evaluate(() => {
    const st = document.getElementById('stage');
    const r = st.getBoundingClientRect();
    const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(st).transform);
    const s = m ? parseFloat(m[1].split(',')[0]) : 1;
    const cam = window.__sk.cam(), p = window.__sk.state();
    return { left: r.left, top: r.top, s, camX: cam.x, camY: cam.y, px: p.x, py: p.y, cw: p.cw, state: p.state };
  });
  console.log(JSON.stringify(info));

  const toScreen = (cx, cy) => [info.left + (cx - info.camX) * info.s,
                                info.top + (cy - info.camY) * info.s];
  // 以人为中心裁 5 格宽 / 3 格高（1:1，不经任何二次缩放）
  const [x0, y0] = toScreen(info.px - 96, info.py - 72);
  const [x1, y1] = toScreen(info.px + 144, info.py + 72);
  const clip = { x: Math.round(x0), y: Math.round(y0),
                 width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
  await page.screenshot({ path: path.join(__dirname, 'shots', 'flat_zoom_inside.png'), clip });
  await page.keyboard.up('f'); await sleep(600);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'flat_zoom_stood.png'), clip });

  // 裸缝（人不在里面）：用来判"人和缝像不像"
  await page.keyboard.down('d'); await sleep(500); await page.keyboard.up('d'); await sleep(400);
  const p2 = await page.evaluate(() => window.__sk.state());
  const cam2 = await page.evaluate(() => window.__sk.cam());
  const toS2 = (cx, cy) => [info.left + (cx - cam2.x) * info.s, info.top + (cy - cam2.y) * info.s];
  const slitLeft = 11 * 48;                     // 壁龛左墙那一片
  const [u0, v0] = toS2(slitLeft, 11 * 48);
  const [u1, v1] = toS2(slitLeft + 260, 16 * 48);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'flat_zoom_static.png'),
    clip: { x: Math.round(u0), y: Math.round(v0),
            width: Math.round(u1 - u0), height: Math.round(v1 - v0) } });
  console.log('done');
  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
