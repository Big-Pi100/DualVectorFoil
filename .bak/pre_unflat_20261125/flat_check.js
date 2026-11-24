// flat_check.js — S4「侧身（Flatten）」验收
//
// 这个动词是整款游戏的立论，所以它不能靠"看起来能玩"过关。这里测五类：
//   A. 纸缝：站着的 28px 过不去，侧身的 6px 过得去（而且要能安全地站起来）
//   B. 限制：侧身时不能攻击、不能跳、不能放红魂（少一条就变免伤外挂）
//   C. 墨：消耗速率、归零自动起身、只有灯能补
//   D. 伤害：同平面的身体打不到侧身的人，飞来的纸镖照样能打中
//   E. 埋点：首次使用时间 / 必经缝时间 / 之后是否自发复用
//
// 用法: node flat_check.js [--json]
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
    appendChild() {}, remove() {}, getContext: () => fakeCtx(), addEventListener() {}, click() {},
    getAttribute() { return null; },
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
    location: { search: '?room=paper' },
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
  code += `;globalThis.__peek = () => ({ P, SAVE, room, loadRoom, MET, enemies, projectiles, pickups });`;
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
           peek: () => sandbox.__peek(), met: () => sandbox.__sk.metrics() };
}

const fail = [], ok = [];
const check = (n, c, d) => (c ? ok : fail).push(n + (d ? ' — ' + d : ''));
const T = 48;                     // TILE
const px = t => t * T;

/* 进显影室，等落地稳（invuln 也清掉），再把玩家挪到指定格 */
function enter(atTile) {
  const g = makeGame();
  g.peek().loadRoom('paper', null, false);
  g.run(700);
  if (atTile != null) { g.peek().P.x = px(atTile); g.peek().P.y = px(15) - 100; }
  g.run(60);
  return g;
}
const cwOf = g => g.st().cw;
/* 侧身改成**切换**了（白哥 2026-11-24，对齐《重生细胞》"格子点一下就使用"）：
 * 点一下压扁，再点一下起身，不再靠"松手"退出。
 * 所以两个 helper 都变成"点一下"，语义由调用次序决定；
 * 带状态检查是为了让重复调用变成幂等 —— 已经是 flat 就不再点一次退出。 */
const tapF = g => { g.key('f', true); g.run(20); g.key('f', false); g.run(20); };
const flatOn = g => { if (g.st().state !== 'flat') tapF(g); };
const flatOff = g => { if (g.st().state === 'flat') tapF(g); };

/* ================= A. 纸缝 ================= */
/* 第一处是"伸进去"，不是"穿过去"（裁定 Q23 把矮墙降到 3 格之后，
 * 缝后面是一格宽的暗格，不是通道）。所以断言分三件：
 *   站着进不去 / 侧身进得去 / 墙本身仍然是实的（侧身也穿不过整堵墙）。 */
console.log('A. 纸缝（站着 28px 过不去，侧身 6px 过得去）');
{
  /* 矮墙左脸在 x=12 格，站着的身体撞在 576 上 —— 应该停在 548 之前 */
  const g = enter(10);
  g.key('d', true); g.run(1600); g.key('d', false); g.run(100);
  const xStand = g.st().x;
  check('站着撞在纸缝前（x < 550）', xStand < 550, 'x=' + xStand.toFixed(1));
  check('站着时碰撞宽度 = 28', cwOf(g) === 28, String(cwOf(g)));
}
{
  const g = enter(10);
  flatOn(g); g.run(120);
  check('按下 F 进入侧身', g.st().state === 'flat', g.st().state);
  check('侧身时碰撞宽度 = 6', cwOf(g) === 6, String(cwOf(g)));
  g.key('d', true); g.run(1400); g.key('d', false); g.run(100);
  const xFlat = g.st().x;
  check('侧身穿过矮墙（x > 624）', xFlat > 624, 'x=' + xFlat.toFixed(1));
}
{
  /* 缝里那个墨囊：站着够不到，侧身够得到。
   * reach 默认 52，这个道具是 24 —— 因为缝中线离站着的人中心只有 38.5px，
   * 用默认值会隔着空气把东西吸走，"只能侧身拿"这句话就不成立了。 */
  const g = enter(10);
  g.key('d', true); g.run(1600); g.key('d', false); g.run(250);
  const got0 = g.peek().pickups.filter(p => p.got).length;
  check('站着靠过去，缝里的东西没被吸走', got0 === 0, 'got=' + got0);
  flatOn(g); g.run(120);
  g.key('d', true); g.run(900); g.key('d', false); g.run(250);
  const got1 = g.peek().pickups.filter(p => p.got).length;
  check('侧身过去顺手拿到缝里的墨囊', got1 === 1, 'got=' + got1);
  flatOff(g); g.run(200);
}

console.log('\nB. 缝里不能硬撑开');
{
  const g = enter(10);
  flatOn(g); g.run(100);
  /* 走到缝里（x ≈ 590..610），松手 —— 必须继续保持扁平 */
  g.key('d', true);
  let guard = 0;
  while (g.st().x < 594 && guard++ < 300) g.run(16);
  g.key('d', false);
  flatOff(g); g.run(120);
  check('在缝里松手仍是侧身（站不起来）', g.st().state === 'flat', g.st().state);
  check('在缝里宽度仍是 6', cwOf(g) === 6, String(cwOf(g)));
  /* 穿出去之后应该自动起身 */
  g.key('d', true); g.run(900); g.key('d', false); g.run(120);
  check('退出去之后自动站起（宽度回到 28）', cwOf(g) === 28 && g.st().state !== 'flat',
        cwOf(g) + '/' + g.st().state);
}

/* ================= C. 限制：不能攻 / 不能跳 ================= */
console.log('\nC. 侧身时不能攻击、不能跳');
{
  const g = enter(4);
  flatOn(g); g.run(120);
  const cd0 = g.st().cdRed;
  g.key('j', true); g.run(200); g.key('j', false); g.run(100);
  check('侧身按 J 不出招', g.st().state === 'flat', g.st().state);
  check('侧身按 J 没有投射物', g.sk.projectiles().length === 0);
  g.key('k', true); g.run(200); g.key('k', false); g.run(100);
  check('侧身按 K 不起跳', g.st().onGround && g.st().state === 'flat',
        'onGround=' + g.st().onGround + ' state=' + g.st().state);
  g.key('u', true); g.run(200); g.key('u', false); g.run(100);
  check('侧身按 U 不放红魂（不给冷却）', g.st().cdRed === cd0, cd0 + '→' + g.st().cdRed);
}

/* ================= D. 墨 ================= */
console.log('\nD. 墨：消耗 / 归零 / 只有灯能补');
{
  const g = enter(4);
  g.peek().P.ink = 100;
  flatOn(g);
  const a = g.st(), ta = a.simT;
  g.run(1000);
  const b = g.st(), tb = b.simT;
  const rate = (a.ink - b.ink) / (tb - ta);
  check('墨按 26/s 消耗', Math.abs(rate - 26) < 2, rate.toFixed(2) + '/s');
  flatOff(g);
}
{
  const g = enter(4);
  g.peek().P.ink = 0.5;
  flatOn(g); g.run(300);
  check('墨尽自动起身', g.st().state !== 'flat' && cwOf(g) === 28, g.st().state);
  check('墨不会变成负数', g.st().ink >= 0, String(g.st().ink));
}
{
  /* 灯在 x=4 格（出生点旁边）。把墨打空再站到灯下。 */
  const g = enter(10);
  g.peek().P.ink = 5;
  g.run(60);
  const inkAt10 = g.st().ink;
  check('离灯远的地方不补墨', inkAt10 <= 5.5, String(inkAt10.toFixed(2)));
  g.peek().P.x = px(4);
  g.run(1000);
  check('灯下补墨（> 60）', g.st().ink > 60, g.st().ink.toFixed(1));
}

/* ================= E. 伤害规则 ================= */
console.log('\nE. 同平面的身体打不到，飞来的纸镖打得到');
{
  /* 站立：把史莱姆挪到身上 */
  const g = enter(20);
  const e = g.peek().enemies.find(x => !x.dead);
  e.x = g.st().x + 4; e.y = 620;
  const hp0 = g.st().hp;
  g.run(200);
  check('站着被史莱姆碰到会掉血', g.st().hp < hp0, hp0 + '→' + g.st().hp);
}
{
  const g = enter(20);
  flatOn(g); g.run(120);
  const hp0 = g.st().hp;
  const e = g.peek().enemies.find(x => !x.dead);
  e.x = g.st().x + 4; e.y = 620;
  g.run(400);
  check('侧身时同平面的史莱姆打不到（不掉血）', g.st().hp === hp0, hp0 + '→' + g.st().hp);
  check('接触被消掉记了数', g.met().contactsSuppressed >= 1, String(g.met().contactsSuppressed));
}
{
  /* 飞镖：直接塞一颗到身上，侧身也躲不掉 */
  const g = enter(20);
  flatOn(g); g.run(120);
  const hp0 = g.st().hp;
  const P = g.peek().P;
  g.peek().projectiles.push({ x:P.x + 3, y:P.y + 50, vx:0, vy:0, life:0.6, dmg:8,
                              kind:'dart', foe:true, pierce:false, hits:new Set() });
  g.run(120);
  check('侧身挡不住投掷物（掉血）', g.st().hp < hp0, hp0 + '→' + g.st().hp);
  check('被投掷物打中记了数', g.met().shotsHit >= 1, String(g.met().shotsHit));
}

/* ================= F. 必经缝 + 埋点 ================= */
console.log('\nF. 必经缝与埋点');
{
  const g = enter(26);
  /* 这一组量的全是**几何**：站着过不去、压扁过得去、过墙那一刻被记下来。
   * 走廊里的蝙蝠会在 1.9s 间隔吐纸镖（它本来就该吐 —— 那是"侧身不是无敌"
   * 的证据），而这里要站在原地等 1.5s，正好撞上第一发：
   * 人被打成 hurt、被击退，测出来的就是"挨打"而不是"过墙"。
   * 所以先把敌人清掉。这不是绕过 bug —— 打击与投掷物有它们自己的用例
   * （D 组"侧身挡不住投掷物"），这里只留地形。 */
  g.peek().enemies.forEach(e => { e.dead = true; });
  g.key('d', true); g.run(1500); g.key('d', false); g.run(100);
  /* 右缘不许进墙。solidBox 的判据是 body 里最后一个像素的下标，
   * 所以贴墙时 x 可以到 1316.99 —— 拿 1316 当线是自己跟自己过不去。 */
  check('站着过不了必经墙（右缘没进墙）', g.st().x + 28 <= 1345, 'x+28=' + (g.st().x + 28).toFixed(1));
  check('没过墙时 gateTime 还是 null', g.met().gateTime === null);

  flatOn(g); g.key('d', true); g.run(2500); g.key('d', false); g.run(200);
  const m = g.met();
  check('侧身穿过必经墙（x > 1400）', g.st().x > 1400, 'x=' + g.st().x.toFixed(1));
  check('过墙时间被记下', m.gateTime !== null, String(m.gateTime));
  check('过墙那一刻还不算"自发复用"', m.reuseAfterGate === 0, String(m.reuseAfterGate));

  /* 第一次按下的位置就在墙跟前 → 这是"被逼的"，不能算发现 */
  check('首次使用记在墙跟前（kind = atGate）', m.firstUse && m.firstUse.kind === 'atGate',
        m.firstUse && m.firstUse.kind);

  /* ---- 负控制：在墙跟前再压一次，**不算**自发复用 ----
   * 策划的硬规则：forced use 不许算成 discovery，也不许算成 voluntary reuse。
   * 这里如果算进去，判据 2 就会被"玩家在墙边多按了两下"灌水。
   * 必须先把人放定在 gateX 上 —— 过墙之后一路跑出去的人不在判断区里，
   * 那样测的就不是"墙跟前"这件事了。 */
  flatOff(g); g.run(300);
  g.peek().P.x = px(29); g.run(80);
  flatOn(g); g.run(200); flatOff(g); g.run(120);
  const m2 = g.met();
  check('在墙跟前再压 → 不计入 voluntaryReuses', m2.voluntaryReuses === 0, String(m2.voluntaryReuses));
  check('它被单独记进 atGateAfterCross', m2.useBreakdown.atGateAfterCross === 1,
        JSON.stringify(m2.useBreakdown));
  check('判定量仍然 false', m2.voluntarilyReused === false);

  /* ---- 正例：走开去压，才算自发复用 ----
   * 挪到 x=31.5 格（离 gateX 120px，出了 90px 的判断区），再按 F。 */
  g.peek().P.x = px(31.5); g.run(80);
  flatOn(g); g.run(200); flatOff(g); g.run(100);
  const m3 = g.met();
  check('离墙的地方再压 → voluntaryReuses = 1', m3.voluntaryReuses === 1, String(m3.voluntaryReuses));
  check('判定量 voluntarilyReused = true', m3.voluntarilyReused === true);
  check('首次侧身时间被记下（>= 0）', m3.timeToFirstFlat !== null && m3.timeToFirstFlat >= 0,
        String(m3.timeToFirstFlat));
  check('累计侧身时长 > 0', m3.flatSeconds > 0, String(m3.flatSeconds));
}
{
  /* 另一头：在必经墙之外的地方第一次压，记的是"发现"。
   * 这是判据 1（无提示发现）唯一该读的字段。 */
  const g = enter(10);
  flatOn(g); g.run(120);
  const m = g.met();
  check('在墙外第一次压 → kind = beforeGate', m.firstUse && m.firstUse.kind === 'beforeGate',
        m.firstUse && m.firstUse.kind);
  check('它不计入 mandatoryUses', m.mandatoryUses === 0, String(m.mandatoryUses));
  flatOff(g);
}

/* ============ F2. 过墙后的第二处：只有侧身拿得到（裁定 Q22） ============ */
console.log('\nF2. 过墙之后的壁龛');
{
  const g = enter(31);
  g.key('d', true); g.run(1200); g.key('d', false); g.run(250);
  const xStand = g.st().x;
  check('站着被缝挡在槽外（x + 28 <= 1537）', xStand + 28 <= 1537, 'x+28=' + (xStand + 28).toFixed(1));
  const gotBefore = g.peek().pickups.filter(p => p.got && p.soul).length;
  check('站着拿不到槽里的魂', gotBefore === 0, 'got=' + gotBefore);

  flatOn(g); g.run(120);
  g.key('d', true); g.run(900); g.key('d', false); g.run(250);
  check('侧身进了槽（x > 1536）', g.st().x > 1536, 'x=' + g.st().x.toFixed(1));
  const gotAfter = g.peek().pickups.filter(p => p.got && p.soul).length;
  check('侧身进槽拿到魂（这就是"值得为它压扁"）', gotAfter === 1, 'got=' + gotAfter);
  flatOff(g); g.run(200);
  check('松手后仍在槽里保持扁平（48px 宽，撑不开就走出去）',
        g.st().state === 'flat' || cwOf(g) === 28, g.st().state + '/' + cwOf(g));
}

/* ================= G. 房间形状 ================= */
console.log('\nG. 房间本身');
{
  const g = makeGame();
  const r = g.peek().room;
  check('显影室 40 格宽', r.w === 40 && r.id === 'paper', r.w + ' ' + r.id);
  check('有 3 盏灯', (r.lamps || []).length === 3, String((r.lamps || []).length));
  /* 第一处（裁定 Q23）：矮墙只有 3 格 = 144px，跳过去是显而易见的事。
   * 一格厚、不挖洞：上一版挖了暗格，1:1 读成"面板"，不是"墙里的洞"。 */
  check('矮墙 3 格高：y12 顶，y11 空', r.g[12][12] === '|' && r.g[11][12] === '.',
        r.g[12][12] + '/' + r.g[11][12]);
  check('矮墙只有一格厚（没有暗格/门洞）', r.g[12][13] === '.', r.g[12][13]);
  check('整根柱子都是缝（144px 连续）',
        r.g[12][12] === '|' && r.g[13][12] === '|' && r.g[14][12] === '|',
        r.g[12][12] + r.g[13][12] + r.g[14][12]);
  /* 第二处（裁定 Q22）：过墙之后的密封窄槽 —— 1 格宽，不读成门洞 */
  check('过墙后有第二处壁龛（左脸有缝）', r.g[12][32] === '|' && r.g[14][32] === '|');
  check('槽只挖一格宽（3 格会读成门洞）',
        r.g[12][33] === '.' && r.g[12][34] === '#', r.g[12][33] + '/' + r.g[12][34]);
  check('第二处壁龛上面有顶（只能从缝进）', r.g[11][33] === '#', r.g[11][33]);
  check('第二处三格高（进去之后站得起来）',
        r.g[12][33] === '.' && r.g[13][33] === '.' && r.g[14][33] === '.',
        r.g[12][33] + r.g[13][33] + r.g[14][33]);
  check('过墙后的壁龛里有魂（值得为它压扁）', (r.items || []).some(i => i.soul),
        JSON.stringify((r.items || []).map(i => i.id)));
  /* 必经墙：x=28 整列，只有 y=12..14 是纸缝 */
  const col = [];
  for (let y = 0; y < 15; y++) col.push(r.g[y][28]);
  const slits = col.filter(c => c === '|').length;
  const solids = col.filter(c => c === '#').length;
  check('必经墙：3 格纸缝 + 12 格实墙', slits === 3 && solids === 12, slits + '/' + solids);
  const hasItem = (r.items || []).some(i => i.ink);
  check('壁龛里有一个墨囊', hasItem);
  const shooter = (r.enemies || []).some(e => e.shoots);
  check('有一只吐纸镖的蝙蝠', shooter);
}

console.log('');
if (fail.length) {
  console.log('失败 ' + fail.length + ' 项:');
  for (const f of fail) console.log('  ✗ ' + f);
} else {
  console.log('侧身验收全通过（' + ok.length + ' 项）');
}
if (process.argv.includes('--json')) {
  fs.writeFileSync(path.join(__dirname, 'flat_check.json'), JSON.stringify({
    at: new Date().toISOString(), ok, fail,
  }, null, 2));
}
process.exit(fail.length ? 1 : 0);
