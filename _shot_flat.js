// _shot_flat.js — 显影室的视觉取证（铁律 19：交付必须有图）
// 产出：shots/flat_01_room.png / flat_02_slit.png / flat_03_through.png / flat_04_mobile.png
'use strict';
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));

const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/') + '?room=paper';
const OUT = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto(FILE, { waitUntil: 'load' });
  await sleep(700);
  await page.keyboard.press('Enter');
  await sleep(400);

  // 1. 出生点：灯 + 走廊 + 壁龛在远处
  await page.evaluate(() => window.__sk.releaseAll());
  await sleep(200);
  await page.screenshot({ path: path.join(OUT, 'flat_01_room.png') });

  // 2. 走到壁龛前，站着（缝在眼前，过不去）
  await page.evaluate(() => { window.__sk.__peekP = 1; });
  await page.keyboard.down('d');
  await sleep(2200);
  await page.keyboard.up('d');
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'flat_02_slit.png') });

  // 3. 按住 F 侧身，蹭进缝里
  await page.keyboard.down('f');
  await sleep(150);
  await page.keyboard.down('d');
  await sleep(700);
  await page.keyboard.up('d');
  await sleep(120);
  await page.screenshot({ path: path.join(OUT, 'flat_03_inside.png') });
  const st = await page.evaluate(() => window.__sk.state());
  console.log('inside slit:', JSON.stringify({ state: st.state, cw: st.cw, ink: +st.ink.toFixed(1), x: Math.round(st.x) }));
  await page.keyboard.up('f');
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'flat_04_alcove.png') });
  console.log('metrics:', JSON.stringify(await page.evaluate(() => window.__sk.metrics())));

  // 5. 手机：第七键"纸"
  const mctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3,
                                    isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  await mp.goto(FILE + '&touch=1', { waitUntil: 'load' });
  await sleep(900);
  await mp.screenshot({ path: path.join(OUT, 'flat_05_mobile.png') });
  const geo = await mp.evaluate(() => {
    const r = document.getElementById('pbFlat').getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log('pbFlat:', JSON.stringify(geo));
  await mctx.close();
  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
