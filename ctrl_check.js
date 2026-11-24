// ctrl_check.js — 图例说了什么，按键就必须做到什么。
//
// 这个套件不从代码里读期望，它读**界面上那一行**（#keys .ent 的 data-keys / data-verb），
// 然后照着自己按。于是"说明"和"实现"不可能各走各的：
//   · 图例多写一个按不出来的键 -> 红
//   · 图例少写一个能用的键      -> 「完整性」那一组红
//   · 改键位忘了改图例          -> 字母对不上，红
//
// 上一轮的问题正是这个：滑铲（下+跳）和穿板（下+攻）两个组合键，图例里一个字都没有，
// 玩家只能靠猜。按键是好的，说明是残的 —— 而"说明残"和"控制坏"在玩家那里是同一件事。
'use strict';
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/') + '?room=hall';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? 'OK   ' : 'FAIL ') + name.padEnd(24) + (detail === undefined ? '' : JSON.stringify(detail)));
}

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(FILE, { waitUntil: 'load' });
  await sleep(800);
  await page.keyboard.press('Enter');
  await sleep(900);

  // ---------- 1. 从界面读图例 ----------
  // 主界面只有四个高频动作（裁定 Q3），完整表在魂匣里（#fullkeys）。
  const read = sel => page.evaluate(s => [...document.querySelectorAll(s + ' .ent')].map(el => ({
    keys: el.getAttribute('data-keys').split('+'),
    verb: el.getAttribute('data-verb'),
    need: el.getAttribute('data-need'),
    off: el.classList.contains('off'),
    lock: (el.querySelector('.lk') || {}).textContent || '',
    text: el.textContent.trim(),
  })), sel);
  const hi = await read('#keys');
  check('主界面图例正好 4 条', hi.length === 4, hi.map(e => e.verb));
  /* 纸删了（2026-11-25），主界面空出的那一位给了冲刺 ——
   * 它本来就是拇指三键之一（跳 / 冲刺 / 交互），只是以前被侧身挤掉了。 */
  check('主界面是 移动/跳/冲刺/攻',
        JSON.stringify(hi.map(e => e.verb)) === '["移动","跳","冲刺","攻"]', hi.map(e => e.verb));

  const legend = await read('#fullkeys');
  /* 写死数量是刻意的：表里加一条就红一次，逼人确认新条目真的渲染出来了。
   * 12 = 13 − 纸（侧身随 2026-11-25 删除）。 */
  check('魂匣里有完整 12 条', legend.length === 12, legend.length);
  check('完整表含血瓶', legend.some(e => e.verb === '血瓶'));
  check('完整表含滑铲', legend.some(e => e.verb === '滑铲'));
  check('完整表含穿板', legend.some(e => e.verb === '穿板'));
  check('空蓝魂槽 = 蓝魂变灰', legend.filter(e => e.verb === '蓝魂').every(e => e.off === true));
  // 裁定 Q4：不可用必须是"变灰 + 明写未装备"，不是只暗一点
  const lb = legend.find(e => e.verb === '蓝魂');
  check('不可用项写明「未装备」', lb.off === true && lb.lock === '未装备', { off: lb.off, lock: lb.lock });
  // 分组按动作（裁定 Q1），不按手指
  const groups = await page.evaluate(() => [...document.querySelectorAll('#fullkeys .gname')].map(el => el.textContent));
  check('分组是 移动/战斗/工具/系统',
        JSON.stringify(groups) === '["移动","战斗","工具","系统"]', groups);

  // 图例字母必须就是 KEY_OF 的字母（不是手抄的）
  const caps = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#fullkeys .ent').forEach(el => {
      out[el.getAttribute('data-verb')] = [...el.querySelectorAll('.k')].map(k => k.textContent);
    });
    return out;
  });
  check('移动印 A/D', JSON.stringify(caps['移动']) === '["A","D"]', caps['移动']);
  check('滑铲印 S+K', JSON.stringify(caps['滑铲']) === '["S","K"]', caps['滑铲']);
  check('穿板印 S+J', JSON.stringify(caps['穿板']) === '["S","J"]', caps['穿板']);
  check('冲刺印 F', JSON.stringify(caps['冲刺']) === '["F"]', caps['冲刺']);

  // ---------- 2. 逐条按下去 ----------
  const snap = () => page.evaluate(() => {
    const s = window.__sk.state();
    return { x: s.x, y: s.y, st: s.state, cd: s.cdRed, camY: s.camY, cw: s.cw, dropT: s.dropT,
      menu: !!document.querySelector('#menu.show'), onGround: s.onGround };
  });
  const place = (x, y) => page.evaluate(([x, y]) => window.__sk.place(x, y), [x, y]);

  // 地面 y：回廊地面在第 15 行，行首 720 -> 脚底 720，头顶 620
  const FLOOR_Y = 620;
  async function toFloor() {
    await page.evaluate(() => window.__sk.place(3 * 48 + 10, 620));
    await sleep(320);
  }

  // --- 移动 ---
  await toFloor();
  let a = await snap();
  await page.keyboard.down('d'); await sleep(400); await page.keyboard.up('d'); await sleep(150);
  let c = await snap();
  check('D 真的移动', c.x - a.x > 20, { dx: Math.round(c.x - a.x), st: c.st });

  // --- 抬头 ---
  await toFloor();
  a = await snap();
  await page.keyboard.down('w'); await sleep(360); await page.keyboard.up('w'); await sleep(120);
  c = await snap();
  check('W 真的抬头', c.camY - a.camY < -10, { dcam: Math.round(c.camY - a.camY) });

  // --- 蹲 ---
  await toFloor();
  await page.keyboard.down('s'); await sleep(260);
  c = await snap();
  check('S 真的蹲下', c.st === 'crouch', { st: c.st });
  await page.keyboard.up('s'); await sleep(200);

  // --- 滑铲 = 下 + 跳 ---
  await toFloor();
  await page.keyboard.down('s'); await sleep(120);
  await page.keyboard.down('k'); await sleep(90);
  c = await snap();
  check('下+跳 真的滑铲', c.st === 'slide', { st: c.st });
  await page.keyboard.up('k'); await page.keyboard.up('s'); await sleep(400);

  // --- 跳 ---
  await toFloor();
  a = await snap();
  await page.keyboard.down('k'); await sleep(90); await page.keyboard.up('k'); await sleep(120);
  c = await snap();
  check('K 真的起跳', c.st === 'jump' || c.y < a.y - 20, { st: c.st, dy: Math.round(c.y - a.y) });
  await sleep(700);

  // --- 攻 ---
  await toFloor();
  await page.keyboard.press('j'); await sleep(70);
  c = await snap();
  check('J 真的出招', c.st === 'attack', { st: c.st });
  await sleep(500);

  // --- 红魂：进入冷却 ---
  await toFloor();
  await page.evaluate(() => { window.__sk.state(); });
  a = await snap();
  await page.keyboard.press('u'); await sleep(120);
  c = await snap();
  check('U 真的放红魂', c.cd > a.cd, { cd: +c.cd.toFixed(2), st: c.st });
  await sleep(400);

  // --- 后跃：地面限定，向身后退 ---
  await toFloor();
  await page.keyboard.down('d'); await sleep(200); await page.keyboard.up('d'); await sleep(200);
  a = await snap();
  await page.keyboard.press('i'); await sleep(160);
  c = await snap();
  check('I 真的后跃', c.x - a.x < -20, { dx: Math.round(c.x - a.x), st: c.st });
  await sleep(500);

  // --- 蓝魂：没有魂，按下去必须毫无反应（图例也确实是灰的） ---
  await toFloor();
  a = await snap();
  await page.keyboard.down('l'); await sleep(300);
  c = await snap();
  const blueOff = legend.find(e => e.verb === '蓝魂').off;
  check('空槽时 L 不起作用', Math.abs(c.y - a.y) < 2 && c.st === 'stand', { st: c.st, dy: Math.round(c.y - a.y), blueOff });
  await page.keyboard.up('l'); await sleep(200);

  // --- 魂匣 ---
  await page.keyboard.press('o'); await sleep(320);
  c = await snap();
  check('O 真的开魂匣', c.menu === true);
  await page.keyboard.press('o'); await sleep(320);
  c = await snap();
  check('O 再按能关', c.menu === false);

  // --- 冲刺（原后跃，主键从 I 挪到 F：白哥「F 是冲刺」）---
  await toFloor();
  const f0 = await snap();
  await page.keyboard.press('f'); await sleep(90);
  c = await snap();
  check('F 真的冲刺（进入 dash）', c.st === 'dash', { st: c.st });
  /* 旧键 I 保留为别名：改键不能让已经有肌肉记忆的人按空。 */
  await sleep(400);
  const f1 = await snap();
  await page.keyboard.press('i'); await sleep(90);
  c = await snap();
  check('旧键 I 仍然能冲刺（别名不失效）', c.st === 'dash', { st: c.st });
  await sleep(400);

  // --- 穿板 = 下 + 攻，站在薄板上 ---
  // 回廊第 12 行 x11..14 是 '='，板面 y = 12*48 = 576，头顶 476
  await place(12 * 48 + 20, 476);
  await sleep(420);
  a = await snap();
  const stood = a.onGround;
  await page.keyboard.down('s'); await sleep(100);
  await page.keyboard.press('j'); await sleep(140);
  c = await snap();
  check('站上薄板', stood === true, { onGround: stood, y: Math.round(a.y) });
  check('下+攻 真的穿板', c.dropT > 0, { dropT: +c.dropT.toFixed(3), st: c.st });
  await page.keyboard.up('s');
  await sleep(600);

  // ---------- 3. 完整性：代码里能用的动作，完整表里都得有 ----------
  const actsInLegend = await page.evaluate(() => {
    const set = new Set();
    document.querySelectorAll('#fullkeys .ent').forEach(el => {
      el.getAttribute('data-keys').split('+').forEach(k => set.add(k));
    });
    return [...set];
  });
  // 每个可打印键都必须能在图例里找到，或出现在别名行里
  const alias = await page.evaluate(() => (document.querySelector('#fullkeys .alias') || {}).textContent || '');
  /* 'i' 不在图例里：冲刺的主键改成 F 之后，I 只是兼容别名，不占版面。 */
  const mustCover = ['a', 'd', 'w', 's', 'j', 'u', 'k', 'l', 'o', 'f'];
  const missing = mustCover.filter(k => !actsInLegend.includes(k));
  check('图例覆盖全部主键', missing.length === 0, missing);
  check('别名行写了空格', /空格/.test(alias), alias.slice(0, 40));

  // ---------- 4. HUD 结构（裁定 Q6–Q11）----------
  // 这一节验的是"删掉的真的删了、留下的不会动"，不是审美。
  const hud = await page.evaluate(() => {
    const cs = el => el ? getComputedStyle(el) : null;
    const ink = document.querySelector('#inkrow');
    return {
      hasLog: !!document.querySelector('#log'),
      hasMinimap: !!document.querySelector('#minimap'),
      hasSoulCount: !!document.querySelector('#soulcount'),
      menuCount: (document.querySelector('#menucount') || {}).textContent || '',
      /* 四格 = 2 装备 + 2 魂（白哥 2026-11-24 改的，取代了 Q8 的"只留红蓝"）。
       * 判定从"恰好 2 个"变成"恰好 4 个"：数量本身就是那次改动的验收点 ——
       * 少一格说明装不上整组，多一格说明又混进了不该常驻的东西。 */
      slots: document.querySelectorAll('#slots .slot').length,
      inkH: ink ? Math.round(ink.getBoundingClientRect().height) : -1,
      inkVis: ink ? cs(ink).visibility : 'none',
      roomTop: Math.round(document.querySelector('#roomname').getBoundingClientRect().top),
      /* 不能断言"top 等于 142"：stage 整体有缩放，rect 是视口坐标。
       * 真正的判据是"墨条显隐前后位置不变" —— 下面直接切换再量一次。 */
      roomTopInked: (() => {
        const st = document.getElementById('stage');
        const was = st.classList.contains('ink');
        st.classList.add('ink');
        const t = Math.round(document.querySelector('#roomname').getBoundingClientRect().top);
        if (!was) st.classList.remove('ink');
        return t;
      })(),
      keysSize: parseFloat(cs(document.querySelector('#keys')).fontSize),
    };
  });
  check('日志面板已删（Q6）', hud.hasLog === false);
  check('小地图已删（Q10）', hud.hasMinimap === false);
  check('主界面不再有收集计数（Q9）', hud.hasSoulCount === false);
  check('计数进了魂匣且带单位（Q9）', /已收\s*\d+\s*\/\s*\d+/.test(hud.menuCount), hud.menuCount);
  check('四格装备栏（2 装备 + 2 魂，取代 Q8）', hud.slots === 4, hud.slots);
  /* Q7 的判据不是"墨条看不见"，而是"看不见的时候仍然占着地方" ——
   * display:none 会让左边整块跳一下，visibility:hidden 不会。 */
  /* Q7 原本守的是"墨条隐身但占位"。墨条本身已经删了（侧身的燃料没了），
   * 所以判据换成**它真的不再存在** —— 一个 display:none 的残留节点
   * 和"删干净"在截图上一样，在 DOM 上不一样。 */
  check('墨条已删（Q7 的前提消失）', hud.inkH === -1, { h: hud.inkH, vis: hud.inkVis });
  check('房间名不受 ink 类影响（Q7 的结论仍成立）', hud.roomTop === hud.roomTopInked,
        { off: hud.roomTop, on: hud.roomTopInked });
  /* Q11 当时定的是 12px；WO-003 §1 要求把主界面图例提升到 13–14，
   * 新裁定覆盖旧的。这里断言"不低于 13"，防止以后又被改回看不清的尺寸。 */
  check('图例字号 ≥13px（WO-003 §1，覆盖 Q11）', hud.keysSize >= 13, hud.keysSize);
  /* Q6 的另一半：撤掉常驻面板不等于撤掉旁白 —— 开场那几句必须还在。 */
  const said = await page.evaluate(() => window.__sk.says());
  check('开场旁白仍然送达（Q6）', said.some(t => /这张照片是你拍的/.test(t)), said.slice(0, 3));

  check('无脚本异常', errs.length === 0, errs.slice(0, 2));

  const bad = results.filter(r => !r.ok);
  console.log('\n' + (bad.length ? '控制层有 ' + bad.length + ' 项没过：' + bad.map(r => r.name).join('、')
                               : '控制层全通过（' + results.length + ' 项）'));
  await b.close();
  if (bad.length) process.exitCode = 1;
})().catch(e => { console.error('CRASH', e); process.exit(1); });
