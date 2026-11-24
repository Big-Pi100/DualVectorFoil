'use strict';
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/') + '?room=hall';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(FILE, { waitUntil: 'load' }); await sleep(700);
  await page.keyboard.press('Enter'); await sleep(900);
  const st = () => page.evaluate(() => window.__sk.state());
  const S = s => ({ x: Math.round(s.x), y: Math.round(s.y), st: s.state, vy: Math.round(s.vy), jumps: s.jumps });
  const log = async (name) => console.log(name.padEnd(26), JSON.stringify(S(await st())));

  // 1. 蹲着走（按住 S + D）
  await page.keyboard.down('s'); await sleep(200); await log('S 按住');
  await page.keyboard.down('d'); await sleep(500); await log('S+D 蹲着走');
  await page.keyboard.up('d'); await page.keyboard.up('s'); await sleep(400);

  // 2. 走路时抬头
  await page.keyboard.down('d'); await page.keyboard.down('w'); await sleep(500);
  await log('D+W 边走边抬头');
  await page.keyboard.up('w'); await page.keyboard.up('d'); await sleep(400);

  // 3. 空中攻击
  await page.keyboard.down('k'); await sleep(120); await page.keyboard.up('k');
  await sleep(160); await page.keyboard.press('j'); await sleep(90);
  await log('空中 J');
  await sleep(900);

  // 4. 踢空双跳（无魄）
  await page.keyboard.down('k'); await sleep(120); await page.keyboard.up('k');
  await sleep(220);
  const before = await st();
  await page.keyboard.down('k'); await sleep(120); await page.keyboard.up('k'); await sleep(100);
  const after = await st();
  console.log('空 K 二段（无魄）'.padEnd(26), 'jumps', before.jumps, '->', after.jumps, 'vy', Math.round(after.vy));
  await sleep(900);

  // 5. 下 + 跳 = 穿板？（找一块能站的平台：先跳上 => 用 hall 里的 '=' 平台）
  //    直接测：站地上按下+空格，看有没有任何变化
  await page.keyboard.down('s'); await page.keyboard.down(' '); await sleep(120);
  await page.keyboard.up(' '); await sleep(100);
  await log('地上 S+空格');
  await page.keyboard.up('s'); await sleep(300);

  // 6. 下 + A = 滑铲？
  await page.keyboard.down('s'); await sleep(120);
  await page.keyboard.down('a'); await sleep(160);
  await log('S+A（滑铲？）');
  await page.keyboard.up('a'); await page.keyboard.up('s'); await sleep(500);

  // 7. 空中后跃
  await page.keyboard.down('k'); await sleep(120); await page.keyboard.up('k');
  await sleep(200);
  await page.keyboard.press('i'); await sleep(100);
  await log('空中 I（后跃？）');
  await sleep(900);

  // 8. 扁平时按 J / K（应该完全无效）
  await page.keyboard.down('f'); await sleep(200);
  await page.keyboard.press('j'); await sleep(100);
  const f1 = await st();
  await page.keyboard.press('k'); await sleep(100);
  const f2 = await st();
  console.log('扁平时 J / K'.padEnd(26), 'J后', f1.state, 'K后', f2.state, 'cw', f2.cw);
  await page.keyboard.up('f'); await sleep(400);

  // 9. 魂匣开着时能不能走（菜单应该暂停玩法）
  await page.keyboard.press('o'); await sleep(300);
  await page.keyboard.down('d'); await sleep(400);
  const m1 = await st();
  await page.keyboard.up('d');
  console.log('魂匣开着按 D'.padEnd(26), 'state', m1.state, 'x', Math.round(m1.x));
  await page.keyboard.press('o'); await sleep(300);
  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
