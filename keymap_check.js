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
 *   D. 手机层 → 七个按钮互不重叠、都在屏内、触控尺寸够，且按下去发的是**动作**
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
  const page = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => R.errors.push(String(e && e.message || e)));

  /* 慢机器模拟：KM_THROTTLE=20 node keymap_check.js
   * 存在的理由：这套断言以前有一项只在"机器慢"时红（消息被开场台词盖掉，
   * 见 L 蓝魂那段注释）。不把慢机做成一个开关，这类问题永远只能靠运气复现。 */
  const THROTTLE = +(process.env.KM_THROTTLE || 0);
  const throttle = async pg => {
    if (THROTTLE <= 0) return;
    const cdp = await pg.context().newCDPSession(pg);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  };
  await throttle(page);
  R.throttle = THROTTLE || 'none';

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

  /* 通用节拍：按下 → 等 ms → 取值 → 松开。
   * 只用在"必须**不**发生某件事"的断言上（例如 W 不许产生位移）——
   * 那种断言等不来，只能固定时长观察。 */
  const hold = async (keys, ms, probe) => {
    for (const k of keys) await page.keyboard.down(k);
    await sleep(ms);
    const v = await probe();
    for (const k of keys) await page.keyboard.up(k);
    return v;
  };

  /* 按住直到条件成立（最多 timeout），并记录**游戏时间**走了多少。
   *
   * 为什么不能写死 sleep(300) 再量位移：20× CPU 降速下，300ms 墙钟里
   * 游戏只走了约 100ms —— 累加器单帧上限 12 步（100ms）是防"切标签页回来
   * 瞬移"的保护，不是 bug。于是位移只有 25px，断言"300ms 内走 40px"就红了，
   * 而玩家手上什么都没变。断言该问"按住会不会往右走"，不该问
   * "这台机器 300ms 跑了几帧"。simMs 记下来，红的时候一眼能分清是哪种。 */
  /* 预算按**游戏时间**算，不按墙钟：20× 降速下页面只有 ~1fps，
   * 等 1.5 秒墙钟 = 只走了 1~2 个物理步，"抬头抬了 14px"不是它的错。
   * 墙钟上限只是兜底，防止页面彻底卡死时把测试挂住。 */
  const holdUntil = async (keys, cond, simBudget = 1.2, wallMax = 12000) => {
    for (const k of keys) await page.keyboard.down(k);
    const t0 = Date.now();
    let s = await st();
    const sim0 = s.simT;
    while (!cond(s) && (s.simT - sim0) < simBudget && Date.now() - t0 < wallMax) {
      await sleep(10);
      s = await st();
    }
    for (const k of keys) await page.keyboard.up(k);
    s.wallMs = Date.now() - t0;
    s.simMs = +((s.simT - sim0) * 1000).toFixed(0);
    s.met = cond(s);
    return s;
  };

  // ================= A. 每个动作键 =================
  R.dirs = {};
  for (const [name, k, axis, sign] of [
    ['D 右', 'd', 'x', 1], ['A 左', 'a', 'x', -1],
    ['W 上（不动）', 'w', 'y', 0], ['S 下（蹲）', 's', 'y', 0],
  ]) {
    await boot();
    const a = await st();
    if (axis === 'x') {
      /* "往右走"这件事本身：位移方向对、且确实走了（40px ≈ 起步后的 0.15s） */
      const c = await holdUntil([k], s => Math.sign(s.x - a.x) === sign && Math.abs(s.x - a.x) > 40);
      R.dirs[name] = {
        dx: +(c.x - a.x).toFixed(1), dy: +(c.y - a.y).toFixed(1), state: c.state,
        simMs: c.simMs, wallMs: c.wallMs, pass: c.met,
      };
    } else if (k === 's') {
      const c = await holdUntil([k], s => s.state === 'crouch', 0.5);
      R.dirs[name] = { dx: +(c.x - a.x).toFixed(1), state: c.state,
                       simMs: c.simMs, pass: c.met };
    } else {
      /* W 是"不许发生"的断言：等不来，只能固定时长看它有没有动 */
      const c = await hold([k], 300, st);
      R.dirs[name] = { dy: +(c.y - a.y).toFixed(1), state: c.state,
                       pass: Math.abs(c.y - a.y) < 2 };
    }
  }

  // W 的可见效果：镜头往上（抬头）。抬到头要一会儿，等它过线，不等固定时长。
  await boot();
  const camA = await page.evaluate(() => window.__sk.cam());
  const up = await holdUntil(['w'], s => s.camY < camA.y - 20, 2.5);
  /* 读**满足条件那一步**的 camY，不读松手之后重新取的一次。
   * 抬头是瞬时效果：松开 ↑ 镜头就回位，而"松手 → 再取一次"是两个往返，
   * CPU 降速时那段能跑掉十几帧，量到的已经是回位后的值。
   * 这和"读 SAY_LOG 历史而不是读当前 msg"是同一类错误 ——
   * 量一个瞬时效果，必须在它成立的**那一刻**读，不能事后再补读。 */
  R.lookUp = { before: camA.y, after: up.camY, dy: +(up.camY - camA.y).toFixed(1),
               simMs: up.simMs, pass: up.met };

  // J 攻击
  await boot();
  R.atk = await (async () => {
    const s0 = await st();
    const c = await holdUntil(['j'], s => s.state === 'attack' && s.lock > 0, 0.5);
    return { state: c.state, lock: +c.lock.toFixed(2), simMs: c.simMs,
             pass: c.met && c.state === 'attack' && c.lock > 0 };
  })();

  // K 跳
  await boot();
  R.jump = await (async () => {
    const c = await holdUntil(['k'], s => s.vy < -300 && !s.onGround, 0.5);
    return { vy: +c.vy.toFixed(0), onGround: c.onGround, simMs: c.simMs,
             pass: c.met };
  })();

  // U 红魂：等投射物真的出现（不看它飞多远，只看"出没出"）
  await boot();
  R.redKey = await (async () => {
    const s0 = await st();
    await page.keyboard.down('u');
    const t0 = Date.now();
    let n = 0, s = s0;
    while (n < 1 && Date.now() - t0 < 800) { await sleep(10); n = await proj(); s = await st(); }
    await page.keyboard.up('u');
    return { n, cd: +s.cdRed.toFixed(2), wallMs: Date.now() - t0,
             pass: n >= 1 && s.cdRed > 0 };
  })();

  // F 冲刺（原"后跃"，旧键 I 保留为别名）：朝背后（初始朝右 → 往左）
  /* 无敌只持续 0.12s，而位移要 0.2s 才走完 —— 两个量必须在不同时刻采样。
   * 上一版在 120ms 时同时取，invuln 恰好归零，报了个假警报。 */
  await boot();
  const bd = await st();
  await page.keyboard.down('f');
  let sBack = await st(), dashSeen = false, invInDash = 0, met = false;
  {
    const t0 = Date.now();
    while (Date.now() - t0 < 900) {
      sBack = await st();
      if (sBack.state === 'dash') { dashSeen = true; invInDash = Math.max(invInDash, sBack.invuln); }
      if (sBack.x < bd.x - 60) { met = true; break; }
      await sleep(10);
    }
  }
  await page.keyboard.up('f');
  /* 这里只测**行为**：按 I 会朝背后弹开 60px 以上，且过程中进过 dash 状态。
   * 无敌帧不在这里断言 —— 它只覆盖 dash 的前 0.12s，而 20× 降速下采样点
   * 落在 dash 后段时 invuln 正经是 0，"看到 0 就判失败"是冤枉（已经踩过一次）。
   * 那条性质由 test.js 的"后跃带无敌帧"按物理步确定性验证。 */
  R.back = {
    dx: +(sBack.x - bd.x).toFixed(1), state: sBack.state,
    dashSeen, invulnInDash: +invInDash.toFixed(3),
    pass: met,
  };

  /* F 侧身这一段已删除（2026-11-25）：侧身不是"改个键"能救的，
   * 它整个动词都没了。F 现在绑冲刺，见下面 R.backF。 */

  // L 蓝魂：初始没装备，必须有提示（不能按下去毫无回应）
  await boot();
  /* 判据必须落在 say() 那一行字上（画在 canvas 里），不能读 #log ——
   * #log 里本来就有"Tab 打开魂菜单"，任何 /魂菜单/ 的判据都会假阳性。
   *
   * 但**不能读"现在这一行是什么"**：屏幕只有一行，开场三句台词是
   * setTimeout 2.6s / 5.2s 发的，机器慢一点（或页面被压测拖慢）就会在
   * 这条断言采样之前把它顶掉。2026-11-24 的就是这么红的：
   * 20× CPU 降速下读到了"你按下去的时候，手抖了一下"。
   * 所以读**历史**（__sk.says()），问的是"按下之后有没有出现过这句"——
   * 这才是"按键有没有回声"本身。 */
  const cntBad = () => page.evaluate(() =>
    window.__sk.says().filter(t => /没有装备蓝魂/.test(t)).length);
  const nBad0 = await cntBad();
  R.blueKey = await hold(['l'], 120, async () => {
    const n = await cntBad();
    const last = await page.evaluate(() => window.__sk.says().slice(-1)[0] || '');
    return { hint: last, hits: n - nBad0, pass: n > nBad0 };
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
                  cd: window.__sk.state().cdRed };
    window.__sk.release('up');
    return out;
  });
  R.combo = { before: { state: c0.state, cd: +c0.cdRed.toFixed(2) }, ...c1,
              pass: c1.n >= 1 && c1.state !== 'attack' && c1.cd > c0.cdRed };

  // 裸 J 必须还是普攻（不能因为改了组合就把 J 变成魔法）
  await boot();
  R.plainAtk = await (async () => {
    const c = await holdUntil(['j'], s => s.state === 'attack', 0.5);
    const n = await proj();
    return { state: c.state, n, simMs: c.simMs, pass: c.met && n === 0 };
  })();

  // ================= C. 危险键 =================
  // R 按一次 → 只提示，不重开
  await boot();
  await page.keyboard.down('d'); await sleep(400); await page.keyboard.up('d');
  await sleep(420);                      // 等惯性滑完（FRIC_G 停下要 0.2s）
  const beforeR = await st();
  /* 同上：读历史，不读当前那一行（开场台词也会盖它） */
  const cntR = () => page.evaluate(() =>
    window.__sk.says().filter(t => /再按一次/.test(t)).length);
  const nR0 = await cntR();
  await page.keyboard.press('r');
  await sleep(220);
  const afterR = await st();
  const nR1 = await cntR();
  R.reloadGuard = {
    xBefore: +beforeR.x.toFixed(0), xAfter: +afterR.x.toFixed(0),
    hint: await page.evaluate(() => window.__sk.says().slice(-1)[0] || ''),
    hit: nR1 - nR0,
    pass: Math.abs(afterR.x - beforeR.x) < 2 && nR1 > nR0,
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
  await throttle(mp);
  await mp.goto(FILE + '?touch=1', { waitUntil: 'load' });
  await sleep(700);
  await mp.evaluate(() => window.__sk && window.__sk.releaseAll());
  const geo = await mp.evaluate(() => {
    /* 四格装备 + 三键（WO-004）。判据跟以前一样，只是可点区域换了地方：
     *   「攻」从按钮变成 1 号格（剑），「纸」变成 2 号格，「后跃」变成「翻滚」键，
     *   红/蓝从按钮变成 3、4 号格。 */
    const ids = ['pbJump', 'pbRoll', 'pbUse', 'pbMenu', 'slotw1', 'slotw2', 'slotred', 'slotblue'];
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
              /* 8 个可点区域 = 4 格 + 3 键 + 匣。数量不是目标本身，
               * 但它挡住了"漏掉某一格/某键"这种改一半的中间状态。 */
              pass: bs.length === 8 && overlaps.length === 0 && outOfScreen.length === 0 && tooSmall.length === 0 };
  await mp.screenshot({ path: path.join(OUT, 'keymap_touch.png') });

  /* 几何对了 ≠ 按得动。mobile.js 走的是 pointerdown/pointerup，
   * 所以这里用真实指针事件按下去，再看游戏状态变没变 ——
   * 只量 getBoundingClientRect 的话，按钮位置完美但事件没绑上，
   * 测试照样全绿，玩家照样点不动。 */
  const center = id => mp.evaluate((id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);

  const mst = () => mp.evaluate(() => window.__sk.state());
  /* 按下去 → 等到条件成立（或超时）→ 松开。固定 holdMs 在慢机上会漏状态：
   * dash 只有 0.2s，采样点落在它后面就永远看不见。 */
  const tapBtn = async (id, cond, timeout = 1200) => {
    const c = await center(id);
    await mp.mouse.move(c.x, c.y);
    await mp.mouse.down();
    const t0 = Date.now();
    let st = await mst();
    while (!cond(st) && Date.now() - t0 < timeout) { await sleep(10); st = await mst(); }
    st.heldActions = await mp.evaluate(() => window.__sk.input());
    st.wallMs = Date.now() - t0;
    st.met = cond(st);
    await mp.mouse.up();
    return st;
  };
  /* 等游戏自己回到可再操作的状态（落地 / 出招结束），不等墙钟 */
  const mpWait = async (cond, timeout = 2500) => {
    const t0 = Date.now();
    let st = await mst();
    while (!cond(st) && Date.now() - t0 < timeout) { await sleep(15); st = await mst(); }
    return st;
  };

  const tj = await tapBtn('pbJump', st => st.vy < -200 || !st.onGround);
  /* "按得动"之上还要"发对了动作"：如果手机层还在发键名（'k'），
   * 动作层里根本不会出现 'jump'，这里立刻红。 */
  R.touchJump = { state: tj.state, vy: +tj.vy.toFixed(0), onGround: tj.onGround,
                  held: tj.heldActions, wallMs: tj.wallMs,
                  pass: tj.met && tj.heldActions.jump === 1 };
  await mpWait(st => st.onGround);

  /* 格子是"点一下就用"：mobile.js 按下即 press、90ms 后自己 release。
   * 所以不能像圆键那样"按住再读 input()" —— 读的时候它已经松开了。
   * 这里按下立刻抬手，再轮询状态：状态变了才证明这一格真的通了。 */
  const tapSlot = async (id, cond, timeout = 1200) => {
    /* 按住 90ms 之后 mobile.js 会自己松开（那几格都是边沿触发）。
     * 两次点击必须隔开这段自动松开的时间，否则第二次按下去时
     * 动作层还认为"这个来源已经按着"，新的边沿不会产生 ——
     * 表现出来就是"点第二下没反应"。真人做不到 90ms 内点两下。 */
    await sleep(170);
    const c = await center(id);
    await mp.mouse.move(c.x, c.y);
    await mp.mouse.down();
    await sleep(30);
    await mp.mouse.up();
    const t0 = Date.now();
    let st = await mst();
    while (!cond(st) && Date.now() - t0 < timeout) { await sleep(10); st = await mst(); }
    st.wallMs = Date.now() - t0;
    st.met = cond(st);
    return st;
  };

  const ta = await tapSlot('slotw1', st => st.state === 'attack' && st.lock > 0);
  R.touchAtk = { state: ta.state, lock: +ta.lock.toFixed(2), wallMs: ta.wallMs,
                 pass: ta.met };
  await mpWait(st => st.state !== 'attack' && st.lock <= 0);

  /* 手机侧身/手机起身两条已删除（2026-11-25）：第二格现在是空槽，
   * 点它什么也不该发生。反倒该断言"点了不会把状态搞坏"——
   * 空槽按钮绑过 'flat' 的时候，点下去会让输入层静默失败，更难查。 */
  {
    const before = await mst();
    const t2 = await tapSlot('slotw2', st => st.state !== before.state, 420);
    R.touchEmptySlot = { state: t2.state, sameAsBefore: t2.state === before.state,
                         pass: t2.state === before.state };
  }

  const tb = await tapBtn('pbRoll', st => st.state === 'dash');
  R.touchBack = { state: tb.state, invuln: +tb.invuln.toFixed(2), wallMs: tb.wallMs,
                  pass: tb.met };
  await mpWait(st => st.state !== 'dash');

  /* 摇杆：按住右半边往下拖 → 应该先后触发"移动"和"蹲" */
  const st0 = await mst();
  await mp.mouse.move(160, 250);
  await mp.mouse.down();
  await mp.mouse.move(230, 250, { steps: 6 });
  let stR = await mst();
  {
    const t0 = Date.now();
    while (!(stR.x > st0.x + 25) && Date.now() - t0 < 1500) { await sleep(15); stR = await mst(); }
  }
  await mp.mouse.move(160, 320, { steps: 6 });
  let stD = await mst();
  {
    const t0 = Date.now();
    while (stD.state !== 'crouch' && Date.now() - t0 < 1200) { await sleep(15); stD = await mst(); }
  }
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
    await sleep(60);
    await mp.mouse.up();
    /* 菜单是同步开关的，但要等事件派发到页面，轮询比 sleep 稳 */
    const t0 = Date.now();
    let open = await mp.evaluate(() => document.getElementById('menu').classList.contains('show'));
    const want = !open;
    while (open !== want && Date.now() - t0 < 800) {
      await sleep(20);
      open = await mp.evaluate(() => document.getElementById('menu').classList.contains('show'));
    }
    return open;
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

  fs.writeFileSync(path.join(__dirname, 'keymap_check.json'), JSON.stringify(R, null, 2));
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
  row('F 冲刺', R.back); row('L 蓝魂', R.blueKey);
  console.log('--- 组合 ---');
  row('↑+J 魔法', R.combo); row('裸 J', R.plainAtk);
  console.log('--- 危险键 ---');
  row('R 防误触', R.reloadGuard); row('O 魂匣', R.menuKey);
  console.log('--- 手机 ---');
  row('触屏布局', R.touch);
  row('手机跳', R.touchJump); row('手机攻', R.touchAtk);
  row('手机后跃', R.touchBack); row('手机空格', R.touchEmptySlot);
  row('手机摇杆', R.touchStick);
  row('手机魂匣', R.touchMenu);
  console.log('--- 存档 ---');
  row('刷新后还在原地', R.persist);
  if (R.errors.length) console.log('errors:', R.errors);
  /* 递归数，不能只看第一层：R.dirs 里的四行以前**从来没被数过**，
   * 于是"方向键坏了"也会打印"全通过" —— 一个说谎的总结比没有总结更糟。 */
  const bad = [];
  const walk = (o, path) => {
    if (!o || typeof o !== 'object') return;
    if ('pass' in o) { if (!o.pass) bad.push(path); return; }
    for (const [k, v] of Object.entries(o)) walk(v, path ? path + '.' + k : k);
  };
  walk(R, '');
  console.log(bad.length === 0 ? '\n键位层全通过（24 项）'
            : '\n有 ' + bad.length + ' 项没过: ' + bad.join(', '));
  if (bad.length) process.exitCode = 1;
})().catch(e => { console.error('CRASH', e); process.exit(1); });
