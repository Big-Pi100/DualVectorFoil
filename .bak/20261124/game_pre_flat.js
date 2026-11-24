/* 魂之城 · Soul Keep
 * AoS（晓月圆舞曲）模式的玩法内核原型
 * ------------------------------------------------------------------
 * 只做三件事，每件都要能换成真素材：
 *   1. 房间探索 + 能力门（拿魂 → 解锁 → 回头开门）
 *   2. 三类魂装备（红/蓝/黄）+ 银魂（能力魂，永久）
 *   3. 皮肤包（skin pack）：主角/怪物的视觉可整体替换，碰撞体不变
 * 美术默认用名片管线导出的 atlas（同一份 atlas.json），换照片走 dyn 包。
 */
'use strict';

// ============================ 常量 ============================
const TILE = 48;
/* 逻辑分辨率：高度锁 540，宽度跟着设备走。
 * 手机横屏是 19.5:9（2.16），比 16:9 更长；如果硬锁 960 宽，左右各留 75px 黑边。
 * 与其裁掉视野，不如让它多看一段 —— 触屏本来就该多看。 */
let VIEW_W = 960;
const VIEW_H = 540;
/* 逻辑分辨率固定 960×540，实际像素密度跟着屏幕走：
 * 手机 Retina 上 960 的backing store 会被放大成糊的，所以对外留一个 RS（渲染倍率），
 * 触屏层按 缩放×DPR 设它，render() 起手 setTransform(RS) —— 全部绘制逻辑仍写逻辑坐标。 */
let RS = 1;
/* 通用的重力/落速上限：敌人和死亡动画在用。
 * 玩家正常跳跃**不走这两个** —— 见下面的 P_GRAV，否则调手教会把怪一起改了。 */
const GRAV = 2000, MAX_FALL = 950;

/* ==================== 手感预设 ====================
 * 恶魔城（晓月）和现代平台游戏不是"参数大小"的区别，是设计哲学的区别。
 *
 * ── 有据可查的四条 ──
 * castlevaniaspeedruns.com/AoS/Movement 与 TASVideos 的 AoS 页：
 *   1. Soma 走路 1.5 像素/帧（@60fps = 90 px/s），**没有加速度**
 *      —— 按下就是满速，松手就停，不存在"爬升"
 *   2. 跳跃期间水平速度不变（跳起来不会变慢）
 *   3. 按住 A 更久跳更高（可变跳跃高度）
 * sotn-decomp/src/ric/pl_steps.c（月下反编译，同世代手感）：
 *   4. 松手时上升速度被硬压到 -1.0 像素/帧，是**绝对值切断**，不是乘系数
 *   5. 走路每帧先 RicDecelerateX(FIX(0.125)) 再 RicSetSpeedX(FIX(1.25)) ——
 *      恒速是"每帧重设"，不是"没有摩擦"。松手后仍在减速，要 10 帧才停。
 *   6. 空中减速是地面的一半（FIX(0.0625)）
 *
 * ── 恶魔城没有的东西 ──
 * 土狼时间、跳跃缓冲、顶点重力打折。这三个都是后来的游戏为了让玩家"别摔死"
 * 加的宽容设计，GBA 上的恶魔城一个都没有。去掉了操作会变"硬" —— 那正是它的手感。
 *
 * ── 换算（全部按 1 格 = 16px → 我们 48px，倍数 3）──
 *   走速     1.5 × 3 × 60 = 270 px/s        （AoS Soma 1.5px/帧）
 *   地面减速 0.125 × 3 × 3600 = 1350 px/s²  → 270 减到 0 要 12 帧、滑 29px
 *   空中减速 0.0625 × 3 × 3600 =  675 px/s² → 滑行距离是地面的两倍
 *   重力     0.21875 × 3 × 3600 = 2362 px/s²
 *   起跳     5.4375 × 3 × 60 = 979 px/s     → 跳高 67.6×3 = 203px = 4.22 格
 *            （979 是连续解；离散积分每步都少一点，实际给的 971.3 才落到 203.8px。
 *              971.3 不是凑的：见下面 P_JUMP_V 那行的注释。）
 *
 * **跳高 203px（4.22 格）是照真实比例来的，不是凑的。** 上一版是 161px
 * （3.35 格），比原版矮了 21% —— 因为当时我是照"1.6 倍身高"倒推的，
 * 而反编译里身高比和格子比的换算结果其实是 2 倍身高。改成 203 之后
 * 能力门必须跟着抬（192px 会被单跳过），关卡的平台高度也相应调过。
 *
 * 松手切断值**没有**照搬 -1.0 px/帧：那个数在我们的尺度下只能再升 6px，
 * 轻点跳不到半格，手机上等于"按了没反应"。按"轻点刚好上一格台阶"定 400px/s。
 * 质地（松手立刻掐断上升）保留了，幅度是按可玩性定的 —— 这是全套参数里
 * 唯一一个主动偏离原版的地方。
 *
 * ── modern ──
 * 上一版：117ms 加速爬升 + 100ms 土狼时间 + 130ms 跳跃缓冲 + 顶点重力打折。
 * 留着是为了能随时切回去做对比（`?feel=modern`），不是给玩家选的。
 */
const FEELS = {
  aos: {
    ACC_G: 1e6, ACC_A: 1e6,          // 一帧到满速（数学上的无穷大，不是偷懒）
    FRIC_G: 1350, FRIC_A: 675,       // 月下真实摩擦：地面 0.125、空中 0.0625 px/帧²
    TURN_MUL: 1,                     // 没有"转身加倍"，因为本来就没有加速过程
    COYOTE_T: 0, JBUF_TICKS: 3,      // 恶魔城没有土狼时间；跳跃缓冲 1.5 帧 = 25ms（3 个物理步）
    /* 顶点窗口是**非对称**的，这不是调参调出来的：pl_collision.c:18-26
     * 条件是 `vy < FIX(3/8) && vy > FIX(-1/8)`，即 -0.125 ~ +0.375 px/帧。
     * 换算 ×3 格 ×60 帧 = -22.5 ~ +67.5 px/s。窗口内且**按住跳键**时，
     * 重力从 28/128 掉到 5.6/128 —— 正好 1/5。这就是原版的"顶点滞空"。 */
    APEX_LO: -22.5, APEX_HI: 67.5, APEX_MUL: 0.2,
    CUT_V: 400, CUT_MUL: 0,          // 松手：上升速度压到 400px/s（≈ 轻点跳一格）
    SPD_RUN: 270, SPD_AIR: 270,      // 1.5 px/帧 × 3 × 60
    P_JUMP_V: 971.3, P_DJUMP_V: 792.7,
    /* 961/783 是按 60fps 可变 dt 标定的。改成 120Hz 定步长后同一速度只跳到
     * 199.72px（步长减半 → 半隐式欧拉每步欠的位移变小，整段少了 2%）。
     * 这不是"更准所以更高"，而是**换了积分器就要重新标定**：
     * 二分扫到 971.3 时，30/60/120/144Hz 全部落在 203.79~203.80px ——
     * 和旧循环 60fps 实测的 203.73 是同一个数（差 0.06px）。
     * 二段跳同理：增量从 136.34 掉到 133.24，补到 792.7 后回到 136.34。
     * 标定脚本的结论写在这里，改数之前先看 S1_S3_REPORT.md 第二节。 */
    P_GRAV: 2362, P_MAX_FALL: 1260,  // 0.21875 px/帧² × 3 × 3600；终速 FIX(7)=7px/帧
    VY_CEIL: -45,                    // 撞顶压到 -0.25 px/帧
  },
  modern: {
    ACC_G: 2600, ACC_A: 1500, FRIC_G: 3000, FRIC_A: 600, TURN_MUL: 2.0,
    COYOTE_T: 0.10, JBUF_TICKS: 16,   // 133ms（原来是 0.13s，换算成整步数）
    APEX_LO: -120, APEX_HI: 120, APEX_MUL: 0.60,
    CUT_V: 0, CUT_MUL: 0.42,
    SPD_RUN: 290, SPD_AIR: 300,
    P_JUMP_V: 815, P_DJUMP_V: 650, P_GRAV: 2000, P_MAX_FALL: 950,
    VY_CEIL: -180,
  },
};

let FEEL_NAME = 'aos';
let ACC_G, ACC_A, FRIC_G, FRIC_A, TURN_MUL, COYOTE_T, JBUF_TICKS;
let APEX_LO, APEX_HI, APEX_MUL, CUT_V, CUT_MUL, SPD_RUN, SPD_AIR, VY_CEIL;
let P_JUMP_V, P_DJUMP_V, P_GRAV, P_MAX_FALL;

function setFeel(name) {
  const key = FEELS[name] ? name : 'aos';
  const p = FEELS[key];
  FEEL_NAME = key;
  ACC_G = p.ACC_G; ACC_A = p.ACC_A; FRIC_G = p.FRIC_G; FRIC_A = p.FRIC_A;
  TURN_MUL = p.TURN_MUL; COYOTE_T = p.COYOTE_T; JBUF_TICKS = p.JBUF_TICKS;
  APEX_LO = p.APEX_LO; APEX_HI = p.APEX_HI; APEX_MUL = p.APEX_MUL;
  CUT_V = p.CUT_V; CUT_MUL = p.CUT_MUL;
  SPD_RUN = p.SPD_RUN; SPD_AIR = p.SPD_AIR; VY_CEIL = p.VY_CEIL;
  P_JUMP_V = p.P_JUMP_V; P_DJUMP_V = p.P_DJUMP_V;
  P_GRAV = p.P_GRAV; P_MAX_FALL = p.P_MAX_FALL;
}
setFeel('aos');
if (typeof location !== 'undefined' && location.search) {
  try {
    const want = new URLSearchParams(location.search).get('feel');
    if (want) setFeel(want);
  } catch (e) { /* file:// 下拿不到就用手感默认 */ }
}

/* 松手切断上升：两种机制二选一。
 * CUT_V > 0 → 绝对值切断（恶魔城：直接压到某个速度）
 * CUT_V = 0 → 乘系数（现代：留一点余味） */
function cutJump() {
  if (P.vy >= 0) return;
  if (CUT_V > 0) { if (P.vy < -CUT_V) P.vy = -CUT_V; }
  else P.vy *= CUT_MUL;
  P.cutOK = false;
}

const P_W = 28, P_H = 100, P_SPRITE_H = 128;

// ============================ 魂表 ============================
// red=主动耗蓝 / blue=持续耗蓝 / yellow=被动 / silver=能力魂（永久）
/* 主键名的**唯一来源**。SOULS 的说明文字、魂菜单的分组标题、手机端按钮
 * 全都要引用它 —— 上一版这些文案里写死了字母，键位一改文案就烂：
 * 说明书上写着「按住 K 减缓下落」，而 K 现在是跳，玩家照着按会原地起跳。
 * 文案是界面的一部分，不能靠手抄。 */
const KEY_OF = { atk:'j', jump:'k', red:'u', blue:'l', back:'i', menu:'o' };
const keyName = a => KEY_OF[a].toUpperCase();

const SOULS = {
  fire:  { type:'red',    name:'炎魔之魂', cost:12, desc:'向前掷出火球（' + keyName('red') + '）' },
  axe:   { type:'red',    name:'飞斧之魂', cost:10, desc:'回旋飞斧，可穿透（' + keyName('red') + '）' },
  glide: { type:'blue',   name:'翼魔之魂', drain:9,  desc:'按住 ' + keyName('blue') + ' 减缓下落' },
  sight: { type:'yellow', name:'识破之魂', desc:'看见可破坏的墙，普攻可击碎' },
  djump: { type:'silver', name:'双跃之魂', desc:'空中可再跳一次，打开够不到的路' },
};

// ============================ 房间 ============================
function mkRoom(id, name, w, h) {
  const g = [];
  for (let y = 0; y < h; y++) g.push(new Array(w).fill('.'));
  return { id, name, w, h, g, spawn:{x:0,y:0}, enemies:[], items:[], portals:[] };
}
function fill(r, x, y, w, h, ch) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const yy = y + j, xx = x + i;
    if (yy >= 0 && yy < r.h && xx >= 0 && xx < r.w) r.g[yy][xx] = ch;
  }
}
function put(r, x, y, ch) { if (y >= 0 && y < r.h && x >= 0 && x < r.w) r.g[y][x] = ch; }
function border(r) {
  fill(r, 0, 0, r.w, 1, '#'); fill(r, 0, r.h - 1, r.w, 1, '#');
  fill(r, 0, 0, 1, r.h, '#'); fill(r, r.w - 1, 0, 1, r.h, '#');
}
const px = t => t * TILE;

// ---- 回廊 ----
const hall = mkRoom('hall', '废墟回廊', 32, 18);
border(hall);
fill(hall, 0, 15, 32, 3, '#');             // 地面
/* 左高台 = 能力门。跳高按真实比例改成 203px（4.22 格）之后，
 * 原来的 192px 单跳就能上，门等于没了 —— 抬到 288px（6 格）：
 * 单跳 203 差 85px 上不去，二段跳 ~340 余 52px 能上。 */
fill(hall, 1, 9, 5, 1, '=');               // 左高台：离地 288px
/* 中间平台原来写在 y=11（离地 192px），和注释里的 144px 差了一格 ——
 * 满跳只有 161px，所以玩家从地面根本上不去，也就走不到密室顶、进不了塔。
 * 左高台那 192px 是故意留给双跃的，这两个不是。改到 y=12 才是 144px。 */
fill(hall, 12, 12, 4, 1, '=');             // 中间平台：离地 144px，满跳能上
fill(hall, 20, 12, 4, 1, '=');             // 同上 —— 上塔的必经跳板
/* 密室整体左移一格（x26..29），在 x30 留出一条竖直通道。
 * 原来顶盖铺到 x30（紧贴右边界），角色走到顶端就贴着墙 ——
 * 贴着墙时身体上部那一格算实心，连纵向起跳都会被它按住，人下不来。 */
fill(hall, 26, 10, 4, 1, '=');             // 密室顶（堵掉"从上面跳进去"的抄近路）
fill(hall, 26, 11, 1, 4, 'H');             // 隐藏墙：识破才看见，普攻可碎
put(hall, 2, 8, 'D');                      // 高台上的门（跟着平台抬两格）
/* 通往钟塔的门洞要开 3 格高（144px）：角色 100px 站在地面上时头顶落在格 12 里，
 * 只开 y=13,14 两格的话，头顶那一格还是墙 —— 门就在眼前但走不进去。 */
put(hall, 31, 12, '.'); put(hall, 31, 13, '.'); put(hall, 31, 14, '.');
hall.spawn = { x: px(7), y: px(15) };
hall.enemies = [
  { type:'slime', x: px(12), y: px(15), min: px(10), max: px(14), soul:'fire' },
  { type:'slime', x: px(18), y: px(15), min: px(15), max: px(21), soul:'fire' },
  { type:'slime', x: px(13), y: px(11), min: px(12), max: px(15), soul:'fire' },
];
hall.items = [
  { id:'axe', x: px(29), y: px(15), soul:'axe' },   // 藏在识破墙后面
];
hall.portals = [
  { x:31, y:13, w:1, h:2, to:'tower', spawn:'left' },
  { x:2,  y:10, w:1, h:1, to:'ending' },
];
// 展厅：被拍平的人贴在墙上，标着编号。纯装饰，不参与碰撞。
hall.portraits = [
  { tx:6.2,  ty:15, n:'07' }, { tx:8.8,  ty:15, n:'08' }, { tx:15.4, ty:15, n:'11' },
  { tx:18.6, ty:15, n:'12' }, { tx:22.4, ty:15, n:'19' }, { tx:25.2, ty:15, n:'20' },
];

// ---- 钟塔 ----
const tower = mkRoom('tower', '崩落钟塔', 32, 36);
border(tower);
fill(tower, 0, 34, 32, 2, '#');
/* 每级间隔 3 格（144px），5 格宽。
 * 错开距离从 8 格收到 7 格：8 格时相邻平台的水平间隙是 144px，
 * 而这一跳要"升 144px 的同时横跨 144px" —— 满跳 161px 的高度够，
 * 但水平只有在下落回原高度的那个瞬间才够，余量不到一帧，真人根本按不出来。
 * 收到 7 格后间隙 96px，容错回到能玩的范围。 */
[[1,31],[8,28],[15,25],[1,22],[8,19],[15,16],[8,13],[15,10,11]].forEach(p => {
  fill(tower, p[0], p[1], p[2] || 5, 1, '=');
});
/* 回廊的门洞同理：tower 地面在 y=34，角色站上去头顶在格 31.9，
 * 只开 y=33 一格的话门洞比人矮，进不来。 */
put(tower, 0, 31, '.'); put(tower, 0, 32, '.'); put(tower, 0, 33, '.');
tower.spawn = { x: px(2), y: px(34) };
tower.enemies = [
  { type:'bat', x: px(14), y: px(28), cy: px(28), amp: 90, soul:'sight' },
  { type:'bat', x: px(20), y: px(20), cy: px(20), amp: 110 },
  { type:'slime', x: px(10), y: px(28), min: px(9),  max: px(13) },
  { type:'slime', x: px(18), y: px(25), min: px(17), max: px(21) },
  { type:'boss',  x: px(22), y: px(10), soul:'djump' },
];
tower.items = [{ id:'glide', x: px(11), y: px(28), soul:'glide' }];
tower.portals = [{ x:0, y:33, w:1, h:1, to:'hall', spawn:'right' }];

const ROOMS = { hall, tower };

// ============================ 皮肤包 ============================
const PACK_ATLAS = {
  kind:'atlas', label:'名片角色（默认）',
  /* 状态名对齐源码的 step：stand / walk / jump / fall / crouch / slide / attack / cast / hurt。
   * 名片管线只有 idle/walk/attack/wave/hit 五组动画，缺的走 fallback（jump→idle 等），
   * 这是皮肤包本来的设计 —— 一张照片生成 1 帧也能玩。 */
  /* map.walk 必须指向**真实存在的动画**。上一版写 'walk'，而名片管线只导出
   * idle/wave/attack/kick/hit 五组 —— animFrames('walk') 返回空数组，drawAtlasFrame
   * 在 `!frames.length` 那里直接 return，于是**一走路整个人就消失了**。
   * 这个 bug 很阴：站着正常、跳正常、只有走的时候没有，会让人以为"走路状态坏了"。
   * 现在走 idle 帧 + 程序化步态（见 renderPlayer 的 walkPhase），缺素材也能读成"在走"。 */
  map: { stand:'idle', idle:'idle', walk:'idle', jump:'idle', fall:'idle',
         crouch:'idle', slide:'idle', attack:'attack', cast:'wave', hurt:'hit',
         dash:'idle' },
};
let atlasImg = null, atlasMan = null;

function animFrames(n) { const a = atlasMan && atlasMan.animations[n]; return a ? a.frames : []; }
function animFps(n)    { const a = atlasMan && atlasMan.animations[n]; return a ? a.fps : 6; }

function drawAtlasFrame(ctx, anim, t, feetX, feetY, height, flip, fixIdx) {
  if (!atlasImg || !atlasMan) return;
  const frames = animFrames(anim);
  if (!frames.length) return;
  let i;
  if (fixIdx != null) i = Math.min(fixIdx, frames.length - 1);
  else {
    const loop = atlasMan.animations[anim].loop;
    i = Math.floor(t * animFps(anim));
    i = loop ? i % frames.length : Math.min(i, frames.length - 1);
  }
  const fr = atlasMan.frames[frames[i]].frame;
  const k = height / fr.h;
  const pv = atlasMan.meta.pivot;
  const ax = flip ? (fr.w - pv.x) : pv.x;
  const dx = feetX - ax * k, dy = feetY - pv.y * k;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (flip) { ctx.translate(feetX, 0); ctx.scale(-1, 1); ctx.translate(-feetX, 0); }
  ctx.drawImage(atlasImg, fr.x, fr.y, fr.w, fr.h, dx, dy, fr.w * k, fr.h * k);
  ctx.restore();
}

// ---- 照片包：运行时像素化（真产品这里换成 AI 管线，接口一致） ----
const PACK_PHOTO = { kind:'dyn', label:'你拍的（本地显影）', canvas:null, w:0, h:0 };

function buildPhotoPack(file, done) {
  const img = new Image();
  img.onload = () => {
    const H = 96;
    const W = Math.max(1, Math.round(img.width * (H / img.height)));
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const c = off.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.drawImage(img, 0, 0, W, H);
    const im = c.getImageData(0, 0, W, H), d = im.data;
    const cAt = i => [d[i], d[i+1], d[i+2]];
    const cs = [cAt(0), cAt((W-1)*4), cAt((H-1)*W*4), cAt(((H-1)*W+W-1)*4)];
    const bg = [0,1,2].map(ch => Math.round(cs.reduce((s,v)=>s+v[ch],0)/4));
    let minX = W, maxX = 0, minY = H, maxY = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y*W + x) * 4;
      const dist = Math.abs(d[i]-bg[0]) + Math.abs(d[i+1]-bg[1]) + Math.abs(d[i+2]-bg[2]);
      if (dist < 60) { d[i+3] = 0; continue; }
      d[i] &= 0xE0; d[i+1] &= 0xE0; d[i+2] &= 0xE0; d[i+3] = 255;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (maxX >= minX) {
      const w2 = maxX - minX + 1, h2 = maxY - minY + 1;
      const cut = document.createElement('canvas');
      cut.width = w2; cut.height = h2;
      cut.getContext('2d').putImageData(c.getImageData(minX, minY, w2, h2), 0, 0);
      PACK_PHOTO.canvas = cut; PACK_PHOTO.w = w2; PACK_PHOTO.h = h2;
    } else {
      PACK_PHOTO.canvas = off; PACK_PHOTO.w = W; PACK_PHOTO.h = H;
    }
    done && done(true);
  };
  img.onerror = () => done && done(false);
  img.src = URL.createObjectURL(file);
}

function drawPhotoFrame(ctx, feetX, feetY, height, flip, state, t) {
  const c = PACK_PHOTO.canvas;
  if (!c) return;
  const k = height / PACK_PHOTO.h;
  let bob = 0, sq = 1;
  if (state === 'walk') { bob = -Math.abs(Math.sin(t * 10)) * 4; sq = 1 + Math.sin(t * 20) * 0.02; }
  if (state === 'attack') { bob = -3; }
  if (state === 'hurt') { bob = 2; }
  const w = PACK_PHOTO.w * k * sq, h = PACK_PHOTO.h * k / sq;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (flip) { ctx.translate(feetX, 0); ctx.scale(-1, 1); ctx.translate(-feetX, 0); }
  ctx.drawImage(c, feetX - w/2, feetY - h + bob, w, h);
  ctx.restore();
}

// ============================ 状态 ============================
let room = hall;
let camX = 0, camY = 0;

/* ---- 定步长（S1）--------------------------------------------------
 * 物理永远按 1/120 秒走一步，**和屏幕刷新率脱钩**。
 * 改之前：dt 是 RAF 的真实间隔（钳位 0.05），每帧一步半隐式欧拉。
 * 于是 30fps 的机器每步算 33ms、60fps 算 16.7ms，同一个跳跃在两台机器上
 * 落点不同（实测低帧率偏高 8.4%，而且中途卡一下会随机偏 1~3%）。
 * 手感参数是按 60fps 调的，别人拿在手里跑的是另一个游戏 —— 这才是最贵的一条。
 *
 * 现在：一帧里跑 N 个 8.33ms 的整步，剩下的零头留给渲染插值。
 * 顶点高度只取决于步数，和帧率无关。
 */
const SIM_HZ = 120, FIXED_DT = 1 / SIM_HZ;
/* 单帧最多补 12 步（=100ms）。切回标签页时 RAF 可能隔了几十秒，
 * 不设上限就是一次算几千步、卡死几秒 —— 玩家看到的是"游戏崩了"。 */
const MAX_SUBSTEPS = 12;
let acc = 0;               // 未消耗的时间
/* 上一个物理步之前的位置/镜头。渲染时在这两者之间取点，
 * 让画面永远是"连续"的，而不是每帧跳 2~4 个物理步。 */
let prevX = 0, prevY = 0, prevCamX = 0, prevCamY = 0;
function snapInterp() { prevX = P.x; prevY = P.y; prevCamX = camX; prevCamY = camY; }
let shakeT = 0, shakeAmp = 0;          // 震屏：剩余时长 + 幅度，分开存才能"大震不因为短而看不见"
let hitStop = 0;                       // 顿帧：打中的那一瞬整体停 40~60ms，是打击感的主要来源
let playerPack = PACK_ATLAS;
let ended = false, msg = '', msgT = 0, msgPrio = 0;
/* 最近几条 say()，只给测试读。存在的理由见 say() 的注释：
 * 屏幕上只有一行字，读"现在是什么"会漏掉"刚才出现过什么"。 */
const SAY_LOG = [];
let enemies = [], projectiles = [], particles = [], pickups = [];

// 浮尘：纯装饰，一直存在，跟着画面缓慢漂浮
const DUST = Array.from({ length: 36 }, () => ({
  x: Math.random() * 1400, y: Math.random() * 700,
  r: 0.8 + Math.random() * 1.6, a: 0.05 + Math.random() * 0.20,
  vy: -(3 + Math.random() * 9), vx: (Math.random() - 0.5) * 9,
}));

function shakeIt(t, amp) { shakeT = Math.max(shakeT, t); shakeAmp = Math.max(shakeAmp, amp); }

const P = {
  x:0, y:0, vx:0, vy:0, face:1, onGround:false, jumps:0,
  hp:120, hpMax:120, mp:60, mpMax:60,
  state:'stand', t:0, animT:0, invuln:0, atkCd:0, castCd:0,
  lock:0, ceilHit:false, ceilBump:false, lookUp:false, landVy:0,
  hitSet:null, atkPending:0, dead:false, deadT:0,
  coyote:0, jumpBuf:0, cutOK:false, sq:1, landT:0, stepT:0,
  /* 步态相位：按**走过的距离**累加，不按时间。站着不动时它不涨，
   * 所以"停下"就真的停下，不会在原地虚空踏步。单位=步。 */
  walkPhase:0, walkW:0,        // walkW = 步态权重（0..1），起停都平滑，避免停下的瞬间人「弹」4px
  /* 姿态目标压缩值。为什么要有它：蹲=0.66、滑铲=0.52 以前是在渲染里用
   * Math.min 硬切的，滑铲结束那帧 ↓ 还按着 → 0.52 → 1.0 → 0.66 三帧内跳两下，
   * 屏幕上就是"闪烁"。改成"状态只写目标，P.sq 每帧追过去"，压缩永远连续。 */
  poseSq:1,
  /* 穿板窗口：从单向平台按"下+攻击"掉下去之后，0.2s 内不许再把 '=' 当脚下地面，
   * 否则下一帧传感器又把人按回平台上，人卡在板里抖。 */
  dropT:0,
  /* 本段滞空的最低点（y 越小越高）。只在起跳时重置，落地后仍保留，
   * 于是"最高点 - 起跳点"就是一次跳的真实高度。 */
  airMinY: 1e9,
};

const SAVE = {
  owned: new Set(['fire']),
  equipped: { red:'fire', blue:null, yellow:null },
  flags: new Set(),
  luck: 12,
};

// ============================ 存档（S2） ============================
/* 为什么要存档：在它之前，这个「可玩构建」刷新一次就全归零 ——
 * 拿到二段跳、砍开的墙、打死过的史莱姆，全都不算数。
 * 于是评审没法说"你从钟塔顶重打一遍 Boss"，玩家也没法说"我卡在哪"。
 * 一个连重试都要从头开始的版本，测不出任何关于玩法的问题。
 *
 * 设计只有三条，多一条都是负担：
 *   1. 版本化：`v` 不符就整份作废。宁可重开，也不要读一份结构变了的旧档
 *      （半读成功的档比没档更糟：装备在、进度不在，玩家会以为是 bug）。
 *   2. 只在**事件**写：进房间、打掉敌人、捡到魂、改装备。不按时间轮询 ——
 *      localStorage 是同步 IO，每帧写会卡住渲染。
 *   3. 读档失败一律当"没有存档"。隐私模式、file://、写满配额都会抛，
 *      每种都吞掉：不能因为存不了档就进不去游戏。
 */
const SAVE_KEY = 'dvf.save';
const SAVE_VER = 1;

/* 探测一次可用性。Safari 无痕模式下 localStorage 存在但 setItem 直接抛，
 * 所以必须**真的写一次**，不能只判 typeof。 */
const STORE = (() => {
  try {
    const ls = (typeof localStorage !== 'undefined') ? localStorage : null;
    if (!ls) return null;
    ls.setItem(SAVE_KEY + '.probe', '1');
    ls.removeItem(SAVE_KEY + '.probe');
    return ls;
  } catch (e) { return null; }
})();

let savedAt = 0;          // 上次落盘的理由，仅调试用
let lastSaveReason = '';
const num = (v, lo, hi, dflt) =>
  (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : dflt;

function saveGame(reason) {
  if (!STORE) return false;
  try {
    STORE.setItem(SAVE_KEY, JSON.stringify({
      v: SAVE_VER,
      room: (room && room.id) || 'hall',
      hp: Math.round(P.hp), mp: Math.round(P.mp),
      luck: SAVE.luck,
      owned: [...SAVE.owned],
      equipped: { red:SAVE.equipped.red, blue:SAVE.equipped.blue, yellow:SAVE.equipped.yellow },
      flags: [...SAVE.flags],
      at: Date.now(),
    }));
    savedAt = 1;
    lastSaveReason = reason || '';
    return true;
  } catch (e) {
    return false;   // 配额满 / 被策略拦：玩下去比存下来重要
  }
}

/* 读档。返回 false 表示"当作新游戏"，此时 SAVE/P 保持默认值。
 * 注意：这里**不改房间**，只把状态填好并返回起始房间，由 boot 决定怎么进。 */
function loadGame() {
  if (!STORE) return null;
  let raw = null;
  try { raw = STORE.getItem(SAVE_KEY); } catch (e) { return null; }
  if (!raw) return null;

  let d = null;
  try { d = JSON.parse(raw); } catch (e) { return null; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  if (d.v !== SAVE_VER) return null;                       // 版本不符：整份作废
  if (!Array.isArray(d.owned) || !Array.isArray(d.flags) ||
      !d.equipped || typeof d.equipped !== 'object') return null;

  /* 逐项白名单：存档是**外部输入**，和玩家按键一样不可信。
   * 一个不存在的魂 id 进到 SAVE.owned 里，菜单会读 SOULS[id].name 直接崩。 */
  const owned = new Set(d.owned.filter(s => typeof s === 'string' && SOULS[s]));
  if (!owned.size) owned.add('fire');                      // 红魂是初始魂，永远在
  const eq = {};
  for (const tp of ['red', 'blue', 'yellow']) {
    const s = d.equipped[tp];
    eq[tp] = (typeof s === 'string' && owned.has(s) && SOULS[s] && SOULS[s].type === tp) ? s : null;
  }
  if (!eq.red) eq.red = [...owned].find(s => SOULS[s].type === 'red') || null;

  SAVE.owned = owned;
  SAVE.equipped = eq;
  SAVE.flags = new Set(d.flags.filter(x => typeof x === 'string' && x.length < 64));
  SAVE.luck = num(d.luck, 0, 999, 12);

  P.hp = num(d.hp, 1, P.hpMax, P.hpMax);
  P.mp = num(d.mp, 0, P.mpMax, P.mpMax);

  const rid = (typeof d.room === 'string' && ROOMS[d.room]) ? d.room : 'hall';
  return { room: rid };
}

/* 进度事件统一入口。写在一个地方，将来要做"存盘图标闪一下"只改这里。 */
function onProgress(reason) { return saveGame(reason); }

// ============================ 输入（照 sotn 的三态模型） ============================
/* 月下 RicMain 用的不是"按下/松开"两个量，是三个（pl_main.c:499-513）：
 *   padHeld    = 上一帧的状态        —— "一直按着"
 *   padPressed = 本帧的状态          —— "现在按着"
 *   padTapped  = padPressed & (padHeld ^ padPressed)  —— **本帧新按下**
 *
 * 为什么必须分开：原版判断"按住×键所以跳更高"用 padPressed，
 * 判断"这一下按了攻击"用 padTapped。混用会出两种毛病 ——
 * 按住攻击键每帧重复出招；或者按住跳键每帧被当成新按下。
 *
 * 键位也按原版：× 是跳，□ 是攻击，△ 是副武器，↑ 是"上"（抬头/进门），**不是跳**。 */

/* ---- 动作层（S3）--------------------------------------------------
 * 上层（玩法代码、触屏层、测试脚本）只说**动作**：jump / atk / left …
 * 只有这一小段知道"动作"和"物理键 / 手指"的对应关系。
 *
 * 改之前的两份真相：game.js 的 K 表说 l 是蓝魂，mobile.js 里还写着
 * bind(pbBlue, 'l') —— 键位一改，键盘对了手机错位，而且桌面上测不出来。
 * 现在 mobile.js 只会说 press('blue')，它再也不知道也不关心蓝魂在哪个键上。
 *
 * 为什么用"来源令牌"而不是布尔量：同一个动作可能有两个来源（W 和 ↑ 同时按着，
 * 或者手机上左手摇杆 + 右手按钮）。布尔量会在松开其中一个时把动作整个关掉 ——
 * 表现为"两个键都按着，走两步突然停"。
 */
const held = Object.create(null);   // 动作 -> 按住它的来源数
const taps = Object.create(null);   // 动作 -> 本步新按下（每个物理步末清空）
const src  = Object.create(null);   // 来源令牌 -> 动作

function actPress(a, token) {
  const tk = token || ('t:' + a);
  if (src[tk]) return;              // 同一来源重复按下（系统连发 keydown）不算新按下
  src[tk] = a;
  if (!held[a]) taps[a] = true;     // 0 -> 1 才算一次"这一下按了"
  held[a] = (held[a] || 0) + 1;
}
function actRelease(token) {
  const a = src[token];
  if (!a) return;
  delete src[token];
  held[a] = Math.max(0, (held[a] || 0) - 1);
}
function actReleaseAll() {
  for (const tk in src) delete src[tk];
  for (const a in held) held[a] = 0;
}
/* 只松触屏来源。开菜单时摇杆会被藏起来（hideplay），
 * 藏起来之后 pointerup 收不到 —— 手指还按着，动作会一直"按住"。
 * 但**键盘不能一起松**：桌面上按住 D 开一下魂匣再关掉，
 * 人应该继续走；把键盘来源也清掉就是"开着菜单回来，人不动了，得重新按一次"。 */
function actReleaseTouch() {
  for (const tk in src) {
    if (tk.slice(0, 2) !== 't:') continue;
    const a = src[tk];
    delete src[tk];
    held[a] = Math.max(0, (held[a] || 0) - 1);
  }
}

/* 键位表 —— 左手 WASD 管方向，右手 JKL / UIO 两排管动作。
 *
 * 为什么是这六个键（AoS 的物理键只有六个，正好对上）：
 *
 *   动作键   我们     AoS 的物理键 / 原版触发方式
 *   ────────────────────────────────────────────
 *   攻击     J        B
 *   红魂     U        上 + B        ← 原版没有独立的"魔法键"
 *   跳跃     K        A
 *   后跃     I        L（能力键）
 *   蓝魂     L        R（按住持续）
 *   菜单     O        START
 *
 * 真正决定排布的不是"手够不够得着"，是**同一个手指管一对语义**：
 *   食指  J / U = 打出去（普攻 / 魔法）
 *   中指  K / I = 位移（往前跳 / 往后跃）
 *   无名指 L / O = 状态（按住的能力 / 系统菜单）
 * 这样"上排高频、下排配对"就有了解释，而不是六个格子随便填 ——
 * 上一版 J 攻 / K 跳 / L 红 / I 蓝 的问题不是按不到，是没有任何分组逻辑，
 * 玩家记不住"蓝魂为什么在食指下排"。
 *
 * 别名只留通行习惯：方向键（←→↑↓）和空格（跳）。别名越多、冲突面越大，
 * 上一版 'k' 同时是跳和蓝魂，手机上按蓝魂会起跳，就是这么来的。 */
const K = {
  left:  ['arrowleft','a'],
  right: ['arrowright','d'],
  up:    ['arrowup','w'],            // 抬头 / 进门 / "上+B" 的组合修饰
  down:  ['arrowdown','s'],          // 蹲 / "下+A" 滑铲 / "下+B" 穿板
  atk:   [KEY_OF.atk],               // B
  jump:  [KEY_OF.jump, ' '],         // A（空格是通行别名）
  red:   [KEY_OF.red],               // 上+B（红魂）——独立键，等价于按住 W 再按 J
  blue:  [KEY_OF.blue],              // R（按住持续）
  back:  [KEY_OF.back],              // L（后跃）
};
const menuKeyOf = ['tab','o'];       // START

/* 键 -> 动作 的反查表。**这是唯一知道物理键名的地方**。
 * 键盘监听、preventDefault 白名单、手机层都不再各自维护一份。 */
const KEYMAP = Object.create(null);
for (const a in K) for (const k of K[a]) KEYMAP[k] = a;
for (const k of menuKeyOf) KEYMAP[k] = 'menu';

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  const a = KEYMAP[k];
  if (a) e.preventDefault();        // Tab 会跳焦点、空格会滚页，都得挡住
  if (a) actPress(a, k);            // 令牌 = 物理键：同一个键连发不会重复触发
});
addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (KEYMAP[k]) actRelease(k);
});

// 音效统一走这个口子：node 测试里没有 audio.js，静默降级而不是抛错
function sfx(n) {
  const a = (typeof window !== 'undefined') && window.__sfx;
  // 音频永远不许弄坏玩法：设备不支持、音频上下文被杀、iOS 静音开关 —— 都吞掉
  if (typeof a === 'function') { try { a(n); } catch (e) { /* 静默 */ } }
}
/* 语义化包装：读代码时不用记具体键 */
const padDown = (act) => (held[act] || 0) > 0;
const padTap  = (act) => !!taps[act];                        // 本步新按下
/* 每个物理步末清空 tap。等价于原版 padTapped = padPressed & (padHeld ^ padPressed)，
 * 但抗"同一步里按下又松开"—— 那种情况原版会丢，我们不该丢。 */
function latchPad() { for (const a in taps) delete taps[a]; }

/* 给触屏层用的口子：只认**动作名**，不认键名。
 * once 由物理步末清空，所以按住不会连跳 —— 和键盘行为完全一致。 */
window.__sk = {
  press(a)   { actPress(a, 't:' + a); },
  release(a) { actRelease('t:' + a); },
  releaseAll(){ actReleaseAll(); },
  setRS(v)   { RS = v; },
  setViewW(w){ VIEW_W = w; },
  /* 动作层的只读快照：手机层"按得动"的测试靠它，
   * 否则只能截图看按钮有没有高亮 —— 那是 CSS，不是输入。 */
  input() {
    const o = {};
    for (const a in held) if (held[a]) o[a] = 1;
    return o;
  },
  /* 只读快照：手感回归测试和调参用，不参与任何逻辑，也不改任何状态。
   * 为什么需要它：手感的量（加速度爬升帧数、土狼窗口、可变跳跃衰减）
   * 在假 canvas 的 vm 里测不出来 —— 那里没有真实的 RAF 和真实键盘事件。 */
  state() {
    return {
      x:P.x, y:P.y, vx:P.vx, vy:P.vy, face:P.face, onGround:P.onGround,
      jumps:P.jumps, state:P.state, coyote:P.coyote, jumpBuf:P.jumpBuf,
      hp:P.hp, mp:P.mp, dead:P.dead, sq:P.sq, room:(room && room.id) || '',
      dt:lastDt, clamped:lastDt >= 0.0499,
      /* 定步长的验收量：airMinY 是本段滞空的最低点（y 越小越高）。
       * 采样帧率会骗人（30fps 采不到顶点），这个由物理步自己记，采不到也准。 */
      airMinY:P.airMinY, stepDt:FIXED_DT, simT:P.t,
      lock:P.lock, ceilBump:P.ceilBump,
      invuln:P.invuln,
      lookUp:P.lookUp, walkPhase:P.walkPhase,
      camY:camY,
    };
  },
  /* ---- 存档相关的调试口子（S2）----
   * store() 读的是**磁盘上那份字符串**，不是内存状态 ——
   * 只回读内存等于自己跟自己握手，"存进去了吗"这个问题它答不了。 */
  save()     { return saveGame('manual'); },
  load()     { return loadGame(); },
  store()    { try { return STORE ? STORE.getItem(SAVE_KEY) : null; } catch (e) { return null; } },
  storeOK()  { return !!STORE; },
  wipe()     { try { if (STORE) STORE.removeItem(SAVE_KEY); } catch (e) {} },
  progress() {
    return {
      room:(room && room.id) || '', hp:P.hp, mp:P.mp, luck:SAVE.luck,
      owned:[...SAVE.owned].sort(),
      equipped:{ red:SAVE.equipped.red, blue:SAVE.equipped.blue, yellow:SAVE.equipped.yellow },
      flags:[...SAVE.flags].sort(),
      lastSave:lastSaveReason,
    };
  },
  /* 只读：敌人与投射物快照，给战斗回归测试用。不改任何状态。 */
  enemies() { return enemies.map(e => ({ idx:e.idx, type:e.def.type, x:e.x, y:e.y, w:e.w, h:e.h, hp:e.hp, dead:e.dead })); },
  projectiles() { return projectiles.map(p => ({ x:p.x, y:p.y, kind:p.kind, dmg:p.dmg })); },
  /* 相机是「↑ 抬头」唯一的证据：抬头不产生任何位移，只有镜头在动。
   * 没有这个口子就只能靠截图肉眼比对 —— 而截图要几百毫秒，读不出 700ms 的趋势。 */
  cam() { return { x:camX, y:camY }; },
  /* say() 是画在 canvas 上的一行字，不进 DOM —— 于是"按键有没有回声"
   * 这件事从 DOM 侧完全看不见（上一版验证脚本读 #log，读到的是初始教程，
   * 于是给了一个假阳性）。要验"按键有回应"，就必须能读到这行字本身。 */
  msg() { return { text: msg, t: msgT }; },
  /* 屏幕那一行字的**历史**。单行 HUD 上"现在是什么"会被后一条消息覆盖，
   * 于是"按了有没有回声"这个问题不能靠读当前值回答 —— 读历史才是问题本身。 */
  says() { return SAY_LOG.slice(); },
  /* 只读：特效快照。砸了半天弧线不出现，得先能看见"粒子到底有没有被 push"，
   * 否则就只能在渲染和逻辑之间瞎猜。 */
  fx() { return particles.map(p => ({ arc:!!p.arc, x:p.x, y:p.y, life:p.life, lifeMax:p.lifeMax, c:p.c, r:p.r, dir:p.dir })); },
  /** 只读：给自动化测试看某格是什么、以及某个矩形会撞上哪些格 */
  tile(tx, ty) {
    if (!room || ty < 0 || ty >= room.h || tx < 0 || tx >= room.w) return '#';
    return room.g[ty][tx];
  },
  probe(x, y, w, h) {
    const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 1) / TILE);
    const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 1) / TILE);
    const out = [];
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const ch = (ty < 0 || ty >= room.h || tx < 0 || tx >= room.w) ? '#' : room.g[ty][tx];
      if (ch !== '.') out.push({ tx, ty, ch });
    }
    return out;
  },
};

// ============================ 碰撞 ============================
/* '=' 是单向平台，'#' 和 'H' 是实心。
 * 为什么要有单向：角色高 100px，站在地面时头顶正好落在格 12 的下沿。
 * 平台放格 12 → 从侧面把地面上的角色卡死；放格 11 → 离地 192px，满跳 161 上不去。
 * 两个高度都不对 —— 这不是数字没调好，是这种地形本来就不该四面实心。
 * 单向规则：横向能穿、往上能穿，只有"从上面落下来"才站住。 */
function isSolid(ch) { return ch === '#' || ch === '=' || ch === 'H'; }

/* 单向平台唯一的正确判据：**脚从上方跨过平台顶面**。
 * 曾经用"身体是否碰到平台格"来判断，结果是：跳不到平台顶面（高度不够）时，
 * 身体横跨平台格 → 下落那一帧判成"撞进平台内部" → vy 清零 → 人永远悬在
 * 平台中间，落不下去也上不来。砸掉整条路，而且要跳到半途才发现。
 * 改判据之后，够不到就正常落回地面，够到了才站住。 */
function platformTop(b, dy) {
  const footBefore = b.y + b.h, footAfter = footBefore + dy;
  const x0 = Math.floor(b.x / TILE), x1 = Math.floor((b.x + b.w - 1) / TILE);
  for (let ty = Math.floor(footBefore / TILE); ty <= Math.floor(footAfter / TILE); ty++) {
    if (ty < 0 || ty >= room.h) continue;
    const top = ty * TILE;
    if (top < footBefore || top > footAfter) continue;   // 没真的跨过这一行顶面
    for (let tx = x0; tx <= x1; tx++) {
      if (tx >= 0 && tx < room.w && room.g[ty][tx] === '=') return top;
    }
  }
  return -1;
}

function solidBox(b) {
  const x0 = Math.floor(b.x / TILE), x1 = Math.floor((b.x + b.w - 1) / TILE);
  const y0 = Math.floor(b.y / TILE), y1 = Math.floor((b.y + b.h - 1) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (tx < 0 || ty < 0 || tx >= room.w || ty >= room.h) return true;
    const ch = room.g[ty][tx];
    if (ch === '#' || ch === 'H') return true;
  }
  return false;
}

/** 亚像素位移 + 只在真的贴上时退到 1px 步进 */
function moveBody(b, dx, dy) {
  let hitX = false, hitY = false;
  if (dx) {
    b.x += dx;
    if (solidBox(b)) {
      b.x -= dx;
      const n = Math.ceil(Math.abs(dx)), s = Math.sign(dx);
      for (let i = 0; i < n; i++) { b.x += s; if (solidBox(b)) { b.x -= s; hitX = true; break; } }
    }
  }
  if (dy) {
    if (dy > 0) {
      const top = platformTop(b, dy);
      if (top >= 0) { b.y = top - b.h; return { hitX, hitY: true }; }
    }
    b.y += dy;
    if (solidBox(b)) {
      b.y -= dy;
      const n = Math.ceil(Math.abs(dy)), s = Math.sign(dy);
      for (let i = 0; i < n; i++) { b.y += s; if (solidBox(b)) { b.y -= s; hitY = true; break; } }
    }
  }
  return { hitX, hitY };
}

function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
/** 从 (x,y) 往下找第一个实心面，返回距离（找不到就返回 999）。投影要用。 */
function groundBelow(x, y) {
  for (let d = 0; d < 420; d += 6) if (isSolid(tileAt(x, y + d))) return d;
  return 999;
}
function tileAt(x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= room.w || ty >= room.h) return '#';
  return room.g[ty][tx];
}

// ============================ 房间装载 ============================
/* 地形烘焙：整张房间的静态瓦片只画一次，之后每帧一次 drawImage。
 * 之前每帧要发几千个 fillRect（每格 4 行砖 × 3 次 fill × 噪声点），
 * 桌面看不出来，iPhone 上会掉帧 —— 这是移动端最容易被忽略的一笔账。
 * 'H' 隐藏墙不进缓存：它的外观随装备变化，而且是少数，每帧现画。 */
let tileCache = null, tileCacheKey = '';

function buildTileCache() {
  const W = px(room.w), H = px(room.h);
  const cv2 = document.createElement('canvas');
  cv2.width = W; cv2.height = H;
  const c2 = cv2.getContext('2d');
  for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
    const ch = room.g[y][x];
    if (ch !== '.' && ch !== 'H') drawTile(c2, ch, x * TILE, y * TILE);
  }
  tileCache = cv2;
  tileCacheKey = room.id;
}

function invalidateTiles() { tileCache = null; }

function loadRoom(id, spawnKey, announce) {
  room = ROOMS[id] || hall;
  invalidateTiles();
  enemies = []; projectiles = []; particles = []; pickups = [];
  room.enemies.forEach((e, i) => {
    if (SAVE.flags.has('dead_' + room.id + '_' + i)) return;
    enemies.push(makeEnemy(e, i));
  });
  room.items.forEach(it => {
    if (SAVE.flags.has('took_' + room.id + '_' + it.id)) return;
    pickups.push({ x:it.x, y:it.y, soul:it.soul, id:it.id, t:0, got:false });
  });
  if (spawnKey === 'left')       { P.x = px(2);  P.y = px(34) - P_H; }
  else if (spawnKey === 'right') { P.x = px(25); P.y = px(15) - P_H; }
  else                           { P.x = room.spawn.x; P.y = room.spawn.y - P_H; }
  P.vx = P.vy = 0; P.jumps = 0; P.state = 'stand'; P.animT = 0; P.invuln = 0.6;
  P.lock = 0; P.ceilBump = false; P.lookUp = false;
  camX = P.x + P_W/2 - VIEW_W/2;
  camY = P.y + P_H/2 - VIEW_H/2;
  clampCam();
  /* 换房间 = 瞬移。插值基点必须跟着跳，否则渲染会在"旧房间的坐标"和
   * "新房间的坐标"之间连一条线 —— 一帧横穿整张地图的残影。 */
  P.airMinY = P.y;
  snapInterp();
  if (announce) say(room.name);
  /* 换房间就是检查点。为什么存这里而不是"存盘点"：
   * 这版没有存盘房，玩家唯一的进度边界就是门。不在这里存，
   * 死了重开就得从头打 —— 那正是"没法重试 Boss"的根源。 */
  saveGame('room');
}

function clampCam() {
  const W = px(room.w), H = px(room.h);
  camX = Math.max(0, Math.min(W - VIEW_W, camX));
  camY = Math.max(0, Math.min(H - VIEW_H, camY));
  if (W < VIEW_W) camX = (W - VIEW_W) / 2;
  if (H < VIEW_H) camY = (H - VIEW_H) / 2;
}

// ============================ 敌人 ============================
function makeEnemy(def, idx) {
  const e = { def, idx, t: Math.random() * 3, hp: 40, hpMax: 40, vx:0, vy:0,
              onGround:false, dead:false, hurtT:0, dir:1, dmg:8 };
  if (def.type === 'slime') { e.w = 46; e.h = 38; e.hp = e.hpMax = 44; e.dmg = 10; }
  if (def.type === 'bat')   { e.w = 46; e.h = 32; e.hp = e.hpMax = 30; e.dmg = 12; }
  if (def.type === 'boss')  { e.w = 150; e.h = 150; e.hp = e.hpMax = 320; e.dmg = 20; }
  e.x = def.x - e.w / 2;
  e.y = def.y - e.h;
  e.spawnX = e.x; e.spawnY = e.y;
  return e;
}
const ebox = e => ({ x:e.x, y:e.y, w:e.w, h:e.h });

function updateEnemy(e, dt) {
  e.t += dt;
  if (e.hurtT > 0) e.hurtT -= dt;
  const dxp = (P.x + P_W/2) - (e.x + e.w/2);

  if (e.def.type === 'slime') {
    if (e.x < e.def.min) e.dir = 1;
    if (e.x + e.w > e.def.max) e.dir = -1;
    const r = moveBody(e, e.dir * 55 * dt, 0);
    if (r.hitX) e.dir *= -1;
    moveBody(e, 0, GRAV * 0.8 * dt);
  } else if (e.def.type === 'bat') {
    e.y = e.spawnY + Math.sin(e.t * 2.2) * (e.def.amp || 80);
    const chase = Math.abs(dxp) < 320 ? Math.sign(dxp) * 60 : 0;
    moveBody(e, (Math.sin(e.t * 1.1) * 50 + chase) * dt, 0);
  } else if (e.def.type === 'boss') {
    e.vy = Math.min(MAX_FALL, e.vy + GRAV * dt);
    const r = moveBody(e, e.vx * dt, e.vy * dt);
    if (r.hitY) { e.vy = 0; e.onGround = true; } else e.onGround = false;
    e.jumpT = (e.jumpT || 0) + dt;
    if (e.onGround && e.jumpT > 1.6) {
      e.jumpT = 0;
      e.vx = Math.sign(dxp) * 170;
      e.vy = -620;
      e.onGround = false;
      shakeIt(0.18, 5); sfx('slam');
    }
    if (e.onGround) e.vx *= 0.85;
  }

  if (overlap({ x:P.x, y:P.y, w:P_W, h:P_H }, ebox(e)) && P.invuln <= 0 && !P.dead) {
    hurtPlayer(e.dmg, e.x + e.w/2);
  }
}

// ============================ 玩家 ============================
function hurtPlayer(dmg, fromX) {
  if (P.invuln > 0 || P.dead) return;
  P.hp -= dmg;
  P.invuln = 0.9;
  P.state = 'hurt'; P.animT = 0;
  /* 月下 RicStepHit：func_8015CAAC(FIX(-1.25)) + velocityY = FIX(-3)。
   * 换算到我们的尺度：击退 1.25×3×60 = 225px/s、击飞 3×3×60 = 540px/s。
   * 上一版垂直只给了 260，被打几乎不飘 —— 那是"挨一下继续走"，不是恶魔城。 */
  const dir = Math.sign(P.x + P_W/2 - fromX) || 1;
  P.vx = dir * 225; P.vy = -540;
  P.cutOK = false;
  shakeIt(0.24, 9);
  hitStop = 0.07;
  sfx('hurt');
  if (P.hp <= 0) { P.hp = 0; P.dead = true; P.deadT = 0; sfx('death'); }
}

function startAttack() {
  if (P.atkCd > 0) return;
  P.atkCd = 0.30;
  P.state = 'attack'; P.animT = 0;
  /* 攻击锁 = 原版的 g_Player.unk46 = 2（pl_steps.c:84-87）。
   * 锁住期间 RicCheckInput 直接 return false —— 不能跳、不能转身、不能再出招，
   * 连施法都不行。这才是恶魔城的出招硬直，不是我以前那种"边打边能跑"。 */
  P.lock = ATK_DUR;
  P.hitSet = new Set();
  P.atkPending = 0.09;
  /* 挥击弧：钉在角色身前的一道白弧，0.14s 内扫过去。
   * 为什么非要它：照片管线生成的 attack 只有 4 帧、姿态差异极小（真人照片本来就动不了），
   * 只靠精灵帧的话，按 J 屏幕上几乎看不出变化 —— 玩家结论就是"攻击键没反应"。 */
  /* 中心点放在**身前**，不是身体正中：正中时半径 30~50 的弧整个落在人物轮廓里，
   * 被精灵自己的像素吃掉 —— 我第一版就是这样，逻辑在跑、屏幕上看不见。 */
  particles.push({ arc:true, noGrav:true, vx:0, vy:0,
                   x:P.x + P_W/2 + P.face*14, y:P.y + P_H*0.38, r:66, dir:P.face,
                   life:0.26, lifeMax:0.26, c:"#eaf8ff" });
  // 出拳时整体前压一小步：不是位移，是"人把重量递出去了"。
  if (P.onGround) P.vx += P.face * 110;
  sfx('swing');
}

function doAttackHit() {
  /* 判定框的**高度**必须对着角色的身体中段，不是头顶。
   * 上一版是 y+8 ~ y+52（相当于胸以上），而史莱姆站在 y+62 ~ y+100 ——
   * 两个框在垂直方向永远不重叠，所以按 J 有动画、有声音、有前压，就是打不到任何东西。
   * 角色 100px 高，手臂实际在 30%~80% 这一段。 */
  const reach = 52, hh = 56;
  const box = { x: P.face > 0 ? P.x + P_W : P.x - reach, y: P.y + 22, w: reach, h: hh };
  if (SAVE.equipped.yellow === 'sight') {
    const tx0 = Math.floor(box.x / TILE), tx1 = Math.floor((box.x + box.w) / TILE);
    const ty0 = Math.floor(box.y / TILE), ty1 = Math.floor((box.y + box.h) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (room.g[ty] && room.g[ty][tx] === 'H') {
        room.g[ty][tx] = '.';
        invalidateTiles();
        for (let i = 0; i < 16; i++) particles.push({ x:px(tx)+24, y:px(ty)+24, vx:(Math.random()-0.5)*260, vy:-Math.random()*260, life:0.6, c:'#8d7660' });
        say('墙壁碎了');
      }
    }
  }
  for (const e of enemies) {
    if (e.dead || P.hitSet.has(e.idx)) continue;
    if (overlap(box, ebox(e))) {
      P.hitSet.add(e.idx);
      damageEnemy(e, 16);
      hitStop = 0.055;
      shakeIt(0.12, 5);
      sfx('hit');
    }
  }
}

function damageEnemy(e, dmg) {
  e.hp -= dmg;
  e.hurtT = 0.14;
  particles.push({ x:e.x+e.w/2, y:e.y+e.h/2, vx:0, vy:-70, life:0.35, c:'#fff', text:'' + dmg, txt:true });
  if (e.hp > 0 || e.dead) return;
  e.dead = true;
  SAVE.flags.add('dead_' + room.id + '_' + e.idx);
  onProgress('kill');                  // 掉魂与否都要落盘：这个敌人已经没了
  for (let i = 0; i < 18; i++) particles.push({ x:e.x+e.w/2, y:e.y+e.h/2, vx:(Math.random()-0.5)*300, vy:(Math.random()-0.7)*300, life:0.55, c:'#c9b45a' });
  const s = e.def.soul;
  if (!s || SAVE.owned.has(s)) return;
  const first = !SAVE.flags.has('once_' + s);
  if (Math.random() < (first ? 1 : 0.12) + SAVE.luck * 0.002) {
    SAVE.flags.add('once_' + s);
    SAVE.owned.add(s);
    say('吸收魂：' + SOULS[s].name + '（Tab 装备）');
    const tp = SOULS[s].type;
    if (tp === 'blue' && !SAVE.equipped.blue) SAVE.equipped.blue = s;
    if (tp === 'yellow' && !SAVE.equipped.yellow) SAVE.equipped.yellow = s;
    if (tp === 'red' && !SAVE.equipped.red) SAVE.equipped.red = s;
    if (s === 'djump') addLog('双跃之魂到手 —— 回廊左侧那个高台现在能上了。');
    onProgress('soul');
  }
}

function castRed() {
  const id = SAVE.equipped.red;
  if (!id || P.castCd > 0) return;
  const s = SOULS[id];
  if (P.mp < s.cost) { say('魔力不足'); return; }
  P.mp -= s.cost; P.castCd = 0.45;
  P.state = 'cast'; P.animT = 0;
  if (id === 'fire') {
    projectiles.push({ x:P.x + P_W/2 + P.face*24, y:P.y + 34, vx:P.face*460, vy:0,
                       life:1.1, dmg:24, kind:'fire', pierce:false, hits:new Set() });
  } else {
    projectiles.push({ x:P.x + P_W/2, y:P.y + 20, vx:P.face*260, vy:-340,
                       life:1.6, dmg:20, kind:'axe', pierce:true, hits:new Set(), spin:0 });
  }
}

/* ============================ 玩家主循环（照 sotn 的 RicMain） ============================
 * 原来我把输入、物理、碰撞、动画、判定全糊在一个函数里按"我觉得顺"的顺序排。
 * 源码不是这么写的（pl_main.c:397 RicMain）：
 *
 *   1. 所有 timer 递减
 *   2. 读输入三态：padHeld(上帧) / padPressed(本帧) / padTapped(本帧新按下)
 *   3. 受伤检测 —— 在 step 分派**之前**，受伤优先级高于一切
 *   4. step 分派 → RicStepXxx()，每个函数第一件事 RicCheckInput(本状态允许的输入集)
 *   5. status 标志
 *   6. UpdateAnim（动画推进）
 *   7. 清 hitParams
 *   8. 物理位移 + 碰撞：|v|>2px/帧 时速度 /4、走 4 次碰撞、再 ×4
 *
 * 三条我以前完全搞错的：
 *   a. **重力不是独立的物理阶段**，是每个状态在 RicCheckInput 里"申请"的
 *      （FALL / JUMP / HIT 三档，值不同；JUMP 档在顶点窗口内按住跳键会掉到 1/5）
 *   b. **攻击锁**（unk46 != 0）时 RicCheckInput 直接 return false —— 连转身都不做
 *   c. 位置和碰撞在最后统一做，状态函数只改速度
 */

/* 原版 CHECK_ 标志（ric_shared.h:9-26），只保留我们真正用得到的 */
const CK = {
  FALL: 4, FACING: 8, JUMP: 0x10, CRASH: 0x40, BACK: 0x80,
  GRAV_HIT: 0x200, ATTACK: 0x1000, CROUCH: 0x2000,
  GRAV_FALL: 0x8000, GRAV_JUMP: 0x10000,
  GROUND_AFTER_HIT: 0x20000, SLIDE: 0x40000,
};

/* 重落地阈值：pl_collision.c:58 `velocityY > FIX(6.875)` → 6.875×3×60 */
const VY_HARD_LAND = 1237;
const ATK_DUR = 0.30;   // 挥完一趟（原版 brandish_whip 9 帧姿态 + 收势）

function checkFacing() {
  const l = padDown('left'), r = padDown('right');
  if (l && !r) P.face = -1;
  else if (r && !l) P.face = 1;
}

/* RicCheckInput 的等价物（pl_collision.c:4）。
 * 返回 true = 这次输入被本状态消费，调用方不要再做本状态的默认行为。
 * 顺序不能动：转身 → 重力 → 撞顶 → 攻击锁 → 动作。 */
function checkInput(checks, dt) {
  // a. 转身。攻击锁里不转（原版 pl_collision.c:9 `if (unk46 == 0)`）
  if ((checks & CK.FACING) && P.lock <= 0) checkFacing();

  // b. 重力：状态申请，不是独立阶段
  let g = 0;
  if (checks & CK.GRAV_FALL) g = P_GRAV;
  if (checks & CK.GRAV_JUMP) {
    /* 原版 pl_collision.c:17-26：窗口 **-1/8 ~ +3/8 px/帧**（非对称！）、
     * 按住跳键、且这次跳没撞过顶 → 重力 5.6/128 而不是 28/128，正好 1/5。 */
    const inApex = P.vy > APEX_LO && P.vy < APEX_HI;
    g = (inApex && padDown('jump') && !P.ceilBump) ? P_GRAV * APEX_MUL : P_GRAV;
  }
  if (checks & CK.GRAV_HIT) {
    const inApex = P.vy > APEX_LO && P.vy < APEX_HI;
    g = inApex ? P_GRAV * 0.5 : P_GRAV;
  }
  P.vy += g * dt;
  if (P.vy > P_MAX_FALL) P.vy = P_MAX_FALL;        // 原版 clamp FIX(7) = 7px/帧

  // c. 撞顶：pl_steps.c:176 velocityY = FIX(-0.25)
  if (P.ceilHit && P.vy < VY_CEIL) { P.vy = VY_CEIL; P.ceilBump = true; }

  // d. 攻击锁：屏蔽一切后续输入（含跳、攻击、蹲）
  if (P.lock > 0) return false;

  // e. 红魂（独立键 U = 原版的"上 + B"）
  if ((checks & CK.CRASH) && padTap('red')) { castRed(); return true; }

  /* f. 后跃（原版 L 键的能力，地面限定）。
   * AoS 里 L 不是"第三个攻击键"，是**能力键** —— 拿到 Grave Keeper 之后才是后跃。
   * 我们直接给，因为它解决了一个真实问题：面对敌人出招之后没法快速脱身。 */
  if ((checks & CK.BACK) && padTap('back') && P.onGround) { doBackdash(); return true; }

  // g. 滑铲（下 + 跳）—— 原版 CHECK_SLIDE
  if ((checks & CK.SLIDE) && padDown('down') && padTap('jump') && P.onGround) {
    P.state = 'slide'; P.animT = 0; P.vx = P.face * 420; P.lock = 0.28;
    sfx('swing'); return true;
  }

  // h. 跳（A）
  if ((checks & CK.JUMP) && padTap('jump')) {
    if (P.onGround || P.coyote > 0) { doJump(); return true; }
    if (SAVE.owned.has('djump') && P.jumps < 2) { doDoubleJump(); return true; }
  }

  /* i. 攻击（B）—— 原版 B 不是一个"攻击键"，是三个动作的基座：
   *      裸 B      = 普攻
   *      上 + B    = 红魂（Bullet Soul）
   *      下 + B    = 从薄地板掉下去（"下 + B 穿过薄地板"）
   * 顺序不能反：按住上时按 B 必须是魔法，不能先普攻一下再放魔法。
   * 这条在手册里写得死死的，但上一版把红魂做成了独立键，等于把
   * "方向 = 修饰"这个设计整个丢掉了 —— 玩家按上想打上方的敌人，什么都没有。 */
  if ((checks & CK.ATTACK) && padTap('atk')) {
    if (padDown('up') && SAVE.equipped.red) { castRed(); return true; }
    if (padDown('down') && P.onGround && onOneWay()) { dropThrough(); return true; }
    startAttack(); return true;
  }

  // i. 蹲（↓）
  /* "想走就别蹲"：按着方向的时候不进蹲。
   * 不加这句会出现一个很丑的循环 —— stepCrouch 见方向 → 起身 → stand 的
   * checkInput 又见 ↓ → 蹲下 → 循环，每帧 stand/crouch 交替，人原地抖，
   * 走也走不动。玩家读到的是"按↓之后有方向键就卡住了"。 */
  if ((checks & CK.CROUCH) && padDown('down') && P.onGround) {
    if (padDown('left') || padDown('right')) return false;
    P.state = 'crouch'; P.vx = 0; return true;
  }
  return false;
}

function decelX(rate, dt) {
  const f = rate * dt;
  if (Math.abs(P.vx) <= f) P.vx = 0;
  else P.vx -= Math.sign(P.vx) * f;
}

function doJump() {
  P.vy = -P_JUMP_V; P.onGround = false; P.coyote = 0; P.jumpBuf = 0;
  P.jumps = 1; P.cutOK = true; P.sq = 1.20; P.ceilBump = false;
  /* 起跳点 = 本段滞空最高点的参考零位。只在起跳时重置，
   * 落地**不清** —— 清了就只剩"最后一帧的下落位置"，量不出刚才那一跳。 */
  P.airMinY = P.y;
  sfx('jump');
}

function doDoubleJump() {
  P.vy = -P_DJUMP_V; P.jumps = 2; P.jumpBuf = 0;
  P.cutOK = true; P.sq = 1.22; P.ceilBump = false;
  P.airMinY = Math.min(P.airMinY, P.y);   // 二段跳不该把参考点抬高
  burst(P.x + P_W/2, P.y + P_H, '#9fd8ff');
  sfx('djump');
}

/* 后跃（原版 L 键的能力）。AoS 里它叫 Backstep：
 * 朝背对方向弹开约 2 格，带很短的受击无敌，动作期间不能取消 ——
 * 这才是"面对敌人出完招怎么脱身"的答案。没有它，贴身打完就只能硬吃一下。 */
const DASH_DUR = 0.20;
function doBackdash() {
  P.state = 'dash'; P.animT = 0;
  P.vx = -P.face * 560;
  P.vy = 0;
  P.lock = DASH_DUR;
  P.invuln = Math.max(P.invuln, 0.12);   // 无敌只覆盖前 60%，不是白给
  P.sq = 1.08;
  P.cutOK = false;
  for (let i = 0; i < 5; i++) {
    particles.push({ x:P.x + P_W/2 + P.face*10, y:P.y + P_H*0.7,
      vx:P.face*(40 + Math.random()*90), vy:-Math.random()*50,
      life:0.28, c:'#7d7688' });
  }
  sfx('swing');
}

/* 脚下是不是踩着单向平台（'='）。要两列以上都踩到才算 ——
 * 只踩到边缘一角就掉下去，比"按了没反应"更难受。 */
function onOneWay() {
  const fy = P.y + P_H + 2;
  let n = 0;
  for (const x of [P.x + 3, P.x + P_W/2, P.x + P_W - 3]) if (tileAt(x, fy) === '=') n++;
  return n >= 2;
}

/* 下 + 攻击 = 从薄地板掉下去（AoS 手册原文 "Drop through thin floors"）。
 * 逐像素往下找一个"脚已经离开 '=' 格、且身体没插进实心"的位置：
 * 一次跳一大步会插进下面紧贴的实心地面，或者卡在板里被传感器按回去。 */
function dropThrough() {
  let best = P.y;
  for (let i = 1; i <= TILE + 6; i++) {
    const ny = P.y + i;
    if (solidBox({ x:P.x, y:ny, w:P_W, h:P_H })) break;
    best = ny;
    if (tileAt(P.x + P_W/2, ny + P_H + 1) !== '=') break;
  }
  if (best === P.y) return;                 // 底下就是实心，掉不下去
  P.y = best; P.vy = 150; P.dropT = 0.20;
  P.onGround = false; P.state = 'fall';
  for (let i = 0; i < 5; i++) {
    particles.push({ x:P.x + P_W/2 + (Math.random()-0.5)*18, y:P.y + P_H - 2,
      vx:(Math.random()-0.5)*70, vy:-Math.random()*30, life:0.3, c:'#8d8478' });
  }
  sfx('step');
}


/* ---- 状态函数：只改速度和 step，不碰位置 ---- */

/* RicStepStand（pl_steps.c:27）：站在地上只减速，滑行就是从这里来的 */
function stepStand(dt) {
  if (checkInput(CK.FALL|CK.FACING|CK.JUMP|CK.CRASH|CK.ATTACK|CK.CROUCH|CK.SLIDE|CK.BACK, dt)) return;
  decelX(FRIC_G, dt);
  /* ↑ 在原版是 press_up（抬头看），**不是跳**。跳是 ×。
   * 抬头位在 updatePlayer 里统一算，这里只负责把"按了方向"转成走路。 */
  if (padDown('left') || padDown('right')) P.state = 'walk';
}

/* RicStepWalk（:116）：每帧先减速再重设为 1.25 —— 恒速是"每帧重设"的结果 */
function stepWalk(dt) {
  if (checkInput(CK.FALL|CK.FACING|CK.JUMP|CK.CRASH|CK.ATTACK|CK.CROUCH|CK.BACK, dt)) return;
  decelX(FRIC_G, dt);
  if (!padDown('left') && !padDown('right')) { P.state = 'stand'; return; }
  P.vx = P.face * SPD_RUN;
}

/* RicStepJump（:169） */
function stepJump(dt) {
  /* 松手切断：条件是「速度还在上升」且「没按跳键」。原版是绝对值 -1px/帧，
   * 我们按"轻点刚好上一格"定成 400（README 里写明了这是唯一主动偏离）。 */
  if (P.vy < -1 && !padDown('jump') && P.lock <= 0) {
    if (P.vy < -CUT_V) P.vy = -CUT_V;
  }
  /* JUMP 也在这里消费 —— 原版的空中跳（后空翻/二段）写在 RicStepJump 的
   * step_s == 0 分支里（pl_steps.c:198-209），由 padTapped & PAD_CROSS 触发。 */
  if (checkInput(CK.JUMP|CK.FACING|CK.ATTACK|CK.GRAV_JUMP, dt)) return;
  decelX(FRIC_A, dt);                     // 空中减速只有地面一半
  if (padDown('left') || padDown('right')) P.vx = P.face * SPD_AIR;
}

/* RicStepFall。
 * 原版这里不带 CHECK_JUMP：二段跳是 fall 自己用 `timers[PL_T_5] && padTapped & PAD_CROSS`
 * 判断的（pl_steps.c:?? 就在 RicStepFall 的 step_s == 0 分支里），
 * 我们的等价物是 djump 能力。土狼时间 / 跳跃缓冲也在这里消费 ——
 * 它们本来就是"空中按跳还有效"的设计，放在 fall 才对。 */
function stepFall(dt) {
  if (checkInput(CK.JUMP|CK.FACING|CK.ATTACK|CK.GRAV_FALL, dt)) return;
  decelX(FRIC_A, dt);
  if (padDown('left') || padDown('right')) P.vx = P.face * SPD_AIR;
}

/* 攻击：原版是独立 step + 独立实体（BP_ARM_BRANDISH_WHIP 按 {10,11,13,17,15,12,18,14,16}
 * 逐帧查 9 个姿态）。这里 P.lock 就是 unk46：锁住期间所有输入被屏蔽。 */
function stepAttack(dt) {
  decelX(FRIC_G * 2, dt);
  if (P.animT >= ATK_DUR) { P.lock = 0; P.state = P.onGround ? 'stand' : 'fall'; }
}

function stepCast(dt) {
  decelX(FRIC_G * 2, dt);
  if (P.animT >= 0.38) P.state = P.onGround ? 'stand' : 'fall';
}

/* RicStepHit（:496）：24 帧硬直（0x18），硬直里不能操作 */
function stepHit(dt) {
  checkInput(CK.GRAV_HIT|CK.GROUND_AFTER_HIT, dt);
  decelX(FRIC_A * 0.5, dt);
  if (P.animT >= 0.40) P.state = P.onGround ? 'stand' : 'fall';
}

/* RicStepCrouch：原版的输入集是 CHECK_FALL | CHECK_FACING | CHECK_ATTACK | CHECK_SLIDE，
 * **不含 JUMP/CROUCH**；蹲跳和滑铲在函数体里单独判（蹲+跳 = 滑铲，这是原版行为）。 */
function stepCrouch(dt) {
  if (checkInput(CK.FALL|CK.FACING|CK.ATTACK|CK.SLIDE|CK.CRASH|CK.BACK, dt)) return;
  if (padTap('jump')) { doJump(); return; }        // 蹲跳 RicSetJump(1)
  if (padTap('red')) { castRed(); return; }
  decelX(FRIC_G, dt);
  P.vx = 0;
  /* 蹲着按左右 = 起身。原版蹲下确实不能走，但键盘上"按了方向一动不动"读起来
   * 就是**游戏卡住了**（白哥的原话）。起身比禁止更顺手，也不给任何额外能力 ——
   * 我们没有"蹲行"。 */
  if (padDown('left') || padDown('right')) { P.state = 'stand'; return; }
  if (!padDown('down')) P.state = 'stand';
}

function stepSlide(dt) {
  decelX(900, dt);
  if (P.animT >= 0.28) {
    P.lock = 0;
    /* 滑铲收势必须一步落到"下一帧本来就该在的状态"。
     * 上一版是统一回 stand，然后下一帧 checkInput 又因为 ↓ 还按着转成 crouch ——
     * 中间那 1 帧 stand 让压缩从 0.52 弹回 1.0，屏幕上就是"下+空格 = 闪烁"。
     * 状态机不该有这种"过路状态"。 */
    if (!P.onGround) P.state = 'fall';
    else P.state = padDown('down') ? 'crouch' : 'stand';
  }
}

/* 后跃：只有速度，没有输入。原版 Backstep 中途不能转向、不能取消。 */
function stepDash(dt) {
  /* 重力还是要有：从平台边缘往后跃出去，不加这句会悬空 0.2 秒，
   * 读起来像"人挂在半空"，比不后退更怪。 */
  P.vy = Math.min(P_MAX_FALL, P.vy + P_GRAV * dt);
  decelX(1600, dt);
  if (P.animT >= DASH_DUR) {
    P.lock = 0;
    P.state = P.onGround ? 'stand' : 'fall';
  }
}

/* 地面传感器。原版是靠碰撞传感器的结果位 g_Player.vram_flag & TOUCHING_GROUND，
 * 不是"这一帧的位移有没有被挡住" —— 后者在 dy=0（站着、速度刚好为 0）时会误判成
 * "脚下是空的"，人就会莫名其妙掉进 fall 状态。
 * 单向平台只在往下走（或静止）时算地面：从下方穿上去不算。
 * dropT > 0 是"刚按 ↓+攻击 主动跳下去"的窗口，这段时间里 '=' 不算地面。 */
function touchingGround() {
  const fy = P.y + P_H + 1;
  const xs = [P.x + 3, P.x + P_W / 2, P.x + P_W - 3];
  for (const x of xs) {
    const ch = tileAt(x, fy);
    if (ch === '#' || ch === 'H') return true;
    if (ch === '=' && P.vy >= 0 && P.dropT <= 0) return true;
  }
  return false;
}

/* ---- 统一物理（pl_main.c:785-816）：分 4 子步，防高速穿墙 ---- */
function physics(dt) {
  const prevVy = P.vy, wasGround = P.onGround;
  const body = { x:P.x, y:P.y, w:P_W, h:P_H };

  /* 原版：|v| > FIX(2)=2px/帧（=360px/s）时 v>>=2、走 4 次 CheckStageCollision、v*=4。
   * 一次走完会穿过 1 格厚的墙 —— 这是 60fps 下最高 7px/帧的速度决定的老问题。 */
  const fast = Math.abs(P.vx) > 360 || Math.abs(P.vy) > 360;
  const n = fast ? 4 : 1;
  let hitX = false, hitY = false, vyRun = true;
  for (let i = 0; i < n; i++) {
    /* 落地之后剩下的子步**只走横向**，不能 break ——
     * break 会把剩余 3/4 的 dx 一起丢掉。后跃在平地上每帧都"落地"，
     * 于是 560px/s 的后跃只走出 56px（应该是 80+）。这个 bug 只在
     * "有纵向速度 + 4 子步"时出现，站着走永远碰不到。 */
    const r = moveBody(body, P.vx * dt / n, vyRun ? P.vy * dt / n : 0);
    if (r.hitX) { hitX = true; P.vx = 0; }
    if (r.hitY) { hitY = true; vyRun = false; }
  }
  P.x = body.x; P.y = body.y;
  /* 滞空最高点。只给调试和回归测试读（定步长的验收标准就是"不同帧率下
   * 顶点一致"），不参与任何玩法判定 —— 采样帧率会骗人，这个不会。 */
  if (P.y < P.airMinY) P.airMinY = P.y;

  P.ceilHit = false;
  if (hitY) {
    if (prevVy > 0) {
      // 下落撞到东西 = 落地
      P.onGround = true; P.jumps = 0; P.coyote = COYOTE_T; P.landVy = prevVy;
    } else if (prevVy < 0) {
      // 上升撞到东西 = 撞顶（原版 unk44 |= 0x20，之后顶点加速失效）
      P.ceilHit = true;
      if (P.vy > VY_CEIL) P.vy = VY_CEIL;
    } else {
      P.onGround = true; P.jumps = 0; P.coyote = COYOTE_T;
    }
    P.vy = 0;
  } else {
    /* 没有竖直碰撞不代表脚下是空的 —— 站着时 dy 就是 0。
     * 这里用传感器补一次，等价于原版的 TOUCHING_GROUND 位。 */
    P.onGround = touchingGround();
    if (P.onGround) { P.jumps = 0; P.coyote = COYOTE_T; }
  }

  // 落地：压扁 + 尘土 + 音效。重落地（>6.875px/帧）额外震一下
  if (!wasGround && P.onGround && prevVy > 120) {
    const k = Math.min(1, prevVy / (VY_HARD_LAND * 1.2));
    const hard = prevVy > VY_HARD_LAND;
    P.sq = 1 - (hard ? 0.30 : 0.16) * k;
    P.landT = 0.14;
    for (let i = 0; i < Math.round((hard ? 8 : 3) + k * 7); i++) {
      particles.push({ x:P.x + P_W/2 + (Math.random()-0.5)*22, y:P.y + P_H - 2,
        vx:(Math.random()-0.5)*(60 + k*160), vy:-Math.random()*40, life:0.34, c:'#6b6478' });
    }
    sfx('land');
    if (hard) shakeIt(0.10, 3);
  }
  if (hitX) P.vx = 0;

  /* 跳跃缓冲：落地这一帧如果还记着"刚按过跳"，立刻起跳。
   * 原版 AoS 没有这个（JBUF_T 按帧算，等于 0）；我们给 3 个物理步 = 25ms，
   * 是主动加的宽容 —— 手机上一帧按早了就白按。窗口固定，不随帧率变。 */
  if (!wasGround && P.onGround && P.jumpBuf > 0 && P.lock <= 0) {
    P.jumpBuf = 0; doJump();
  }
}

function updatePlayer(dt) {
  if (P.dead) {
    P.deadT += dt;
    P.vy = Math.min(P_MAX_FALL, P.vy + P_GRAV * dt);
    P.y += P.vy * dt;
    if (P.deadT > 1.3) respawn();
    return;
  }

  // 1. 所有计时器递减（原版 RicMain 开头就是这个 for 循环）
  P.t += dt; P.animT += dt;
  if (P.invuln > 0) P.invuln -= dt;
  if (P.atkCd > 0) P.atkCd -= dt;
  if (P.castCd > 0) P.castCd -= dt;
  if (P.lock > 0) P.lock -= dt;
  if (P.coyote > 0) P.coyote -= dt;
  if (P.jumpBuf > 0) P.jumpBuf -= dt;
  if (P.dropT > 0) P.dropT -= dt;
  if (P.atkPending > 0) { P.atkPending -= dt; if (P.atkPending <= 0) doAttackHit(); }

  // 2. 蓝魂滑翔（持续消耗，别的状态里回蓝）
  const gliding = SAVE.equipped.blue === 'glide' && padDown('blue') && P.mp > 0 && P.vy > 60;
  if (gliding) P.mp = Math.max(0, P.mp - SOULS.glide.drain * dt);
  else if (P.state !== 'attack' && P.state !== 'cast') P.mp = Math.min(P.mpMax, P.mp + 7 * dt);
  /* 按键必须有回声。蓝魂是"按住持续"的能力：没装备时按下去屏幕上什么都不会发生，
   * 玩家只能得出"这个键坏了"的结论。一句提示的成本是 0，省掉一轮排查。 */
  if (padTap('blue')) {
    if (!SAVE.equipped.blue) say('没有装备蓝魂（Tab 打开魂菜单）');
    else if (P.mp <= 0) say('魔力不足');
  }

  /* ↑ 抬头只在"站着"有意义（原版 press_up 是站立/走路的姿态切换，不是动作）。
   * 集中在这里判，而不是塞进每个 step —— 上一版只在 stepStand 里写，
   * 于是"走路时按 ↑"用的是上一帧的残留值，而"蹲下时按 ↑"会把抬头的姿态带一帧。
   * 统一条件：地上、没锁、不是蹲/滑。 */
  P.lookUp = P.onGround && P.lock <= 0 && padDown('up')
             && P.state !== 'crouch' && P.state !== 'slide';

  // 3. 状态分派 —— 状态函数只改速度，位置统一在 physics 里走
  P.ceilHit = false;
  switch (P.state) {
    case 'stand':  stepStand(dt);  break;
    case 'walk':   stepWalk(dt);   break;
    case 'jump':   stepJump(dt);   break;
    case 'fall':   stepFall(dt);   break;
    case 'attack': stepAttack(dt); break;
    case 'cast':   stepCast(dt);   break;
    case 'hurt':   stepHit(dt);    break;
    case 'crouch': stepCrouch(dt); break;
    case 'slide':  stepSlide(dt);  break;
    case 'dash':   stepDash(dt);   break;
    default:       stepFall(dt);   break;
  }

  // 4. 跳跃缓冲 / 土狼时间（modern 才有）
  /* 跳跃缓冲按**整步数**记，不按秒记：
   * 以前这里是 dt * 1.5 —— dt 一换（S1 从 16.7ms 变成 8.33ms）缓冲就自己减半，
   * 这不是谁调的手感，是单位的锅。3 步 = 25ms，和 60fps 时 dt*1.5 等价。 */
  if (padTap('jump')) P.jumpBuf = JBUF_TICKS * FIXED_DT;

  // 5. 滑翔限制下落
  if (gliding) {
    P.vy = Math.min(P.vy, 140);
    if (Math.random() < dt * 24) particles.push({ x:P.x+P_W/2+(Math.random()-0.5)*22, y:P.y+P_H, vx:0, vy:50, life:0.3, c:'#8fd0ff' });
  }

  // 6. 物理：位置 + 碰撞（统一做，状态函数碰不到 x/y）
  physics(dt);

  // 7. 落地后把跳跃状态收回来
  if (!P.onGround && (P.state === 'stand' || P.state === 'walk' || P.state === 'crouch')) {
    P.state = P.vy < 0 ? 'jump' : 'fall';
    P.lookUp = false;
  }
  if (P.onGround && (P.state === 'jump' || P.state === 'fall')) {
    P.state = Math.abs(P.vx) > 10 ? 'walk' : 'stand';
  }

  // 8. 姿态压缩 + 步态 + 脚步声
  if (P.landT > 0) P.landT -= dt;
  /* 压缩值由**状态写目标**，P.sq 每帧追过去。这样蹲/滑铲/起跳拉伸共用一条曲线，
   * 任何切换都是连续的 —— 硬切就是"闪烁"的来源。 */
  P.poseSq = P.state === 'crouch' ? 0.66 : P.state === 'slide' ? 0.52 : 1;
  P.sq += (P.poseSq - P.sq) * Math.min(1, dt * 22);

  /* 步态相位按**走过的距离**推进，不按时间：走得快步频就高，停下相位就不动。
   * 31px = 半步。225px/s 下约 3.6 步/秒，正好是快走的节奏。
   * 它驱动 walk 的程序化躯干起伏/左右摆（素材里没有 walk 帧，见 PACK_ATLAS.map）。 */
  const moveDx = Math.abs(P.vx) * dt;
  if (P.onGround && moveDx > 0.05) P.walkPhase += moveDx / 31;
  /* 步态权重：走起来才涨到 1，停下平滑回 0。
   * 不加它的话，停在 sin 峰值那一刻会保持 -4px 的抬升，人物像被提着；
   * 停下瞬间直接归零又会弹一下 —— 两头都得平滑。 */
  P.walkW += ((P.state === 'walk' ? 1 : 0) - P.walkW) * Math.min(1, dt * 18);

  if (P.onGround && Math.abs(P.vx) > 60) {
    P.stepT += moveDx;
    if (P.stepT > 62) {
      P.stepT = 0; sfx('step');
      /* 一脚 = 两粒土。这是"我真的在走"最便宜的证明，比任何 UI 都直观。 */
      for (let i = 0; i < 2; i++) {
        particles.push({ x:P.x + P_W/2 - P.face*10 + (Math.random()-0.5)*14, y:P.y + P_H - 2,
                         vx:-P.face*(20+Math.random()*40), vy:-(10+Math.random()*30),
                         life:0.26, c:'#8d8578' });
      }
    }
  } else P.stepT = 40;

  // 9. 拾取
  for (const it of pickups) {
    if (it.got) continue;
    const d = Math.hypot(it.x - (P.x + P_W/2), (it.y - 26) - (P.y + P_H/2));
    if (d > 52) continue;
    it.got = true;
    SAVE.owned.add(it.soul);
    SAVE.flags.add('took_' + room.id + '_' + it.id);
    const tp = SOULS[it.soul].type;
    if (tp === 'blue' && !SAVE.equipped.blue) SAVE.equipped.blue = it.soul;
    if (tp === 'yellow' && !SAVE.equipped.yellow) SAVE.equipped.yellow = it.soul;
    say('获得魂：' + SOULS[it.soul].name + '（Tab 装备）');
    sfx('pickup');
    onProgress('pickup');
  }

  // 10. 传送门
  const pcx = Math.floor((P.x + P_W/2) / TILE), pcy = Math.floor((P.y + P_H - 6) / TILE);
  for (const pt of room.portals) {
    if (pcx >= pt.x && pcx < pt.x + pt.w && pcy >= pt.y && pcy < pt.y + pt.h) {
      if (pt.to === 'ending') { ended = true; return; }
      sfx('portal');
      loadRoom(pt.to, pt.spawn, true);
      return;
    }
  }
}

function respawn() {
  P.dead = false; P.deadT = 0; P.hp = P.hpMax; P.mp = P.mpMax;
  loadRoom(room.id, room.id === 'hall' ? null : 'left', false);
  P.invuln = 1.4;
}

function burst(x, y, c) {
  for (let i = 0; i < 10; i++) particles.push({ x, y, vx:(Math.random()-0.5)*180, vy:(Math.random()-0.5)*180, life:0.3, c });
}

function updateProjectiles(dt) {
  for (const p of projectiles) {
    p.life -= dt;
    if (p.kind === 'axe') { p.vy += 950 * dt; p.spin += dt * 12; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    const t = tileAt(p.x, p.y);
    if (t === '#' || t === '=' || t === 'H') p.life = 0;
    for (const e of enemies) {
      if (e.dead || p.hits.has(e.idx)) continue;
      if (!overlap({ x:p.x-9, y:p.y-9, w:18, h:18 }, ebox(e))) continue;
      p.hits.add(e.idx);
      damageEnemy(e, p.dmg);
      if (!p.pierce) p.life = 0;
    }
  }
  projectiles = projectiles.filter(p => p.life > 0);
}

// ============================ 程序化怪物（默认怪物包） ============================
/* 敌人不是"怪物"，是被拍坏的照片。
 * 所以它们的材质是纸：折痕、撕口、油墨点。
 * 绿史莱姆虽然好读，但在一个"纸的世界"里它不属于这里 —— 换成纸团之后，
 * 它们和墙上的展品是同一个来源，画面才是一体的。
 */
function crinkle(ctx, cx, cy, rx, ry, seed, n) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    const k = 0.90 + hash2(seed, i, 3) * 0.16;
    const x = cx + Math.cos(a) * rx * k, y = cy + Math.sin(a) * ry * k;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawSlime(ctx, e) {
  const sq = 1 + Math.sin(e.t * 6) * 0.09;
  const w = e.w * sq, h = e.h / sq;
  const cx = e.x + e.w / 2, by = e.y + e.h;
  const cy = by - h / 2;
  const flash = e.hurtT > 0;

  // 落地投影
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(cx, by, w * 0.46, 5, 0, 0, Math.PI * 2); ctx.fill();

  // 纸体
  const g = ctx.createLinearGradient(cx, by - h, cx, by);
  if (flash) { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#ffffff'); }
  else { g.addColorStop(0, '#cfc3a6'); g.addColorStop(0.55, '#b0a487'); g.addColorStop(1, '#7d745d'); }
  ctx.fillStyle = g;
  crinkle(ctx, cx, cy, w / 2, h / 2, e.idx, 7);
  ctx.fill();
  // 右下体积阴影（否则是一个平色块）
  if (!flash) {
    const sg = ctx.createRadialGradient(cx + w*0.16, by - h*0.30, 2, cx + w*0.16, by - h*0.30, w*0.55);
    sg.addColorStop(0, 'rgba(50,42,30,.42)'); sg.addColorStop(1, 'rgba(50,42,30,0)');
    ctx.fillStyle = sg;
    crinkle(ctx, cx, cy, w / 2, h / 2, e.idx, 7);
    ctx.fill();
  }
  // 撕口：右上角被咬掉一块 —— 这是"它会咬人"的唯一视觉证据
  ctx.fillStyle = flash ? '#fff' : 'rgba(18,14,10,.72)';
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.16, by - h * 0.90);
  ctx.lineTo(cx + w * 0.46, by - h * 0.62);
  ctx.lineTo(cx + w * 0.20, by - h * 0.50);
  ctx.closePath(); ctx.fill();

  // 折痕：两道，一深一浅
  ctx.strokeStyle = flash ? '#eee' : 'rgba(90,78,56,.42)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.30, by - h * 0.78);
  ctx.lineTo(cx - w * 0.06, by - h * 0.42);
  ctx.lineTo(cx - w * 0.22, by - h * 0.06);
  ctx.moveTo(cx + w * 0.34, by - h * 0.70);
  ctx.lineTo(cx + w * 0.10, by - h * 0.34);
  ctx.stroke();
  // 高光
  ctx.fillStyle = flash ? 'rgba(255,255,255,.9)' : 'rgba(255,252,240,.42)';
  ctx.beginPath(); ctx.ellipse(cx - w * 0.18, by - h * 0.70, w * 0.16, h * 0.10, -0.5, 0, Math.PI * 2); ctx.fill();

  // 油墨眼：照片上被戳的两个洞
  const ey = by - h * 0.48;
  // 内倾的眉：让两个洞读成"在看人"，而不是"两个孔"
  ctx.strokeStyle = 'rgba(25,18,12,.85)'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.26, ey - 9); ctx.lineTo(cx - w * 0.09, ey - 3);
  ctx.moveTo(cx + w * 0.26, ey - 9); ctx.lineTo(cx + w * 0.09, ey - 3);
  ctx.stroke();
  ctx.fillStyle = '#1a1410';
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.15, ey, 3.2, 4.4, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + w * 0.15, ey, 3.2, 4.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.fillRect(cx - w * 0.20 - 1, ey - 2, 2, 2);
  ctx.fillRect(cx + w * 0.20 - 1, ey - 2, 2, 2);
}

function drawBat(ctx, e) {
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  const flap = Math.sin(e.t * 14);
  const flash = e.hurtT > 0;
  ctx.save();
  // 两片翅 = 两张被风吹起来的照片残片
  ctx.fillStyle = flash ? '#fff' : '#c9c2d8';
  // 翅缘的暗边：没有它，薄薄一片读不出厚度
  ctx.strokeStyle = flash ? '#fff' : 'rgba(70,60,92,.5)';
  ctx.lineWidth = 1.2;
  for (const s of [-1, 1]) {
    const tipY = cy - 15 - flap * 9;
    ctx.beginPath();
    ctx.moveTo(cx + s * 4, cy - 2);
    ctx.lineTo(cx + s * (24 + flap * 6), tipY);
    // 后缘三个缺口：纸被撕过，不是一片光滑的翅膀
    ctx.lineTo(cx + s * (36 + flap * 4), cy + 1 - flap * 4);
    ctx.lineTo(cx + s * (30 + flap * 3), cy + 4 - flap * 3);
    ctx.lineTo(cx + s * (33 + flap * 2), cy + 9 - flap * 2);
    ctx.lineTo(cx + s * (22 + flap * 2), cy + 7);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = flash ? '#ddd' : 'rgba(90,78,110,.45)';
  for (const s of [-1, 1]) {
    ctx.fillRect(cx + s * 14, cy - 6 - flap * 4, 12, 1);
  }
  // 身体 = 一条纸
  ctx.fillStyle = flash ? '#fff' : '#8d84a4';
  ctx.beginPath(); ctx.ellipse(cx, cy, 11, 10, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = flash ? '#fff' : 'rgba(255,255,255,.28)';
  ctx.beginPath(); ctx.ellipse(cx - 3, cy - 4, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
  // 两点朱砂：这个世界里唯一的红
  ctx.fillStyle = '#c8484a';
  ctx.fillRect(cx - 7, cy - 3, 4, 4);
  ctx.fillRect(cx + 3, cy - 3, 4, 4);
  ctx.restore();
}
function drawBoss(ctx, e) {
  const sq = 1 + Math.sin(e.t * 3) * 0.05;
  const w = e.w * sq, h = e.h / sq;
  const cx = e.x + e.w/2, by = e.y + e.h;
  ctx.save();
  const g = ctx.createLinearGradient(cx, by - h, cx, by);
  g.addColorStop(0, e.hurtT > 0 ? '#fff' : '#a8553f');
  g.addColorStop(1, e.hurtT > 0 ? '#fff' : '#5c2a20');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(cx, by - h/2, w/2, h/2, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#2b1a14';
  ctx.beginPath();
  ctx.moveTo(cx - w*0.34, by - h*0.86); ctx.lineTo(cx - w*0.46, by - h*1.06); ctx.lineTo(cx - w*0.22, by - h*0.90); ctx.closePath();
  ctx.moveTo(cx + w*0.34, by - h*0.86); ctx.lineTo(cx + w*0.46, by - h*1.06); ctx.lineTo(cx + w*0.22, by - h*0.90); ctx.closePath();
  ctx.fill();
  // 怒眉
  ctx.fillStyle = '#2b1a14';
  ctx.beginPath();
  ctx.moveTo(cx - w*0.30, by - h*0.72); ctx.lineTo(cx - w*0.10, by - h*0.64); ctx.lineTo(cx - w*0.30, by - h*0.62); ctx.closePath();
  ctx.moveTo(cx + w*0.30, by - h*0.72); ctx.lineTo(cx + w*0.10, by - h*0.64); ctx.lineTo(cx + w*0.30, by - h*0.62); ctx.closePath();
  ctx.fill();
  // 眼
  ctx.fillStyle = '#ffe36a';
  ctx.beginPath();
  ctx.ellipse(cx - w*0.20, by - h*0.54, 13, 8, 0, 0, Math.PI*2);
  ctx.ellipse(cx + w*0.20, by - h*0.54, 13, 8, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#1a0d08';
  const look = Math.sign(P.x - e.x) * 3;
  ctx.beginPath();
  ctx.ellipse(cx - w*0.20 + look, by - h*0.54, 4, 7, 0, 0, Math.PI*2);
  ctx.ellipse(cx + w*0.20 + look, by - h*0.54, 4, 7, 0, 0, Math.PI*2);
  ctx.fill();
  // 锯齿嘴
  ctx.fillStyle = '#1a0d08';
  ctx.beginPath();
  const mw = w * 0.17, my = by - h*0.30;
  ctx.moveTo(cx - mw, my);
  for (let i = 0; i < 5; i++) {
    const x1 = cx - mw + (i*2+1) * (mw*2/10), x2 = cx - mw + (i*2+2) * (mw*2/10);
    ctx.lineTo(x1, my + (i % 2 ? 10 : -4));
    ctx.lineTo(x2, my + (i % 2 ? -4 : 10));
  }
  ctx.lineTo(cx + mw, my - 6);
  ctx.lineTo(cx + mw, my + 14);
  ctx.lineTo(cx - mw, my + 14);
  ctx.closePath();
  ctx.fill();
  // 身上的暗斑
  ctx.fillStyle = 'rgba(30,12,8,.35)';
  ctx.beginPath(); ctx.ellipse(cx - w*0.30, by - h*0.18, w*0.08, h*0.05, 0, 0, Math.PI*2);
  ctx.ellipse(cx + w*0.26, by - h*0.14, w*0.06, h*0.04, 0, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

// 被拍平的人：贴在墙上的"展品"。只剩正面，从侧面看是一条线。
// 它必须读成"一张照片"，不是"一个图标" —— 区别全在相纸的暖色、玻璃反光和内阴影上。
function drawWallMan(ctx, x, footY, num) {
  const h = 94, w = 36, top = footY - h;
  const cx = x + w / 2;

  // 墙上的投影
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.fillRect(x - 6, top - 6, w + 16, h + 14);

  // 外框（木）+ 内侧一圈亮边（金）
  ctx.fillStyle = '#3b2b1e';
  ctx.fillRect(x - 9, top - 13, w + 18, h + 22);
  ctx.fillStyle = '#5a4128';
  ctx.fillRect(x - 9, top - 13, w + 18, 2);
  ctx.fillRect(x - 9, top + h + 7, w + 18, 2);
  ctx.fillStyle = '#8a6a3a';
  ctx.fillRect(x - 6, top - 10, w + 12, 1);

  // 相纸：暖调，不是紫色
  const g = ctx.createLinearGradient(0, top - 8, 0, top + h + 4);
  g.addColorStop(0, '#6d5c48'); g.addColorStop(0.5, '#584838'); g.addColorStop(1, '#332a20');
  ctx.fillStyle = g; ctx.fillRect(x - 5, top - 9, w + 10, h + 14);

  // 被拍下来的人：几乎全黑，只有一侧有轮廓光
  const sil = '#171219';
  ctx.fillStyle = sil;
  ctx.beginPath(); ctx.ellipse(cx, top + 13, 11, 13, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 16, top + 35);
  ctx.lineTo(cx + 16, top + 35);
  ctx.lineTo(cx + 13, top + h - 15);
  ctx.lineTo(cx - 13, top + h - 15);
  ctx.closePath(); ctx.fill();
  ctx.fillRect(cx - 12, top + h - 15, 9, 15);
  ctx.fillRect(cx + 3,  top + h - 15, 9, 15);
  ctx.fillRect(cx + 13, top + 39, 6, 24);          // 垂下的手
  // 轮廓光：照片里也有主光方向，全平就没有"曝光"感
  ctx.strokeStyle = 'rgba(226,204,168,.28)'; ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(cx, top + 13, 11, 13, 0, Math.PI * 1.05, Math.PI * 1.75); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 16, top + 35); ctx.lineTo(cx - 13, top + h - 15);
  ctx.stroke();

  // 玻璃反光：一条斜的亮带，照片之所以是"照片"就靠这个
  ctx.save();
  ctx.beginPath(); ctx.rect(x - 5, top - 9, w + 10, h + 14); ctx.clip();
  const rg = ctx.createLinearGradient(x - 5, top, x + w + 5, top + h);
  rg.addColorStop(0, 'rgba(255,250,235,0)');
  rg.addColorStop(0.42, 'rgba(255,250,235,.11)');
  rg.addColorStop(0.5, 'rgba(255,250,235,.16)');
  rg.addColorStop(0.58, 'rgba(255,250,235,0)');
  ctx.fillStyle = rg; ctx.fillRect(x - 5, top - 9, w + 10, h + 14);
  // 内阴影：照片边缘一定比中心暗
  const ig = ctx.createLinearGradient(0, top - 9, 0, top + h + 5);
  ig.addColorStop(0, 'rgba(0,0,0,.35)'); ig.addColorStop(0.25, 'rgba(0,0,0,0)');
  ig.addColorStop(0.78, 'rgba(0,0,0,0)'); ig.addColorStop(1, 'rgba(0,0,0,.42)');
  ctx.fillStyle = ig; ctx.fillRect(x - 5, top - 9, w + 10, h + 14);
  ctx.restore();

  // 铭牌（黄铜）
  ctx.fillStyle = '#2a2218'; ctx.fillRect(x - 1, footY - 15, w + 2, 11);
  ctx.fillStyle = '#7d6335'; ctx.fillRect(x - 1, footY - 15, w + 2, 1);
  ctx.fillStyle = '#c8b184';
  ctx.font = '8px ui-monospace, monospace';
  ctx.fillText('No.' + num, x + 2, footY - 6);
}

function hash2(x, y, s) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2246822519);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
const STONE = ['#1f1a28', '#221d2c', '#1c1725', '#252030'];
const BRICK_H = 8, BRICK_W = 16;

function drawStone(ctx, x, y, tx, ty) {
  const upOpen = !isSolid(tileAt(x + TILE * 0.5, y - 4));
  const dnOpen = !isSolid(tileAt(x + TILE * 0.5, y + TILE + 4));
  const lfOpen = !isSolid(tileAt(x - 4, y + TILE * 0.5));
  const rtOpen = !isSolid(tileAt(x + TILE + 4, y + TILE * 0.5));

  ctx.fillStyle = '#0d0b12';
  ctx.fillRect(x, y, TILE, TILE);

  // 错行砖
  for (let r = 0; r < TILE / BRICK_H; r++) {
    const off = (r % 2) * (BRICK_W / 2);
    for (let bx = -BRICK_W; bx < TILE + BRICK_W; bx += BRICK_W) {
      const px0 = x + bx + off;
      const hx = Math.round((px0 - x) / BRICK_W), hy = r;
      const seed = Math.floor(x / TILE) * 31 + Math.floor(y / TILE);
      const rv = hash2(hx, hy, seed);
      const c = STONE[Math.floor(rv * STONE.length)];
      ctx.fillStyle = c;
      ctx.fillRect(px0 + 1, y + r * BRICK_H + 1, BRICK_W - 2, BRICK_H - 2);
      // 每块砖顶上一条 1px 微光 —— 石头靠这个比靠贴图更容易读出来
      ctx.fillStyle = rv > 0.72 ? 'rgba(206,192,240,.10)' : 'rgba(206,192,240,.05)';
      ctx.fillRect(px0 + 1, y + r * BRICK_H + 1, BRICK_W - 2, 1);
      // 少量砖缺角/发霉，打破规则网格
      if (rv < 0.05) { ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(px0 + 3, y + r * BRICK_H + 3, 4, 3); }
    }
  }

  // 颗粒：每格 5 点，位置由哈希定死
  for (let i = 0; i < 5; i++) {
    const gx = x + Math.floor(hash2(tx, ty, i * 3 + 1) * (TILE - 3));
    const gy = y + Math.floor(hash2(tx, ty, i * 3 + 2) * (TILE - 3));
    ctx.fillStyle = hash2(tx, ty, i * 3 + 3) > 0.55 ? 'rgba(190,178,210,.10)' : 'rgba(0,0,0,.22)';
    ctx.fillRect(gx, gy, 2, 2);
  }

  // 受光顶面 / 背光底边 / 侧边压暗
  if (upOpen) {
    ctx.fillStyle = '#574c66'; ctx.fillRect(x, y, TILE, 3);
    ctx.fillStyle = '#6d6180'; ctx.fillRect(x, y, TILE, 1);
  }
  if (dnOpen) { ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x, y + TILE - 5, TILE, 5); }
  if (lfOpen) { ctx.fillStyle = 'rgba(0,0,0,.30)'; ctx.fillRect(x, y, 3, TILE); }
  if (rtOpen) { ctx.fillStyle = 'rgba(0,0,0,.30)'; ctx.fillRect(x + TILE - 3, y, 3, TILE); }
}

function drawSlab(ctx, x, y, tx, ty) {
  // 台面：14px 厚，下面是空的（玩家能从下面走过去）
  ctx.fillStyle = '#1b1724'; ctx.fillRect(x, y + 4, TILE, 14);
  const g = ctx.createLinearGradient(0, y + 4, 0, y + 18);
  g.addColorStop(0, '#4a4058'); g.addColorStop(0.35, '#38304a'); g.addColorStop(1, '#241f2e');
  ctx.fillStyle = g; ctx.fillRect(x, y + 4, TILE, 12);
  ctx.fillStyle = '#6b5f7e'; ctx.fillRect(x, y + 4, TILE, 1);
  // 铆钉
  for (let i = 0; i < 2; i++) {
    const rx = x + 10 + i * 24;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(rx, y + 10, 3, 3);
    ctx.fillStyle = 'rgba(200,190,220,.25)'; ctx.fillRect(rx, y + 10, 2, 2);
  }
  // 底边阴影投到空气里 —— 让它有厚度
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x, y + 16, TILE, 4);
}

function drawDoor(ctx, x, y) {
  ctx.fillStyle = '#120e18'; ctx.fillRect(x + 4, y - 18, TILE - 8, TILE + 18);
  // 门框
  ctx.fillStyle = '#5a4a2e'; ctx.fillRect(x + 4, y - 18, TILE - 8, 4);
  ctx.fillStyle = '#3d3220'; ctx.fillRect(x + 4, y - 18, 4, TILE + 18);
  ctx.fillRect(x + TILE - 8, y - 18, 4, TILE + 18);
  // 门板
  const g = ctx.createLinearGradient(x, y - 18, x, y + TILE);
  g.addColorStop(0, '#7a5a30'); g.addColorStop(1, '#3a2a16');
  ctx.fillStyle = g; ctx.fillRect(x + 8, y - 14, TILE - 16, TILE + 14);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(x + 8, y + 8, TILE - 16, 2);
  ctx.fillRect(x + TILE / 2 - 1, y - 14, 2, TILE + 14);
  // 门缝漏出的一点暖光
  ctx.fillStyle = 'rgba(255,196,110,.20)'; ctx.fillRect(x + 8, y + TILE - 6, TILE - 16, 6);
}

function drawTile(ctx, ch, x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (ch === '#') {
    drawStone(ctx, x, y, tx, ty);
  } else if (ch === '=') {
    drawSlab(ctx, x, y, tx, ty);
  } else if (ch === 'H') {
    drawStone(ctx, x, y, tx, ty);
    if (SAVE.equipped.yellow === 'sight') {
      ctx.strokeStyle = 'rgba(216,178,74,.85)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 8, y + 8);  ctx.lineTo(x + 24, y + 24); ctx.lineTo(x + 14, y + 40);
      ctx.moveTo(x + 30, y + 6);  ctx.lineTo(x + 21, y + 27); ctx.lineTo(x + 39, y + 41);
      ctx.stroke();
      ctx.fillStyle = 'rgba(216,178,74,.10)'; ctx.fillRect(x, y, TILE, TILE);
    }
  } else if (ch === 'D') {
    drawDoor(ctx, x, y);
  }
}

// ============================ 循环 ============================
let last = 0, hudT = 0;
/* 上一帧的**真实**帧间隔 —— 只给调试读，不参与逻辑。
 * 为什么要记它：采样帧间隔 ≠ 物理步长。想知道"这台机器掉到几帧"，
 * 必须看这个，而不是看物理步长（那个永远是 1/120）。 */
let lastDt = 0;

function frame(ts) {
  if (!last) last = ts;
  let raw = (ts - last) / 1000;
  last = ts;
  /* 时间戳回退 / NaN / 后台切回来隔了几十秒：都不能直接喂给累加器 */
  if (!(raw > 0)) raw = 0;
  if (raw > 0.25) raw = 0.25;
  lastDt = raw;

  acc += raw;
  let steps = 0;
  while (acc >= FIXED_DT && steps < MAX_SUBSTEPS) {
    prevX = P.x; prevY = P.y; prevCamX = camX; prevCamY = camY;
    update(FIXED_DT);
    acc -= FIXED_DT;
    steps++;
    /* 一次按下只能被**一个**物理步吃掉。
     * 不在这里清，60fps 一帧两步时"跳"会被连吃两次：第一步入 jump、
     * 第二步状态已是 jump 不会重跳，但攻击会（攻击状态里也读 padTap），
     * 一帧出两刀、伤害翻倍，且只在 60fps 出现、30fps 反而正常。 */
    latchPad();
  }
  /* 抗螺旋：补满 12 步还没追平，说明这台机器已经跑不动了。
   * 丢掉欠账、按"慢动作"继续 —— 越算越落后比掉帧更糟。 */
  if (steps === MAX_SUBSTEPS) acc = 0;

  render(acc / FIXED_DT);
  /* 240Hz 屏一帧可能一步都不跑（4.2ms < 8.3ms）。这时**不能**清 tap：
   * 清了就是把这一下按键扔了（按下后屏幕上什么都不发生）。
   * 留着，下一个物理步自然会吃掉它。 */
  requestAnimationFrame(frame);
}

function update(dt) {
  /* START 走动作层：键盘 Tab/O 和手机上那个"匣"按钮现在是同一条路径。
   * 以前手机层直接调 toggleMenu()，键盘在 boot 里单独判 —— 两条路，
   * 于是"手机能开、键盘不能"这类错位只是时间问题。 */
  if (padTap('menu')) { actReleaseTouch(); toggleMenu(); }

  if (msgT > 0) msgT -= dt;
  if (shakeT > 0) { shakeT -= dt; if (shakeT <= 0) { shakeT = 0; shakeAmp = 0; } }

  // 顿帧：世界停住，但提示、震屏、镜头照常走 —— 否则打中的那一帧"什么都没发生"
  if (hitStop > 0) {
    hitStop -= dt;
  } else if (!ended && !menuOpen) {
    updatePlayer(dt);
    // 第一次走过"展品"，让玩家自己发现背面是空的（不用教程）
    if (room.id === 'hall' && !SAVE.flags.has('seen_noback') && P.x > px(10)) {
      SAVE.flags.add('seen_noback');
      say('……他没有背面。');
    }
    if (!P.dead) for (const e of enemies) if (!e.dead) updateEnemy(e, dt);
    updateProjectiles(dt);
    for (const it of pickups) it.t += dt;
    for (const p of particles) {
      p.life -= dt;
      if (p.noGrav) continue;                 // 挥击弧钉在角色身前，不该被重力拽下去
      p.x += p.vx*dt; p.y += p.vy*dt; p.vy += 700*dt;
    }
    particles = particles.filter(p => p.life > 0);
  }

  // 镜头：横向带前瞻（朝哪走就多看一点），纵向留死区（小跳不晃镜头）
  const lookX = P.face * 46 * Math.min(1, Math.abs(P.vx) / 220);
  const tx = P.x + P_W/2 - VIEW_W/2 + lookX;
  /* ↑ 抬头：镜头往上让一截。原版是 ric_anim_press_up（真的抬头看上方），
   * 照片精灵里没有"头"可以转动，让镜头说话最省事 —— 按一下就能确认"上"被吃到了。
   * 纵向死区同时收窄：常态死区 62px 是给"小跳不晃镜头"用的，
   * 抬头要的就是"镜头跟着看"，留着大死区等于白给（58px 的位移会被死区吃干净，
   * 实测 camY 一格都不动 —— 那就还是"按了没反应"）。 */
  const looking = P.lookUp && !P.dead;
  const upLift = looking ? 180 : 0;
  const dz = looking ? 18 : 62;
  const ty = P.y + P_H/2 - VIEW_H/2 - upLift;
  camX += (tx - camX) * Math.min(1, dt * 6.5);
  const dy = ty - camY;
  if (Math.abs(dy) > dz) camY += (dy - Math.sign(dy) * dz) * Math.min(1, dt * 7.5);
  clampCam();
  for (const d of DUST) {
    d.y += d.vy * dt; d.x += d.vx * dt;
    if (d.y < -40) { d.y = VIEW_H + 40; d.x = Math.random() * (VIEW_W + 200); }
  }
  hudT += dt;
  if (hudT > 0.1) { hudT = 0; syncHUD(); }
}

function render(alpha) {
  /* ---- 渲染插值 ----
   * 物理是 120Hz，屏幕可能是 30/60/120Hz。直接画"最新状态"的话，
   * 30fps 下每帧会跳过 4 个物理步 —— 位移是准的，但眼睛看到的是
   * "一格一格挪"。这里把**上一次步进前**和当前之间按 alpha 取点画。
   *
   * 画完立刻还回去：render() 对外仍是只读函数，物理状态一个字节都没变。
   * 镜头也要一起插值 —— 只插人不插镜头，人会相对背景左右抖 ±2px。 */
  const _px = P.x, _py = P.y, _cx = camX, _cy = camY;
  if (alpha > 0 && alpha < 1) {
    P.x = prevX + (P.x - prevX) * alpha;
    P.y = prevY + (P.y - prevY) * alpha;
    camX = prevCamX + (camX - prevCamX) * alpha;
    camY = prevCamY + (camY - prevCamY) * alpha;
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(RS, 0, 0, RS, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, '#161320'); g.addColorStop(1, '#08070c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const sx = shakeT > 0 ? (Math.random()-0.5)*shakeAmp*2 : 0;
  ctx.save();
  ctx.translate(-Math.round(camX) + sx, -Math.round(camY) + sx*0.6);

  // 背景：两层视差。视差要按"屏幕坐标 → 世界坐标"反推，直接拿 camX 减会在大 camX 下把整层甩出屏幕。
  function layer(p, spacing, fn) {
    const m = ((camX * p) % spacing + spacing) % spacing;
    for (let sx = -spacing - m; sx < VIEW_W + spacing; sx += spacing) fn(ctx, sx + camX, camY);
  }
  // 远层：拱龛（越远越亮、越虚）
  if (room.id !== 'hall') layer(0.20, 300, (c, wx, cy) => {
    const w = 168, h = 330, top = cy + 40;
    c.fillStyle = '#1b1726';
    c.beginPath();
    c.moveTo(wx, top + h);
    c.lineTo(wx, top + w / 2);
    c.arc(wx + w / 2, top + w / 2, w / 2, Math.PI, 0);
    c.lineTo(wx + w, top + h);
    c.closePath(); c.fill();
    c.fillStyle = 'rgba(150,133,190,.045)';
    c.fillRect(wx + 10, top + w / 2, w - 20, h - w / 2);
  });
  // 长廊：展厅是一堵真墙，不是虚空。
  // 没有它，画框会"浮"在背景上 —— 这是上一版最难看的地方。
  if (room.id === 'hall') {
    const RW = px(room.w), railY = px(12.45), floorY = px(15);
    const gw = ctx.createLinearGradient(0, 0, 0, floorY);
    gw.addColorStop(0, '#100d16'); gw.addColorStop(0.55, '#1a1424'); gw.addColorStop(1, '#221a2c');
    ctx.fillStyle = gw; ctx.fillRect(0, 0, RW, floorY);

    // 墙面竖向壁板缝（每 96px 一条，很淡，只是让大面不空）
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    for (let x = 0; x < RW; x += 96) ctx.fillRect(x, 0, 1, railY);
    // 霉斑：哈希定死，不闪
    for (let i = 0; i < 26; i++) {
      const mx = hash2(i, 1, 7) * RW, my = hash2(i, 2, 7) * railY;
      ctx.fillStyle = 'rgba(90,74,110,.055)';
      ctx.beginPath(); ctx.ellipse(mx, my, 24 + hash2(i,3,7)*50, 14 + hash2(i,4,7)*30, 0, 0, Math.PI*2); ctx.fill();
    }
    // 挂镜线
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, railY, RW, 6);
    ctx.fillStyle = '#3d3222'; ctx.fillRect(0, railY, RW, 4);
    ctx.fillStyle = 'rgba(240,214,160,.16)'; ctx.fillRect(0, railY, RW, 1);

    // 护墙板
    const wg = ctx.createLinearGradient(0, railY + 6, 0, floorY);
    wg.addColorStop(0, '#231a2a'); wg.addColorStop(1, '#150f1c');
    ctx.fillStyle = wg; ctx.fillRect(0, railY + 6, RW, floorY - railY - 6);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    for (let x = 0; x < RW; x += 72) ctx.fillRect(x, railY + 6, 2, floorY - railY - 6);
    ctx.fillStyle = 'rgba(150,120,180,.06)';
    for (let x = 0; x < RW; x += 72) ctx.fillRect(x + 2, railY + 6, 1, floorY - railY - 6);

    // 壁灯：长廊每 480px 一盏。不是为了照亮，是为了给这条走廊一个节奏 ——
    // 也让暗角有东西可以压。没有它，整面墙是均匀的黑，眼睛找不到落点。
    for (let x = 300; x < RW; x += 480) {
      const sy = railY - 150;
      // 光晕要够大才像光。第一版半径 210、透明度 .17 —— 屏幕上只是一个黄方块。
      const rg = ctx.createRadialGradient(x, sy, 2, x, sy, 300);
      rg.addColorStop(0, 'rgba(255,196,120,.26)');
      rg.addColorStop(0.25, 'rgba(255,178,96,.10)');
      rg.addColorStop(1, 'rgba(255,170,90,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, sy, 300, 0, Math.PI * 2); ctx.fill();
      // 墙上的光洗：必须用椭圆径向渐变。
      // 第一版用了"竖直线性渐变的矩形"，结果墙上出现一个硬边的亮方块 —— 一眼假。
      ctx.save();
      ctx.translate(x, sy + 40);
      ctx.scale(0.42, 1);
      const wsh = ctx.createRadialGradient(0, 0, 4, 0, 0, 190);
      wsh.addColorStop(0, 'rgba(255,190,120,.13)');
      wsh.addColorStop(1, 'rgba(255,190,120,0)');
      ctx.fillStyle = wsh;
      ctx.beginPath(); ctx.arc(0, 0, 190, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // 铁托架
      ctx.fillStyle = '#241c2c'; ctx.fillRect(x - 2, sy, 4, 26);
      ctx.fillRect(x - 16, sy - 6, 32, 4);
      // 灯罩（梯形）
      ctx.fillStyle = '#5c4728';
      ctx.beginPath();
      ctx.moveTo(x - 16, sy - 6); ctx.lineTo(x - 11, sy - 26);
      ctx.lineTo(x + 11, sy - 26); ctx.lineTo(x + 16, sy - 6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8a6a3c'; ctx.fillRect(x - 11, sy - 27, 22, 3);
      // 灯芯
      ctx.fillStyle = '#ffd79a'; ctx.fillRect(x - 7, sy - 22, 14, 14);
      ctx.fillStyle = '#fff2d0'; ctx.fillRect(x - 4, sy - 20, 8, 8);
      // 灯下地面的一点反光
      ctx.fillStyle = 'rgba(255,190,110,.09)';
      ctx.beginPath(); ctx.ellipse(x, floorY - 4, 96, 9, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  // 折痕：钟塔不是建筑，是这个世界被折起来的那一道。
  // 所以它的主体不是砖，是一道竖着的皱。
  if (room.id === 'tower') {
    const W = px(room.w), H = px(room.h);
    const cxw = W * 0.46, bw = W * 0.26;
    const cg = ctx.createLinearGradient(cxw - bw, 0, cxw + bw, 0);
    cg.addColorStop(0, 'rgba(126,110,168,0)');
    cg.addColorStop(0.30, 'rgba(126,110,168,.13)');
    cg.addColorStop(0.5, 'rgba(160,143,206,.26)');
    cg.addColorStop(0.70, 'rgba(126,110,168,.13)');
    cg.addColorStop(1, 'rgba(126,110,168,0)');
    ctx.fillStyle = cg; ctx.fillRect(cxw - bw, 0, bw * 2, H);

    // 折线本身：一条随高度轻微摆动的亮线
    ctx.strokeStyle = 'rgba(206,196,236,.13)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = 0; y <= H; y += 48) {
      const x = cxw + Math.sin(y * 0.017) * 12 + (hash2(y, 1, 9) - 0.5) * 16;
      if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 两侧撕边：折起来的地方，纸是裂开的
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let y = 0; y <= H; y += 26) {
        const x = cxw + side * bw * 0.92 + (hash2(y, side, 21) - 0.5) * 34;
        if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(224,216,244,.10)'; ctx.lineWidth = 2; ctx.stroke();
    }

    // 悬在折痕上的纸片（纯装饰，说明这地方"还在皱"）
    for (let i = 0; i < 26; i++) {
      const sx3 = cxw - bw + hash2(i, 4, 11) * bw * 2;
      const sy3 = hash2(i, 5, 11) * H;
      const s = 4 + hash2(i, 6, 11) * 9;
      ctx.save();
      ctx.translate(sx3, sy3);
      ctx.rotate((hash2(i, 7, 11) - 0.5) * 1.6);
      ctx.fillStyle = 'rgba(214,206,232,.10)';
      ctx.fillRect(-s / 2, -s / 2, s, s * 0.7);
      ctx.restore();
    }
  }
  // 中层：壁柱（比远层暗一档，把背景压下去）
  if (room.id !== 'hall') layer(0.45, 232, (c, wx, cy) => {
    c.fillStyle = '#141020';
    c.fillRect(wx, cy - 120, 46, VIEW_H + 360);
    c.fillStyle = 'rgba(255,255,255,.028)';
    c.fillRect(wx, cy - 120, 3, VIEW_H + 360);
    c.fillStyle = '#1a1526';
    c.fillRect(wx - 10, cy - 120, 66, 26);          // 柱头
  });
  // 地面之下的暗部：让画面重心沉下去
  // 天花板压暗：越往上越沉，把视线压到地面附近
  {
    const g2 = ctx.createLinearGradient(0, camY, 0, camY + VIEW_H * 0.55);
    g2.addColorStop(0, 'rgba(0,0,0,.55)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2; ctx.fillRect(camX - 40, camY - 40, VIEW_W + 80, VIEW_H * 0.62 + 40);
  }

  const x0 = Math.max(0, Math.floor(camX / TILE) - 1), x1 = Math.min(room.w - 1, Math.ceil((camX + VIEW_W) / TILE));
  const y0 = Math.max(0, Math.floor(camY / TILE) - 1), y1 = Math.min(room.h - 1, Math.ceil((camY + VIEW_H) / TILE));
  if (!tileCache || tileCacheKey !== room.id) buildTileCache();
  // 只取可见那一块，别把整张房间贴上去
  const cx0 = x0 * TILE, cy0 = y0 * TILE;
  const cw = (x1 - x0 + 1) * TILE, chh = (y1 - y0 + 1) * TILE;
  ctx.drawImage(tileCache, cx0, cy0, cw, chh, cx0, cy0, cw, chh);
  // 隐藏墙现画（外观随装备变化）
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (room.g[y][x] === 'H') drawTile(ctx, 'H', px(x), px(y));
  }

  // 展厅里的"展品"（画在人物之后、玩家之前 = 贴在墙上）
  // −26：画框要离地悬着。贴在踢脚线上的画框会读成"站在地上的人"，这是上一版的错。
  if (room.portraits) for (const p of room.portraits) drawWallMan(ctx, px(p.tx), px(p.ty) - 26, p.n);

  for (const it of pickups) {
    if (it.got) continue;
    const bob = Math.sin(it.t * 3) * 5;
    ctx.save();
    ctx.globalAlpha = 0.22; ctx.fillStyle = '#ffd75e';
    ctx.beginPath(); ctx.arc(it.x, it.y - 30 + bob, 20, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = '#ffd75e';
    ctx.beginPath(); ctx.arc(it.x, it.y - 30 + bob, 8, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  for (const e of enemies) {
    if (e.dead) continue;
    if (e.def.type === 'slime') drawSlime(ctx, e);
    else if (e.def.type === 'bat') drawBat(ctx, e);
    else drawBoss(ctx, e);
  }

  for (const p of projectiles) {
    ctx.save();
    if (p.kind === 'fire') {
      ctx.fillStyle = '#ff9a3c'; ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ffe08a'; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI*2); ctx.fill();
    } else {
      ctx.translate(p.x, p.y); ctx.rotate(p.spin);
      ctx.fillStyle = '#cfd6e0';
      ctx.fillRect(-4, -13, 8, 26); ctx.fillRect(-13, -5, 26, 6);
    }
    ctx.restore();
  }

  if (!P.dead || P.deadT < 1) {
    const feetX = P.x + P_W/2;
    /* 步态（走）与抬头（↑）都只改"画在哪"，不改 P.y —— 物理和画面必须分开。
     * 上一版把浮动直接写进 feetY，同时又在下面用 Math.min 硬切压缩，
     * 两个都在动就分不清是哪个在抖了。 */
    const ph = P.walkPhase * Math.PI;
    let lift = 0, roll = 0;
    if (P.state === 'walk') {
      /* 名片管线没有 walk 帧（只有 idle/wave/attack/kick/hit）。硬画 idle 会像"滑行"，
       * 所以补一层程序化步态：躯干上下颠 + 左右摆 + 两拍一次的轻微压缩。
       * 这三件事频率一致、都由 walkPhase（距离）驱动，读起来就是"在迈步"。 */
      const w = P.walkW;
      lift = -Math.abs(Math.sin(ph)) * 4 * w;
      roll = Math.sin(ph) * 0.085 * w;   // 3°太小，凑近看才勉强有；5°才读得出重心在换脚
    }
    if (P.lookUp) { lift -= 3; roll -= P.face * 0.025; }
    const feetY = P.y + P_H + lift;

    // 投影：离地越高越淡越大。它比任何特效都更能说明"人在空中"。
    const gd = groundBelow(feetX, P.y + P_H);
    if (gd < 400) {
      const k = Math.max(0, 1 - gd / 400);
      ctx.save();
      ctx.globalAlpha = 0.30 * k + 0.06;
      ctx.fillStyle = '#05040a';
      ctx.beginPath();
      ctx.ellipse(feetX, P.y + P_H + gd - 2, 17 + gd * 0.035, 5 + gd * 0.008, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    if (P.invuln > 0 && Math.floor(P.invuln * 18) % 2 === 0) ctx.globalAlpha = 0.45;
    /* 姿态 = 压缩（蹲/滑铲，由状态写目标、P.sq 每帧追）+ 步态摇摆。
     * **以脚底为原点**：以身体中心缩放会让人半截陷进地板里。
     * 这里不再有 Math.min 硬切 —— 硬切就是"按键时画面闪一下"的根因。 */
    let sq = P.sq || 1;
    if (P.walkW > 0.01) sq *= 1 + Math.sin(ph * 2) * 0.018 * P.walkW;
    if (Math.abs(sq - 1) > 0.004 || Math.abs(roll) > 0.001) {
      ctx.translate(feetX, feetY);
      ctx.rotate(roll);
      ctx.scale(1 / Math.sqrt(sq), sq);
      ctx.translate(-feetX, -feetY);
    }
    if (playerPack.kind === 'atlas') {
      const anim = PACK_ATLAS.map[P.state] || 'idle';
      const fix = P.state === 'jump' ? 1 : null;
      /* 后跃的残影：精灵表里没有后空翻的帧，只有 idle。
       * 不加这个，后跃看起来就是"人站着平移" —— 玩家会以为是被推了一下。
       * 两帧错位半透明，读出来的是"快速退开"。 */
      if (P.state === 'dash') {
        const base = ctx.globalAlpha;
        for (let i = 2; i >= 1; i--) {
          ctx.globalAlpha = base * (0.10 + i * 0.06);
          drawAtlasFrame(ctx, anim, P.animT, feetX - P.vx * 0.022 * i, feetY,
                         P_SPRITE_H, P.face < 0, null);
        }
        ctx.globalAlpha = base;
      }
      drawAtlasFrame(ctx, anim, P.animT, feetX, feetY, P_SPRITE_H, P.face < 0, fix);
    } else {
      drawPhotoFrame(ctx, feetX, feetY, P_SPRITE_H, P.face < 0, P.state, P.animT);
    }
    ctx.restore();
  }

  for (const p of particles) {
    /* 挥击弧:一道 90 度左右的白色弧从角色身前扫过去。精灵表的 attack 4 帧
     * 几乎看不出差别（照片生成的动作幅度天然小），没有这层弧，玩家按 J
     * 得到的信息只有"人物好像没动" —— 这就是"攻击键没反馈"。 */
    if (p.arc) {
      const k = 1 - p.life / p.lifeMax;               // 0→1 扫过去
      ctx.save();
      ctx.lineCap = 'round';
      /* 三道同心弧，外淡内亮 —— 单根线在任何背景上都会被读成"一道划痕"，
       * 三道叠起来才有"挥过去的风"的体积感。 */
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = (1 - k) * (0.35 + i * 0.30);
        ctx.strokeStyle = i === 2 ? '#ffffff' : p.c;
        ctx.lineWidth = 3 + i * 4;
        ctx.beginPath();
        const peak = 0.62 + i * 0.06;                  // 外圈慢一点，读成"甩出去的尾"
        const kk = Math.min(1, k / peak);
        /* 130° 的扇面：从斜上挥到身前。角度必须够大，否则读成"一道划痕"，
         * 而且半径要压到人物轮廓之外才看得见（见 particles.push 处的注释）。 */
        const a0 = p.dir * (-1.45 + kk * 0.65);
        const a1 = p.dir * (-0.25 + kk * 1.55);
        ctx.arc(p.x, p.y, p.r * (0.62 + i * 0.20) * (0.80 + kk * 0.40),
                Math.min(a0, a1), Math.max(a0, a1));
        ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2.2));
    if (p.txt) { ctx.fillStyle = '#fff'; ctx.font = 'bold 15px monospace'; ctx.fillText(p.text, p.x, p.y); }
    else { ctx.fillStyle = p.c || '#fff'; ctx.fillRect(p.x - 2, p.y - 2, 4, 4); }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // 浮尘：屏幕空间的慢速颗粒。静止的画面有它才像"空气里有东西"
  for (const d of DUST) {
    const sx2 = ((d.x - camX * 0.55) % (VIEW_W + 40) + VIEW_W + 40) % (VIEW_W + 40) - 20;
    const sy2 = ((d.y - camY * 0.55) % (VIEW_H + 40) + VIEW_H + 40) % (VIEW_H + 40) - 20;
    ctx.globalAlpha = d.a;
    ctx.fillStyle = '#cfc4e6';
    ctx.fillRect(sx2, sy2, d.r, d.r);
  }
  ctx.globalAlpha = 1;

  // 暗角
  const vg = ctx.createRadialGradient(VIEW_W/2, VIEW_H*0.52, VIEW_H*0.26, VIEW_W/2, VIEW_H*0.52, VIEW_H*0.98);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.52)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 相框：屏幕的四条边是玩家给这张照片装的框
  ctx.strokeStyle = 'rgba(232,222,200,.11)'; ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, VIEW_W - 2, VIEW_H - 2);
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1;
  ctx.strokeRect(5, 5, VIEW_W - 10, VIEW_H - 10);

  if (msgT > 0) {
    ctx.fillStyle = '#ffe6a3'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
    ctx.globalAlpha = Math.min(1, msgT * 2);
    ctx.fillText(msg, VIEW_W/2, 84);
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  }

  if (ended) {
    ctx.fillStyle = 'rgba(4,4,8,0.88)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd75e'; ctx.font = 'bold 36px sans-serif';
    ctx.fillText('城 之 尽 头', VIEW_W/2, 226);
    ctx.fillStyle = '#cfc7b0'; ctx.font = '16px sans-serif';
    ctx.fillText('你用二段跳上了那段原本够不到的台子。', VIEW_W/2, 276);
    ctx.fillText('能力门的闭环成立 —— 剩下的就是关卡与素材的量。', VIEW_W/2, 306);
    ctx.fillStyle = '#7d7568'; ctx.font = '13px monospace';
    ctx.fillText('按 R 重开', VIEW_W/2, 366);
    ctx.textAlign = 'left';
  }

  P.x = _px; P.y = _py; camX = _cx; camY = _cy;   // 插值只是为了这一帧的像素
}

// ============================ HUD / 菜单 ============================
const $ = s => document.querySelector(s);
/* 屏幕底部上面那一行只有一格。谁写都能盖掉上一条 —— 包括开场那三句
 * setTimeout 里的剧情台词（2.6s / 5.2s）。
 *
 * 为什么这是个 bug 而不是"测试运气不好"：新玩家进游戏第一件事就是乱按。
 * 他按了蓝魂，看到"没有装备蓝魂"的提示，紧接着 2.6 秒那句台词顶上来 ——
 * 玩家的结论不是"有提示被覆盖了"，而是"按了没反应"。
 * 所以这里给消息分优先级：玩家动作触发的回声(1) 不许被剧情台词(0) 盖掉。
 * 反过来可以：提示会盖掉台词（玩家刚做的事比旁白重要）。 */
function say(t, prio = 1) {
  if (prio < msgPrio && msgT > 0.6) return;   // 台词让路，但不是永久闭嘴：提示淡了它还能出来
  msg = t; msgT = 1.9; msgPrio = prio;
  SAY_LOG.push(t);
  if (SAY_LOG.length > 8) SAY_LOG.shift();
}
function addLog(t) {
  const el = $('#log'); if (!el) return;
  const d = document.createElement('div'); d.textContent = '· ' + t;
  el.appendChild(d); setTimeout(() => d.remove(), 7000);
}

function syncHUD() {
  $('#hpfill').style.width = Math.max(0, P.hp / P.hpMax * 100) + '%';
  $('#mpfill').style.width = Math.max(0, P.mp / P.mpMax * 100) + '%';
  $('#roomname').textContent = room.name;
  const setSlot = (sel, id) => {
    const el = $(sel);
    if (!id) { el.textContent = '空'; el.className = 'slot empty'; return; }
    el.textContent = SOULS[id].name;
    el.className = 'slot ' + SOULS[id].type;
  };
  setSlot('#slotred', SAVE.equipped.red);
  setSlot('#slotblue', SAVE.equipped.blue);
  setSlot('#slotyellow', SAVE.equipped.yellow);
  $('#soulcount').textContent = SAVE.owned.size + '/' + Object.keys(SOULS).length;
  drawMinimap();
}

function drawMinimap() {
  const c = $('#minimap'); if (!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  /* 每格占几个设备像素 —— 这里原来的写法是"整张图缩放比"：
   * 32 格的房间算出 s≈0.09，再乘格子索引，每格只有 0.09px，
   * 抗锯齿抹完小地图就是一块空面板（只剩几个位置全错的彩点）。
   * 小地图的格子单位是"一格"，所以先求每格尺寸，再乘索引。 */
  const s = Math.max(2, Math.floor(Math.min(c.width / room.w, c.height / room.h)));
  const ox = Math.floor((c.width - room.w * s) / 2);
  const oy = Math.floor((c.height - room.h * s) / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(ox, oy, room.w * s, room.h * s);
  for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
    const ch = room.g[y][x];
    if (ch === '#') ctx.fillStyle = '#4a4652';
    else if (ch === '=') ctx.fillStyle = '#5d5768';
    else if (ch === 'H' && SAVE.equipped.yellow === 'sight') ctx.fillStyle = 'rgba(232,115,90,.8)';
    else continue;
    ctx.fillRect(ox + x*s, oy + y*s, s, s);
  }
  /* 点的坐标是世界像素，必须先除以 TILE 换成格 —— 不然点会飘到图外 */
  ctx.fillStyle = '#e8735a';
  for (const e of enemies) if (!e.dead) ctx.fillRect(ox + (e.x/TILE)*s - 1, oy + (e.y/TILE)*s - 1, 3, 3);
  ctx.fillStyle = '#ffd75e';
  for (const it of pickups) if (!it.got) ctx.fillRect(ox + (it.x/TILE)*s - 1, oy + (it.y/TILE)*s - 2, 3, 4);
  ctx.fillStyle = '#8fd0ff';
  ctx.fillRect(ox + (P.x/TILE)*s - 1, oy + (P.y/TILE)*s - 1, 3, 4);
}

let menuOpen = false;
function buildMenu() {
  const wrap = $('#souls'); wrap.innerHTML = '';
  const groups = [['red','红魂 · 主动（' + keyName('red') + ' 施放，耗蓝）'],
                ['blue','蓝魂 · 持续（按住 ' + keyName('blue') + '，耗蓝）'],
                ['yellow','黄魂 · 被动（装备即生效）']];
  for (const [tp, title] of groups) {
    const h = document.createElement('div'); h.className = 'grp ' + tp; h.textContent = title; wrap.appendChild(h);
    const owned = [...SAVE.owned].filter(s => SOULS[s].type === tp);
    if (!owned.length) {
      const d = document.createElement('div'); d.className = 'none'; d.textContent = '（还没拿到 —— 去打对应的怪）';
      wrap.appendChild(d);
    }
    for (const s of owned) {
      const b = document.createElement('button');
      b.className = 'soul ' + tp + (SAVE.equipped[tp] === s ? ' on' : '');
      b.innerHTML = '<b>' + SOULS[s].name + '</b><span>' + SOULS[s].desc + '</span>';
      b.onclick = () => {
      SAVE.equipped[tp] = SAVE.equipped[tp] === s ? null : s;
      buildMenu();
      onProgress('equip');   // 换魂也要落盘：下次进来手里该还是这个
    };
      wrap.appendChild(b);
    }
  }
  const h2 = document.createElement('div'); h2.className = 'grp silver'; h2.textContent = '银魂 · 能力（永久，不用装备）';
  wrap.appendChild(h2);
  const sil = [...SAVE.owned].filter(s => SOULS[s].type === 'silver');
  if (!sil.length) {
    const d = document.createElement('div'); d.className = 'none'; d.textContent = '（打倒钟塔顶的守关者）';
    wrap.appendChild(d);
  }
  for (const s of sil) {
    const d = document.createElement('div'); d.className = 'silveritem';
    d.innerHTML = '<b>' + SOULS[s].name + '</b><span>' + SOULS[s].desc + '</span>';
    wrap.appendChild(d);
  }
}
function toggleMenu(force) {
  menuOpen = force === undefined ? !menuOpen : force;
  $('#menu').classList.toggle('show', menuOpen);
  if (menuOpen) buildMenu();
}

// ============================ 启动 ============================
const cv = document.getElementById('cv');

function boot() {
  atlasMan = window.ATLAS_MAN;
  const b64 = window.ATLAS_B64 || '';
  if (atlasMan && b64) {
    const img = new Image();
    img.onload = () => { atlasImg = img; };
    img.src = 'data:image/png;base64,' + b64;
  }
  let start = 'hall';
  /* 读档在进房间**之前**：进房间本身会落盘，顺序反了会把刚读出来的进度
   * 用默认值盖掉（先写后读 = 存档永远停在开局）。 */
  const loaded = loadGame();
  if (loaded && loaded.room) start = loaded.room;
  try { start = new URLSearchParams(location.search).get('room') || start; } catch (e) { /* 无头环境没有 location */ }
  loadRoom(start, null, false);
  syncHUD();
  if (loaded) addLog('接着上次。');
  addLog('打史莱姆拿魂，Tab 打开魂菜单。');
  addLog('回廊右侧藏着东西，钟塔能往上爬。');
  // 开场三句：先说你干了什么，再说你为什么还能动。
  // 不加"教程弹窗"，因为这不是规则说明，是事实陈述。
  say('这张照片是你拍的。', 0);
  setTimeout(() => say('你按下去的时候，手抖了一下。', 0), 2600);
  setTimeout(() => say('所以他还没被拍死。', 0), 5200);
  requestAnimationFrame(frame);

  /* 手机上没有"退出游戏"这一步，玩家是直接把浏览器划掉的。
   * visibilitychange 是唯一能赶在进程冻结前落盘的时机。 */
  addEventListener('visibilitychange', () => {
    if (typeof document !== 'undefined' && document.hidden) saveGame('hide');
  });

  /* 系统键只碰三个：菜单（Tab / O）、静音（M）、重开（R 连按两次）。
   *
   * 为什么重开要连按两次：R 就在 W 右边一格，交战中按错一格 = 整局清空，
   * 而且 location.reload() 没有任何挽回余地。上一版按一下就直接重开，
   * 这是"按键逻辑出了问题"里最难原谅的一条 —— 它不是手感问题，是丢进度。
   *
   * e.repeat 必须挡：按住 Tab 半秒，系统会连发 keydown，菜单会疯狂开关。 */
  let reloadArm = 0;
  addEventListener('keydown', e => {
    if (!e.repeat && (e.key === 'm' || e.key === 'M') && !e.ctrlKey && window.__audio) {
      window.__audio.mute(!window.__audio.isMuted());
      say(window.__audio.isMuted() ? '静音' : '声音开');
    }
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.repeat) {
      const now = performance.now();
      /* `reloadArm &&` 不能省：reloadArm 初值是 0，而页面加载后 1.6s 内
       * performance.now() 本来就小于 1600 —— 少了这个前置条件，
       * 开局第一下 R 会直接 reload，第二次确认形同虚设。 */
      if (reloadArm && now - reloadArm < 1600) { location.reload(); return; }
      reloadArm = now;
      say('再按一次 R 重开');
    }
  });

  $('#skinbtn').onclick = () => $('#skinf').click();
  $('#skinf').onchange = ev => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    buildPhotoPack(f, ok => {
      if (!ok) { say('这张图读不出来'); return; }
      playerPack = PACK_PHOTO;
      $('#skinlabel').textContent = PACK_PHOTO.label;
      // 这不是"换皮肤"，这是按了一下快门。两句话，别合成一句。
      sfx('shutter');
      say('咔。');
      setTimeout(() => say('他还在。只是薄了。'), 1100);
    });
  };
  $('#skinreset').onclick = () => {
    playerPack = PACK_ATLAS;
    $('#skinlabel').textContent = PACK_ATLAS.label;
    say('换回那张名片');
  };
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
else boot();
