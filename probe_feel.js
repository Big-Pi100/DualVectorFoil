/* probe_feel.js — 在真 Chromium 里按真键盘，测量手感
 *
 * 为什么不用 test.js：test.js 跑在 vm + 假 canvas 上，它能证明"逻辑不崩"，
 * 但证明不了手感 —— 那里没有真实 RAF，没有真实键盘事件，dt 是手摇的。
 *
 * 两个已经踩过的坑，写在这里免得下次又错：
 *   1. 时间轴必须用游戏自己累加的 dt（simT），不能用采样回调的墙钟间隔。
 *      采样是另一个 rAF，它的帧间隔 ≠ 游戏 dt，混用会量出"44ms 到满速"的假数。
 *   2. 跳跃必须站在头顶没有平台的地方。回廊里 x=288..576 一格平台都没有；
 *      x=240..288 是左高台正下方，跳起来 45px 就撞底 —— 那不是物理坏了。
 *
 * 用法: node probe_feel.js [--headful]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(
  process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));

const HOME = process.env.USERPROFILE || process.env.HOME;
const EXE = path.join(HOME, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FEEL = (process.argv.find(a => a.startsWith('--feel=')) || '').replace('--feel=', '') || 'aos';
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/') + '?feel=' + FEEL;
const OUT = path.join(__dirname, 'shots');
const SAFE_X = [300, 540]; // 头顶无平台的区间（格 6..11）

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!fs.existsSync(EXE)) { console.error('找不到 chromium: ' + EXE); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, headless: !process.argv.includes('--headful') });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const boot = async () => {
    await page.goto(FILE, { waitUntil: 'load' });
    await sleep(800);
    await page.evaluate(() => {
      window.__P = { r: [], on: false, sim: 0 };
      const L = () => {
        const s = window.__sk.state();
        if (window.__P.on) {
          window.__P.sim += s.dt * 1000;
          window.__P.r.push(Object.assign({ sim: window.__P.sim }, s));
        }
        requestAnimationFrame(L);
      };
      requestAnimationFrame(L);
    });
    await page.keyboard.press('Enter'); // 跳过标题
    await sleep(400);
  };
  const start = () => page.evaluate(() => { window.__P.r = []; window.__P.sim = 0; window.__P.on = true; });
  const stop = () => page.evaluate(() => { window.__P.on = false; return window.__P.r; });
  const st = () => page.evaluate(() => window.__sk.state());

  const report = { feel: FEEL };

  // ================= 1. 满跳（从出生点，头顶空旷）=================
  await boot();
  const g1 = await st();
  if (!(g1.x >= SAFE_X[0] && g1.x <= SAFE_X[1])) throw new Error('跳跃测试站位不安全: x=' + g1.x);
  await start();
  await page.keyboard.down(' ');
  await sleep(1400);
  await page.keyboard.up(' ');
  let recs = await stop();
  const apex = recs.reduce((a, b) => (b.y < a.y ? b : a), recs[0]);
  const land = recs.find(r => r.sim > apex.sim && r.onGround);
  report.jump = {
    from: +g1.y.toFixed(1),
    height: +(g1.y - apex.y).toFixed(1),
    riseMs: +apex.sim.toFixed(0),
    fallMs: land ? +(land.sim - apex.sim).toFixed(0) : null,
    totalMs: land ? +land.sim.toFixed(0) : null,
    // 顶点附近停留：|vy| < 120 的时长，这就是"顶点滞空"的手感来源
    apexHangMs: +recs.filter(r => Math.abs(r.vy) < 120 && !r.onGround).length * 16.7 | 0,
  };

  // ================= 2. 轻点跳 =================
  await boot();
  const g2 = await st();
  await start();
  await page.keyboard.down(' ');
  await sleep(25);
  await page.keyboard.up(' ');
  await sleep(1100);
  recs = await stop();
  const apex2 = recs.reduce((a, b) => (b.y < a.y ? b : a), recs[0]);
  report.tapJump = { height: +(g2.y - apex2.y).toFixed(1), ratio: +(report.jump.height / (g2.y - apex2.y)).toFixed(2) };

  // ================= 3. 起步 / 滑停 / 转身 =================
  await boot();
  await start();
  await page.keyboard.down('d');
  await sleep(450);
  recs = await stop();
  const vmax = Math.max(...recs.map(r => Math.abs(r.vx)));
  const firstMove = recs.find(r => Math.abs(r.vx) > 0.5);
  const near = recs.find(r => Math.abs(r.vx) >= vmax * 0.95);
  report.run = {
    vmax: +vmax.toFixed(1),
    rampMs: firstMove && near ? +(near.sim - firstMove.sim + 16.7).toFixed(0) : null,
    rampFrames: firstMove && near ? recs.indexOf(near) - recs.indexOf(firstMove) + 1 : null,
    // 第一帧就有的速度占比 —— 0 表示纯加速起步，>0.3 表示"啪一下到位"
    firstFrameRatio: +(firstMove ? Math.abs(firstMove.vx) / vmax : 0).toFixed(2),
  };

  await start();
  await page.keyboard.up('d');
  await sleep(300);
  recs = await stop();
  const still = recs.find(r => Math.abs(r.vx) < 2);
  report.stop = still ? { slideMs: +still.sim.toFixed(0), slideDist: +(still.x - recs[0].x).toFixed(1) } : {};

  await boot();
  await page.keyboard.down('d'); await sleep(300);
  await start();
  await page.keyboard.up('d'); await page.keyboard.down('a');
  await sleep(400);
  recs = await stop();
  const zero = recs.find(r => r.vx <= 0);
  const neg = recs.find(r => r.vx <= -vmax * 0.95);
  report.turn = {
    fromX: +recs[0].x.toFixed(0),
    toZeroMs: zero ? +zero.sim.toFixed(0) : null,
    toFullMs: neg ? +neg.sim.toFixed(0) : null,
    stuckAtWall: recs[recs.length - 1].x <= 60,
  };

  // ================= 4. 帧率（连续跑 5 秒 + 跳跃 + 出招）=================
  await boot();
  await start();
  await page.keyboard.down('d'); await sleep(1500);
  await page.keyboard.press(' '); await sleep(400);
  await page.keyboard.press('j'); await sleep(300);
  await page.keyboard.up('d'); await page.keyboard.down('a'); await sleep(2800);
  await page.keyboard.up('a');
  recs = await stop();
  const dts = recs.map(r => r.dt * 1000).filter(d => d > 0);
  const sorted = [...dts].sort((a, b) => a - b);
  const pct = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  report.perf = {
    frames: dts.length,
    avgFps: +(1000 / (dts.reduce((a, b) => a + b, 0) / dts.length)).toFixed(1),
    p50: +pct(0.5).toFixed(1), p95: +pct(0.95).toFixed(1), max: +sorted[sorted.length - 1].toFixed(1),
    over20ms: dts.filter(d => d > 20).length,
    clamped: dts.filter(d => d >= 49.9).length,
  };

  // ================= 5. 截图 =================
  await boot();
  await page.screenshot({ path: path.join(OUT, 'probe_01_title.png') });
  await page.screenshot({ path: path.join(OUT, 'probe_02_hall.png') });
  await page.keyboard.down('d'); await sleep(320);
  await page.screenshot({ path: path.join(OUT, 'probe_03_run.png') });
  await page.keyboard.down(' '); await sleep(260);
  await page.screenshot({ path: path.join(OUT, 'probe_04_air.png') });
  await page.keyboard.up(' '); await page.keyboard.up('d');
  await sleep(700);
  await page.screenshot({ path: path.join(OUT, 'probe_05_land.png') });

  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
