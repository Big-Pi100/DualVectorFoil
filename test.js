// test.js — 无头冒烟测试：没有浏览器也能跑一遍游戏逻辑，抓 undefined / NaN / 卡住
// 用法: node test.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');

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
    id, textContent: '', innerHTML: '', style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; },
             getPropertyValue(k) { return this[k] || ''; } }, width: 150, height: 120, value: '', className: '',
    files: [],
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, remove() {},
    getContext: () => fakeCtx(),
    addEventListener() {}, click() {},
  };
}
const els = new Map();
const doc = {
  readyState: 'complete',
  getElementById: id => { if (!els.has(id)) els.set(id, el(id)); return els.get(id); },
  querySelector: s => { if (!els.has(s)) els.set(s, el(s)); return els.get(s); },
  createElement: tag => el(tag),
  addEventListener() {},
};

let rafCb = null;
const listeners = {};
const win = { ATLAS_MAN: null, ATLAS_B64: '' };

const sandbox = {
  window: win,
  document: doc,
  console,
  Image: class { set src(v) {} },
  URL: { createObjectURL: () => 'blob:x' },
  requestAnimationFrame: cb => { rafCb = cb; return 1; },
  addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
  setTimeout: () => 0,
  Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean,
  Uint8ClampedArray, isNaN, parseFloat, parseInt, isFinite,
  location: { search: '' }, URLSearchParams: class { constructor(){} get(){ return null; } },
};
sandbox.globalThis = sandbox;

let code = fs.readFileSync(path.join(__dirname, 'src', 'game.js'), 'utf8');
code += `
;globalThis.__peek = () => ({ P, SAVE, room, enemies, pickups, projectiles, ended, menuOpen,
  loadRoom, damageEnemy, startAttack, setFeel, getFeel: () => FEEL_NAME });`;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'game.js' });

const peek = sandbox.__peek;
let t = 0;
const step = (n = 1, ms = 16.7) => { for (let i = 0; i < n; i++) { t += ms; rafCb(t); } };

function key(k, down = true) {
  const type = down ? 'keydown' : 'keyup';
  const ev = { key: k, preventDefault() {}, ctrlKey: false };
  (listeners[type] || []).forEach(fn => fn(ev));
}
const press = k => { key(k, true); step(1); key(k, false); };

const fail = [], ok = [];
const check = (n, c, d) => (c ? ok : fail).push(n + (d ? ' — ' + d : ''));

// ---- 初始状态 ----
let s = peek();
check('初始房间', s.room.id === 'hall', s.room.id);
check('起始站在地上', Math.abs(s.P.y + 100 - 720) < 2, 'feet=' + (s.P.y + 100));
check('起始 HP 满、装备无冷却', s.P.hp === 120 && s.P.cdRed === 0 && s.P.cdBlue === 0);
check('起始只有火球', s.SAVE.owned.size === 1 && s.SAVE.owned.has('fire'));
check('起始 3 只史莱姆', s.enemies.length === 3, 'n=' + s.enemies.length);
check('起始没装备银魂', !s.SAVE.owned.has('djump'));

const x0 = s.P.x;
step(60);
s = peek();
check('静止 1s 不漂移', Math.abs(s.P.x - x0) < 0.5, 'dx=' + (s.P.x - x0).toFixed(2));
check('静止时贴地', s.P.onGround === true);
check('站立状态（源码 step 名是 stand，不是 idle）', s.P.state === 'stand', s.P.state);

// ---- 键盘走路 ----
s.P.x = 700; s.P.y = 620; step(2);
key('d', true);
const xa = peek().P.x;
step(20);
key('d', false);
s = peek();
check('按 D 向右移动', s.P.x > xa + 50, 'dx=' + (s.P.x - xa).toFixed(0));
check('朝向右', s.P.face === 1);
check('walk 状态', s.P.state === 'walk' || s.P.state === 'stand', s.P.state);
check('长廊挂了展品', Array.isArray(s.room.portraits) && s.room.portraits.length >= 4,
  'n=' + (s.room.portraits || []).length);
check('走过展品触发"没有背面"', s.SAVE.flags.has('seen_noback'));
step(10);
key('a', true); step(20); key('a', false);
s = peek();
check('按 A 向左 + 转身', s.P.face === -1);

// ---- 单跳高度（能力门判据：以"按住不放的满跳"为准） ----
// 站到空地再跳，避免头顶平台压低高度
function jumpFrom(holdFrames, extra) {
  s = peek();
  s.P.x = 384; s.P.y = 620; s.P.vx = 0; s.P.vy = 0; s.P.onGround = true;
  s.P.coyote = 0; s.P.jumpBuf = 0; s.P.cutOK = false;
  step(2);
  const y = peek().P.y;
  key(' ', true);
  let mn = 1e9;
  for (let i = 0; i < holdFrames; i++) { step(1); mn = Math.min(mn, peek().P.y); }
  key(' ', false);
  for (let i = 0; i < (extra || 50); i++) { step(1); mn = Math.min(mn, peek().P.y); }
  return y - mn;
}

const jumpH = jumpFrom(40);
/* 按月下反编译的真实比例：跳高 67.6px(SotN) × 3 = 203px = 4.22 格。
 * 上一版 161px 是照"1.6 倍身高"倒推的，比原版矮了 21%。 */
check('满跳高度 195~215px（真实比例 4.22 格）', jumpH > 195 && jumpH < 215, jumpH.toFixed(0) + 'px');
check('满跳上不去 288px 能力门', jumpH < 288);
step(40);
check('跳完落地', peek().P.onGround === true);

// 轻点 = 小跳（可变跳跃高度）。这不是 bug，是手感来源。
const tapH = jumpFrom(1);
check('轻点跳明显更矮（< 满跳 55%）', tapH < jumpH * 0.55, tapH.toFixed(0) + ' / ' + jumpH.toFixed(0) + 'px');

/* 土狼时间和跳跃缓冲是 modern 特有的宽容设计，恶魔城（默认 aos）一个都没有。
 * 所以这两条要显式切到 modern 再测 —— 否则改了默认手感就会误报成"功能坏了"。 */
s = peek();
s.setFeel('modern');
s.loadRoom('hall', null, false);
step(2);
s = peek();
s.P.x = 250; s.P.y = 332; s.P.vx = 0; s.P.vy = 0; s.P.onGround = true;
step(2);
key('d', true);
let off = -1;
for (let i = 0; i < 40; i++) { step(1); if (!peek().P.onGround) { off = i; break; } }
key('d', false);
key(' ', true); step(1); key(' ', false);
check('土狼时间：离开边缘后按跳仍能起跳', off >= 0 && peek().P.vy < -400, 'vy=' + peek().P.vy.toFixed(0));

// 跳跃缓冲：落地前一刻按跳，落地自动接上
s = peek();
s.P.x = 384; s.P.y = 600; s.P.vx = 0; s.P.vy = 180; s.P.onGround = false;
s.P.coyote = 0; s.P.jumpBuf = 0;
step(1);
key(' ', true); step(1); key(' ', false);
let buffered = false;
for (let i = 0; i < 12; i++) { step(1); if (peek().P.vy < -300) { buffered = true; break; } }
check('跳跃缓冲：落地前按跳会自动起跳', buffered);

// 切回默认（恶魔城），后半段都按它测
s = peek(); s.setFeel('aos'); s.loadRoom('hall', null, false); step(2);
check('默认手感是恶魔城（aos）', peek().getFeel() === 'aos', peek().getFeel());

// aos 下走出平台边缘就跳不了了（没有土狼时间）—— 这不是缺陷，是恶魔城的手感
s = peek();
s.P.x = 250; s.P.y = 428; s.P.vx = 0; s.P.vy = 0; s.P.onGround = true; s.P.coyote = 0;
step(2);
key('d', true);
for (let i = 0; i < 40; i++) { step(1); if (!peek().P.onGround) break; }
key('d', false);
key(' ', true); step(1); key(' ', false);
check('恶魔城没有土狼时间：离地后按跳无效', peek().P.vy > -100, 'vy=' + peek().P.vy.toFixed(0));

// ---- 二段跳（拿到银魂后） ----
s.SAVE.owned.add('djump');
s.P.x = 384; s.P.y = 620; s.P.vy = 0; s.P.onGround = true; s.P.coyote = 0; s.P.jumpBuf = 0;
step(2);
const y1 = peek().P.y;
key(' ', true);
let minY2 = 1e9;
for (let i = 0; i < 20; i++) { step(1); minY2 = Math.min(minY2, peek().P.y); }
key(' ', false); step(1);
key(' ', true); step(1);
for (let i = 0; i < 40; i++) { step(1); minY2 = Math.min(minY2, peek().P.y); }
key(' ', false);
const djH = y1 - minY2;
check('二段跳 > 200px（能上高台）', djH > 200, djH.toFixed(0) + 'px');

// ---- 战斗 ----
s = peek();
const e0 = s.enemies.find(e => !e.dead);
const hp0 = e0.hp;
s.damageEnemy(e0, 20);
check('掉血', e0.hp === hp0 - 20, e0.hp + '/' + hp0);
s.damageEnemy(e0, 999);
check('可击杀', e0.dead === true);
check('击杀标记持久化', peek().SAVE.flags.has('dead_' + peek().room.id + '_' + e0.idx));

// 红魂（攻击锁里不能施法，先等这一刀挥完 —— 这是原版行为，不是 bug）
step(25);
s = peek();
s.P.mp = 60;
key('u', true); step(1); key('u', false);     // 红魂的独立键（原版是 上+B）
s = peek();
check('红魂进入冷却', s.P.cdRed > 0, 'cd=' + s.P.cdRed.toFixed(2));


check('产生投射物', s.projectiles.length === 1, 'n=' + s.projectiles.length);

/* ---- 红魂的第二种触发：↑ + J ----
 * 原版 AoS 里红魂**没有独立键**，是"上 + B"。我们两套都留着：
 * 独立键 U 是给不想用组合的人，↑+J 是原版语义。
 * 只测独立键不够 —— 组合分支是单独一段代码，不测就等于没写。 */
step(30);
s = peek(); s.P.cdRed = 0; s.P.x = 500; s.P.state = 'stand'; s.P.lock = 0;
while (s.projectiles.length) s.projectiles.pop();
key('w', true); step(2); key('j', true); step(1); key('j', false); key('w', false);
check('↑+J 放红魂（原版组合）', peek().projectiles.length === 1 && peek().P.cdRed > 0,
  'n=' + peek().projectiles.length + ' cd=' + peek().P.cdRed.toFixed(2));
while (peek().projectiles.length) peek().projectiles.pop();
step(40);

/* ---- 后跃（I / 原版 L 键） ---- */
s = peek(); s.P.x = 620; s.P.y = 620; s.P.vx = 0; s.P.vy = 0;
s.P.face = 1; s.P.onGround = true; s.P.lock = 0; s.P.state = 'stand'; s.P.invuln = 0;
step(2);
const dashX0 = peek().P.x;
key('i', true); step(1); key('i', false);
step(1);
check('后跃进入 dash 状态', peek().P.state === 'dash', peek().P.state);
check('后跃带无敌帧', peek().P.invuln > 0.05, 'inv=' + peek().P.invuln.toFixed(3));
step(11);
check('后跃朝背后弹开 >60px', peek().P.x < dashX0 - 60, 'dx=' + (peek().P.x - dashX0).toFixed(0));
step(6);
check('后跃结束回到可操作状态', peek().P.lock <= 0 && peek().P.state !== 'dash', peek().P.state);

/* ---- 站立时攻击 = 普攻，不能误放魔法 ---- */
step(30);
s = peek(); s.P.mp = 60; s.P.state = 'stand'; s.P.lock = 0; s.P.x = 500;
while (s.projectiles.length) s.projectiles.pop();
key('j', true); step(1); key('j', false);
check('裸 J 是普攻不是魔法', peek().projectiles.length === 0 && peek().P.state === 'attack',
  peek().P.state);
step(30);

/* ---- 下 + 攻击 = 从单向平台掉下去（AoS: "Down + B 穿过薄地板"） ----
 * 这条以前根本没有：单向平台只能从边缘走下去，玩家站在板中间想下去，
 * 唯一的办法是走到底 —— 而有些板两边都是墙。 */
s = peek();
let pw = null;
for (let ty = 0; ty < s.room.g.length && !pw; ty++) {
  for (let tx = 0; tx < s.room.w; tx++) if (s.room.g[ty][tx] === '=') { pw = { tx, ty }; break; }
}
check('关卡里有单向平台', !!pw, JSON.stringify(pw));
if (pw) {
  s.P.x = pw.tx * 48 + 10; s.P.y = pw.ty * 48 - 100;
  s.P.vx = 0; s.P.vy = 0; s.P.lock = 0; s.P.state = 'stand'; s.P.dropT = 0;
  step(3);
  const standY = peek().P.y;
  check('先站在单向平台顶面', peek().P.onGround === true, 'y=' + standY.toFixed(0));
  key('s', true); step(2);
  key('j', true); step(1); key('j', false);
  step(6);
  check('下+攻击 从薄板掉下去', peek().P.y > standY + 20, 'dy=' + (peek().P.y - standY).toFixed(0));
  key('s', false);
  step(40);
}
step(90);
check('投射物会消失', peek().projectiles.length === 0);

// ---- 碰撞 / 房间 ----
s.P.x = 120; s.P.y = 620; step(2);
key('a', true); step(70); key('a', false);
check('一直向左被墙挡住（撞边界墙）', peek().P.x >= 46 && peek().P.x < 52, 'x=' + peek().P.x.toFixed(1));

s.loadRoom('tower', null, false);
s = peek();
check('塔加载 5 个敌人', s.enemies.length === 5, 'n=' + s.enemies.length);
check('塔里有 Boss', s.enemies.some(e => e.def.type === 'boss'));
step(240);
s = peek();
check('塔里跑 4s 不崩 / 无 NaN', isFinite(s.P.x) && isFinite(s.P.y));
check('塔里落地', s.P.onGround === true, 'y=' + s.P.y.toFixed(0));

// 一路向上打：把 Boss 打死，检查掉魂
s = peek();
const boss = s.enemies.find(e => e.def.type === 'boss');
s.damageEnemy(boss, 9999);
check('Boss 掉落双跃之魂', peek().SAVE.owned.has('djump'));

// ---- 隐藏墙 ----
s.loadRoom('hall', null, false);
s = peek();
s.SAVE.equipped.yellow = null;
s.P.x = 26 * 48 - 40; s.P.y = 620; s.P.face = 1;
s.P.hitSet = new Set(); s.startAttack();
step(8);
check('没装备识破时砍不碎墙',
  peek().room.g[13][26] === 'H', peek().room.g[13][26]);
s.SAVE.equipped.yellow = 'sight';
s.P.atkCd = 0; s.P.hitSet = new Set(); s.startAttack();
step(8);
check('装了识破能砍碎墙', peek().room.g[13][26] === '.', peek().room.g[13][26]);

// ---- 关卡可达性 ----
/* 这一组防的是"路看着在、其实走不通"。
 * 之前真实出过两个：中间平台写在 y=11（离地 192px）注释却写 144px，满跳 161 上不去；
 * 门洞只开 2 格高，人头顶那一格还是墙 —— 门就在眼前，人进不去。
 * 静态断言比模拟跳跃稳：它直接问"这一格的几何对不对"，不会因为调手感参数而误报。 */
s = peek(); s.loadRoom('hall', null, false);
step(2);
let G = peek().room.g;
check('中间平台离地 144px（满跳 161 够得上）', G[12][13] === '=' && G[11][13] === '.');
check('第二级平台同样在格 12', G[12][21] === '=' && G[11][21] === '.');
check('左高台 288px（故意留给双跃）', G[9][3] === '=' && G[10][3] === '.');
check('回廊右门洞 3 格高', G[12][31] === '.' && G[13][31] === '.' && G[14][31] === '.');

// 地面横向穿过平台下方 —— 单向平台的核心作用
s.P.x = 300; s.P.y = 620; s.P.vx = 0; s.P.vy = 0; s.P.onGround = true;
key('d', true); step(120); key('d', false); step(2);
check('地面能穿过平台下方（不被侧面挡住）', peek().P.x > 800, peek().P.x.toFixed(0) + 'px');

/* 能力门不能只验高度，要验"真的站得上去"。
 * 跳高改成 203px 之后左高台抬到 288px，这条用真实按键序列走一遍：
 * 单跳够不到 → 拿到二段跳（Boss 掉落）→ 落到 432 顶面。 */
s = peek(); s.loadRoom('hall', null, false);
s.SAVE.owned.delete('djump');          // 前面的测试加过，这里必须先摘掉
step(2);
s.P.x = 150; s.P.y = 620; s.P.vx = 0; s.P.vy = 0; s.P.onGround = true;
step(2);
key(' ', true); step(18); key(' ', false); step(4);
key(' ', true); step(18); key(' ', false);
for (let i = 0; i < 90; i++) step(1);
check('没二段跳时上不去 288px 能力门', Math.abs(peek().P.y + 100 - 720) < 4, '脚=' + (peek().P.y + 100).toFixed(0));

s = peek(); s.loadRoom('hall', null, false);
s.SAVE.owned.add('djump');
step(2);
s.P.x = 150; s.P.y = 620; s.P.vx = 0; s.P.vy = 0; s.P.onGround = true;
step(2);
key(' ', true); step(18); key(' ', false); step(4);
key(' ', true); step(18); key(' ', false);
for (let i = 0; i < 90; i++) step(1);
check('拿到二段跳后能站上 288px 能力门', Math.abs(peek().P.y + 100 - 432) < 6, '脚=' + (peek().P.y + 100).toFixed(0));
s.SAVE.owned.delete('djump');

s.loadRoom('tower', null, false);
step(2);
G = peek().room.g;
check('钟塔左门洞 3 格高', G[31][0] === '.' && G[32][0] === '.' && G[33][0] === '.');

/* 主循环回归：照 RicMain 的结构守三条，防止以后又退回"按键没反应" */
s = peek(); s.loadRoom('hall', null, false); step(2);
check('站立状态名是 stand（源码 step 名）', peek().P.state === 'stand', peek().P.state);
check('↑ 不产生跳跃（原版是 press_up 抬头）',
  (() => { const y0 = peek().P.y; key('arrowup', true); step(6); key('arrowup', false); return Math.abs(peek().P.y - y0) < 1; })(),
  'y=' + peek().P.y.toFixed(0));

/* 攻击锁：出招期间跳不了、转不了、也施不了法 */
s = peek(); s.loadRoom('hall', null, false); step(2);
s.P.x = 500; s.P.y = 620; s.P.onGround = true; s.P.atkCd = 0; s.P.lock = 0;
s.startAttack(); step(1);
check('出招带攻击锁', peek().P.lock > 0.1, 'lock=' + peek().P.lock.toFixed(2));
const vyBefore = peek().P.vy;
key(' ', true); step(3); key(' ', false);
check('攻击锁里跳不起来', Math.abs(peek().P.vy - vyBefore) < 1, 'vy=' + peek().P.vy.toFixed(0));
step(30);

/* 攻击判定框必须够得着站在地上的敌人（这一条曾经是"按 J 打不到任何东西"） */
s = peek(); s.loadRoom('hall', null, false); step(2);
const foe = peek().enemies.find(e => !e.dead && e.def.type === 'slime');
s.P.x = foe.x - 58; s.P.y = foe.y + foe.h - 100; s.P.onGround = true; s.P.face = 1;
s.P.atkCd = 0; s.P.lock = 0; s.P.state = 'stand';
const foeHp = foe.hp;
s.P.hitSet = new Set(); s.startAttack();
step(12);
check('普攻够得着地面上的敌人', foe.hp < foeHp, foe.hp + '/' + foeHp);
step(30);

console.log('\n通过 ' + ok.length + ' 项');
ok.forEach(x => console.log('  ✓ ' + x));
if (fail.length) {
  console.log('\n失败 ' + fail.length + ' 项');
  fail.forEach(x => console.log('  ✗ ' + x));
  process.exit(1);
}
console.log('\n冒烟测试全通过');
