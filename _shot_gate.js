// _shot_gate.js — 必经缝：站着过不去 / 侧身过得去。
// 这张图是实验的"引入"环节，必须能自己说话：一堵墙、一道缝、一个过不去的人。
//
// 上一版跑 7 秒 'd' 就截图，结果卡在 x12 的壁龛柱子上（那是一根可跳过的柱子，
// 不是必经墙），拍出来的"gate_blocked"其实是壁龛。这里改成按 x 停滞判"撞上了"，
// 再跳过柱子走到 x28 的真墙。
'use strict';
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/') + '?room=paper';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = path.join(__dirname, 'shots');

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.goto(FILE, { waitUntil: 'load' });
  await sleep(700);
  await page.keyboard.press('Enter');
  await sleep(300);

  const st = () => page.evaluate(() => window.__sk.state());

  // 走到撞上为止：连续 350ms 的 x 变化 < 2px 就当撞墙
  async function walkUntilBlocked(maxMs) {
    await page.keyboard.down('d');
    let prev = (await st()).x, t = 0, still = 0;
    while (t < maxMs) {
      await sleep(100); t += 100;
      const x = (await st()).x;
      if (Math.abs(x - prev) < 2) { still += 100; if (still >= 350) break; } else still = 0;
      prev = x;
    }
    await page.keyboard.up('d');
    await sleep(200);
    return st();
  }

  const a = await walkUntilBlocked(4000);
  console.log('hit #1:', JSON.stringify({ x: Math.round(a.x), state: a.state, cw: a.cw }));

  // 跳过壁龛柱子（柱子顶 160px，跳高 203.8px），落到右侧继续走
  for (let i = 0; i < 4; i++) {
    await page.keyboard.down('d');
    await sleep(120);
    await page.keyboard.down('k'); await sleep(160); await page.keyboard.up('k');
    await sleep(900);
    await page.keyboard.up('d');
    await sleep(150);
    const s = await st();
    console.log('  jump', i + 1, '->', Math.round(s.x), s.state);
    if (s.x > 1000) break;
  }
  const mid = await st();
  console.log('after pillar:', JSON.stringify({ x: Math.round(mid.x), state: mid.state }));

  // 继续走到 x28 的真墙
  const g = await walkUntilBlocked(8000);
  console.log('hit #2 (gate):', JSON.stringify({ x: Math.round(g.x), state: g.state, cw: g.cw }));
  await page.screenshot({ path: path.join(OUT, 'flat_06_gate_blocked.png') });

  // 按住 F 侧身挤过去
  await page.keyboard.down('f'); await sleep(160);
  await page.keyboard.down('d'); await sleep(3000); await page.keyboard.up('d'); await sleep(200);
  const c = await st();
  const m = await page.evaluate(() => window.__sk.metrics());
  console.log('through:', JSON.stringify({ x: Math.round(c.x), state: c.state, gateT: m.gateT }));
  await page.screenshot({ path: path.join(OUT, 'flat_07_gate_through.png') });
  await page.keyboard.up('f');
  await sleep(600);
  const m2 = await page.evaluate(() => window.__sk.metrics());
  console.log('metrics:', JSON.stringify(m2));
  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
