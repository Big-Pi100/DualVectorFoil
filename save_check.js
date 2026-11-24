// save_check.js — 存档（S2）验收：写得进去、读得回来、坏档不许进游戏
//
// 为什么必须有这个脚本：
//   存档是**外部输入**。玩家换浏览器、旧版本标签页还开着、存储被手动改过，
//   任何一种都会让磁盘上那份 JSON 和当前代码对不上。
//   "能存能读"只要写对一次，"坏档不炸"要每一种坏法都试 —— 所以这里逐条构造。
//
// 用法: node save_check.js [--json]
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SAVE_KEY = 'dvf.save';   // 必须与 game.js 的 SAVE_KEY 一致

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

/* store: Map（内存 localStorage）；传 null 表示"这台设备没有 localStorage" */
function memStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _m: m,
  };
}

function bootGame(store) {
  const els = new Map();
  const doc = {
    readyState: 'complete',
    hidden: false,
    getElementById: id => { if (!els.has(id)) els.set(id, el(id)); return els.get(id); },
    querySelector: s => { if (!els.has(s)) els.set(s, el(s)); return els.get(s); },
    createElement: tag => el(tag),
    addEventListener() {},
  };
  const listeners = {};
  let rafCb = null;
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
    URLSearchParams: class { constructor() {} get() { return null; } },
    performance: { now: () => 0 },
  };
  if (store) sandbox.localStorage = store;
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;

  let code = fs.readFileSync(path.join(__dirname, 'src', 'game.js'), 'utf8');
  code += `;globalThis.__peek = () => ({ P, SAVE, room, loadRoom, damageEnemy, enemies,
    pickups, toggleMenu, saveGame, loadGame, SAVE_VER });`;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'game.js' });

  let t = 0;
  const tick = (n = 1, ms = 16.7) => { for (let i = 0; i < n; i++) { t += ms; rafCb(t); } };
  const key = (k, down = true) => {
    const ev = { key: k, preventDefault() {}, ctrlKey: false, repeat: false };
    (listeners[down ? 'keydown' : 'keyup'] || []).forEach(fn => fn(ev));
  };
  return { sandbox, __peek: sandbox.__peek, sk: sandbox.__sk, tick, key };
}

const fail = [], ok = [];
const check = (n, c, d) => (c ? ok : fail).push(n + (d ? ' — ' + d : ''));

const J = o => JSON.stringify(o);

/* ---------------- 1. round-trip ---------------- */
{
  const store = memStore();
  const A = bootGame(store);
  check('冷启动就有存档可用（localStorage 可用）', A.sk.storeOK());

  A.tick(20);
  const before = A.sk.progress();
  /* 真的走一遍会写档的事件：进房间 + 打死一个敌人 */
  A.__peek().loadRoom('tower', null, false);
  A.tick(5);
  const afterRoom = A.sk.progress();
  check('进房间会落盘', J(afterRoom) !== J(before) && afterRoom.room === 'tower',
        'room=' + afterRoom.room + ' reason=' + afterRoom.lastSave);

  const raw1 = A.sk.store();
  check('磁盘上有 dvf.save', typeof raw1 === 'string' && raw1.length > 20);
  let parsed = null;
  try { parsed = JSON.parse(raw1); } catch (e) {}
  check('落盘内容是合法 JSON 且有版本号', !!parsed && parsed.v === A.__peek().SAVE_VER,
        parsed ? 'v=' + parsed.v : 'parse fail');

  const en = A.__peek().enemies;
  check('钟塔里有敌人可打', en.length > 0, 'n=' + en.length);
  A.__peek().damageEnemy(A.__peek().enemies[0], 9999);
  A.tick(2);
  const afterKill = A.sk.progress();
  check('击杀写进了 flags', afterKill.flags.some(f => /^dead_/.test(f)),
        afterKill.flags.join(','));
  check('击杀后磁盘里也有这个 flag',
        (JSON.parse(A.sk.store()).flags || []).some(f => /^dead_/.test(f)));

  /* 血量与装备：手改内存再落盘，看 B 能不能原样读回来 */
  A.__peek().P.hp = 77;
  A.__peek().SAVE.equipped.blue = A.__peek().SAVE.owned.has('glide') ? 'glide' : A.__peek().SAVE.equipped.blue;
  A.sk.save();
  const rawFinal = A.sk.store();

  const B = bootGame(store);
  B.tick(1);
  const rb = B.sk.progress();
  const ra = A.sk.progress();
  check('第二次启动读回了房间', rb.room === ra.room, rb.room);
  check('第二次启动读回了血量', rb.hp === 77, String(rb.hp));
  check('第二次启动读回了 owned', J(rb.owned) === J(ra.owned), J(rb.owned));
  check('第二次启动读回了 flags', J(rb.flags) === J(ra.flags),
        'A=' + ra.flags.length + ' B=' + rb.flags.length);
  check('第二次启动读回了装备', J(rb.equipped) === J(ra.equipped), J(rb.equipped));

  /* 读回来的档再存一次，必须逐字节稳定（不能因为读一遍就变形） */
  const p1 = JSON.parse(rawFinal), p2 = JSON.parse(B.sk.store());
  delete p1.at; delete p2.at;
  check('读档→再存 不变形（at 除外）', J(p1) === J(p2),
        J(p1) === J(p2) ? '' : 'A=' + J(p1) + ' B=' + J(p2));
}

/* ---------------- 2. 版本拒绝 ---------------- */
function withRaw(rawObj) {
  const store = memStore();
  store.setItem(SAVE_KEY, typeof rawObj === 'string' ? rawObj : JSON.stringify(rawObj));
  return bootGame(store);
}
function isFresh(g) {
  const p = g.sk.progress();
  return p.owned.length === 1 && p.owned[0] === 'fire' && p.flags.length === 0 &&
         p.hp === 120 && p.cdRed === 0 && p.room === 'hall';
}

{
  const g = withRaw({ v: 999, room:'tower', owned:['fire','djump'], flags:['dead_hall_0'],
                      equipped:{ red:'fire' }, hp:5, luck:12 });
  check('版本号不符 → 整份作废、按新游戏开局', isFresh(g),
        'owned=' + g.sk.progress().owned.join(',') + ' room=' + g.sk.progress().room);
}
{
  const g = withRaw({ v: 1, room:'tower', owned:['fire','djump'], equipped:{ red:'fire' },
                      flags:['dead_hall_0'], hp:5 });
  check('版本号相符 → 正常读取（对照组）', !isFresh(g), 'owned=' + g.sk.progress().owned.join(','));
}
{
  const g = withRaw('{"v":1,"room":');   // 半截 JSON
  check('JSON 截断 → 当没有存档', isFresh(g));
}
{
  const g = withRaw('[1,2,3]');
  check('顶层是数组 → 当没有存档', isFresh(g));
}
{
  const g = withRaw({ v:1, room:'tower', owned:'fire', equipped:{}, flags:[], hp:1 });
  check('owned 不是数组 → 当没有存档', isFresh(g));
}
{
  const g = withRaw({ v:1, room:'nowhere', owned:['fire','bogus_soul'], flags:[],
                      equipped:{ red:'bogus_soul', blue:'nope' }, hp:1e9, luck:'x' });
  const p = g.sk.progress();
  check('不存在的魂 id 被丢弃', p.owned.length === 1 && p.owned[0] === 'fire', J(p.owned));
  check('指向不存在魂的装备被清空/回退', p.equipped.blue === null && p.equipped.red === 'fire', J(p.equipped));
  check('不存在的房间回落到 hall', p.room === 'hall', p.room);
  check('血量被钳进合法区间', p.hp > 0 && p.hp <= 120, String(p.hp));
  /* 蓝条删了，就没有"魔力钳制"这条了；换成同一组脏数据下的冷却读数必须干净。 */
  check('冷却读数干净（没有蓝条残留）', p.cdRed === 0 && p.cdBlue === 0, p.cdRed + '/' + p.cdBlue);
  check('luck 是字符串 → 回落默认 12', p.luck === 12, String(p.luck));
}

/* ---------------- 3. 存不了也必须能玩 ---------------- */
{
  const g = bootGame(null);           // 没有 localStorage（无痕 / file:// / 被策略拦）
  check('没有 localStorage：不抛错、照常开局', g.sk.progress().room === 'hall');
  check('没有 localStorage：storeOK() 为 false', g.sk.storeOK() === false);
  check('没有 localStorage：save() 返回 false 而不是炸', g.sk.save() === false);
  g.tick(10);
  check('没有 localStorage：跑 10 帧仍然活着', !g.sk.state().dead);
}
{
  /* 配额满 / 隐私模式：setItem 直接抛 */
  const bad = memStore();
  bad.setItem = () => { throw new Error('QuotaExceededError'); };
  const g = bootGame(bad);
  check('setItem 抛异常：启动不炸', g.sk.progress().room === 'hall');
  g.tick(10);
  check('setItem 抛异常：跑 10 帧仍然活着', !g.sk.state().dead);
}

/* ---------------- 4. 存档点语义 ---------------- */
{
  const store = memStore();
  const g = bootGame(store);
  g.tick(10);
  g.__peek().loadRoom('hall', null, false);
  g.tick(2);
  const p = JSON.parse(g.sk.store());
  check('存档里带房间与时间戳', typeof p.room === 'string' && typeof p.at === 'number',
        p.room + ' @' + p.at);
  /* 死亡重生 = 回本房间左边，进度不丢。这是"能不能重试 Boss"的全部意义。 */
  g.__peek().loadRoom('tower', null, false);
  g.tick(2);
  const beforeDeath = g.sk.progress();
  g.__peek().P.hp = 1;
  g.__peek().P.dead = true;
  g.__peek().P.deadT = 9;      // 让 updatePlayer 立刻走重生分支
  g.tick(4);
  const afterDeath = g.sk.progress();
  check('死亡重生不回大厅', afterDeath.room === 'tower', afterDeath.room);
  check('死亡重生回满血', afterDeath.hp === 120, 'hp=' + afterDeath.hp);
  check('死亡重生不丢进度', J(afterDeath.flags) === J(beforeDeath.flags) &&
        J(afterDeath.owned) === J(beforeDeath.owned));
  check('死亡重生后立刻落盘（重开也能接着打）',
        JSON.parse(g.sk.store()).room === 'tower');
}

/* ---------------- 输出 ---------------- */
console.log('存档验收（S2）\n');
for (const s of ok) console.log('  ✓ ' + s);
if (fail.length) {
  console.log('');
  for (const f of fail) console.log('  ✗ ' + f);
  console.log('\n失败 ' + fail.length + ' 项');
} else {
  console.log('\n存档验收全通过（' + ok.length + ' 项）');
}
if (process.argv.includes('--json')) {
  fs.writeFileSync(path.join(__dirname, 'save_check.json'),
    JSON.stringify({ at:new Date().toISOString(), ok, fail }, null, 2));
}
process.exit(fail.length ? 1 : 0);
