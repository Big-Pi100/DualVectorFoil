/* verify_fix.js — 针对"按键没反馈 / 下+空格闪烁 / 走路人不见"三件事的回归验证
 *
 * 每一项都对应一个已经被证实的原因，不是"跑跑看":
 *   1. 走 → 消失：PACK_ATLAS.map.walk 指向了 atlas 里不存在的动画 → 一帧都不画
 *   2. 下+空格 → 闪：slide 收势回 stand，下一帧又被 ↓ 转成 crouch，压缩 0.52→1.0→0.66
 *   3. 其他键 → 无反馈：attack 4 帧照片几乎同姿态、↑ 没有任何视觉表达、蓝魂没装备时零回应
 *
 * 用法: node verify_fix.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(
  process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));

const HOME = process.env.USERPROFILE || process.env.HOME;
const EXE = path.join(HOME, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');
const OUT = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const boot = async () => {
    await page.goto(FILE, { waitUntil: 'load' });
    await sleep(700);
    await page.keyboard.press('Enter');
    await sleep(350);
  };
  const st = () => page.evaluate(() => window.__sk.state());
  const R = {};

  // ============ 1. 走路：人物必须真的被画出来 ============
  /* 判据不用"暖色像素"（会随镜头/火把漂移，上一次就是这么被骗的）。
   * 改成**直接数绘制调用**：在 drawImage 上挂钩子，只统计主角矩形内的那一次。
   * 主角是每帧最后画的 atlas 帧，且尺寸 ~ P_SPRITE_H 高。 */
  await boot();
  const drawStats = async () => page.evaluate(() => {
    // 钩住 canvas 的 drawImage，数"高度在 60~130px 之间的贴图"= 主角
    if (window.__hooked) return null;
    window.__hooked = true; window.__pdraw = 0;
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const orig = g.drawImage.bind(g);
    g.drawImage = function (img, ...a) {
      // 9 参数形式：sx,sy,sw,sh,dx,dy,dw,dh
      if (a.length === 8) {
        const dh = a[7], dw = a[6];
        if (dh > 60 && dh < 140 && dw > 20 && dw < 120) window.__pdraw++;
      }
      return orig(img, ...a);
    };
    return true;
  });
  await drawStats();
  await page.evaluate(() => { window.__pdraw = 0; });
  await page.keyboard.down('d');
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'fix_01_walk.png') });
  const walkDraws = await page.evaluate(() => window.__pdraw);
  const walkPhase = (await st()).walkPhase;
  await page.keyboard.up('d');
  R.walk = { playerDraws: walkDraws, walkPhase: +walkPhase.toFixed(2),
             pass: walkDraws > 8 && walkPhase > 0.5 };

  // ============ 2. 下+空格：不能出现"stand 过路帧" ============
  await boot();
  await page.evaluate(() => { window.__F = []; window.__Fon = true;
    const L = () => { if (window.__Fon) { const s = window.__sk.state();
      window.__F.push({ s:s.state, sq:+s.sq.toFixed(2), lock:+s.lock.toFixed(2) }); }
      requestAnimationFrame(L); };
    requestAnimationFrame(L); });
  await page.keyboard.down('s'); await sleep(150);
  await page.keyboard.down(' '); await sleep(600);
  await page.keyboard.up(' '); await page.keyboard.up('s');
  await sleep(200);
  const fr = await page.evaluate(() => { window.__Fon = false; return window.__F; });
  /* 判据：从第一次进 slide，到回 crouch/stand，中间**不允许**出现 stand 与 slide 交替；
   * 且 sq 的相邻帧变化必须平滑（|Δsq| < 0.12），跳变就是闪。 */
  const i0 = fr.findIndex(f => f.s === 'slide');
  const seq = i0 >= 0 ? fr.slice(i0) : [];
  /* 判据只看**滑动区间内部**：从第一个 slide 到第一次离开 slide。
   * 离开的那一步允许是 crouch（↓ 还按着）或 stand（松开 ↓），
   * 但区间内部**不允许**出现 stand/crouch 插一帧又回 slide —— 那才是闪。
   * 起始那一帧的压缩跳变（1.0 → 0.61）是入姿态的加速，不算闪。 */
  const endIdx = seq.findIndex(f => f.s !== 'slide');
  const core = endIdx > 0 ? seq.slice(0, endIdx) : seq;
  const coreJitter = core.filter((f, i) => i > 1 && Math.abs(f.sq - core[i-1].sq) > 0.12).length;
  const tailStates = seq.slice(endIdx).map(f => f.s);
  // 离开 slide 之后，如果先 stand 再 crouch（↓ 还按着），就是那 1 帧闪烁
  const flicker = tailStates.length > 1 && tailStates[0] === 'stand' && tailStates[1] === 'crouch';
  await page.screenshot({ path: path.join(OUT, 'fix_02_slide_end.png') });
  R.slide = { seqHead: seq.slice(0, 6).map(f => f.s + f.sq).join(' '),
              tailStates: tailStates.slice(0, 6).join(','),
              sawSlide: i0 >= 0, coreJitter, flickerPattern: flicker,
              pass: i0 >= 0 && coreJitter === 0 && !flicker };

  // ============ 3. 每个键都必须有可见变化 ============
  /* 判据：动作键按下后，**画面上像素确实变了**（不是逻辑变了）。
   * 用两张截图的差异像素数：< 300 = 人眼看不出来。
   * 像素比较必须**在页面内做** —— 把 1280×720×4 的 Uint8ClampedArray 序列化传出来
   * 是 3.7M 个数字，一次要几秒，跑五个键就直接超时。 */
  const pixSnap = (slot) => page.evaluate((slot) => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    window.__snap = window.__snap || {};
    window.__snap[slot] = new Uint8ClampedArray(d);   // 留在页面里
    return true;
  }, slot);
  const diffAgainstSnap = () => page.evaluate(() => {
    const a = window.__snap.a;
    const c = document.querySelector('canvas');
    const b = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) > 18 || Math.abs(a[i+1] - b[i+1]) > 18) n++;
    }
    return n;
  });

  const measure = async (hold, ms) => {
    await boot();
    await pixSnap('a');
    for (const k of hold) await page.keyboard.down(k);
    await sleep(ms);
    const n = await diffAgainstSnap();
    for (const k of hold) await page.keyboard.up(k);
    return n;
  };

  R.keys = {};
  for (const [name, hold, ms, file] of [
    ['攻击 J', ['j'], 110, 'fix_03_attack'],
    ['红魂 U', ['u'], 140, 'fix_04_cast'],
    ['抬头 ↑', ['w'], 260, 'fix_05_lookup'],
    ['蹲 ↓', ['s'], 260, 'fix_06_crouch'],
    ['蓝魂 L', ['l'], 120, 'fix_07_blue'],
  ]) {
    const n = await measure(hold, ms);
    await boot();
    for (const k of hold) await page.keyboard.down(k);
    await sleep(ms);
    await page.screenshot({ path: path.join(OUT, file + '.png') });
    for (const k of hold) await page.keyboard.up(k);
    R.keys[name] = { changedPixels: n, pass: n > 300 };
  }

  R.keys = {};
  for (const [name, hold, ms, file] of [
    ['攻击 J', ['j'], 110, 'fix_03_attack'],
    ['红魂 U', ['u'], 140, 'fix_04_cast'],
    ['抬头 ↑', ['w'], 260, 'fix_05_lookup'],
    ['蹲 ↓', ['s'], 260, 'fix_06_crouch'],
    ['蓝魂 L', ['l'], 120, 'fix_07_blue'],
  ]) {
    const n = await measure(hold, ms);
    await boot();
    for (const k of hold) await page.keyboard.down(k);
    await sleep(ms);
    await page.screenshot({ path: path.join(OUT, file + '.png') });
    for (const k of hold) await page.keyboard.up(k);
    R.keys[name] = { changedPixels: n, pass: n > 300 };
  }


  // ============ 3b. 挥击弧真的被画出来了吗 ============
  /* 这一条是被坑出来的：粒子确实被 push 了（fx() 能查到），但截图里看不到 ——
   * 第一次是因为半径太小整条弧藏在人物轮廓里，第二次是截图太慢、0.2s 的弧已经没了。
   * 所以判据必须是**页面内逐帧数近白像素**，不能靠 screenshot。 */
  await boot();
  const arcProbe = await page.evaluate(async () => {
    const c = document.getElementById('cv');
    const g = c.getContext('2d');
    /* 判据用"全画面最大亮度和"，不用"近白像素计数"。
     * 踩过的坑：弧的最内层是纯白 #ffffff，叠在冷色暗底上会变成**近灰**
     * （叠加色 b-r 只有 1~2），任何"偏蓝"的判据都会把它排除；
     * 反过来偏蓝的外层又太淡够不到亮度阈值 —— 两头都落空，计数恒为 0，
     * 但 maxSum 从 648 跳到 713 已经把真相说清楚了。 */
    const bright = () => {
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let mx = 0;
      for (let i = 0; i < d.length; i += 4) {
        const s = d[i] + d[i+1] + d[i+2];
        if (s > mx) mx = s;
      }
      return mx;
    };
    const raf = () => new Promise(r => requestAnimationFrame(r));
    const base = [];
    for (let i = 0; i < 8; i++) { base.push(bright()); await raf(); }
    const baseMax = Math.max(...base);
    window.__sk.press('atk');
    const burst = [];
    for (let i = 0; i < 12; i++) { burst.push(bright()); await raf(); }
    window.__sk.release('atk');
    return { base: baseMax, peak: Math.max(...burst) };
  });
  R.arc = { baselineMax: arcProbe.base, peakMax: arcProbe.peak,
            gain: arcProbe.peak - arcProbe.base,
            pass: arcProbe.peak - arcProbe.base > 30 };

  // ============ 4. 抬头：相机必须真的往上走 ============
  await boot();
  const c0 = (await st()).camY;
  await page.keyboard.down('w'); await sleep(420);
  const c1 = (await st()).camY;
  await page.keyboard.up('w');
  R.lookUpCam = { before: +c0.toFixed(1), after: +c1.toFixed(1),
                  delta: +(c1 - c0).toFixed(1), pass: c1 < c0 - 20 };

  // ============ 5. 蹲着按方向要能起身走（"卡住"） ============
  await boot();
  await page.keyboard.down('s'); await sleep(220);
  const d0 = await st();
  await page.keyboard.down('d'); await sleep(360);
  const d1 = await st();
  await page.keyboard.up('d'); await page.keyboard.up('s');
  R.crouchWalkOut = { crouched: d0.state, after: d1.state,
                      dx: +(d1.x - d0.x).toFixed(0),
                      pass: d1.state === 'walk' && d1.x > d0.x + 40 };

  R.errors = errors;
  fs.writeFileSync(path.join(__dirname, 'verify_fix.json'), JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
