// interact_check.js — 「交互」（E 键 / 手机第三键）验收
//
// 为什么单独一套：这个动作是 WO-004 加第三个圆键时**新写的**，
// 写完之后没有任何测试执行过一次。按项目里那条铁律，
// 「编译通过但从未被跑过」不是完成，是待爆的 bug —— 第一次跑就抓到两条：
//
//   ① 真 bug（已修）：interact() 用固定 USE_REACH=112，无视 it.reach。
//      走路拾取那一支尊重 reach，缝里那个墨囊用 24 就是为了「站着吸不走」，
//      而 E 键 112 会隔着墙把它拿走 —— 侧身机制的教学点当场失效。
//      修法：半径取 min(USE_REACH, it.reach)。伸手不该比走过去踩到还强。
//
//   ② 设计冗余（待白哥裁定）：修完之后，交互半径与走路拾取**完全相等**，
//      因为所有道具都是「贴近式」的（reach 52 / 缝里 24，都 ≤ 112 的上限）。
//      于是「能拿到」的那一刻走路已经自动拿了，E 键永远只能回答
//      「这儿没有可拿的东西」。它不是坏键，是**死键**。
//      下面 F 组把这件事写成可读的观察项，不计入通过数。
//
// 这里测：
//   A. 走路拾取在 reach 内生效；交互不比它更远（越权检查）
//   B. 缝里的东西：站着按 E 拿不到（① 的守卫）
//   C. 缝里的东西：侧身后拿得到
//   D. 远处按 E 不拿，并给出提示
//   E. 拿过的不会再被拿（got 保护）
//   F. 手机那条路（__sk.press('use')）与键盘同源 + 死键观察项
//
// 用法: node interact_check.js
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

/* ---------------- 与 test.js / flat_check.js 相同的假 DOM ---------------- */
function fakeCtx() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: 960, height: 540 };
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (k === 'measureText') return () => ({ width: 10 });
      return typeof k === 'string' ? (() => {}) : undefined;
    },
    set() { return true; },
  });
}
function el(id) {
  return {
    id, textContent: '', innerHTML: '',
    style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; },
             getPropertyValue(k) { return this[k] || ''; } },
    width: 150, height: 120, value: '', className: '', files: [],
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, remove() {}, getContext: () => fakeCtx(),
    addEventListener() {}, click() {}, getAttribute() { return null; },
  };
}

function makeGame() {
  const els = new Map();
  const doc = {
    readyState: 'complete',
    getElementById: id => { if (!els.has(id)) els.set(id, el(id)); return els.get(id); },
    querySelector: s => { if (!els.has(s)) els.set(s, el(s)); return els.get(s); },
    createElement: tag => el(tag),
    addEventListener() {},
  };
  const listeners = {};
  let rafCb = null;
  const store = new Map();
  const sandbox = {
    ATLAS_MAN: null, ATLAS_B64: '',
    document: doc,
    console: { log() {}, warn() {}, error() {} },
    Image: class { set src(v) {} },
    URL: { createObjectURL: () => 'blob:x' },
    requestAnimationFrame: cb => { rafCb = cb; return 1; },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    setTimeout: () => 0,
    Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean,
    Uint8ClampedArray, isNaN, parseFloat, parseInt, isFinite,
    location: { search: '' },
    URLSearchParams: class {
      constructor(q) { this.q = String(q || ''); }
      get(k) { const m = new RegExp('[?&]' + k + '=([^&]*)').exec(this.q); return m ? m[1] : null; }
    },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    performance: { now: () => 0 },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;

  let code = fs.readFileSync(path.join(__dirname, 'src', 'game.js'), 'utf8');
  code += `;globalThis.__peek = () => ({ P, SAVE, room, loadRoom, enemies, projectiles,
                                       pickups, SAY_LOG, SOULS, USE_REACH });
           globalThis.__usp = { interact: () => interact };`;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'game.js' });

  const key = (k, down = true) => {
    const ev = { key: k, preventDefault() {}, ctrlKey: false, repeat: false };
    (listeners[down ? 'keydown' : 'keyup'] || []).forEach(fn => fn(ev));
  };
  let t = 0;
  const tick = ms => { t += ms; rafCb(t); };
  const run = ms => { for (let i = 0; i < Math.round(ms / (1000 / 120)); i++) tick(1000 / 120); };
  return { sandbox, key, tick, run, st: () => sandbox.__sk.state(), sk: sandbox.__sk,
           peek: () => sandbox.__peek(), met: () => null };
}

const fail = [], ok = [], notes = [];
const check = (n, c, d) => (c ? ok : fail).push(n + (d ? ' — ' + d : ''));
const T = 48;
const px = t => t * T;

/* 进房间、清掉敌人（这里测的是拾取，不是战斗；走廊里的蝙蝠会来打断）、等落地稳 */
function enter(roomId) {
  const g = makeGame();
  g.peek().loadRoom(roomId, null, false);
  g.peek().enemies.forEach(e => { e.dead = true; });
  g.run(700);
  return g;
}
/* 按一下 E（点按：按下 → 跑几帧 → 抬起）。
 * padTap 是**边沿**检测，按下去之后必须至少有一帧去消费它；
 * 只 keydown 不 run 的话，按键记在 held 里但这一帧没跑，等于没按。 */
const tapE = g => { g.key('e', true); g.run(40); g.key('e', false); g.run(40); };
const pk = (g, id) => g.peek().pickups.find(p => p.id === id);
const said = g => g.peek().SAY_LOG.slice(-1)[0] || '';
/* 与 interact()/update 第 9 步同一条距离公式，免得测试自己另写一份判据 */
const distTo = (g, it) => {
  const P = g.peek().P;
  return Math.hypot(it.x - (P.x + g.st().cw / 2), (it.y - 26) - (P.y + 50));
};

/* ================= A. 走路拾取 vs 交互：半径不许越权 ================= */
console.log('A. 走路拾取在 reach 内生效；交互不比它更远');
{
  /* 塔里的滑翔魂，默认 reach 52。放到 20px 处 —— 走一步就该到手。 */
  const g = enter('tower');
  const it = pk(g, 'glide');
  check('塔里有滑翔魂这件东西', !!it);
  const P = g.peek().P;
  P.x = it.x - 12; P.y = it.y - 100; P.vy = 0;
  g.run(80);
  check('贴近后走路就把东西捡了（不用按键）', it.got === true, 'got=' + it.got);
  check('魂进了背包', g.peek().SAVE.owned.has('glide'), [...g.peek().SAVE.owned].join(','));
  check('给出获得提示', /获得魂/.test(g.peek().SAY_LOG.join('|')), said(g));
}
{
  /* 关键的一条：站在 **52 之外、112 之内** 按 E，不该拿到东西。
   * 修 bug 之前这里会拿走（112），修完之后拿不到（min 生效）。
   * 这不是"越远越好"—— 伸手不该比走过去踩到还强，否则玩家会站在门口按 E。 */
  const g = enter('tower');
  const it = pk(g, 'glide');
  const P = g.peek().P;
  /* 垂直方向拉开距离（塔里水平方向有墙），拉到 ~70px：>52、<112 */
  P.x = it.x - 12; P.y = it.y - 100 - 70; P.vy = 0;
  g.run(40);
  const d0 = distTo(g, it);
  check('构造出的距离落在 52~112 之间', d0 > 52 && d0 < 112, 'd=' + d0.toFixed(1));
  check('还没被走路捡走', it.got === false, 'got=' + it.got);
  tapE(g);
  check('交互不突破物品 reach（不该拿到）', it.got === false, 'got=' + it.got);
  check('并如实说没有可拿的', /没有可拿/.test(said(g)), said(g));
}

/* ================= B. reach 小的东西：站着拿不到 ================= */
/* 这一段原来是"纸缝里的墨囊"。纸缝和墨囊都随侧身删了（2026-11-25），
 * 但**它守的那条规则还在**：interact 的距离是 min(USE_REACH, it.reach)，
 * 不是固定的 112。于是改成在塔里塞一件 reach:24 的合成物品 ——
 * 规则一样被测到，且不再依赖任何一间特定房间。 */
console.log('B. reach 24 的东西：站在 30px 外拿不到');
{
  const g = enter('tower');
  const P = g.peek().P;
  P.x = px(5); P.y = px(28) - 100; P.vy = 0; g.run(700);   // 先落地站稳再摆物品
  const it = { x: P.x + g.st().cw / 2 + 30, y: P.y + 76,
               soul:'axe', id:'synth24', t:0, got:false, reach:24, slim:true };
  g.peek().pickups.push(it);
  const d = distTo(g, it);
  check('构造出的距离在 24~52 之间', d > 24 && d < 52, 'd=' + d.toFixed(1));
  g.run(200);
  check('走路没吸走它（reach 24 生效）', it.got === false, 'got=' + it.got);
  tapE(g);
  check('按 E 也拿不到（min(112,reach) 生效）', it.got === false, 'got=' + it.got);
  check('并如实说没有可拿的', /没有可拿/.test(said(g)), said(g));
}

/* ================= C. 走到 reach 之内就拿得到 ================= */
console.log('C. reach 24 的东西：进到 24 内就拿到');
{
  const g = enter('tower');
  const P = g.peek().P;
  P.x = px(5); P.y = px(28) - 100; P.vy = 0; g.run(700);   // 先落地站稳再摆物品
  const it = { x: P.x + g.st().cw / 2 + 30, y: P.y + 76,
               soul:'axe', id:'synth24b', t:0, got:false, reach:24, slim:true };
  g.peek().pickups.push(it);
  /* 直接摆到 14px 处（x 和 y 一起摆），再跑几帧让拾取逻辑看见它。
   * 只摆 x 不摆 y 的话，人站在地上、物品悬在空中，distTo 里的 dy 会把
   * "水平 14px"变成"斜距 49px" —— 量到的就不是想测的那个距离。 */
  P.x = it.x - g.st().cw / 2 - 14; P.y = it.y - 76; P.vy = 0; g.run(120);
  const d = distTo(g, it);
  check('进到 24 之内', d <= 24, 'd=' + d.toFixed(1));
  check('这时走路就捡起来了', it.got === true, 'got=' + it.got);
}

/* ================= D. 远处按 E 不拿，且有提示 ================= */
console.log('D. 远处按 E：不拿，给提示');
{
  const g = enter('tower');
  const near = g.peek().pickups.filter(it => !it.got && distTo(g, it) <= g.peek().USE_REACH);
  check('出生点附近确实没有可拿的东西', near.length === 0, near.map(n => n.id).join(','));
  tapE(g);
  check('远处按 E 一件都没拿走', g.peek().pickups.some(it => it.got) === false);
  check('提示「这儿没有可拿的东西」', /没有可拿/.test(said(g)), said(g));
}

/* ================= E. 拿过的不会再被拿 ================= */
console.log('E. 拿过的不会再被拿（got 保护）');
{
  const g = enter('tower');
  const it = pk(g, 'glide');
  const P = g.peek().P;
  P.x = it.x - 12; P.y = it.y - 100; P.vy = 0;
  g.run(80);
  check('第一次拿到', it.got === true);
  const owned = g.peek().SAVE.owned.size;
  const flags = g.peek().SAVE.flags.size;
  const logN = g.peek().SAY_LOG.length;
  tapE(g);
  check('再按一次不会重复计入', g.peek().SAVE.owned.size === owned && g.peek().SAVE.flags.size === flags,
        g.peek().SAVE.owned.size + '/' + flags);
  check('第二次不再刷「获得魂」', !/获得魂/.test(g.peek().SAY_LOG.slice(logN).join('|')),
        g.peek().SAY_LOG.slice(logN).join('|'));
}

/* ================= F. 手机那条路 + 死键观察 ================= */
console.log('F. 手机第三键（press("use")）走同一个动作层');
{
  const g = enter('tower');
  const logN = g.peek().SAY_LOG.length;
  /* 出生点没有可拿的东西 —— 按下去必须**走到 interact()**，
   * 证据就是那句提示。走不到的话 SAY_LOG 不会有新条目。 */
  g.sk.press('use'); g.run(40); g.sk.release('use'); g.run(40);
  const newLines = g.peek().SAY_LOG.slice(logN);
  check('press("use") 真的走到了交互逻辑', newLines.length > 0, JSON.stringify(newLines));
  check('确认走的是同一句话', /没有可拿/.test(newLines.join('|')), newLines.join('|'));
}
{
  /* 死键观察（不计入通过数）：交互半径与走路拾取完全相等。
   * 只要道具都是"贴近式"的（reach ≤ 112），玩家能按 E 的那一刻，
   * update 第 9 步已经先把它捡走了 —— E 键拿不到任何东西，
   * 只能回答"这儿没有"。这不是坏键，是**没有职能**。
   * 死细手机版第三键是门/拉杆/对话，我们没有门，所以它退化成了捡东西。
   * 要么给它一个新职能（读画/开箱），要么换成别的键 —— 等白哥裁定。 */
  const reachOfDefault = 52;         // 房间数据里的默认值
  const same = Math.min(112, reachOfDefault) === reachOfDefault;
  notes.push('交互半径 = min(112, reach)。默认 reach=52，走路拾取也是 52 —— 两径相同，' +
             '交互键目前在实机上拿不到任何东西（死键），待裁定新职能。' +
             (same ? '' : '（数值与预期不符，需复查）'));
}

/* ---------------- 汇总 ---------------- */
console.log('');
fail.forEach(f => console.log('FAIL ' + f));
notes.forEach(n => console.log('NOTE ' + n));
console.log(fail.length === 0
  ? `交互验收全通过（${ok.length} 项）`
  : `交互验收：${ok.length} 通过 / ${fail.length} 失败`);
process.exit(fail.length ? 1 : 0);
