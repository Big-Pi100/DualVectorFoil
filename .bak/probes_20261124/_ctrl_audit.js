// _ctrl_audit.js — 图例说的事，按键到底做不做。
// 不看代码，只看按下之后画面/状态变了什么。图例是从 KEY_OF 生成的，
// 所以字母一定对得上；对不上的是**行为**：某些键按下去什么都没发生。
'use strict';
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/') + '?room=hall';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(FILE, { waitUntil: 'load' });
  await sleep(700);
  await page.keyboard.press('Enter');
  await sleep(900);

  // 图例原文（DOM 里真实显示的那一行）
  const legend = await page.evaluate(() =>
    [...document.querySelectorAll('#keys > div, .legend > div, #legend > div')]
      .map(d => d.textContent.replace(/\s+/g, ' ').trim()));
  console.log('LEGEND:', JSON.stringify(legend));

  const snap = () => page.evaluate(() => {
    const s = window.__sk.state();
    return { x: Math.round(s.x), y: Math.round(s.y), st: s.state, mp: Math.round(s.mp),
      hp: Math.round(s.hp), camY: Math.round(s.camY), cw: s.cw, look: s.lookUp,
      menu: !!document.querySelector('#menu.show') };
  });

  async function settle() {
    await page.evaluate(() => { window.__sk && 0; });
    await sleep(500);
  }

  const keys = [
    ['a', '移动（左）'], ['d', '移动（右）'], ['w', '抬头'], ['s', '蹲'],
    ['j', '攻'], ['u', '红魂'], ['k', '跳'], ['i', '后跃'],
    ['l', '蓝魂'], ['o', '魂匣'], ['f', '纸'], [' ', '（未标注：空格）'],
  ];

  const rows = [];
  for (const [k, claim] of keys) {
    await settle();
    const a = await snap();
    await page.keyboard.down(k);
    await sleep(420);
    const mid = await snap();
    await page.keyboard.up(k);
    await sleep(320);
    const c = await snap();
    rows.push({
      key: k === ' ' ? 'Space' : k.toUpperCase(), claim,
      dx: c.x - a.x, dy: c.y - a.y, dcam: mid.camY - a.camY, dmp: mid.mp - a.mp,
      dh: c.hp - a.hp, st: mid.st, stEnd: c.st, cw: mid.cw, look: mid.look,
      menu: mid.menu,
    });
    // 菜单会挡住后面所有按键
    if (mid.menu) { await page.keyboard.press('o'); await sleep(400); }
    // 死了就重开
    if (c.hp <= 0) { await page.keyboard.press('r'); await sleep(80); await page.keyboard.press('r'); await sleep(1200);
      await page.keyboard.press('Enter'); await sleep(800); }
  }

  for (const r of rows) {
    const bits = [];
    if (r.dx) bits.push('x' + (r.dx > 0 ? '+' : '') + r.dx);
    if (r.dy) bits.push('y' + (r.dy > 0 ? '+' : '') + r.dy);
    if (r.dcam) bits.push('cam' + (r.dcam > 0 ? '+' : '') + r.dcam);
    if (r.dmp) bits.push('mp' + (r.dmp > 0 ? '+' : '') + r.dmp);
    if (r.dh) bits.push('hp' + (r.dh > 0 ? '+' : '') + r.dh);
    if (r.cw !== 28) bits.push('cw=' + r.cw);
    if (r.menu) bits.push('MENU');
    if (r.look) bits.push('lookUp');
    const effect = bits.length ? bits.join(' ') : '—— 什么都没发生 ——';
    console.log(`${r.key.padEnd(6)} 声称=${r.claim.padEnd(10)} 状态=${String(r.st).padEnd(7)} ${effect}`);
  }
  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
