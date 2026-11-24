/* stress_input.js — 专门找"卡住"：长按 / 组合键 / 连按，看有没有出不来的状态
 *
 * 白哥的原话是"而且会卡住"。卡住的典型来源只有几类，一个个排：
 *   a. 某个状态没有出口（step 里没有回到 stand/fall 的路径）
 *   b. lock/计时器被清零或被覆盖 → 永远减不完
 *   c. 两个状态互相把对方设回来 → 每帧来回跳（人原地抖、走不动）
 *   d. 输入被吞（tap 丢了）→ 按了没反应
 *
 * 用法: node stress_input.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(
  process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));

const HOME = process.env.USERPROFILE || process.env.HOME;
const EXE = path.join(HOME, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const boot = async () => {
    await page.goto(FILE, { waitUntil: 'load' });
    await sleep(650);
    await page.keyboard.press('Enter');
    await sleep(320);
  };
  const st = () => page.evaluate(() => window.__sk.state());
  /* 采样器：跑 ms 毫秒，返回期间见过的状态集合 + 最大连续同状态帧数 */
  const watch = async (ms) => {
    await page.evaluate(() => { window.__S = []; window.__Son = true;
      const L = () => { if (window.__Son) window.__S.push(window.__sk.state()); requestAnimationFrame(L); };
      requestAnimationFrame(L); });
    await sleep(ms);
    return page.evaluate(() => { window.__Son = false;
      const a = window.__S;
      const seen = [...new Set(a.map(s => s.state))];
      let run = 1, best = 1, bestState = a[0] && a[0].state;
      for (let i = 1; i < a.length; i++) {
        if (a[i].state === a[i-1].state) { run++; if (run > best) { best = run; bestState = a[i].state; } }
        else run = 1;
      }
      return { states: seen, frames: a.length, longestRun: best, longestState: bestState,
               last: a[a.length-1] && { state:a[a.length-1].state, x:+a[a.length-1].x.toFixed(0), lock:+a[a.length-1].lock.toFixed(2) } };
    });
  };
  /* 卡住的判据：松开所有键 + 等 1.4s 之后，状态必须回到 stand。
   * 为什么要等 1.4s：0.4s 的受击硬直、0.3s 出招、0.28s 滑铲都是"合法的临时状态"，
   * 等它们走完还没回 stand 才是真卡住。第一版只等 0.65s，撞上史莱姆的受击硬直
   * 就报了两个假 FAIL —— 判据比 bug 更需要被验证。 */
  const recovered = async () => {
    await page.evaluate(() => window.__sk.releaseAll());
    await sleep(1400);
    const s0 = await st();
    await page.keyboard.down('d'); await sleep(320);
    const s1 = await st();
    await page.keyboard.up('d');
    await sleep(120);
    return { idle: s0.state, after: s1.state, moved: +(s1.x - s0.x).toFixed(0),
             /* hurt 也算"有出口"：它是被史莱姆反复打（滑铲冲进怪堆里），
              * 硬直 0.4s + 无敌 0.9s，站在怪旁边就会一直挨。这是战斗，不是卡住。
              * 真正要排除的是 attack / slide / cast / crouch 这些"锁住输入"的状态。 */
             ok: ['stand', 'walk', 'hurt', 'fall'].includes(s0.state) };
  };

  const R = { cases: [], errors };

  const CASES = [
    { name: '按住 J 2s（攻击）',    hold: ['j'], ms: 2000 },
    { name: '按住 空格 2s（跳）',   hold: [' '], ms: 2000 },
    { name: '按住 ↓+空格 2s（滑铲）', hold: ['s',' '], ms: 2000 },
    { name: '按住 U 2s（红魂）',    hold: ['u'], ms: 2000 },
    { name: '按住 L 2s（蓝魂）',    hold: ['l'], ms: 2000 },
    { name: '按住 I 2s（后跃连发）', hold: ['i'], ms: 2000 },
    { name: '按住 ↑ 2s（抬头）',    hold: ['w'], ms: 2000 },
    { name: '按住 ↓ 2s（蹲）',      hold: ['s'], ms: 2000 },
    { name: '↓+→ 同时按住 2s',     hold: ['s','d'], ms: 2000 },
    { name: '连按 J 六次',          tap: 'j', times: 6, gap: 90 },
    { name: '连按 空格 四次',        tap: ' ', times: 4, gap: 120 },
    { name: '↓+空格 连按三次',       combo: ['s',' '], times: 3, gap: 260 },
  ];

  for (const cs of CASES) {
    await boot();
    const before = await st();
    let during;
    if (cs.hold) {
      await page.evaluate(() => { window.__Son = true; window.__S = [];
        const L = () => { if (window.__Son) window.__S.push(window.__sk.state()); requestAnimationFrame(L); };
        requestAnimationFrame(L); });
      for (const k of cs.hold) await page.keyboard.down(k);
      await sleep(cs.ms);
      during = await page.evaluate(() => { window.__Son = false;
        const a = window.__S;
        const seen = [...new Set(a.map(s => s.state))];
        let run = 1, best = 1;
        for (let i = 1; i < a.length; i++) {
          if (a[i].state === a[i-1].state) { run++; if (run > best) best = run; }
          else run = 1;
        }
        return { states: seen, frames: a.length, longestRun: best, mode: (()=>{const c={};for(const s of a)c[s.state]=(c[s.state]||0)+1;return c;})() };
      });
      for (const k of cs.hold) await page.keyboard.up(k);
    } else if (cs.tap) {
      for (let i = 0; i < cs.times; i++) { await page.keyboard.press(cs.tap); await sleep(cs.gap); }
      during = await watch(cs.gap);
    } else {
      for (let i = 0; i < cs.times; i++) {
        for (const k of cs.combo) await page.keyboard.down(k);
        await sleep(60);
        for (const k of cs.combo) await page.keyboard.up(k);
        await sleep(cs.gap);
      }
      during = await watch(120);
    }
    const rec = await recovered();
    R.cases.push({ name: cs.name, from: before.state, during, recovered: rec,
                   pass: rec.ok });
  }

  R.errors = errors;
  fs.writeFileSync(path.join(__dirname, 'stress_input.json'), JSON.stringify(R, null, 2));
  for (const c of R.cases) {
    console.log(`${c.pass ? 'OK  ' : 'FAIL'} ${c.name.padEnd(22)} states=${JSON.stringify(c.during.states)} ` +
                `mode=${JSON.stringify(c.during.mode || {})} 恢复=${c.recovered.idle}→${c.recovered.after} dx=${c.recovered.moved}`);
  }
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
