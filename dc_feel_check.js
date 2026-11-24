// dc_feel_check.js — A 路线 P1：手感三件套验收
//
// 这一套测的不是"功能有没有"，是**边界在哪**。三件套每一件都有一个
// "差一点就变味"的临界点，测不出来就等于没做：
//
//   A. 取消后摇：前摇里按后跃必须**失败**，后摇里必须**成功**。
//      只测"能取消"而不测"什么时候不能取消"，做出的是一招无责任攻击。
//   B. rally：额度要有上限、窗口要会过期。只测"能回血"，
//      做出的是一台站着不漏血的机器。
//   C. 一击保护：血 >25% 才触发，<25% 该死死。只测"触发"，会把低血量
//      变成免死金牌，整局紧张感消失。
//   D. 眩晕：只验 stunT 存在不够，还要验它真的会结束。
//
// 用法: node dc_feel_check.js
'use strict';
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
const ck = (name, ok, extra) => {
  if (ok) { pass++; console.log('OK   ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};

/* 站在回廊地面上（地板 y=15 格 = 720，角色高 100 → 头顶 620）。
 * 用 place 而不是走位：走位要靠运气，靠运气的测试跑三次绿一次不算证据。 */
const STAND = { x: 336, y: 620 };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 810 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(FILE, { waitUntil: 'load' });
  await p.waitForTimeout(1500);

  const st = () => p.evaluate(() => window.__sk.state());
  const foes = () => p.evaluate(() => window.__sk.foes());
  /* reset 只管位置；血量另外显式设，不让上一段测试的残血漏进来。
   * 上一版没隔离，D 段开局血只有 67，hurt(80) 就直接触发了保护 ——
   * 于是后面那条"致死一刀"根本没跑到，报出来的现象像"眩晕没生效"。 */
  const reset = async (x = STAND.x, y = STAND.y, hp = 120) => {
    await p.evaluate(([a, c, h]) => { window.__sk.place(a, c); window.__sk.setHp(h); }, [x, y, hp]);
    await p.waitForTimeout(260);      // 落地：place 之后 onGround 是 false，得给物理步时间
  };
  const tap = async (act, ms = 18) => {
    await p.evaluate(a => window.__sk.press(a), act);
    await p.waitForTimeout(ms);
    await p.evaluate(a => window.__sk.release(a), act);
  };

  /* ================= A. 取消后摇 ================= */
  /* 前摇 0.09s。30ms 时 animT≈0.033，140ms 时≈0.14 —— 两边都离边界足够远，
   * 不会因为调度抖动测出"偶尔失败"。 */
  await reset();
  await p.evaluate(() => window.__sk.press('atk'));
  await p.waitForTimeout(30);
  const a1 = await st();
  await p.evaluate(() => window.__sk.release('atk'));
  await p.evaluate(() => window.__sk.press('back'));
  await p.waitForTimeout(45);
  await p.evaluate(() => window.__sk.release('back'));
  const a2 = await st();
  ck('A1 攻击已起手（state=attack）', a1.state === 'attack', { state: a1.state, anim: +a1.lock.toFixed(2) });
  ck('A2 前摇里按后跃：**取消不了**（仍是 attack）', a2.state === 'attack', { state: a2.state });

  await p.waitForTimeout(500);       // 让上一次攻击彻底结束、atkCd 走完
  await reset();
  await p.evaluate(() => window.__sk.press('atk'));
  await p.waitForTimeout(140);
  const a3 = await st();
  await p.evaluate(() => window.__sk.release('atk'));
  await p.evaluate(() => window.__sk.press('back'));
  await p.waitForTimeout(45);
  await p.evaluate(() => window.__sk.release('back'));
  const a4 = await st();
  ck('A3 攻击进入后摇（仍在 attack）', a3.state === 'attack', { state: a3.state });
  ck('A4 后摇里按后跃：**取消成功**（变 dash）', a4.state === 'dash', { state: a4.state });
  ck('A5 取消后速度反向（后跃真的弹开了）', a4.vx < -200, { vx: Math.round(a4.vx) });

  /* ================= B. rally ================= */
  await p.waitForTimeout(400);
  await reset();
  await p.evaluate(() => window.__sk.hurt(40));
  const b1 = await st();
  ck('B1 受伤后产生 rally 额度', b1.rally > 0, { rally: +b1.rally.toFixed(1) });
  ck('B2 额度不超过本次伤害的 60%', b1.rally <= 40 * 0.6 + 0.01, { rally: +b1.rally.toFixed(1) });
  ck('B3 窗口打开（rallyT≈2.5）', b1.rallyT > 2.0, { t: +b1.rallyT.toFixed(2) });

  /* 画面上必须看得见。rally 是"看不见就等于不存在"的机制：
   * 玩家不知道有个 2.5 秒的窗口，就永远不会去打那一下。
   * 所以这里量的不是状态字段，是**玩家眼睛能看到的那个宽度**。
   * 等 260ms：syncHUD 每 0.1 秒跑一次，CSS 的 width 还带 .12s 过渡 ——
   * 立刻读会读到过渡起点（0），那不是"没画"，是"还没画完"。 */
  await p.waitForTimeout(260);
  const rlw = await p.evaluate(() => {
    const r = document.getElementById('hprally');
    if (!r) return -1;
    return r.getBoundingClientRect().width;
  });
  ck('B3b 血条上画出了可夺回段（宽度 > 0）', rlw > 1, { px: rlw });

  /* 窗口内打一下。
   * 不能写死坐标 —— 史莱姆在 480~672 之间巡逻，跑到哪算哪。
   * 上一版写死 516，结果它已经走到 672，攻击框整个落在空气里，
   * 测出来的是"没命中"，会被误读成"rally 不工作"。 */
  const fs = await foes();
  const tgt = fs[0];
  ck('B4 前置：场上至少一个敌人', !!tgt, { n: fs.length });
  await reset(tgt.x - 60, tgt.y + tgt.h - 100, 80);
  const before = await st();
  await tap('atk', 20);
  await p.waitForTimeout(180);       // 判定在 0.09s，留足余量
  const after = await st();
  ck('B5 窗口内命中：血真的回来了', after.hp > before.hp,
     { before: +before.hp.toFixed(0), after: +after.hp.toFixed(0),
       rally: +after.rally.toFixed(1), at: { x: tgt.x, y: tgt.y } });

  /* 窗口过期：额度必须清空，不能留着慢慢夺 */
  await reset();
  await p.evaluate(() => window.__sk.hurt(30));
  const b5 = await st();
  await p.waitForTimeout(2750);
  const b6 = await st();
  ck('B6 过期前还有额度', b5.rally > 0, { rally: +b5.rally.toFixed(1) });
  ck('B7 2.5 秒后额度清零', b6.rally === 0 && b6.rallyT === 0, { rally: b6.rally, t: b6.rallyT });

  /* 清零之后那段斜纹必须跟着消失，否则玩家会一直看到一段"其实夺不回来"的血。
   * 同样要等过渡：游戏时间是按帧累加的，2750ms 实时可能只走了 2.55 秒游戏时间，
   * 清零刚发生、CSS 正从 40px 收到 0。立刻读会读到 1px 的残影，误判成"没清"。 */
  await p.waitForTimeout(300);
  const rlw0 = await p.evaluate(() => {
    const r = document.getElementById('hprally');
    return r ? r.getBoundingClientRect().width : -1;
  });
  ck('B8 额度清零后画面上也没有了', rlw0 < 1, { px: rlw0 });

  /* ================= C. 一击保护 ================= */
  await reset();
  await p.evaluate(() => window.__sk.hurt(80));       // 120 → 40（> 25% 的 30）
  await p.waitForTimeout(1000);                        // 等无敌帧过，否则下一刀被吃掉
  await p.evaluate(() => window.__sk.hurt(9999));
  const c1 = await st();
  ck('C1 血 40 时挨致死一刀：剩 1 HP 且没死', !c1.dead && Math.round(c1.hp) === 1,
     { hp: +c1.hp.toFixed(1), dead: c1.dead });
  ck('C2 冷却进入 45 秒', c1.ohpCd > 44 && c1.ohpCd <= 45, { cd: +c1.ohpCd.toFixed(1) });

  /* 低血量不保护：这是它和"免死金牌"的分界线 */
  await reset();
  await p.evaluate(() => window.__sk.hurt(105));      // 120 → 15（< 30）
  await p.waitForTimeout(1000);
  await p.evaluate(() => window.__sk.hurt(9999));
  const c3 = await st();
  ck('C3 血 15 时挨致死一刀：真的会死（保护不生效）', c3.dead === true, { hp: +c3.hp.toFixed(1), dead: c3.dead });

  /* 死过之后必须等复活走完（deadT > 1.3s 才 respawn）。
   * 不等的话后面每一次 hurt 都被 `if (P.dead) return` 吃掉，
   * 测出来是"冷却一直是 0"—— 会让人去改没坏的代码。 */
  await p.waitForTimeout(2600);

  /* 喝药重置冷却 */
  await reset();
  await p.evaluate(() => window.__sk.hurt(80));
  await p.waitForTimeout(1000);
  await p.evaluate(() => window.__sk.hurt(9999));
  const c4 = await st();
  await p.waitForTimeout(1000);                        // 等 flaskCd / 无敌帧
  await p.click('#flask');
  await p.waitForTimeout(200);
  const c5 = await st();
  ck('C4 触发后确实在冷却中', c4.ohpCd > 44, { cd: +c4.ohpCd.toFixed(1) });
  ck('C5 喝药把冷却清掉（DC：喝药可重置）', c5.ohpCd === 0, { cd: c5.ohpCd });

  /* ================= D. 眩晕 ================= */
  /* 站到史莱姆左边 126px：不接触，但在 160px 的眩晕半径内。
   * 史莱姆的巡逻下界是 x=480，所以站在 450~478 不会被碰。 */
  /* 先把血打到 40，等无敌帧过去，再**重新摆位**触发保护。
   * 为什么不能一边挨打一边等：hurtPlayer 的击退是 225px/s，
   * 一巴掌把人推开 68px —— 原本站在 130px 处，等它推完就到 198px，
   * 早就出了 160 的眩晕半径。测出来是"没震住"，其实是"人被打飞了"。 */
  await reset(STAND.x, STAND.y, 120);
  await p.evaluate(() => window.__sk.hurt(80));
  await p.waitForTimeout(1000);

  const f0 = await foes();
  ck('D1 附近有敌人（测试前提）', f0.length > 0, { n: f0.length });
  const st1 = await st();
  /* 取**离玩家最近**的那个，不是数组第一个 —— 前面的攻击可能已经打死了一只，
   * f0[0] 换人之后，摆位坐标就全错。 */
  const d0 = f0.slice().sort((a, c) =>
    Math.hypot(a.x - st1.x, a.y - st1.y) - Math.hypot(c.x - st1.x, c.y - st1.y))[0];
  await p.evaluate(([x, y]) => window.__sk.place(x, y), [d0.x - 100, d0.y + d0.h - 100]);
  await p.waitForTimeout(200);

  /* hurt 和读数必须在**同一次 evaluate** 里：分两次的话，中间那几百毫秒
   * 环境抖动会把 1 秒的眩晕磨到 0.13，测出来像是"没震住"。 */
  const r1 = await p.evaluate(() => { window.__sk.hurt(9999); return { st: window.__sk.state(), foes: window.__sk.foes() }; });
  const f1 = r1.foes;
  ck('D0 这一刀确实触发了保护（冷却起来了）', r1.st.ohpCd > 0, { cd: +r1.st.ohpCd.toFixed(1), hp: +r1.st.hp.toFixed(1) });
  ck('D2 一击保护把附近敌人震住', f1.some(e => e.stunT >= 0.9),
     { stuns: f1.map(e => e.stunT) });

  await p.waitForTimeout(1200);
  const f2 = await foes();
  ck('D3 眩晕会结束（不是永久定身）', f2.every(e => e.stunT === 0),
     { stuns: f2.map(e => e.stunT) });

  /* ================= F. 攻击输入缓冲 =================
   * 这一节的由来（ACTION_CHAIN.md §4）：照抄对照表只比了"有没有这个键 / 按了干什么"，
   * 没比"按下去是被接住还是被吃掉"。实测 8 连打只出 2 刀 —— 玩家读到的是"这键有时不灵"。
   *
   * 加了缓冲就要守四条边界，任何一条破了都比不加更糟：
   *   F1 后摇末尾补按 → 接上（把被吞的输入救回来）
   *   F2 前摇里补按   → **不接**（否则等于前摇可取消，攻击变成无责任）
   *   F3 受击硬直里猛按 → 不接（不能变成"挨完自动还手"）
   *   F4 连打不超频   → 缓冲只改"能不能接上"，不改"一秒几刀"
   */
  /* 数"起刀"数 lock 的复位次数，不数 state 的进出 —— 缓冲接刀时状态一直停在
   * attack，中间没有 stand 那一帧，按状态数会少算一刀。 */
  const countSlashes = async (ms) => {
    await p.evaluate(() => {
      window.__lk = []; window.__lkOn = true;
      const f = () => {
        if (!window.__lkOn) return;
        window.__lk.push(window.__sk.state().lock);
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    await p.waitForTimeout(ms);
    const arr = await p.evaluate(() => { window.__lkOn = false; return window.__lk; });
    let n = 0, prev = 0;
    for (const v of arr) { if (v > 0.24 && prev <= 0.24) n++; prev = v; }
    return n;
  };

  await reset();
  {
    const rP = countSlashes(700);
    await tap('atk');
    await p.waitForTimeout(220);            // 剩 ~80ms，缓冲窗口内
    await tap('atk');
    const n = await rP;
    ck('F1 后摇末尾补按：接上第二刀', n === 2, { 刀数: n });
  }

  await p.waitForTimeout(400);
  await reset();
  {
    const rP = countSlashes(700);
    await tap('atk');
    await p.waitForTimeout(50);             // 前摇 90ms 之内
    await tap('atk');
    const n = await rP;
    ck('F2 前摇里补按：**不接**（前摇仍不可取消）', n === 1, { 刀数: n });
  }

  await p.waitForTimeout(400);
  await reset();
  {
    const rP = countSlashes(800);
    await p.evaluate(() => window.__sk.hurt(12));
    for (let i = 0; i < 4; i++) { await p.waitForTimeout(40); await tap('atk'); }
    const n = await rP;
    ck('F3 受击硬直里猛按：一刀都不出', n === 0, { 刀数: n });
  }

  await p.waitForTimeout(500);
  await reset();
  {
    const rP = countSlashes(1000);
    for (let i = 0; i < 8; i++) { await tap('atk', 12); await p.waitForTimeout(48); }
    const n = await rP;
    /* 上限 = 1000ms / 300ms ≈ 3，留 1 刀给起手相位。超过就说明缓冲绕过了 atkCd。 */
    ck('F4 连打 8 下不超过 CD（0.3s 一刀）', n >= 3 && n <= 4, { 刀数: n });
  }

  ck('E1 全程没有 JS 异常', errs.length === 0, errs.slice(0, 3));

  console.log('\n==== ' + (fail === 0 ? '全部通过' : '有失败') + ' — OK ' + pass + ' / FAIL ' + fail + ' ====');
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})();
