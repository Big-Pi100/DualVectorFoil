/* keymap_check.js — 键位层验证（真 Chromium + 真键盘事件）
 *
 * 为什么单独一个脚本：test.js 在 vm 里直接调 key()，它证明的是"逻辑分支通"，
 * 证明不了"按下这个物理键，游戏里发生的事和说明书一致"。
 * 键位是一张**映射表**，映射错了 vm 测试全绿、玩家全懵 —— 上一版
 * 就是这个状态（'k' 同时是跳和蓝魂）。
 *
 * 检查四类：
 *   A. 每个动作键 → 状态真的变了
 *   B. 组合键 → 走的是组合分支，不是主分支（↑+J 必须是魔法，不能是普攻）
 *   C. 危险键 → R 按一次不许重开
 *   D. 手机层 → 六个按钮互不重叠、都在屏内、触控尺寸够，且按下去发的是**动作**
 *
 * 用法: node keymap_check.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));

const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');
const OUT = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const R = { errors: [] };

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const THROTTLE = +(process.env.KM_THROTTLE || 0);
  if (THROTTLE > 0) b._throttle = THROTTLE;
  const page = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  if (THROTTLE > 0) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  }
  page.on('pageerror', e => R.errors.push(String(e && e.message || e)));

  const boot = async () => {
    await page.goto(FILE, { waitUntil: 'load' });
    await sleep(620);
    await page.keyboard.press('Enter');
    await sleep(360);
    await page.evaluate(() => window.__sk.releaseAll());
  };
  const st = () => page.evaluate(() => window.__sk.state());
  const proj = () => page.evaluate(() => window.__sk.projectiles().length);
  const menuOpen = () => page.evaluate(() => !!document.getElementById('menu').classList.contains('show'));

  /* 通用节拍：按下 → 等 ms → 取值 → 松开 */
  const hold = async (keys, ms, probe) => {
    for (const k of keys) await page.keyboard.down(k);
    await sleep(ms);
    const v = await probe();
    for (const k of keys) await page.keyboard.up(k);
    return v;
  };

  // ================= A. 每个动作键 =================
  R.dirs = {};
  for (const [name, k, axis, sign] of [
    ['D 右', 'd', 'x', 1], ['A 左', 'a', 'x', -1],
    ['W 上（不动）', 'w', 'y', 0], ['S 下（蹲）', 's', 'y', 0],
  ]) {
    await boot();
    const a = await st();
    const c = await hold([k], 300, st);
    R.dirs[name] = {
      dx: +(c.x - a.x).toFixed(1), dy: +(c.y - a.y).toFixed(1),
      state: c.state, camY: 0,
    };
    if (axis === 'x') R.dirs[name].pass = Math.sign(c.x - a.x) === sign && Math.abs(c.x - a.x) > 40;
    else if (k === 's') R.dirs[name].pass = c.state === 'crouch';
    else R.dirs[name].pass = Math.abs(c.y - a.y) < 2;   // W 不许产生位移
  }

  // W 的可见效果：镜头往上（抬头）
  await boot();
  const camA = await page.evaluate(() => window.__sk.cam());
  await hold(['w'], 700, st);
  const camB = await page.evaluate(() => window.__sk.cam());
  R.lookUp = { before: camA.y, after: camB.y, dy: +(camB.y - camA.y).toFixed(1),
               pass: camB.y < camA.y - 20 };

  // J 攻击
  await boot();
  R.atk = await hold(['j'], 120, async () => {
    const s = await st();
    return { state: s.state, lock: +s.lock.toFixed(2), pass: s.state === 'attack' && s.lock > 0 };
  });

  // K 跳
  await boot();
  R.jump = await hold(['k'], 220, async () => {
    const s = await st();
    return { vy: +s.vy.toFixed(0), onGround: s.onGround, pass: s.vy < -300 && !s.onGround };
  });

  // U 红魂
  await boot();
  R.redKey = await hold(['u'], 160, async () => {
    const s = await st(); const n = await proj();
    return { n, mp: +s.mp.toFixed(0), pass: n >= 1 && s.mp < 60 };
  });

  // I 后跃：朝背后（初始朝右 → 往左）
  /* 无敌只持续 0.12s，而位移要 0.2s 才走完 —— 两个量必须在不同时刻采样。
   * 上一版在 120ms 时同时取，invuln 恰好归零，报了个假警报。 */
  await boot();
  const bd = await st();
  await page.keyboard.down('i');
  await sleep(50);
  const invAt50 = (await st()).invuln;
  await sleep(150);
  const sBack = await st();
  await page.keyboard.up('i');
  R.back = {
    dx: +(sBack.x - bd.x).toFixed(1), state: sBack.state,
    invulnAt50ms: +invAt50.toFixed(3),
    pass: sBack.x < bd.x - 60 && invAt50 > 0.02,
  };

  // L 蓝魂：初始没装备，必须有提示（不能按下去毫无回应）
  await boot();
  /* 判据必须落在 say() 那一行字上（画在 canvas 里），不能读 #log ——
   * #log 里本来就有"Tab 打开魂菜单"，任何 /魂菜单/ 的判据都会假阳性。 */
  R.blueKey = await hold(['l'], 120, async () => {
    const m = await page.evaluate(() => window.__sk.msg());
    return { hint: m.text, pass: /没有装备蓝魂/.test(m.text) };
  });

  // ================= B. 组合键 =================
  await boot();
  const c0 = await st();
  const c1 = await page.evaluate(async () => {
    const raf = () => new Promise(r => requestAnimationFrame(r));
    /* 触屏层和测试脚本都只说动作名（S3 之后）：'up' / 'atk'，不是 'w' / 'j'。
     * 如果这里还能写键名，说明又有第二份键位表活在别处。 */
    window.__sk.press('up');
    for (let i = 0; i < 4; i++) await raf();
    window.__sk.press('atk');
    await raf();
    window.__sk.release('atk');
    for (let i = 0; i < 3; i++) await raf();
    const out = { state: window.__sk.state().state, n: window.__sk.projectiles().length,
                  mp: window.__sk.state().mp };
    window.__sk.release('up');
    return out;
  });
  R.combo = { before: { state: c0.state, mp: +c0.mp.toFixed(0) }, ...c1,
              pass: c1.n >= 1 && c1.state !== 'attack' && c1.mp < c0.mp };

  // 裸 J 必须还是普攻（不能因为改了组合就把 J 变成魔法）
  await boot();
  R.plainAtk = await hold(['j'], 120, async () => {
    const s = await st(); const n = await proj();
    return { state: s.state, n, pass: s.state === 'attack' && n === 0 };
  });

  // ================= C. 危险键 =================
  // R 按一次 → 只提示，不重开
  await boot();
  await page.keyboard.down('d'); await sleep(400); await page.keyboard.up('d');
  await sleep(420);                      // 等惯性滑完（FRIC_G 停下要 0.2s）
  const beforeR = await st();
  await page.keyboard.press('r');
  await sleep(220);
  const afterR = await st();
  const mR = await page.evaluate(() => window.__sk.msg());
  R.reloadGuard = {
    xBefore: +beforeR.x.toFixed(0), xAfter: +afterR.x.toFixed(0),
    hint: mR.text,
    pass: Math.abs(afterR.x - beforeR.x) < 2 && /再按一次/.test(mR.text),
  };

  // O 打开魂匣，再按关掉
  await boot();
  await page.keyboard.press('o'); await sleep(200);
  const o1 = await menuOpen();
  await page.keyboard.press('o'); await sleep(200);
  const o2 = await menuOpen();
  R.menuKey = { open: o1, closed: !o2, pass: o1 === true && o2 === false };

  // ================= D. 手机层 =================
  const mctx = await b.newContext({
    viewport: { width: 844, height: 390 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true,
  });
  const mp = await mctx.newPage();
  mp.on('pageerror', e => R.errors.push('mobile:' + (e && e.message)));
  await mp.goto(FILE + '?touch=1', { waitUntil: 'load' });
  await sleep(700);
  await mp.evaluate(() => window.__sk && window.__sk.releaseAll());
  const geo = await mp.evaluate(() => {
    const ids = ['pbJump', 'pbAtk', 'pbRed', 'pbBlue', 'pbBack', 'pbMenu'];
    const out = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) { out[id] = null; continue; }
      const r = el.getBoundingClientRect();
      out[id] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }
    return { vw: innerWidth, vh: innerHeight, btns: out };
  });
  const bs = Object.entries(geo.btns).filter(([, v]) => v);
  const overlaps = [];
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const [ia, a] = bs[i], [ib, c] = bs[j];
      const ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x);
      const oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
      if (ox > 0 && oy > 0) overlaps.push(ia + '×' + ib + '(' + Math.min(ox, oy) + 'px)');
    }
  }
  const outOfScreen = bs.filter(([, v]) => v.x < 0 || v.y < 0 ||
    v.x + v.w > geo.vw + 1 || v.y + v.h > geo.vh + 1).map(([k]) => k);
  const tooSmall = bs.filter(([, v]) => Math.min(v.w, v.h) < 44).map(([k, v]) => k + '(' + v.w + ')');
  R.touch = { vw: geo.vw, vh: geo.vh, btns: geo.btns, overlaps, outOfScreen, tooSmall,
              pass: bs.length === 6 && overlaps.length === 0 && outOfScreen.length === 0 && tooSmall.length === 0 };
  await mp.screenshot({ path: path.join(OUT, 'keymap_touch.png') });

  /* 几何对了 ≠ 按得动。mobile.js 走的是 pointerdown/pointerup，
   * 所以这里用真实指针事件按下去，再看游戏状态变没变 ——
   * 只量 getBoundingClientRect 的话，按钮位置完美但事件没绑上，
   * 测试照样全绿，玩家照样点不动。 */
  const center = id => mp.evaluate((id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);

  const tapBtn = async (id, holdMs) => {
    const c = await center(id);
    await mp.mouse.move(c.x, c.y);
    await mp.mouse.down();
    await sleep(holdMs);
    const st = await mp.evaluate(() => window.__sk.state());
    const inp = await mp.evaluate(() => window.__sk.input());
    await mp.mouse.up();
    st.heldActions = inp;
    return st;
  };

  const tj = await tapBtn('pbJump', 180);
  /* "按得动"之上还要"发对了动作"：如果手机层还在发键名（'k'），
   * 动作层里根本不会出现 'jump'，这里立刻红。 */
  R.touchJump = { state: tj.state, vy: +tj.vy.toFixed(0), onGround: tj.onGround,
                  held: tj.heldActions,
                  pass: (tj.vy < -200 || !tj.onGround) && tj.heldActions.jump === 1 };
  await sleep(700);
  const ta = await tapBtn('pbAtk', 120);
  R.touchAtk = { state: ta.state, lock: +ta.lock.toFixed(2),
                 pass: ta.state === 'attack' && ta.lock > 0 };
  await sleep(500);
  const tb = await tapBtn('pbBack', 100);
  R.touchBack = { state: tb.state, invuln: +tb.invuln.toFixed(2),
                  pass: tb.state === 'dash' };
  await sleep(500);

  /* 摇杆：按住右半边往下拖 → 应该先后触发"移动"和"蹲" */
  const st0 = await mp.evaluate(() => window.__sk.state());
  await mp.mouse.move(160, 250);
  await mp.mouse.down();
  await mp.mouse.move(230, 250, { steps: 6 });
  await sleep(280);
  const stR = await mp.evaluate(() => window.__sk.state());
  await mp.mouse.move(160, 320, { steps: 6 });
  await sleep(280);
  const stD = await mp.evaluate(() => window.__sk.state());
  await mp.mouse.up();
  R.touchStick = {
    dx: +(stR.x - st0.x).toFixed(0), stateRight: stR.state, stateDown: stD.state,
    pass: stR.x > st0.x + 25 && stD.state === 'crouch',
  };

  /* 匣：以前它绕过动作层直接调 toggleMenu()，是键盘之外的第二种开法。
   * 现在必须和 Tab/O 走同一条路 —— 这里按两下，开一次、关一次。 */
  const tapMenu = async () => {
    const c = await center('pbMenu');
    await mp.mouse.move(c.x, c.y);
    await mp.mouse.down();
    await sleep(120);
    await mp.mouse.up();
    await sleep(260);
    return mp.evaluate(() => document.getElementById('menu').classList.contains('show'));
  };
  const m1 = await tapMenu();
  const m2 = await tapMenu();
  R.touchMenu = { open: m1, closed: !m2, pass: m1 === true && m2 === false };

  await mctx.close();

  // ================= E. 存档（file:// 下的真 localStorage） =================
  /* 为什么要在浏览器里再测一遍：headless 的 save_check.js 用的是内存假存储，
   * 它证明的是"逻辑对"。真实分发是**双击打开的 file://**，
   * 那里的 localStorage 是另一套规则（每个文件一个 origin，某些浏览器直接禁用）。
   * 只有真刷新一次页面，才能证明"关掉再开还在原地"。 */
  await page.goto(FILE + '?room=tower', { waitUntil: 'load' });
  await sleep(700);
  const towerRoom = await page.evaluate(() => window.__sk.state().room);
  await page.goto(FILE, { waitUntil: 'load' });     // 不带参数：只靠存档决定从哪进
  await sleep(700);
  const backRoom = await page.evaluate(() => window.__sk.state().room);
  const storeLen = await page.evaluate(() => (window.__sk.store() || '').length);
  R.persist = { first: towerRoom, afterReload: backRoom, bytes: storeLen,
                pass: towerRoom === 'tower' && backRoom === 'tower' && storeLen > 20 };
  await page.evaluate(() => window.__sk.wipe());

  fs.writeFileSync(path.join(__dirname, 'keymap_check' + (process.env.KM_OUT || '') + '.json'), JSON.stringify(R, null, 2));
  await b.close();

  const row = (k, v) => {
    const ok = v && v.pass;
    console.log((ok ? 'OK  ' : 'FAIL') + '  ' + k.padEnd(12) + JSON.stringify(v));
  };
  console.log('--- 方向 ---');
  for (const [k, v] of Object.entries(R.dirs)) row(k, v);
  row('W 抬头', R.lookUp);
  console.log('--- 动作 ---');
  row('J 普攻', R.atk); row('K 跳', R.jump); row('U 红魂', R.redKey);
  row('I 后跃', R.back); row('L 蓝魂', R.blueKey);
  console.log('--- 组合 ---');
  row('↑+J 魔法', R.combo); row('裸 J', R.plainAtk);
  console.log('--- 危险键 ---');
  row('R 防误触', R.reloadGuard); row('O 魂匣', R.menuKey);
  console.log('--- 手机 ---');
  row('触屏布局', R.touch);
  row('手机跳', R.touchJump); row('手机攻', R.touchAtk);
  row('手机后跃', R.touchBack); row('手机摇杆', R.touchStick);
  row('手机魂匣', R.touchMenu);
  console.log('--- 存档 ---');
  row('刷新后还在原地', R.persist);
  if (R.errors.length) console.log('errors:', R.errors);
  const bad = Object.values(R).filter(v => v && typeof v === 'object' && 'pass' in v && !v.pass).length;
  console.log(bad === 0 ? '\n键位层全通过' : '\n有 ' + bad + ' 项没过');
})().catch(e => { console.error('CRASH', e); process.exit(1); });
