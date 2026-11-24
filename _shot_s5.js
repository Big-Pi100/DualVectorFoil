// _shot_s5.js — 这一版（裁定 Q1–Q17 / Q22–Q24）的视觉取证。
// 产出：flat_01_room / flat_02_slit / flat_03_inside / flat_04_lantern /
//       flat_08_alcove2 / hud_legend_full / flat_05_mobile
'use strict';
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));

const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/') + '?room=paper';
const OUT = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.goto(FILE, { waitUntil: 'load' });
  await sleep(700);
  await page.keyboard.press('Enter');
  await sleep(500);

  const st = () => page.evaluate(() => window.__sk.state());
  const place = (x, y) => page.evaluate(([x, y]) => window.__sk.place(x, y), [x, y]);

  // 1. 出生点：灯笼 + 走廊
  await page.screenshot({ path: path.join(OUT, 'flat_01_room.png') });

  // 2. 站在 144px 矮墙前：缝 + 缝里透出的光
  await place(10 * 48 + 8, 620);
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'flat_02_slit.png') });
  console.log('at block:', JSON.stringify(await st()));

  // 3. 侧身挤进缝里（按住 D 往里顶，动作中途截 —— 看拖影）
  await page.keyboard.down('f');
  await sleep(200);
  await page.keyboard.down('d');
  await sleep(420);
  await page.screenshot({ path: path.join(OUT, 'flat_03_inside.png') });
  console.log('inside:', JSON.stringify(await st()));
  await page.keyboard.up('d');
  await page.keyboard.up('f');
  await sleep(400);

  // 4. 灯笼 1:1 裁剪（左起第 4 格那盏）
  const g = await page.evaluate(() => window.__sk.cam());
  const dsf = 2;
  await page.screenshot({
    path: path.join(OUT, 'flat_04_lantern.png'),
    clip: { x: Math.max(0, (4 * 48 - g.x - 90) * dsf), y: Math.max(0, (15 * 48 - g.y - 190) * dsf),
            width: 180 * dsf, height: 210 * dsf },
  });

  // 5. 过墙后的第二处壁龛（裁定 Q22）
  await page.evaluate(() => { window.__sk.state(); });
  await place(30 * 48, 620);
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'flat_08_alcove2.png') });
  console.log('alcove2:', JSON.stringify(await st()));

  // 6. HUD：4 条图例 / 两个槽 / 无小地图 / 无日志
  await page.screenshot({ path: path.join(OUT, 'hud_legend_full.png') });
  const hud = await page.evaluate(() => {
    const k = document.querySelector('#keys');
    return { keys: k.textContent.trim(), slots: document.querySelectorAll('#main .slot').length,
             minimap: !!document.querySelector('#minimap'), log: !!document.querySelector('#log'),
             menuCount: (document.querySelector('#menucount') || {}).textContent };
  });
  console.log('hud:', JSON.stringify(hud));

  // 7. 魂匣里的完整表
  await page.keyboard.press('o');
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'fullkeys_menu.png') });
  await page.keyboard.press('o');
  await sleep(300);

  // 8. 手机
  const mctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3,
                                    isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  await mp.goto(FILE + '&touch=1', { waitUntil: 'load' });
  await sleep(1000);
  await mp.screenshot({ path: path.join(OUT, 'flat_05_mobile.png') });
  await mctx.close();

  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
