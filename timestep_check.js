// timestep_check.js — 定步长（S1）验收：同一个跳跃在 30 / 60 / 120Hz 下必须一致
//
// 为什么必须单独测这一条：
//   改之前物理跟着 RAF 的真实间隔走，30fps 每步算 33ms、60fps 算 16.7ms，
//   同一个跳跃在两台机器上落点不同（实测低帧率偏高 8.4%，中途卡一下还随机偏 1~3%）。
//   而 test.js 全部用 16.7ms 一个时钟推进 —— 它永远看不到这个 bug，
//   因为它自己就是 60fps。所以这里必须**换时钟**跑同一个动作。
//
// 用法: node timestep_check.js [--json]
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

/* ---------------- 与 test.js 相同的假 DOM ---------------- */
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

/* 造一个独立的游戏实例：每个帧率一份，互不污染 */
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
    URLSearchParams: class { constructor() {} get() { return null; } },
    /* localStorage 是真的会被读写的（S2），这里给一份内存实现 */
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    performance: { now: () => 0 },
  };
  sandbox.globalThis = sandbox;
  /* window 就是全局本身 —— game.js 把 __sk 挂在 window 上，
   * 两个对象的话测试侧永远看不到它（上一版 test.js 就是没用到 __sk 才没暴露）。 */
  sandbox.window = sandbox;

  let code = fs.readFileSync(path.join(__dirname, 'src', 'game.js'), 'utf8');
  code += `;globalThis.__peek = () => ({ P, SAVE, room, loadRoom, setFeel });`;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'game.js' });

  const key = (k, down = true) => {
    const ev = { key: k, preventDefault() {}, ctrlKey: false, repeat: false };
    (listeners[down ? 'keydown' : 'keyup'] || []).forEach(fn => fn(ev));
  };

  let t = 0;
  const tick = ms => { t += ms; rafCb(t); };
  return { sandbox, __peek: sandbox.__peek, key, tick, st: () => sandbox.__sk.state(), sk: sandbox.__sk };
}

/* ---------------- 一个动作，三种时钟 ---------------- */
const fail = [], ok = [];
const check = (n, c, d) => (c ? ok : fail).push(n + (d ? ' — ' + d : ''));

/* 在给定帧率下跳一次，返回物理自己记的顶点高度（apex）。
 * 顶点由 physics 每个整步记最小值 —— 不靠采样，30fps 也不会漏掉真顶点。 */
function jumpApex(hz, holdMs) {
  const g = makeGame();
  const frameMs = 1000 / hz;
  g.__peek().loadRoom('hall', null, false);
  for (let i = 0; i < Math.round(800 / frameMs); i++) g.tick(frameMs);   // 落地稳定
  const y0 = g.st().y;
  g.key('k', true);                                                     // 按住跳
  const until = Math.round(holdMs / frameMs);
  for (let i = 0; i < until; i++) g.tick(frameMs);
  g.key('k', false);
  for (let i = 0; i < Math.round(700 / frameMs); i++) g.tick(frameMs);   // 落回
  const s = g.st();
  return { apex: y0 - s.airMinY, y0, yEnd: s.y, onGround: s.onGround };}

/* 横向速度也要一致。
 * 比"位移"是不公平的：按键落在帧边界上，30Hz 时最多晚 33ms 才开始加速，
 * 这点差 4px 得算采样误差，不是物理误差。所以改成比**匀速段的速度** ——
 * 窗口取 200~400ms（已经跑到匀速），用游戏自己的 simT 算，
 * 起点那一下的量化误差在比值里自动消掉。 */
function runSpeed(hz) {
  const g = makeGame();
  const frameMs = 1000 / hz;
  g.__peek().loadRoom('hall', null, false);
  for (let i = 0; i < Math.round(600 / frameMs); i++) g.tick(frameMs);
  g.key('d', true);
  for (let i = 0; i < Math.round(200 / frameMs); i++) g.tick(frameMs);
  const a = g.st();
  for (let i = 0; i < Math.round(200 / frameMs); i++) g.tick(frameMs);
  const b = g.st();
  g.key('d', false);
  return (b.x - a.x) / (b.simT - a.simT);
}

function stats(a) {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  const v = a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length;
  return { mean: m, sd: Math.sqrt(v), min: Math.min(...a), max: Math.max(...a) };
}

const RATES = [30, 60, 120, 144];
console.log('定步长验收 —— 同一动作 / 不同时钟\n');
console.log('帧率   顶点(px)  三跳  落地  ');
const apexBy = {};
for (const hz of RATES) {
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(jumpApex(hz, 600));
  apexBy[hz] = runs.map(r => +r.apex.toFixed(3));
  const s = stats(runs.map(r => r.apex));
  console.log(`${String(hz).padStart(4)}Hz  ${s.mean.toFixed(2).padStart(7)}  ` +
              `${runs.map(r => r.apex.toFixed(1)).join(' / ').padStart(16)}  ` +
              `${runs.every(r => r.onGround) ? '✓' : '✗'}  sd=${s.sd.toFixed(3)}`);
}

const all = RATES.flatMap(hz => apexBy[hz]);
const sdAll = stats(all).sd;
check('30/60/120/144Hz 顶点标准差 < 0.5px', sdAll < 0.5, 'sd=' + sdAll.toFixed(4));

/* 同一帧率重复三次也必须一样：这是"中途卡一下不会偏"的证据 */
for (const hz of RATES) {
  const s = stats(apexBy[hz]);
  check(`${hz}Hz 重复三次顶点标准差 < 0.05px`, s.sd < 0.05, 'sd=' + s.sd.toFixed(4));
}

/* 每帧帧率都不同，但**低帧率不能靠"运气"拿到同一个值** —— 极值差也要小 */
const gmin = Math.min(...all), gmax = Math.max(...all);
check('跨帧率极差 < 1px', gmax - gmin < 1, (gmax - gmin).toFixed(3) + 'px');

/* 顶点**绝对值**也要钉住，不只是"各帧率之间一致"。
 * 一个全都跑到 190px 的构建，上面所有"一致性"断言照样全绿 ——
 * 但手感已经被悄悄改掉了。203.8 是旧循环 60fps 实测值（标定见 P_JUMP_V 的注释）。 */
check('顶点 = 203.8 ± 0.5px（原始手感）', Math.abs(stats(all).mean - 203.8) < 0.5,
      stats(all).mean.toFixed(2) + 'px');

/* 匀速段速度：跨帧率必须一致（差 1% 就是"这台机器跑得更快"） */
const DRATES = [30, 60, 120, 144];
const speeds = DRATES.map(hz => runSpeed(hz));
const sdV = stats(speeds).sd, mV = stats(speeds).mean;
console.log('\n匀速段速度: ' + speeds.map((v, i) => DRATES[i] + 'Hz=' + v.toFixed(1)).join('  ') +
            '  sd=' + sdV.toFixed(3));
check('跑动速度跨帧率一致（相对差 < 0.5%）', sdV / mV < 0.005, (sdV / mV * 100).toFixed(3) + '%');

/* 30fps 下按键不能被吞：一帧 33ms = 4 个物理步，
 * 如果 tap 在第一步之后被清掉又没被读，跳就没了（"按了不跳"） */
{
  const g = makeGame();
  g.__peek().loadRoom('hall', null, false);
  for (let i = 0; i < 20; i++) g.tick(33.3);
  g.key('k', true);
  let air = false;
  for (let i = 0; i < 4; i++) { g.tick(33.3); if (!g.st().onGround) air = true; }
  g.key('k', false);
  check('30fps 下按一下跳能起跳（tap 不被吞）', air);
}

/* 240Hz：一帧 4.17ms < 8.33ms 物理步长，会出现"这一帧一步都没跑"。
 * 这时 tap 绝不能清 —— 清了就是"高刷屏按一下没反应"。 */
{
  const g = makeGame();
  g.__peek().loadRoom('hall', null, false);
  for (let i = 0; i < 400; i++) g.tick(1000 / 240);   // 稳定同时把累加器相位打乱
  const x0 = g.st().x;
  g.key('k', true);
  let air = false;
  for (let i = 0; i < 12; i++) { g.tick(1000 / 240); if (!g.st().onGround) air = true; }
  g.key('k', false);
  check('240Hz 下按一下跳能起跳（空帧不吞 tap）', air);
}

/* 掉帧保护：一帧塞 3 秒（切标签页回来），不能卡死也不能把时间全补上 */
{
  const g = makeGame();
  g.__peek().loadRoom('hall', null, false);
  for (let i = 0; i < 30; i++) g.tick(16.7);
  const y0 = g.st().y;
  const t0 = Date.now();
  g.tick(3000);
  const cost = Date.now() - t0;
  check('一帧 3s 不会卡死（<200ms 开销）', cost < 200, cost + 'ms');
  check('一帧 3s 不会把角色瞬移穿墙', Math.abs(g.st().y - y0) < 200, 'dy=' + (g.st().y - y0));
}

/* 跳跃缓冲必须是**固定时长**，而且以物理步计。
 * 以前写的是 dt * 1.5 —— dt 从 16.7ms 变成 8.33ms，缓冲自己就从 25ms 缩到 12.5ms，
 * 没有任何人调过它。这类"单位写错把自己改掉"的参数，只有跨时钟读同一个值才抓得到。
 *
 * 读法有个坑：缓冲在**每个物理步**开头衰减。所以一帧跑几步，看到的数就不一样 ——
 * 这不是不稳定，正是"按步算"的证据。30Hz 一帧 4 步，25ms 在那一帧里就走完了，
 * 于是帧末读到 0：**在 30Hz 上根本看不见这个值**，只能靠上面的功能测。 */
{
  const WANT = 3, STEP = 1 / 120, TOL = 1e-9;
  const seen = [];
  for (const hz of [60, 120, 144]) {
    const g = makeGame();
    const fm = 1000 / hz;
    g.__peek().loadRoom('hall', null, false);
    for (let i = 0; i < Math.round(600 / fm); i++) g.tick(fm);
    g.key('k', true);
    g.tick(fm);                        // 这一帧里 tap 被消费，缓冲被写上
    g.key('k', false);
    seen.push({ hz, buf: g.st().jumpBuf });
  }
  /* 期望值：写 3 步，帧内剩下的每步各减 1。60Hz 一帧 2 步 → 剩 2 步 = 16.7ms */
  const exp60 = (WANT - 1) * STEP;     // 2 步
  const expHi = WANT * STEP;           // 120/144Hz 一帧 1 步
  const b60 = seen.find(x => x.hz === 60).buf;
  const b120 = seen.find(x => x.hz === 120).buf;
  const b144 = seen.find(x => x.hz === 144).buf;
  console.log('\n跳跃缓冲（帧末读数）: 60Hz=' + (b60 * 1000).toFixed(2) + 'ms  ' +
              '120Hz=' + (b120 * 1000).toFixed(2) + 'ms  144Hz=' + (b144 * 1000).toFixed(2) + 'ms');
  check('缓冲 = 3 个物理步 = 25ms（120Hz 读得到整值）',
        Math.abs(b120 - 3 * STEP) < TOL, (b120 * 1000).toFixed(3) + 'ms');
  /* 60Hz 帧末读到几，取决于按键落在这一帧的第几步 —— 那由累加器相位决定，
   * 不是稳定量。所以不钉具体值，只钉"它必须是步长的整数倍"：
   * 如果是按秒记的，这个比值会是个随便什么小数。 */
  const ratio = b60 / STEP;
  check('60Hz 帧末读数是步长的整数倍（按步衰减，不是按秒）',
        Math.abs(ratio - Math.round(ratio)) < 1e-6 && ratio >= 1 && ratio <= 3,
        ratio.toFixed(3) + ' 步');
  check('144Hz 一帧一步 → 帧末仍是 25ms',
        Math.abs(b144 - expHi) < TOL, (b144 * 1000).toFixed(3) + 'ms');
}

/* 缓冲要真的起作用，而且要**只在窗口内**起作用。
 * 做法：先量出"从起跳到落地是第几步"，再在落地前 N 步按一下跳，
 * 看落地那一步会不会立刻弹起来。前面几档是负控 —— 太早按就不该起跳，
 * 否则缓冲不是 25ms，是"按过就算"。 */
{
  const fm = 1000 / 120;
  const fresh = () => {
    const g = makeGame();
    g.__peek().loadRoom('hall', null, false);
    for (let i = 0; i < 100; i++) g.tick(fm);
    return g;
  };
  /* 第 0 步：量落地步数（不按任何键，纯下落） */
  const probe = fresh();
  probe.key('k', true); probe.tick(fm); probe.key('k', false);
  let n = 0;
  while (!probe.st().onGround && n < 400) { probe.tick(fm); n++; }
  check('量到落地步数（起跳→落地）', n > 0 && n < 400, 'n=' + n);

  const pressAt = lead => {
    const g = fresh();
    g.key('k', true); g.tick(fm); g.key('k', false);
    for (let i = 1; i < n - lead; i++) g.tick(fm);
    g.key('k', true); g.tick(fm); g.key('k', false);   // 落地前 lead 步按一下
    g.tick(fm);                                        // 这一拍应该已经落地 / 起跳
    const s = g.st();
    return { air: !s.onGround && s.vy < 0, vy: s.vy, jumps: s.jumps, buf: s.jumpBuf };
  };
  const near = pressAt(1), far = pressAt(6);
  check('落地前 1 步按跳 → 落地立刻起跳（缓冲生效）', near.air, JSON.stringify(near));
  check('落地前 6 步按跳 → 不生效（缓冲不是无限长）', !far.air, JSON.stringify(far));
}

console.log('');
if (fail.length) {
  console.log('失败 ' + fail.length + ' 项:');
  for (const f of fail) console.log('  ✗ ' + f);
} else {
  console.log(`定步长验收全通过（${ok.length} 项）`);
}
if (process.argv.includes('--json')) {
  fs.writeFileSync(path.join(__dirname, 'timestep_check.json'), JSON.stringify({
    at: new Date().toISOString(), ok, fail,
    apexByRate: apexBy, sd: sdAll, speeds,
  }, null, 2));
}
process.exit(fail.length ? 1 : 0);
