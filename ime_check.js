// ime_check.js — 中文输入法下的按键验收
//
// 为什么单独一个文件：其余测试都用 page.keyboard（等价英文键盘、无输入法），
// 而真实玩家的字母键会先被 IME 拿去组词，事件变成
//     { key:'Process', code:'KeyD', keyCode:229, isComposing:true }
// 只看 e.key 的实现（旧版）在这一形态下**所有字母键全废，方向键仍可用** ——
// 症状是"只有方向键能动"。这份测试用真实形态的事件逐个动作验。
'use strict';
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log('OK   ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')); }
}

// 组词形态：key 被 IME 吃掉，只剩 code 可信
const IME = (code, keyCode) => ({
  key: 'Process', code, keyCode: keyCode || 229, isComposing: true,
  bubbles: true, cancelable: true,
});
// 正常形态：英文输入法 / 无输入法
const RAW = (code, key, keyCode) => ({
  key, code, keyCode, bubbles: true, cancelable: true,
});

const CASES = [
  ['left', 'KeyA', 65, 'a'],
  ['right', 'KeyD', 68, 'd'],
  ['up', 'KeyW', 87, 'w'],
  ['down', 'KeyS', 83, 's'],
  ['atk', 'KeyJ', 74, 'j'],
  ['jump', 'KeyK', 75, 'k'],
  ['red', 'KeyU', 85, 'u'],
  ['blue', 'KeyL', 76, 'l'],
  /* 冲刺主键 F（白哥「F 是冲刺」），旧键 I 是别名 —— 两个都测。
   * 侧身（flat）已删除，它那一行随动词一起去掉。 */
  ['back', 'KeyF', 70, 'f'],
  ['back', 'KeyI', 73, 'i'],
];

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1100);

  const down = (o) => page.evaluate(x => {
    const ev = new KeyboardEvent('keydown', x);
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, o);
  const up = (o) => page.evaluate(x => window.dispatchEvent(new KeyboardEvent('keyup', x)), o);
  const held = () => page.evaluate(() => window.__sk.input());

  console.log('--- 1. 中文输入法组词形态（本次修复的目标）---');
  for (const [act, code, kc, key] of CASES) {
    const prevented = await down(IME(code, kc));
    const h = await held();
    ck(act + ' 在组词状态下按下生效', h[act] === 1, 'code=' + code + ' input=' + JSON.stringify(h));
    ck(act + ' 已在组词状态下 preventDefault', prevented === true);
    await up(IME(code, kc));
    const h2 = await held();
    ck(act + ' 抬起后松开', !h2[act], JSON.stringify(h2));
    await page.waitForTimeout(30);
  }

  console.log('\n--- 2. 正常形态（回归：不能为了修输入法弄坏英文键盘）---');
  for (const [act, code, kc, key] of CASES) {
    await down(RAW(code, key, kc));
    const h = await held();
    ck(act + ' 正常形态仍生效', h[act] === 1, JSON.stringify(h));
    await up(RAW(code, key, kc));
    await page.waitForTimeout(20);
  }

  console.log('\n--- 3. 方向键 / 空格 / 大小写 ---');
  await down(RAW('ArrowLeft', 'ArrowLeft', 37)); ck('方向键 ← 有效', (await held()).left === 1); await up(RAW('ArrowLeft', 'ArrowLeft', 37));
  await down(RAW('ArrowUp', 'ArrowUp', 38)); ck('方向键 ↑ 有效', (await held()).up === 1); await up(RAW('ArrowUp', 'ArrowUp', 38));
  await down(RAW('Space', ' ', 32)); ck('空格 = 跳', (await held()).jump === 1); await up(RAW('Space', ' ', 32));
  await down(RAW('KeyD', 'D', 68)); ck('大写 D（Shift/CapsLock）有效', (await held()).right === 1); await up(RAW('KeyD', 'D', 68));

  console.log('\n--- 4. 魂匣键（O / Tab）---');
  await down(IME('KeyO', 79));
  ck('O 在组词状态下生效', (await held()).menu === 1 || (await page.evaluate(() => document.getElementById('menu').classList.contains('show'))));
  await up(IME('KeyO', 79));
  await page.waitForTimeout(120);
  const menuOpen = await page.evaluate(() => document.getElementById('menu').classList.contains('show'));
  ck('O 能打开魂匣', menuOpen === true);
  await down(IME('KeyO', 79)); await up(IME('KeyO', 79));
  await page.waitForTimeout(150);
  ck('O 再按一次能关掉', (await page.evaluate(() => document.getElementById('menu').classList.contains('show'))) === false);

  console.log('\n--- 5. 未绑定的字母键也要吞掉（否则 IME 会接管组词）---');
  const pQ = await down(IME('KeyQ', 81));
  ck('KeyQ 也 preventDefault（不让 IME 组词）', pQ === true);
  ck('KeyQ 不产生任何动作', Object.keys(await held()).length === 0, JSON.stringify(await held()));

  console.log('\n--- 6. 无脚本异常 ---');
  ck('errors 为空', errs.length === 0, JSON.stringify(errs.slice(0, 3)));

  await browser.close();
  console.log('\n' + (fail ? '有 ' + fail + ' 项失败' : '输入法验收全通过') + '（' + pass + ' 项）');
  process.exit(fail ? 1 : 0);
})();
