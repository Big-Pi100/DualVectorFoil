// _probe_action_chain.js — 「操作-动作」层实测：按下之后到底发生了几次动作？
//
// 为什么单独做这一套：之前的对照表只比了「有没有这个键 / 按了干什么」，
// 没比「按下去的那 0.3 秒里，输入是被接住了还是被吃掉了」。这一层才是手感。
//
// 测四件事，每一件都是"看起来一样、实际不一样"的地方：
//   A. 硬直末尾补按攻击 —— 接不上就是输入被吞（无缓冲），接得上就是有预输入
//   B. 按住攻击不放 —— 会不会连发
//   C. 连打（60ms 一次）—— 一秒能出几刀，封顶的是 atkCd 还是手速
//   D. 受击硬直里按跳 —— 0.4 秒里是完全锁死，还是留了脱身口
//
// 用法: node _probe_action_chain.js
'use strict';
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');

const out = (k, v) => console.log(k.padEnd(34) + ' ' + JSON.stringify(v));

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 810 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(FILE, { waitUntil: 'load' });
  await p.waitForTimeout(1500);

  const reset = async (x = 336, y = 620) => {
    await p.evaluate(() => { window.__sk.place(336, 620); window.__sk.setHp(120); window.__sk.releaseAll(); });
    await p.waitForTimeout(260);
  };
  const tap = async (a, ms = 18) => {
    await p.evaluate(x => window.__sk.press(x), a);
    await p.waitForTimeout(ms);
    await p.evaluate(x => window.__sk.release(x), a);
  };
  // 页面内采样：Playwright 往返一次 1~3ms，8ms 采样会被往返吃掉；
  // 在页面里用 rAF 记，才拿得到动作中间那几帧。
  const rec = async (ms) => {
    await p.evaluate(() => {
      window.__rec = [];
      window.__recOn = true;
      const t0 = performance.now();
      const f = () => {
        if (!window.__recOn) return;
        const s = window.__sk.state();
        window.__rec.push([Math.round(performance.now() - t0), s.state, +s.lock.toFixed(3), +s.animT || 0, s.onGround ? 1 : 0, Math.round(s.y), Math.round(s.vy)]);
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    await p.waitForTimeout(ms);
    return p.evaluate(() => { window.__recOn = false; return window.__rec; });
  };
  // 一次"出刀"= lock 从低位跳回满值（0.30）。不能数 state 的进出：
  // 缓冲接刀时状态一直停在 attack，中间根本没有 stand 那一帧。
  const attackCount = (s) => {
    let n = 0, prev = 0;
    for (const r of s) {
      if (r[2] > 0.24 && prev <= 0.24) n++;
      prev = r[2];
    }
    return n;
  };

  // ---- A. 硬直末尾补按 ----
  // 攻击总长 300ms，前摇 90ms。分几个时机补按，看缓冲的**两侧边界**。
  //
  // ⚠️ 必须记**真实按下时刻**，不能拿 waitForTimeout 的标称值当数：
  // 一次 tap 含两次 evaluate 往返（各 2~8ms），标称 150ms 实测落在 195ms。
  // 第一版按标称值写表，得出"150ms 按能接上"—— 那是把测量延迟当成了缓冲。
  const t3 = async () => p.evaluate(() => performance.now());
  for (const delay of [40, 90, 140, 190, 240]) {
    await reset();
    const rP = rec(700);
    const t0 = await t3();
    await tap('atk');
    await p.waitForTimeout(delay);
    const tPress = await t3();
    await tap('atk');
    const s = await rP;
    const at = Math.round(tPress - t0);
    out(`A 补按 标称${delay}ms→实际${at}ms`, {
      距收招: 300 - at, 刀数: attackCount(s), 采样帧: s.length,
    });
  }

  // ---- B. 按住不放 ----
  await reset();
  {
    const rP = rec(1000);
    await p.evaluate(() => window.__sk.press('atk'));
    const s = await rP;
    await p.evaluate(() => window.__sk.release('atk'));
    out('B 按住 1s  攻击段数', { 段数: attackCount(s) });
  }

  // ---- C. 连打（每 60ms 一次，共 8 次）----
  await reset();
  {
    const rP = rec(1100);
    for (let i = 0; i < 8; i++) { await tap('atk', 12); await p.waitForTimeout(48); }
    const s = await rP;
    out('C 连打 8 下  攻击段数', { 段数: attackCount(s) });
  }

  // ---- D. 受击硬直里按跳 ----
  // 单看"有没有离地"会被击退骗：受击本身会把人顶起来。所以跑两次对照 ——
  // 一次在硬直里猛按跳，一次什么都不按，比**最高点**。高度一样 = 跳被吞了。
  const runHurt = async (withJump) => {
    await reset();
    const rP = rec(800);
    await p.evaluate(() => window.__sk.hurt(12));
    if (withJump) {
      for (const d of [40, 120, 200, 280]) { await p.waitForTimeout(40); await tap('jump'); }
    }
    const s = await rP;
    return { 最高点y: Math.min(...s.map(r => r[5])), vy最小: Math.min(...s.map(r => r[6])), 状态: [...new Set(s.map(r => r[1]))] };
  };
  const dNo = await runHurt(false);
  const dYes = await runHurt(true);
  out('D 受击硬直中按跳', { 不按跳: dNo, 按跳: dYes });

  // ---- E. 动作期间按别的键，动作结束会不会补上 ----
  // 攻击中按后跃是允许的（P1 取消），但攻击中按红魂呢？（cast 应被吞）
  await reset();
  {
    const rP = rec(700);
    await tap('atk');
    await p.waitForTimeout(120);
    await tap('red');
    const s = await rP;
    out('E 攻击中按红魂', { 出现过的状态: [...new Set(s.map(r => r[1]))] });
  }

  if (errs.length) out('页面错误', errs);
  await b.close();
})();
