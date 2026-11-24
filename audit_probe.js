/* audit_probe.js — 审计用探针：只读，不改游戏。
 *
 * 要回答三个问题（work order #6 的"验证物理"那一项）：
 *   1. 同一个按键序列，在不同帧率下，跳跃最高点一样吗？
 *   2. 掉到 20fps 以下（dt 撞 0.05 钳位）时，帧率低的时候物理是不是"变慢"？
 *   3. 一帧之内按下又松开的"点按"，会不会丢？
 *
 * 用法: node audit_probe.js
 */
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));

const HOME = process.env.USERPROFILE;
const EXE = path.join(HOME, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const out = {};

  const runAt = async (rate) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => { out.err = (out.err || []).concat(e.message); });
    await p.goto(FILE, { waitUntil: 'load' });
    await sleep(600);
    await p.keyboard.press('Enter');
    await sleep(500);

    const cdp = await ctx.newCDPSession(p);
    if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });

    // 站在地面稳定后再跳
    await sleep(400);
    const r = await p.evaluate(async () => {
      const S = window.__sk;
      const raf = () => new Promise(f => requestAnimationFrame(f));
      const t0 = performance.now();
      const frames = [];
      let last = t0;
      const sample = async (n, cb) => {
        for (let i = 0; i < n; i++) {
          await raf();
          const now = performance.now();
          frames.push(now - last); last = now;
          cb && cb();
        }
      };
      // 基准 30 帧，测帧间隔
      await sample(30);

      const y0 = S.state().y;
      // 按住跳 350ms（够长，保证能吃满起跳），全程逐帧记录
      S.press('k');
      const trace = [];
      let apex = y0, apexAt = 0, t = 0, gameT = 0, left = false;
      for (let i = 0; i < 400; i++) {
        await raf();
        const now = performance.now();
        const fdt = now - last; last = now;
        frames.push(fdt);
        t += fdt / 1000;
        const st = S.state();
        gameT += st.dt;
        if (st.y < apex) { apex = st.y; apexAt = t; }
        if (!st.onGround) left = true;
        if (left && st.onGround && i > 3) break;
        trace.push([+(t * 1000).toFixed(0), +st.y.toFixed(1), +st.vy.toFixed(1), st.clamped ? 1 : 0]);
      }
      S.release('k');
      const f = frames.slice(30).sort((a, b) => a - b);
      const pct = q => f.length ? f[Math.min(f.length - 1, Math.floor(f.length * q))] : null;
      return {
        rise: +(y0 - apex).toFixed(1),
        airtime: +(t * 1000).toFixed(0),
        gameTime: +(gameT * 1000).toFixed(0),
        apexAt: +(apexAt * 1000).toFixed(0),
        clampedFrames: trace.filter(r => r[3]).length,
        frames: trace.length,
        p50: +pct(0.5).toFixed(1), p95: +pct(0.95).toFixed(1),
      };
    });

    // 点按：一帧内按下+松开，看攻击有没有被吃
    await sleep(600);
    const tap = await p.evaluate(async () => {
      const S = window.__sk, raf = () => new Promise(f => requestAnimationFrame(f));
      const before = S.state().state;
      S.press('j'); S.release('j');       // 同一帧内按下又松开
      await raf();
      const mid = S.state().state;
      await raf();
      return { before, mid, after: S.state().state };
    });

    await ctx.close();
    return { ...r, tap };
  };

  out.rate1 = await runAt(1);
  out.rate6 = await runAt(6);
  out.rate8 = await runAt(8);
  out.rate12 = await runAt(12);

  await b.close();
  for (const k of ['rate1', 'rate6', 'rate8', 'rate12']) {
    const r = out[k];
    console.log(k.padEnd(7), 'rise', String(r.rise).padStart(6), 'px | air', String(r.airtime).padStart(4),
                'ms | apex@', String(r.apexAt).padStart(4), 'ms | frames', String(r.frames).padStart(3),
                '| gameTime', String(r.gameTime).padStart(4), '| p50', r.p50, 'p95', r.p95, '| clamped', r.clampedFrames,
                '| tap', r.tap.mid);
  }
  if (out.err) console.log('pageerror:', out.err);
})();
