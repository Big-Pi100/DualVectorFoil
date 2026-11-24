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

/* 血瓶回多少：55% 上限。为什么不是 100%：
 * 满血回复等于"三条命"，战斗就没有"该撤了"这个判断；
 * 55% 刚好是"挨两下还能救回来、挨三下救不回"，这个数让血瓶是**决策**而不是保险。 */
const FLASK_HEAL = 0.55;

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
/* ── 侧身（Flatten，S4）──
 * 世界被拍平过一次，所以人也只是"少了一层厚度"：28px 宽的身体只剩 6px。
 * 高度不变 —— 侧身不是变小，是转了个面。 */
const FLAT_W = 6;
/* 比这个更薄的东西才塞得进纸缝（'|'）。用**宽度**判而不是"你是不是玩家、是不是 flat 状态"：
 * 碰撞该问的是"这个身体过得去吗"，不是"你是谁"。于是敌人（46 宽）永远过不去，
 * 而任何一个薄到 12px 以内的东西都能过 —— 规则只用记一条。 */
const PAPER_W = 12;
/* 当前碰撞宽度。只有侧身会改它，其余时刻恒等于 P_W。
 * 为什么不直接改 P_W：它是 const，而且"玩家的宽度"和"玩家现在的厚度"
 * 是两个概念，混成一个之后，所有读 P_W 的地方都得重新想一遍。 */
let P_CW = P_W;
/* 侧身的移动速度系数：侧着走是"蹭过去"，不是跑。也给"压扁很贵"一点体感。 */
const FLAT_SPD = 0.55;
/* 墨：侧身要烧墨，只有灯能补。数值是这一版定的（原型里唯一的经济约束），
 * 26/s 意味着满墨能连续侧身约 3.8 秒 —— 够过一次缝、不够赖在里面。 */
const FLAT_DRAIN = 26, INK_REFILL = 70, INK_NEAR = 78;

/* ── A 路线 P1：手感三件套（DESIGN_A.md §4）──
 * 三样都是《重生细胞》里"让动作能连起来"的东西，缺一样就会回到
 * "打一下→等硬直→被打→退"的老节奏。参数标了估算的地方不是 DC 的公开值。 */
/* 攻击前摇：判定帧。后摇从这里之后开始，也**只有**这里之后能取消 ——
 * 前摇可取消等于攻击无责任，比不给取消更糟。 */
const ATK_WINDUP = 0.09;
/* 攻击输入缓冲（0.10s）—— 《重生细胞》的 roll-attack buffer 的对应物：
 * 它在翻滚最后几帧按攻击，刀会在无敌结束那一瞬递出去。
 * 我们没有翻滚可言，但同一个病在这里：后摇里补的那一下会被 `lock>0` 整段吞掉。
 * 实测（`_probe_action_chain.js`）：硬直还剩 150ms / 220ms 时补按，一刀都不出；
 * 连打 8 下只出 2 刀 —— 玩家读到的是"这键有时不灵"。
 *
 * 三条边界，少一条就变味：
 *   1. 只在 `animT >= ATK_WINDUP`（判定帧之后）才记账。前摇里按的不算预输入，
 *      和"前摇不可取消"是同一条纪律。
 *   2. 只在 `attack` 状态记账。受击硬直（0.40s）里猛按不该换来"挨完自动还手"。
 *   3. 缓冲不绕过 `atkCd`。它只救"按早了"，不提高出刀频率上限（仍是 1/0.30s），
 *      所以不会带来 DPS 膨胀 —— 这一点是决定要不要加它的前提。 */
const ATK_BUF = 0.10;
/* rally（借自《血源》）：挨打后的短窗口里打回去，能夺回一部分损失。
 * 上限 60% 是硬约束 —— 不封顶就变成"站着对拼永远不死"。 */
const RALLY_WIN = 2.5, RALLY_CAP = 0.6, RALLY_RATE = 0.5;
/* 一击保护：血 >25% 时，致命伤只留 1 HP；45 秒冷却，喝药或回满重置。
 * 没有冷却的话，高血量角色等于无限免死，整局紧张感就没了。 */
const OHP_THRESHOLD = 0.25, OHP_CD = 45, OHP_INVULN = 1.0;
const OHP_STUN_R = 160, OHP_STUN_T = 1.0;

// ============================ 魂表 ============================
// red=主动（CD）/ blue=激活式增益（CD）/ yellow=被动 / silver=能力魂（永久）
/* 三档都不再有"耗蓝"：魂和装备是同一个性质，区别只在**冷却**。
 * 对齐《重生细胞》—— 它靠 CD 而不是资源条控制技能释放频率，
 * 所以没有第二条资源条，玩家只需要记"这个格子还有几秒"。
 * 白哥 2026-11-24 的决定，原文：「取消蓝条，魂与装备的性质一样，用 CD 来控制」。 */
/* 主键名的**唯一来源**。SOULS 的说明文字、魂菜单的分组标题、手机端按钮
 * 全都要引用它 —— 上一版这些文案里写死了字母，键位一改文案就烂：
 * 说明书上写着「按住 K 减缓下落」，而 K 现在是跳，玩家照着按会原地起跳。
 * 文案是界面的一部分，不能靠手抄。 */
const KEY_OF = { atk:'j', jump:'k', red:'u', blue:'l', back:'i', menu:'o', flat:'f', use:'e', heal:'h' };
const keyName = a => KEY_OF[a].toUpperCase();

const SOULS = {
  /* short 是格子上用的两字短名。为什么需要：格子按参考图缩到 40px 之后，
   * 四字全名（炎魔之魂）要排两行、字号掉到 9px，在手机上读不出来。
   * 死细的格子是纯图标 —— 我们没图标，两字短名是最近的替代。 */
  fire:  { type:'red',    name:'炎魔之魂', short:'炎魔', cd:1.6, desc:'向前掷出火球（' + keyName('red') + '）' },
  axe:   { type:'red',    name:'飞斧之魂', short:'飞斧', cd:2.4, desc:'回旋飞斧，可穿透（' + keyName('red') + '）' },
  /* 滑翔从"按住持续耗蓝"改成"点一下，3 秒内减缓下落"。原因不只是删蓝条：
   * 手机上"按住某个能力键"和"按住跳跃"是同一个拇指，两个持续动词会打架。
   * 死细的技能也全是点按触发、时长写在冷却里。 */
  glide: { type:'blue',   name:'翼魔之魂', short:'翼魔', cd:9, dur:3, desc:keyName('blue') + ' 激活 3 秒，减缓下落' },
  sight: { type:'yellow', name:'识破之魂', short:'识破', desc:'看见可破坏的墙，普攻可击碎' },
  djump: { type:'silver', name:'双跃之魂', short:'双跃', desc:'空中可再跳一次，打开够不到的路' },
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

// ---- 显影室：S4 的实验室，一间房，只回答一个问题 ----
/* 这一间房不是"关卡"，是**测量工具**。结构从左到右：
 *   出生点 → 灯 → [可选壁龛：纸缝 + 墨囊 + 史莱姆] → 走廊史莱姆 → 纸镖蝙蝠
 *          → [必经纸缝] → 灯 → 尽头（可以走回去）
 *
 * 为什么必需段放在后半：如果一进门就必须侧身，"会不会自己发现"这个数就没了。
 * 前 20 格是纯观察窗 —— 玩家要么在壁龛那儿自己试出来，要么一路走到墙前面卡住。
 * 全房没有一句文字提示（连 say 都没有），墙上有缝就是唯一的提示。
 */
const paper = mkRoom('paper', '显影室', 40, 18);
border(paper);
fill(paper, 0, 15, 40, 3, '#');                 // 地面
paper.spawn = { x: px(2), y: px(15) };
/* 第二盏灯放在必经墙**左**侧 1.5 格处，不是右侧。
 * 原因不是构图：x34 的灯照亮的是玩家已经过去之后的地方，
 * 而缝本身落在暗处时，1:1 下它就是砖墙上的一条发丝 —— 首测玩家找不到入口，
 * 实验就会因为"看不见"而失败，而不是因为"不想用"。灯挪过来之后，
 * 缝被背后的光剪出轮廓，墙又是暗的，读起来是"墙上有道透光的缝"。 */
paper.lamps = [
  { x: px(4),    y: px(15) },   // 出生点
  { x: px(26.5), y: px(15) },   // 必经墙左侧：缝要逆光看才找得到
  { x: px(30.5), y: px(15) },   // 过墙之后：第二处壁龛的缝在暗处等于不存在
];

/* ---- 第一处：可选机会，144px 矮墙 -------------------------------------
 * 裁定 Q23：原来是 4 格（192px），而单跳顶点是 203.8px —— 余量只有 11.8px。
 * 那不是"可选"，那是拿能不能过去赌一把。玩家会读成"过不去"，
 * 于是第一次侧身发生在壁龛而不是必经墙，"首次使用"量到的就不是引入点。
 * 现在是 3 格（144px）：跳过去是显而易见的事，侧身是**另一条**路。
 *
 * 形状上只占**一格厚**，这是被截图逼出来的决定：上一版是 5 格宽里挖暗格，
 * 1:1 看那个空腔读成了"面板/窗口"，而不是"墙里能钻的洞"——
 * 2D 侧视里没有纵深，空出来的格子就是把背景露出来，玩家读到的是"这里没有墙"。
 * 一格厚的矮墙不挖洞：整根柱子都是 `|`，画出来是"一道裂开的石片"，
 * 缝旁边没有可以误读的空白。 */
fill(paper, 12, 12, 1, 3, '|');

/* 必经纸缝：x28 一堵通顶的墙，只留齐人高的一道缝。没有第二条路 ——
 * 想往前，只能把自己变薄。这是"强制教一次"的那一步。 */
fill(paper, 28, 0, 1, 15, '#');
fill(paper, 28, 12, 1, 3, '|');
paper.gateX = px(29);

/* ---- 第二处：过墙之后的壁龛（裁定 Q22）---------------------------------
 * 没有它，"过墙之后是否自发复用"在结构上**永远是 0** ——
 * 那不是玩家不想用，是这里没有任何值得为它压扁的东西。
 * 密封的：四边是墙、上面有顶，只有左脸一道缝；想拿只能侧身进去、站起来、再侧身出来。
 * 所以它测的是"看见诱惑会不会主动用"，而不是"被挡住只好用"。 */
/* 槽只挖一格宽。上一版挖 3 格：那在 2D 侧视里读成一个**门洞** ——
 * 玩家会以为能直接走进去，撞上去才发现不行。假门比没有门更糟。
 * 一格宽（48px）能站人、能放魂，但看起来是"缝"，不是"路"。 */
fill(paper, 32, 11, 4, 4, '#');
fill(paper, 33, 12, 1, 3, '.');
fill(paper, 32, 12, 1, 3, '|');

paper.enemies = [
  /* 走廊里的巡逻：逼玩家在"直接压扁冲过去"和"绕开"之间做选择。
   * 原来有一只守在壁龛空腔里 —— 矮墙改成三格之后里面没有能站人的地方了，
   * 它挪到走廊。接触免疫这件事由这只 + 蝙蝠的纸镖来证明，两件都还在。 */
  { type:'slime', x: px(18), y: px(15), min: px(17), max: px(20), soul:'fire' },
  { type:'slime', x: px(23), y: px(15), min: px(21), max: px(25) },
  /* 会吐纸镖的蝙蝠（同一张纸，多一个动作）：证明"侧身不是无敌" ——
   * 同平面的身体打不到你，迎面对着飞来的东西照样破。 */
  { type:'bat',   x: px(24), y: px(14), cy: px(14), amp: 34, shoots: true },
];
paper.items = [
  /* 卡在缝里的墨囊。它有两个非默认参数，两个都是为了"只能侧身拿到"：
   *   reach:24 —— 默认拾取半径 52 太大，站着的人中心离缝只有 38.5px，
   *               用 52 会隔着空气把东西吸走，机制就白设计了；
   *   slim:true —— 画成一道细光，不是一颗球。缝只有 4px，球会盖住石头。
   * 余量：侧身中心贴到缝中线时距离 6px，站着最近 38.5px —— 两边都不是擦边。 */
  { id:'inkvial', x: px(12) + 24, y: px(15) - 30, ink: 20, reach: 24, slim: true },
  /* 过墙之后的东西（裁定 Q22）：必须是"值得为它压扁"的。
   * 用魂，因为魂是这套游戏里唯一表示"宝物"的词；这间房没有出口传送门，
   * 是独立实验房，所以和正篇里那把飞斧重复也不冲突。 */
  { id:'reuse_treasure', x: px(33) + 24, y: px(15), soul:'axe' },
];

const ROOMS = { hall, tower, paper };

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
  hp:120, hpMax:120,
  /* 墨：侧身的燃料。只有灯能补（见 INK_REFILL），不自然回复 ——
   * 「压扁很便宜」就会变成免伤外挂，这条资源是唯一的价格。 */
  ink:100, inkMax:100,
  state:'stand', t:0, animT:0, invuln:0, atkCd:0, castCd:0,
  /* 装备冷却（对齐《重生细胞》：能力不烧资源，只走 CD）。
   * 键 = 槽位，值 = 剩余秒；0 = 可用。UI 把剩余量画成格子上的扇形遮罩。 */
  cdRed:0, cdBlue:0, glideT:0,
  /* 血瓶（照参考图左上角）：3 瓶打底，回 55% 上限血。
   * 为什么是"次数"而不是"蓝条回血"：魂和装备都已经只是冷却了，
   * 再挂一条资源条就等于把删掉的 MP 从后门放回来。次数是《重生细胞》的做法，
   * 也天然给了"省着用"的取舍 —— 这才是这个格子存在的意义。 */
  flasks:3, flaskMax:3, flaskCd:0, flaskFx:0,
  /* 在缝里点过"起身"但空间不够 → 记住这个意图，穿出可站立处自动起身。
   * 没有它，切换式侧身会留下"点了没反应、出去还扁着"的手感断层。 */
  flatWantStand:false,
  lock:0, ceilHit:false, ceilBump:false, lookUp:false, landVy:0,
  hitSet:null, atkPending:0, atkBuf:0, dead:false, deadT:0,
  /* P1 手感三件套的状态。
   * rally = 还没夺回的血量（被打后 2.5 秒内有效），rallyT = 剩余窗口；
   * ohpCd = 一击保护的剩余冷却。三个都只在这里读写，别的地方不许直接改。 */
  rally:0, rallyT:0, ohpCd:0,
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
  /* 按下侧身那一刻最近的敌人距离。用来区分"主动躲"和"顺手压扁正好躲开"：
   * 这个值只在按下时记一次，之后不再更新 —— 它是**意图的代理**，不是状态。 */
  flatThreat: 999,
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

/* ── 实验埋点（S4）──
 * 这三个数就是"这个机制到底成不成立"的全部证据，所以从第一天就记，
 * 而不是事后凭印象写。判定标准见 AUDIT_001_DVF.md §7：
 * 必经段之后**自发复用**的人不到一半，这个动词就是装饰。
 *
 * 全部按**游戏时间**（P.t）记，不按墙钟：压测/后台切回来都不会污染。
 */
/* 侧身用法分三笔账。策划的硬规则：
 *   "don't count forced use as discovery or voluntary reuse."
 * 判据是**按下的位置**，不是时间差 ——
 * 在必经墙跟前压扁，是被挡住后的唯一出路；在别处压，才是自己想用。
 * 两者混在一个计数器里，这个实验就自己骗自己了。 */
const GATE_ZONE = 90;   // 距 gateX 这么近就算"在墙跟前"
const MET = {
  room: '',             // 这份数据属于哪个房间（换房间才清空）
  spawnT: 0,            // 出生（进房间）那一刻的 P.t
  firstFlatAt: -1,      // 第一次侧身的 P.t（-1 = 从没按过）
  firstUseKind: '',     // 'beforeGate' | 'atGate' | 'afterGate'
  flatUses: 0,          // 侧身次数（按下算一次，按住不重复计）
  flatMs: 0,            // 累计侧身时长
  gateT: -1,            // 第一次穿过必经缝的 P.t
  useBeforeGate: 0,     // 过墙前 + 不在墙跟前：真正的"自己发现了"
  useAtGate: 0,         // 过墙前 + 在墙跟前：强制型（引入本身，不是发现）
  useAtGateAfter: 0,    // 过墙后 + 又在墙跟前：回头穿墙，结构性，两头都不算
  useVoluntary: 0,      // 过墙后 + 不在墙跟前：判据 2 只有这个数能回答
  contactsSuppressed: 0,// 被"侧身"消掉的接触次数（打不到 = 机制在起作用）
  defensiveSaves: 0,    // 其中按下时敌人已经在 160px 以内的（主动躲，不是顺手）
  shotsHit: 0,          // 被投掷物打中的次数（对照：侧身挡不住飞来的东西）
};
function metReset() {
  MET.spawnT = P.t; MET.firstFlatAt = -1; MET.firstUseKind = '';
  MET.flatUses = 0; MET.flatMs = 0;
  MET.gateT = -1;
  MET.useBeforeGate = 0; MET.useAtGate = 0; MET.useAtGateAfter = 0; MET.useVoluntary = 0;
  MET.contactsSuppressed = 0; MET.defensiveSaves = 0; MET.shotsHit = 0;
}
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
      hp: Math.round(P.hp),
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
  down:  ['arrowdown','s'],          // 蹲 / 滑铲（下+跳，AoS 的 CHECK_SLIDE）/ 穿板（下+攻）
  atk:   [KEY_OF.atk],               // B
  jump:  [KEY_OF.jump, ' '],         // A（空格是通行别名）
  red:   [KEY_OF.red],               // 上+B（红魂）——独立键，等价于按住 W 再按 J
  blue:  [KEY_OF.blue],              // R（按住持续）
  back:  [KEY_OF.back],              // L（后跃）
  flat:  [KEY_OF.flat],              // 侧身（切换：点一下扁、再点一下起来）
  use:   [KEY_OF.use],               // 交互（照死细的第三键：伸手拿东西）
  /* 血瓶：照参考图左上角那格。它不是"技能"，所以不进四格 ——
   * 四格是"会被换掉的东西"，血瓶是永远在的消耗品。 */
  heal:  [KEY_OF.heal],
};
const menuKeyOf = ['tab','o'];       // START

/* 键 -> 动作 的反查表。**这是唯一知道物理键名的地方**。
 * 键盘监听、preventDefault 白名单、手机层都不再各自维护一份。 */
const KEYMAP = Object.create(null);
for (const a in K) for (const k of K[a]) KEYMAP[k] = a;
for (const k of menuKeyOf) KEYMAP[k] = 'menu';

/* ---- 物理键码表（KeyboardEvent.code）--------------------------------
 * 为什么 KEYMAP 之外还要这一张：**e.key 在中文输入法下是废的**。
 *
 * Windows 的微软拼音 / 搜狗是全局输入法。焦点在页面上时，字母键会先被 IME
 * 拿去组词，Chrome 派发的 keydown 实测长这样：
 *     { key: 'Process', code: 'KeyD', keyCode: 229, isComposing: true }
 * 于是 KEYMAP['process'] 查不到 —— **D / J / K / F 全部没反应**，而且
 * preventDefault 也没生效，组词窗口照样弹出来。
 * 方向键不参与组词，key 仍然是 'ArrowRight'，所以现象精确地表现为
 * **"只有方向键能动，字母键全废"**，看上去像字母键根本没绑。
 *
 * e.code 报的是**物理位置**（'KeyD'），与输入法、大小写、Shift 组合都无关，
 * 只有它能在组词状态下拿到真实的键。查表顺序因此是 code → key：
 * code 优先，key 只作为老浏览器 / 无 code 合成事件的退路。 */
const CODE_ACT = Object.create(null);
(function () {
  const FIXED = {
    'arrowleft': 'ArrowLeft', 'arrowright': 'ArrowRight',
    'arrowup': 'ArrowUp', 'arrowdown': 'ArrowDown',
    'tab': 'Tab', ' ': 'Space', 'escape': 'Escape',
  };
  const codeOf = k => FIXED[k] || (k.length === 1 ? 'Key' + k.toUpperCase() : null);
  for (const a in K) for (const k of K[a]) { const c = codeOf(k); if (c) CODE_ACT[c] = a; }
  for (const k of menuKeyOf) { const c = codeOf(k); if (c) CODE_ACT[c] = 'menu'; }
})();

/* 游戏键的形态。**即使没绑到动作也要吞掉**：
 * 不吞，IME 就会拿字母去组词，组词一旦开始，下一次连 e.code 都可能拿不到。
 * 反过来，第一下就把字母键 preventDefault 掉，组词窗口根本不会弹 ——
 * 这是让输入法用户和英文用户行为一致的关键，不是锦上添花。 */
const EAT_KEY = /^(Key[A-Z]|Digit[0-9]|Arrow(Left|Right|Up|Down)|Space|Tab|Enter|Escape)$/;

/* 令牌 = 物理键码。down 和 up 必须用同一个令牌，否则按住走两步会松不掉，
 * 动作卡在"按住"上（表现为人物自己一直走）。 */
const tokOf = e => e.code || (e.key || '').toLowerCase();
const actOf = e => (e.code && CODE_ACT[e.code]) || KEYMAP[(e.key || '').toLowerCase()] || null;

addEventListener('keydown', e => {
  if (EAT_KEY.test(e.code || '')) e.preventDefault();   // 空格滚页、Tab 跳焦点、字母进输入法
  const a = actOf(e);
  if (a) actPress(a, tokOf(e));
}, true);                                               // capture：别被页面里任何元素 stopPropagation 吃掉
addEventListener('keyup', e => {
  if (!actOf(e)) return;
  actRelease(tokOf(e));
}, true);

/* ---- 图例 = 规格 ---------------------------------------------------
 * 这张表是"操控"和"界面说明"之间**唯一**的连接点，界面那一行由它生成：
 *   · 字母从 KEY_OF 取，所以不可能印错字母；
 *   · 每一行都带**成立条件**（地面 / 只有薄板），因为"按了没反应"多半是条件不满足，
 *     而不是键坏了 —— 不写条件，玩家只会得出"这游戏控制坏了"；
 *   · 组合键（下+跳 滑铲、下+攻 穿板）必须在表里，否则它们等于不存在；
 *   · need 指向装备槽：没装那个魂就**变灰**。上一版 L 蓝魂 在空槽时按下去什么都不发生，
 *     界面却理直气壮写着"蓝魂" —— 这是最容易被读成"操控坏了"的一处。
 *
 * ctrl_check.js 直接读这张表生成的 DOM，逐条按下去验证效果；
 * 于是"说明"和"实现"不可能再各走各的（测试会红）。
 *
 * 上一版图例只写了 9 个键，还把 WASD 揉成一句"移动 · 蹲 · 抬头" ——
 * 玩家既不知道 S 是蹲，也不知道滑铲怎么按。不是审美问题，是测不了。 */
/* 分组**按动作**，不按手指（裁定 Q1）：手指分工是内部逻辑，不该要求玩家理解；
 * 玩家问的是"我想抬头发，按哪个"。所以组名是 移动 / 战斗 / 工具 / 系统。
 * hi:true = 主界面常驻的四个高频动作（裁定 Q3：主界面四个，完整表进魂匣）。 */
const LEGEND = [
  { grp:'移动', keys:['a','d'], verb:'移动', hi:true, sep:'/' },   // 二选一，不是同时按
  { grp:'移动', keys:['k'],     verb:'跳',   hi:true },
  { grp:'移动', keys:['w'],     verb:'抬头' },
  { grp:'移动', keys:['s'],     verb:'蹲' },
  { grp:'移动', keys:['s','k'], verb:'滑铲', cond:'地面' },
  { grp:'移动', keys:['s','j'], verb:'穿板', cond:'薄板上' },
  { grp:'移动', keys:['i'],     verb:'后跃', cond:'地面' },
  { grp:'战斗', keys:['j'],     verb:'攻',   hi:true },
  { grp:'战斗', keys:['u'],     verb:'红魂', need:'red' },
  { grp:'工具', keys:['f'],     verb:'纸',   hi:true },
  { grp:'工具', keys:['l'],     verb:'蓝魂', need:'blue' },
  /* 血瓶进表，但不是魂 —— 它不进四格（四格是"会被换掉的东西"）。
   * 界面上它有自己的格子（左上），键盘这边给一个键，两条路走同一个 useFlask。 */
  { grp:'工具', keys:['h'],     verb:'血瓶' },
  { grp:'系统', keys:['o'],     verb:'魂匣' },
];
const LEGEND_ALIAS = '方向键=WASD · 空格=跳 · Tab=魂匣 · R×2 重开 · M 静音';
const LEGEND_GRPS = ['移动', '战斗', '工具', '系统'];

function keyCap(k) {
  if (k === ' ') return 'SPC';
  return String(k).toUpperCase();
}
/* 从表生成界面。**不要在这里另写一份文案** —— 文案就是表。 */
function entHTML(e) {
  /* 多个键之间必须印出"怎么组合"：`A / D` 是二选一，`S + K` 是同时按。
   * 上一版两种情况都只是并列，读出来都是"S K" —— 组合键等于没写清楚。 */
  const sep = '<span class="jo">' + (e.sep || '+') + '</span>';
  const caps = e.keys.map(k => '<i class="k">' + keyCap(k) + '</i>').join(sep);
  return '<span class="ent' + (e.hi ? ' hi' : '') + '"' +
         ' data-keys="' + e.keys.join('+') + '" data-verb="' + e.verb + '"' +
         (e.need ? ' data-need="' + e.need + '"' : '') + '>' +
         caps + e.verb +
         (e.cond ? '<u>' + e.cond + '</u>' : '') +
         '<b class="lk">未装备</b></span>';
}
/* 主界面：只放四个高频动作（裁定 Q3）。放多了就不是"参考"，是噪音。
 * 但"完整表进魂匣"要成立，玩家得知道去哪看 —— 加一行入口提示。
 * 文案写成「完整操作：O / Tab」而不是「O 全部按键」：
 * 后者读起来像第五个动作（WO-003 §1），前者明确是一次跳转。 */
function buildLegend() {
  const box = document.querySelector('#keys');
  if (!box) return;
  box.innerHTML = LEGEND.filter(e => e.hi).map(entHTML).join('<span class="pair">·</span>') +
                  '<span class="alias">完整操作：<b>O</b> / <b>Tab</b></span>';
  buildFullLegend();
  paintLegend();
}
/* 魂匣里：完整表，按动作分组（裁定 Q3 的"完整版放魂匣"）。
 * 组合键与条件只在这里出现 —— 主界面不该有它们的位置。 */
function buildFullLegend() {
  const box = document.querySelector('#fullkeys');
  if (!box) return;
  const out = [];
  /* 先说明这一页在为哪几项做补充 —— 否则玩家会问"主界面上那四个为什么又出现一次"。
   * 文案同样从表里取（hi:true 就是主界面常驻那几条），不手写字母。 */
  const hi = LEGEND.filter(e => e.hi)
    .map(e => '<b>' + e.keys.map(keyCap).join(' / ') + '</b> ' + e.verb).join(' · ');
  out.push('<div class="lead">主界面常驻：' + hi + '。<br>下面是全部动作与成立条件。</div>');
  for (const grp of LEGEND_GRPS) {
    const ents = LEGEND.filter(e => e.grp === grp);
    if (!ents.length) continue;
    out.push('<div class="lg"><span class="gname">' + grp + '</span>' +
             ents.map(entHTML).join('<span class="pair">·</span>') + '</div>');
  }
  out.push('<div class="alias">' + LEGEND_ALIAS + '<br>O / Tab 关闭 · 点「魂槽」换魂</div>');
  box.innerHTML = out.join('');
}
/* 没装对应魂的动作变灰 + 明确写「未装备」（裁定 Q4：让不可用状态无法误读）。
 * 这不是装饰：它让"按住 L 没反应"在按之前就有解释。 */
function paintLegend() {
  for (const sel of ['#keys', '#fullkeys']) {
    const box = document.querySelector(sel);
    if (!box || !box.querySelectorAll) continue;
    box.querySelectorAll('.ent[data-need]').forEach(el => {
      const need = el.getAttribute('data-need');
      const has = need === 'red' ? !!SAVE.equipped.red : !!SAVE.equipped.blue;
      el.classList.toggle('off', !has);
    });
  }
  /* 触屏按钮的置灰跟着同一份状态走（WO-003 §4）。手机上玩家看不到图例，
   * 只有按钮自己灰掉，"这个魂还没装"才在按之前就成立。 */
  if (typeof window !== 'undefined' && typeof window.__paintTouch === 'function') {
    window.__paintTouch();
  }
}

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
/* ---- 动作回执（WO-003.1）----
 * 输入层"猜"组合会不会成立是不可靠的：空中下推+跳其实是普通跳，实地上
 * 下推+攻其实是普攻 —— 组合按下了，动作并没有发生。所以回执只能由
 * **真正执行动作的那一行**发出：玩家看到"滑铲"，就是真的滑铲了。
 * 没有订阅者时是空操作，桌面端一次都不执行。 */
let ACT_BEAT = null;
function actDone(kind) { if (ACT_BEAT) { try { ACT_BEAT(kind); } catch (e) {} } }

/* 调布局时的暂停（WO-004）。和 menuOpen 分开记：
 * 两者都会停世界，但"现在是不是在调布局"还要决定别的事
 * （START 要不要响应、格子要不要露出可拖的样子），复用同一个布尔量
 * 会让"开着菜单"也被当成"在调布局"。 */
let editPause = false;

window.__sk = {
  press(a)   { actPress(a, 't:' + a); },
  release(a) { actRelease('t:' + a); },
  releaseAll(){ actReleaseAll(); },
  setRS(v)   { RS = v; },
  setViewW(w){ VIEW_W = w; },
  /* 布局编辑要暂停世界：玩家在拖格子，不该同时被史莱姆撞。
   * 只停"世界"，不停渲染 —— 调位置时得看得见场景，
   * 否则玩家不知道这个位置在实际战斗里挡不挡视线。 */
  pause(v)   { editPause = !!v; },
  /* 手机层要能"把菜单收起来"（进调布局时菜单正开着，得先关掉才能看见格子）。
   * 不给它直接碰 menuOpen：菜单的开合只走 toggleMenu 一处，
   * 否则又会变成"两条路各写一遍 class"。 */
  menu(v)    { toggleMenu(v); },
  /* 触屏层订阅"动作真的发生了"（WO-003.1）。滑铲/穿板只在判定成功时
   * 才会走到这里 —— 传 null 取消订阅。桌面端从不订阅，等于不存在。 */
  onAct(fn) { ACT_BEAT = typeof fn === 'function' ? fn : null; },
  /* 动作层的只读快照：手机层"按得动"的测试靠它，
   * 否则只能截图看按钮有没有高亮 —— 那是 CSS，不是输入。 */
  input() {
    const o = {};
    for (const a in held) if (held[a]) o[a] = 1;
    return o;
  },
  /* 触屏层要知道哪个槽是空的 —— 空槽的红/蓝按钮必须变灰（WO-003 §4）。
   * 装备状态只有 SAVE.equipped 一份，不给它开第二个写入口。 */
  slots() {
    return { red: SAVE.equipped.red, blue: SAVE.equipped.blue };
  },
  /* 只读快照：手感回归测试和调参用，不参与任何逻辑，也不改任何状态。
   * 为什么需要它：手感的量（加速度爬升帧数、土狼窗口、可变跳跃衰减）
   * 在假 canvas 的 vm 里测不出来 —— 那里没有真实的 RAF 和真实键盘事件。 */
  state() {
    return {
      x:P.x, y:P.y, vx:P.vx, vy:P.vy, face:P.face, onGround:P.onGround,
      jumps:P.jumps, state:P.state, coyote:P.coyote, jumpBuf:P.jumpBuf,
      hp:P.hp, cdRed:P.cdRed, cdBlue:P.cdBlue, dead:P.dead, sq:P.sq, room:(room && room.id) || '',
      /* P1 手感三件套：rally 额度与窗口、一击保护冷却。
       * 三个都只读 —— 测试要能分别验证"是不是在窗口内"和"冷却还剩多少"，
       * 只测 hp 的变化量分不清是 rally 回了还是别的东西回了。 */
      rally:P.rally, rallyT:P.rallyT, ohpCd:P.ohpCd,
      /* 血瓶：次数和上限都进快照 —— HUD 上那个徽章是"读了状态再写 DOM"，
       * 只测 DOM 等于测自己，得有个独立的来源能对得上。 */
      flasks:P.flasks, flaskMax:P.flaskMax,
      /* 侧身（S4）的验收量：厚度、墨、以及"是不是在 flat 状态" */
      ink:P.ink, inkMax:P.inkMax, cw:P_CW,
      dt:lastDt, clamped:lastDt >= 0.0499,
      /* 定步长的验收量：airMinY 是本段滞空的最低点（y 越小越高）。
       * 采样帧率会骗人（30fps 采不到顶点），这个由物理步自己记，采不到也准。 */
      airMinY:P.airMinY, stepDt:FIXED_DT, simT:P.t,
      lock:P.lock, ceilBump:P.ceilBump,
      atkBuf:P.atkBuf,            // >0 = 收招里有一下记着的攻击（输入缓冲的证据）
      dropT:P.dropT,              // >0 = 刚从薄板掉下去（穿板生效的证据）
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
      room:(room && room.id) || '', hp:P.hp, luck:SAVE.luck,
      /* 冷却也进快照：它现在是"角色状态"的一部分（以前这里是 mp）。
       * 测试要能断言"这次施放真的进入了冷却"，而不只是"动画播了"。 */
      cdRed:P.cdRed, cdBlue:P.cdBlue,
      owned:[...SAVE.owned].sort(),
      equipped:{ red:SAVE.equipped.red, blue:SAVE.equipped.blue, yellow:SAVE.equipped.yellow },
      flags:[...SAVE.flags].sort(),
      lastSave:lastSaveReason,
    };
  },
  /* 只读：S4 实验的三个指标 + 让它们可判定的复合量。
   * 数量少是刻意的：能用一个数回答的问题，不要用五个。 */
  /* 只读：房间的 ASCII 网格。关卡形状靠肉眼看截图会骗人（缩放、视差、暗部），
   * 一格一格打印出来才敢说"这里真的有一条缝、那里真的是实心"。 */
  grid() { return room.g.map(r => r.join('')); },
  /* 调试用摆放：把脚底放到 (x, y)。**只给测试用** ——
   * 没有它，"站在薄板上按下+攻"这一条就只能靠走位碰运气，
   * 而靠运气的测试等于没测（跑三次绿一次不算证据）。 */
  place(x, y) {
    P.x = x; P.y = y; P.vx = 0; P.vy = 0;
    P.state = 'stand'; P.onGround = false;
    P.lock = 0; P.invuln = 0; P.dropT = 0;
    P_CW = P_W;
    return { x: P.x, y: P.y };
  },
  /* 调试：扣血。**只给测试用** —— 血瓶的"真喝了才回血"必须先把血打下来，
   * 否则只能靠"撞怪碰运气"，而碰运气的测试等于没测。
   * 走的是和敌人伤害同一个入口 hurtPlayer，不是另写一条扣血路径。 */
  hurt(n) { hurtPlayer(n, P.x + 40); return P.hp; },
  /* 调试：直接设血量。**只给测试用**。
   * 为什么必须有：hurt 只能单向减，而"血 40 时挨致死一刀"这种前置条件
   * 每次都得从满血减下来；上一条测试留下的残血会让这一条提前满足条件，
   * 测出来的现象看起来像 bug，其实是测试没隔离。 */
  setHp(n) { P.hp = Math.max(0, Math.min(P.hpMax, n)); return P.hp; },
  /* 调试：直接授予一个魂。**只给测试用**。
   * 为什么必须有：二段跳要 `SAVE.owned.has('djump')` 才认，而新存档里没有它 ——
   * 想量"双跃给多少增量"就只能先跑一趟关卡去捡，而那些捡法靠走位碰运气。
   * 和 setHp 同性质：把"前置条件"变成一行显式代码，而不是碰运气。 */
  grant(soul) { SAVE.owned.add(soul); return [...SAVE.owned].sort(); },
  /* 只读：活着的敌人快照。眩晕只能这样验 ——
   * 截图里"敌人没动"分不清是眩晕还是它本来就在原地。 */
  foes() {
    return enemies.filter(e => !e.dead).map(e => ({
      x: Math.round(e.x), y: Math.round(e.y), hp: e.hp, h: e.h,
      stunT: +(e.stunT || 0).toFixed(2), type: (e.def && e.def.type) || '',
    }));
  },
  /* 只读：最近说过的话。提示是画在 canvas 上的，DOM 里查不到；
   * 要断言"给了哪一句"（比如"血瓶空了"）就得把台词本露出来。 */
  said() { return SAY_LOG.slice(); },
  metrics() {
    const since = P.t - MET.spawnT;
    return {
      room: (room && room.id) || '',
      elapsed: +since.toFixed(2),
      timeToFirstFlat: MET.firstFlatAt < 0 ? null : +(MET.firstFlatAt - MET.spawnT).toFixed(2),
      firstUse: MET.firstFlatAt < 0 ? null : {
        at: +(MET.firstFlatAt - MET.spawnT).toFixed(2),
        kind: MET.firstUseKind,     // beforeGate = 发现；atGate = 被逼
      },
      flatUses: MET.flatUses,
      flatSeconds: +(MET.flatMs / 1000).toFixed(2),
      gateTime: MET.gateT < 0 ? null : +(MET.gateT - MET.spawnT).toFixed(2),
      /* 分三笔账（见 MET 的注释）。判据 2 只能用 voluntary 回答：
       * beforeGate 是判据 1（无提示发现），atGate 是引入本身，不能当证据。 */
      useBreakdown: {
        beforeGate: MET.useBeforeGate,
        atGate: MET.useAtGate,
        atGateAfterCross: MET.useAtGateAfter,
        voluntary: MET.useVoluntary,
      },
      mandatoryUses: MET.useAtGate,
      voluntaryReuses: MET.useVoluntary,
      contactsSuppressed: MET.contactsSuppressed,
      defensiveSaves: MET.defensiveSaves,
      shotsHit: MET.shotsHit,
      /* 兼容旧字段名：仍然表示"过墙之后自己在别处压过" */
      reuseAfterGate: MET.useVoluntary + MET.useAtGateAfter,
      voluntarilyReused: MET.gateT >= 0 && MET.useVoluntary > 0,
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
    /* 纸缝：比缝厚的东西一律当墙。侧身之后身体只有 6px，
     * 同一段代码自然就放行了 —— 不需要"如果玩家在 flat 状态"这种特判。 */
    if (ch === '|' && b.w > PAPER_W) return true;
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
    pickups.push({ x:it.x, y:it.y, soul:it.soul, ink:it.ink || 0, id:it.id, t:0, got:false,
                   reach:it.reach || 52, slim:!!it.slim });
  });
  if (spawnKey === 'left')       { P.x = px(2);  P.y = px(34) - P_H; }
  else if (spawnKey === 'right') { P.x = px(25); P.y = px(15) - P_H; }
  else                           { P.x = room.spawn.x; P.y = room.spawn.y - P_H; }
  P.vx = P.vy = 0; P.jumps = 0; P.state = 'stand'; P.animT = 0; P.invuln = 0.6;
  P.lock = 0; P.ceilBump = false; P.lookUp = false;
  P.atkPending = 0; P.atkBuf = 0;
  /* 换房间时把侧身彻底清掉：带着 6px 的碰撞宽度进新房间，
   * 会在第一帧就开始"卡墙"（而屏幕上什么异常都看不到）。 */
  P_CW = P_W; P.ink = P.inkMax;
  /* 埋点只在**换房间**时重记，复活不重记 —— 死了重来是同一场实验的一部分，
   * 死了就把"他到过必经缝"抹掉，等于把最贵的那个数扔了。 */
  if (MET.room !== room.id) { MET.room = room.id; metReset(); }
  camX = P.x + P_CW/2 - VIEW_W/2;
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
              onGround:false, dead:false, hurtT:0, stunT:0, dir:1, dmg:8 };
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
  /* 眩晕（P1：一击保护的副作用）：不推进 AI，也不造成接触伤害。
   * 必须连接触一起跳过 —— 只停动作不停判定的话，玩家刚在无敌帧里被救下来，
   * 又会被"原地不动的敌人"碰掉血，读起来像 bug。 */
  if (e.stunT > 0) {
    /* 必须 clamp 到 0：直接 -= dt 会留下 -0.01 这样的负数，
     * 负数一路跑到渲染和测试里，"眩晕结束了没"就变成"看运气"。 */
    e.stunT = Math.max(0, e.stunT - dt);
    e.hurtT = Math.max(e.hurtT || 0, e.stunT);
    if (e.stunT > 0) return;
    /* 刚走完：这一帧直接往下跑 AI，不要多停一帧 */
  }
  if (e.hurtT > 0) e.hurtT -= dt;
  const dxp = (P.x + P_CW/2) - (e.x + e.w/2);

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
    /* 会吐纸镖的蝙蝠（def.shoots，只在实验房里开）。
     * 为什么不是"新敌人类型"：它还是同一张纸，只是多了一个"吐出自己一角"的动作。
     * 实验需要它，因为"侧身躲得掉身体、躲不掉飞来的东西"这条规则
     * 光靠史莱姆证明不了 —— 没有投掷物，这条机制就只是个免伤开关。 */
    if (e.def.shoots) {
      e.shotT = (e.shotT || 0) + dt;
      if (e.shotT > 1.9 && Math.abs(dxp) < 470) {
        e.shotT = 0;
        const d = Math.sign(dxp) || 1;
        projectiles.push({ x:e.x + e.w/2 + d*14, y:e.y + e.h*0.5, vx:d*260, vy:0,
                           life:1.9, dmg:e.def.shotDmg || 8, kind:'dart', foe:true,
                           pierce:false, hits:new Set() });
        sfx('swing');
      }
    }
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

  /* 侧身的人**在同平面里没有身体**。这是机制的核心：
   * 躲掉的不是伤害，是厚度 —— 撞过来的东西是照着 28px 找目标的。
   * 但只免同平面的东西：飞来的投掷物照样打中（见 updateProjectiles）。 */
  const touch = overlap({ x:P.x, y:P.y, w:P_CW, h:P_H }, ebox(e));
  if (touch && P.invuln <= 0 && !P.dead) {
    if (P.state === 'flat') {
      /* 一次接触只记一次。留在原地不动时不该继续加数，
       * 否则 contactsSuppressed 记的是"站了多久"，不是"躲了几次"。 */
      if (!e._flatSkip) {
        e._flatSkip = true;
        MET.contactsSuppressed++;
        /* flatThreat = 按下那一刻最近的敌人距离。它区分两种人：
         * 「看见怪才压扁」（主动躲）和「一路压着走正好没被碰」（顺手）。
         * 分成两个数，是因为只有前者能证明这个动词被当成战术用了。 */
        if (P.flatThreat <= 160) MET.defensiveSaves++;
        burst(e.x + e.w/2, e.y + e.h/2, '#e8e2d2');
      }
    } else hurtPlayer(e.dmg, e.x + e.w/2);
  } else if (!touch) e._flatSkip = false;
}

// ============================ 玩家 ============================
function hurtPlayer(dmg, fromX) {
  if (P.invuln > 0 || P.dead) return;
  /* 一击保护（P1）：血 >25% 时，致命伤只留 1 HP，45 秒冷却。
   * 判定必须在扣血**之前** —— 扣完再补回来，中间会经过 hp<=0 的死亡分支，
   * 那等于先死一次再复活，血瓶、连击、存档全乱了。 */
  if (P.hp - dmg <= 0 && P.hp > P.hpMax * OHP_THRESHOLD && P.ohpCd <= 0) {
    P.hp = 1;
    P.ohpCd = OHP_CD;
    P.rally = 0; P.rallyT = 0;      // 血见底了，不该再指望夺回
    P.invuln = OHP_INVULN;          // 比普通受击长：否则下一帧又被打死
    P.cutOK = false;
    stunNearby(OHP_STUN_R, OHP_STUN_T);
    shakeIt(0.42, 15);
    hitStop = 0.12;
    sfx('slam');
    say('撑着 —— 还剩一口气');
    return;
  }
  /* 在缝里被打：**掉血但不击退**。
   * 28px 的击退会把人塞进两侧的墙里 —— 那不是惩罚，是卡死。
   * 所以先问一句"现在撑得开吗"，撑不开就只扣血。 */
  const stuckFlat = P.state === 'flat' && !tryEndFlat();
  P.hp -= dmg;
  P.invuln = 0.9;
  /* rally（P1）：把这次损失的一部分记成"可以夺回来的量"。
   * 用**覆盖**而不是累加：橙色血条在 DC 里代表"最近这一下"，连挨两下时
   * 第二下才是真该夺回的那笔。累加会让连续挨打反而攒出更多回血额度。 */
  P.rally = dmg * RALLY_CAP;
  P.rallyT = RALLY_WIN;
  if (stuckFlat) {
    P.animT = 0;
    P.cutOK = false;
    shakeIt(0.18, 6); hitStop = 0.05; sfx('hurt');
    if (P.hp <= 0) { P.hp = 0; P.dead = true; P.deadT = 0; sfx('death'); }
    return;
  }
  P.state = 'hurt'; P.animT = 0;
  /* 月下 RicStepHit：func_8015CAAC(FIX(-1.25)) + velocityY = FIX(-3)。
   * 换算到我们的尺度：击退 1.25×3×60 = 225px/s、击飞 3×3×60 = 540px/s。
   * 上一版垂直只给了 260，被打几乎不飘 —— 那是"挨一下继续走"，不是恶魔城。 */
  const dir = Math.sign(P.x + P_CW/2 - fromX) || 1;
  P.vx = dir * 225; P.vy = -540;
  P.cutOK = false;
  shakeIt(0.24, 9);
  hitStop = 0.07;
  sfx('hurt');
  if (P.hp <= 0) { P.hp = 0; P.dead = true; P.deadT = 0; sfx('death'); }
}

/* 一击保护的副作用：把身边的敌人按住 1 秒。
 * DC 的原文是"all nearby enemies are also stunned for about 1 second"，
 * 作用不是给奖励，是不让玩家在下一次无敌帧里被同一个敌人再补一刀。 */
function stunNearby(r, t) {
  for (const e of enemies) {
    if (e.dead) continue;
    const d = Math.hypot((e.x + e.w / 2) - (P.x + P_CW / 2),
                         (e.y + e.h / 2) - (P.y + P_H / 2));
    if (d <= r) {
      e.stunT = Math.max(e.stunT || 0, t);
      e.hurtT = Math.max(e.hurtT || 0, t);   // 顺手闪白，让"被震住"看得见
    }
  }
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
  P.atkPending = ATK_WINDUP;
  P.atkBuf = 0;                    // 缓冲是一次性的，用掉就清，不能连吃两刀
  /* 挥击弧：钉在角色身前的一道白弧，0.14s 内扫过去。
   * 为什么非要它：照片管线生成的 attack 只有 4 帧、姿态差异极小（真人照片本来就动不了），
   * 只靠精灵帧的话，按 J 屏幕上几乎看不出变化 —— 玩家结论就是"攻击键没反应"。 */
  /* 中心点放在**身前**，不是身体正中：正中时半径 30~50 的弧整个落在人物轮廓里，
   * 被精灵自己的像素吃掉 —— 我第一版就是这样，逻辑在跑、屏幕上看不见。 */
  particles.push({ arc:true, noGrav:true, vx:0, vy:0,
                   x:P.x + P_CW/2 + P.face*14, y:P.y + P_H*0.38, r:66, dir:P.face,
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
  const box = { x: P.face > 0 ? P.x + P_CW : P.x - reach, y: P.y + 22, w: reach, h: hh };
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
  /* rally（P1）：窗口内的**任何**伤害都能夺回，不限于普攻。
   * 只让近战回血会逼玩家放弃红魂和飞斧 —— 那不是"敢反打"，是"只许用剑"。
   * P.hp 允许是小数，HUD 那边 Math.round，不影响显示。 */
  if (P.rally > 0 && P.rallyT > 0 && !P.dead) {
    const back = Math.min(P.rally, dmg * RALLY_RATE);
    P.rally -= back;
    P.hp = Math.min(P.hpMax, P.hp + back);
    if (P.rally <= 0.5) { P.rally = 0; P.rallyT = 0; }
  }
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
    say('吸收魂：' + SOULS[s].name + '（' + keyName('menu').toUpperCase() + ' 装备）');
    const tp = SOULS[s].type;
    if (tp === 'blue' && !SAVE.equipped.blue) SAVE.equipped.blue = s;
    if (tp === 'yellow' && !SAVE.equipped.yellow) SAVE.equipped.yellow = s;
    if (tp === 'red' && !SAVE.equipped.red) SAVE.equipped.red = s;
    if (s === 'djump') say('双跃之魂到手 —— 回廊左侧那个高台现在能上了。');
    onProgress('soul');
  }
}

function castRed() {
  const id = SAVE.equipped.red;
  if (!id || P.cdRed > 0) return;
  const s = SOULS[id];
  P.cdRed = s.cd;
  P.state = 'cast'; P.animT = 0;
  if (id === 'fire') {
    projectiles.push({ x:P.x + P_CW/2 + P.face*24, y:P.y + 34, vx:P.face*460, vy:0,
                       life:1.1, dmg:24, kind:'fire', pierce:false, hits:new Set() });
  } else {
    projectiles.push({ x:P.x + P_CW/2, y:P.y + 20, vx:P.face*260, vy:-340,
                       life:1.6, dmg:20, kind:'axe', pierce:true, hits:new Set(), spin:0 });
  }
}

/* 喝血瓶。判定顺序写死成"冷却 → 空瓶 → 满血"：
 * 满血也消耗一瓶是最容易犯的错 —— 玩家在血满时误触，瓶子就没了，而且没有回退。
 * 这三条都是"拒绝执行"，不是"执行失败"，所以一律不改状态、只给一句话。 */
function useFlask() {
  if (P.dead || P.flaskCd > 0) return false;
  if (P.flasks <= 0) { say('血瓶空了'); P.flaskCd = 0.6; return false; }
  if (P.hp >= P.hpMax) { say('血是满的'); P.flaskCd = 0.6; return false; }
  P.flasks--;
  P.hp = Math.min(P.hpMax, P.hp + Math.round(P.hpMax * FLASK_HEAL));
  P.flaskCd = 0.9;
  /* 喝药重置一击保护的冷却（DC 的规则："drinking a potion"就能重置）。
   * 这条给了血量管理第二个用途：不只是续命，还是"把免死赎回来"。 */
  P.ohpCd = 0;
  P.flaskFx = 0.55;          // 只有**真喝下去**才闪，被拒绝的那三句不闪
  onProgress('flask');
  return true;
}

/* 拿一件东西。自动拾取和交互键共用同一条路 ——
 * "走过去自动捡"和"按交互键伸手捡"不能是两份逻辑，否则物品状态会分叉。 */
function takeItem(it) {
  if (it.got) return;
  it.got = true;
  SAVE.flags.add('took_' + room.id + '_' + it.id);
  /* 墨囊不是魂：它不给能力，只给一次墨。
   * 走独立分支而不是塞进 SOULS，是因为两者回答的问题不同 ——
   * 魂回答"我还会什么"，墨回答"我还能不能继续侧身"。 */
  if (it.ink) {
    P.ink = Math.min(P.inkMax, P.ink + it.ink);
    say('墨囊：+' + it.ink + ' 墨');
    sfx('pickup');
    onProgress('pickup');
    return;
  }
  SAVE.owned.add(it.soul);
  const tp = SOULS[it.soul].type;
  if (tp === 'blue' && !SAVE.equipped.blue) SAVE.equipped.blue = it.soul;
  if (tp === 'yellow' && !SAVE.equipped.yellow) SAVE.equipped.yellow = it.soul;
  say('获得魂：' + SOULS[it.soul].name + '（' + keyName('menu').toUpperCase() + ' 装备）');
  sfx('pickup');
  onProgress('pickup');
}

/* 交互键 = 伸手拿东西。《重生细胞》的交互键主要也干这个（捡装备、开门、对话）。
 * 自动拾取半径只有 reach（默认 52），够不到的时候按这个键能多伸 60px ——
 * 这样它从一开始就有真实用途，不是"先摆一个按钮，以后再接功能"。 */
const USE_REACH = 112;
function interact() {
  let best = null, bd = 1e9;
  for (const it of pickups) {
    if (it.got) continue;
    const d = Math.hypot(it.x - (P.x + P_CW/2), (it.y - 26) - (P.y + P_H/2));
    /* 半径取 min(伸手距离, 物品自己的 reach)。
     * 只写 USE_REACH 是错的 —— 走路拾取那一支（update 第 9 步）尊重 it.reach，
     * 缝里那个墨囊用 24 就是为了"站着吸不走"，而 E 键用 112 会把它隔着墙拿走，
     * "只能侧身拿到"的教学点当场失效。伸手不该比走过去踩到还强。 */
    const reach = Math.min(USE_REACH, it.reach);
    if (d <= reach && d < bd) { bd = d; best = it; }
  }
  if (best) { takeItem(best); return; }
  say('这儿没有可拿的东西');
}

/* 蓝槽：激活式增益。原来是"按住持续耗蓝"，现在点一下就进入 3 秒滑翔。
 * 为什么必须改：手机上"按住蓝"和"按住跳"抢同一个拇指，两个持续动词打架；
 * 《重生细胞》的技能也全是点按触发、时长写进冷却。 */
function castBlue() {
  const id = SAVE.equipped.blue;
  if (!id || P.cdBlue > 0) return;
  const s = SOULS[id];
  P.cdBlue = s.cd;
  if (id === 'glide') { P.glideT = s.dur; P.state = 'cast'; P.animT = 0; }
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
    actDone('slide');                 // 只有真的滑出去了才回执
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
  burst(P.x + P_CW/2, P.y + P_H, '#9fd8ff');
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
    particles.push({ x:P.x + P_CW/2 + P.face*10, y:P.y + P_H*0.7,
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
  for (const x of [P.x + 3, P.x + P_CW/2, P.x + P_CW - 3]) if (tileAt(x, fy) === '=') n++;
  return n >= 2;
}

/* 下 + 攻击 = 从薄地板掉下去（AoS 手册原文 "Drop through thin floors"）。
 * 逐像素往下找一个"脚已经离开 '=' 格、且身体没插进实心"的位置：
 * 一次跳一大步会插进下面紧贴的实心地面，或者卡在板里被传感器按回去。 */
function dropThrough() {
  let best = P.y;
  for (let i = 1; i <= TILE + 6; i++) {
    const ny = P.y + i;
    if (solidBox({ x:P.x, y:ny, w:P_CW, h:P_H })) break;
    best = ny;
    if (tileAt(P.x + P_CW/2, ny + P_H + 1) !== '=') break;
  }
  if (best === P.y) return;                 // 底下就是实心，掉不下去
  P.y = best; P.vy = 150; P.dropT = 0.20;
  P.onGround = false; P.state = 'fall';
  actDone('plate');                         // 只有真的掉下去了才回执
  for (let i = 0; i < 5; i++) {
    particles.push({ x:P.x + P_CW/2 + (Math.random()-0.5)*18, y:P.y + P_H - 2,
      vx:(Math.random()-0.5)*70, vy:-Math.random()*30, life:0.3, c:'#8d8478' });
  }
  sfx('step');
}


/* ======================== 侧身（Flatten，S4）========================
 * 这个动词的设计意图只有一句：**厚度是世界的物理量**。
 * 不是"按一下获得无敌"，是"按一下，身体从 28px 变成 6px"。于是三件事自动成立：
 *   1. 一格宽的纸缝，站着进不去，侧身进得去 —— 关卡形状本身就是教学，不用写提示
 *   2. 同平面撞过来的身体打不到你（它们瞄的是 28px 的东西）
 *   3. 飞来的投掷物照样打中（它走的是"这条线"，不是"这个身体"）
 * 代价同样三条，少一条就变成外挂：不能攻击、不能跳、烧墨。
 */

/* 当前最近的活敌人有多远。只算本房间、没死的。 */
function nearestEnemyDist() {
  let best = 999;
  for (const e of enemies) {
    if (e.dead) continue;
    const d = Math.hypot((e.x + e.w / 2) - (P.x + P_CW / 2),
                         (e.y + e.h / 2) - (P.y + P_H / 2));
    if (d < best) best = d;
  }
  return best;
}

/* 灯是唯一的墨来源。判据写成"人在灯旁边"而不是"在灯的某一格里"：
 * 格子判定会让玩家站在灯下偏一格就补不到，读起来像灯坏了。 */
function nearLamp() {
  for (const l of (room.lamps || [])) {
    if (Math.abs(l.x - (P.x + P_CW / 2)) < INK_NEAR &&
        Math.abs((l.y - P_H) - P.y) < INK_NEAR) return true;
  }
  return false;
}

function beginFlat() {
  if (P.state === 'flat' || P.dead) return false;
  if (P.lock > 0 || P.ink <= 0) return false;
  if (P.state === 'hurt' || P.state === 'slide' ||
      P.state === 'dash' || P.state === 'attack' || P.state === 'cast') return false;
  P.state = 'flat'; P.animT = 0;
  P_CW = FLAT_W;
  /* 压扁给一点纵向拉伸：横向收到 6px 的同时略微长高，
   * 读起来是"被压薄了"，不是"变小了"。 */
  P.sq = 1.06;
  P.flatThreat = nearestEnemyDist();
  MET.flatUses++;
  if (MET.firstFlatAt < 0) MET.firstFlatAt = P.t;
  /* 分账点在**按下的边沿**上，不记"处在 flat 状态的时长" ——
   * 后者会把"过缝时一直按着"算成复用，指标就自己骗自己了。
   * 位置判据用 gateX：墙跟前 90px 内算强制型。 */
  {
    const cenX = P.x + P_CW / 2;
    const atGate = room && room.gateX != null && Math.abs(cenX - room.gateX) < GATE_ZONE;
    if (MET.gateT < 0) {
      if (atGate) { MET.useAtGate++; if (!MET.firstUseKind) MET.firstUseKind = 'atGate'; }
      else { MET.useBeforeGate++; if (!MET.firstUseKind) MET.firstUseKind = 'beforeGate'; }
    } else {
      if (atGate) MET.useAtGateAfter++;
      else MET.useVoluntary++;
    }
  }
  sfx('paper');
  for (let i = 0; i < 5; i++) {
    particles.push({ x:P.x + P_CW / 2 + (Math.random() - 0.5) * 20, y:P.y + P_H * 0.5,
      vx:(Math.random() - 0.5) * 70, vy:-Math.random() * 40, life:0.3, c:'#d8cdb4' });
  }
  return true;
}

/* 起身必须**先量空间再改宽度**。顺序反了就是穿墙：
 * 先把 P_CW 改回 28，人已经和墙重叠了，再判"能不能站"永远判不成立。 */
function tryEndFlat() {
  if (P.state !== 'flat') return true;
  if (solidBox({ x:P.x, y:P.y, w:P_W, h:P_H })) return false;   // 缝里，站不起来
  P.state = P.onGround ? 'stand' : 'fall';
  P.animT = 0;
  P_CW = P_W;
  P.sq = 1.10;
  return true;
}

/* 侧身不是一个"动作"，是一个**状态**：它只申请朝向和重力。
 * 不申请 ATTACK / JUMP / CRASH / BACK / CROUCH ——
 * 于是"禁攻禁跳"是输入集本身的结果，不是散落在各处的 if。 */
function stepFlat(dt) {
  checkInput(CK.FACING | CK.GRAV_FALL, dt);
  /* 侧着挪不可能和站着一样快。这一条同时堵住"拿侧身当加速"。 */
  if (padDown('left') || padDown('right')) P.vx = P.face * SPD_RUN * FLAT_SPD;
  else { decelX(FRIC_G, dt); P.vx *= 0.9; }
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
  /* P1 取消后摇：过了判定帧就能用后跃打断。
   * 判据是 animT（这一招走了多久），不是"什么时候按的 back" ——
   * 前摇里猛按不该提前生效，那是预输入，不是取消。
   * 只发地面：后跃本来就没有空中版本（见 doBackdash）。 */
  if (P.onGround && P.animT >= ATK_WINDUP && padTap('back')) {
    P.lock = 0;                 // 先解锁，否则 doBackdash 设的 lock 会被这一帧的收尾顶掉
    doBackdash();
    return;
  }
  if (P.animT >= ATK_DUR) {
    P.lock = 0;
    /* 判 atkCd 而不是无条件起 —— 两者现在都是 0.30，但那是巧合，
     * 以后谁调了其中一个，这里不该跟着哑掉。
     * 留 1ms 容差：animT 与 atkCd 同 dt 递减，浮点上可能差最后一步，
     * 差这一丝就把缓冲吞掉，等于"绝大多数时候好使"。 */
    if (P.atkBuf > 0 && P.atkCd <= 0.001) { P.atkBuf = 0; startAttack(); return; }
    P.state = P.onGround ? 'stand' : 'fall';
  }
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
  const xs = [P.x + 3, P.x + P_CW / 2, P.x + P_CW - 3];
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
  const body = { x:P.x, y:P.y, w:P_CW, h:P_H };

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
      particles.push({ x:P.x + P_CW/2 + (Math.random()-0.5)*22, y:P.y + P_H - 2,
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
  /* P1 计时：rally 窗口过了就清空额度（血已经"愈合"了，不能留着慢慢夺）；
   * 一击保护的冷却独立走，不随复活重置 —— 否则死一次就白送一次免死。 */
  if (P.rallyT > 0) { P.rallyT -= dt; if (P.rallyT <= 0) { P.rallyT = 0; P.rally = 0; } }
  if (P.ohpCd > 0) P.ohpCd = Math.max(0, P.ohpCd - dt);
  if (P.atkCd > 0) P.atkCd -= dt;
  if (P.castCd > 0) P.castCd -= dt;
  if (P.cdRed > 0) P.cdRed = Math.max(0, P.cdRed - dt);
  if (P.cdBlue > 0) P.cdBlue = Math.max(0, P.cdBlue - dt);
  if (P.flaskCd > 0) P.flaskCd = Math.max(0, P.flaskCd - dt);
  if (P.flaskFx > 0) P.flaskFx = Math.max(0, P.flaskFx - dt);
  if (P.lock > 0) P.lock -= dt;
  if (P.coyote > 0) P.coyote -= dt;
  if (P.jumpBuf > 0) P.jumpBuf -= dt;
  if (P.dropT > 0) P.dropT -= dt;
  if (P.atkPending > 0) { P.atkPending -= dt; if (P.atkPending <= 0) doAttackHit(); }
  if (P.atkBuf > 0) P.atkBuf -= dt;

  /* 血瓶：和四格一样是"点一下就使用"，所以走 padTap 而不是 padHeld */
  if (padTap('heal')) useFlask();

  /* ---- 侧身：点一下扁、再点一下起来（切换）----
   * 原来这里是"按住"，松手就起身。改切换是为了对齐《重生细胞》——
   * 它四个格子全是"点一下就使用"，没有一个是按住才算数的。
   * "按住"当时防的是"玩家忘记自己还扁着"，这个风险现在由两条兜底：
   *   1) 墨见底自动起身（本来就有的规则）；
   *   2) 侧身时不能攻不能跳，玩家想动手就必须先起来。
   * tryEndFlat 里的空间检测照旧：在缝里点也不起来，不会穿墙。 */
  if (padTap('flat')) {
    if (P.state === 'flat') {
      /* 起身失败（还在缝里）不是"没听见"，是"记住了但做不到"。 */
      if (!tryEndFlat()) P.flatWantStand = true;
      else P.flatWantStand = false;
    } else {
      P.flatWantStand = false;
      if (!beginFlat() && P.ink <= 0) say('墨尽了 —— 找灯');
    }
  }
  if (P.state === 'flat') {
    P.ink = Math.max(0, P.ink - FLAT_DRAIN * dt);
    MET.flatMs += dt * 1000;
    if (P.ink <= 0) { tryEndFlat(); P.flatWantStand = false; }
    /* 意图兑现：一离开缝（能站直了）就自动起来，不用玩家再点一次。 */
    else if (P.flatWantStand && tryEndFlat()) P.flatWantStand = false;
  }
  /* 灯只在不扁的时候补。站在灯下扁着不动就能无限续航，
   * 这个漏洞比"墨不够用"糟糕得多。 */
  if (P.state !== 'flat' && P.ink < P.inkMax && nearLamp()) {
    P.ink = Math.min(P.inkMax, P.ink + INK_REFILL * dt);
  }

  // 2. 蓝魂滑翔（激活式：点一下 3 秒，走 CD）
  if (P.glideT > 0) P.glideT = Math.max(0, P.glideT - dt);
  const gliding = SAVE.equipped.blue === 'glide' && P.glideT > 0 && P.vy > 60;
  /* 按键必须有回声。没装备 / 冷却中按下去屏幕上什么都不发生，
   * 玩家只能得出"这个键坏了"的结论。一句提示的成本是 0，省掉一轮排查。 */
  if (padTap('blue')) {
    if (!SAVE.equipped.blue) say('没有装备蓝魂（' + keyName('menu').toUpperCase() + ' 打开魂匣）');
    else if (P.cdBlue > 0) say('冷却中 ' + P.cdBlue.toFixed(1) + 's');
    else castBlue();
  }

  /* 交互键：伸手拿东西。没有可拿的就直说 —— 一个按下去毫无反应的键，
   * 玩家只会判断"这游戏坏了"，而不会判断"这里没有东西可捡"。 */
  if (padTap('use')) interact();

  /* ↑ 抬头只在"站着"有意义（原版 press_up 是站立/走路的姿态切换，不是动作）。
   * 集中在这里判，而不是塞进每个 step —— 上一版只在 stepStand 里写，
   * 于是"走路时按 ↑"用的是上一帧的残留值，而"蹲下时按 ↑"会把抬头的姿态带一帧。
   * 统一条件：地上、没锁、不是蹲/滑。 */
  P.lookUp = P.onGround && P.lock <= 0 && padDown('up')
             && P.state !== 'crouch' && P.state !== 'slide';

  /* 判定帧之后按的，记进缓冲；前摇里按的照旧丢掉。
   * 位置必须在状态分派**之前**：按在收招那一步上的输入也要算数，
   * 放到分派之后，那一帧的 tap 会因为状态已经翻成 stand 而白按。 */
  if (padTap('atk') && P.state === 'attack' && P.animT >= ATK_WINDUP) P.atkBuf = ATK_BUF;

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
    case 'flat':   stepFlat(dt);   break;
    default:       stepFall(dt);   break;
  }

  // 4. 跳跃缓冲 / 土狼时间（modern 才有）
  /* 跳跃缓冲按**整步数**记，不按秒记：
   * 以前这里是 dt * 1.5 —— dt 一换（S1 从 16.7ms 变成 8.33ms）缓冲就自己减半，
   * 这不是谁调的手感，是单位的锅。3 步 = 25ms，和 60fps 时 dt*1.5 等价。 */
  if (padTap('jump') && P.state !== 'flat') P.jumpBuf = JBUF_TICKS * FIXED_DT;

  // 5. 滑翔限制下落
  if (gliding) {
    P.vy = Math.min(P.vy, 140);
    if (Math.random() < dt * 24) particles.push({ x:P.x+P_CW/2+(Math.random()-0.5)*22, y:P.y+P_H, vx:0, vy:50, life:0.3, c:'#8fd0ff' });
  }

  // 6. 物理：位置 + 碰撞（统一做，状态函数碰不到 x/y）
  physics(dt);

  /* 必经缝：第一次**身体中心**越过 gateX 的那一刻。
   * 用中心而不是左边缘 —— 左缘贴到就记，会让"站在缝口张望"也算过墙。 */
  if (MET.gateT < 0 && room.gateX != null && (P.x + P_CW / 2) > room.gateX) {
    MET.gateT = P.t;
  }

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

  if (P.onGround && P.state !== 'flat' && Math.abs(P.vx) > 60) {
    P.stepT += moveDx;
    if (P.stepT > 62) {
      P.stepT = 0; sfx('step');
      /* 一脚 = 两粒土。这是"我真的在走"最便宜的证明，比任何 UI 都直观。 */
      for (let i = 0; i < 2; i++) {
        particles.push({ x:P.x + P_CW/2 - P.face*10 + (Math.random()-0.5)*14, y:P.y + P_H - 2,
                         vx:-P.face*(20+Math.random()*40), vy:-(10+Math.random()*30),
                         life:0.26, c:'#8d8578' });
      }
    }
  } else P.stepT = 40;

  // 9. 拾取
  for (const it of pickups) {
    if (it.got) continue;
    /* reach 默认 52，可以按道具缩小（缝里那个墨囊用 24）。
     * 为什么需要这个参数：缝只有 4px，站着的人中心离缝中线才 38.5px ——
     * 用 52 的话，人站在墙外就把"卡在缝里"的东西吸走了，机制等于不存在。
     * 半径是**规则**，不是手感参数，所以它必须能被单独调。 */
    const d = Math.hypot(it.x - (P.x + P_CW/2), (it.y - 26) - (P.y + P_H/2));
    if (d > it.reach) continue;
    takeItem(it);
  }

  // 10. 传送门
  const pcx = Math.floor((P.x + P_CW/2) / TILE), pcy = Math.floor((P.y + P_H - 6) / TILE);
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
  P.dead = false; P.deadT = 0; P.hp = P.hpMax;
  /* 血瓶跟着复活回满。不回满的话，"死一次"会连带把血瓶永久削掉几瓶 ——
   * 玩家下一条命还没开打就先输一截，而且没有任何补回来的途径。
   * 血瓶的定位是"这一条命里的容错"，不是跨命的存款。 */
  P.flasks = P.flaskMax;
  /* 复活即满血 ⇒ 一击保护的冷却跟着归零（DC："回满可重置"）。
   * rally 也清掉：人都满血了，留着额度没有意义。 */
  P.ohpCd = 0; P.rally = 0; P.rallyT = 0;
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
    /* 纸缝也挡投射物。缝是"墙上的洞"，不是空气墙 ——
     * 如果镖能穿过去，玩家就会发现"缝"和"走廊"没区别，
     * 那厚度（也就是这个机制本身）就不成立了。 */
    if (t === '#' || t === '=' || t === 'H' || t === '|') p.life = 0;
    if (p.foe) {
      /* 敌人扔出来的东西**不看厚度**：它飞的是"这条线"，不是"这个身体"。
       * 这是侧身唯一的破绽，也是它没变成免伤外挂的原因。 */
      if (!p.hitP && !P.dead && P.invuln <= 0 &&
          overlap({ x:p.x - 9, y:p.y - 9, w:18, h:18 },
                  { x:P.x, y:P.y, w:P_CW, h:P_H })) {
        p.hitP = true;
        MET.shotsHit++;
        hurtPlayer(p.dmg, p.x);
        p.life = 0;
      }
      continue;
    }
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
  /* 眉 = 一道折痕，不是一对怒眉（裁定 Q15）。
   * 上一版 2.5px、alpha .85、内倾 20°，那是卡通怪物的写法 ——
   * "被拍坏的照片"要的是**受过的损**，不是**正在生气**。
   * 压到 1.2px、alpha .38、几乎水平：情绪还在，但读作纸上的压痕。 */
  ctx.strokeStyle = 'rgba(32,24,17,.38)'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.27, ey - 7); ctx.lineTo(cx - w * 0.10, ey - 5.6);
  ctx.moveTo(cx + w * 0.27, ey - 7); ctx.lineTo(cx + w * 0.10, ey - 5.6);
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

/* 墙上的一道缝。为什么不能直接"画一条黑缝"：
 * 石头哈希会给这一列抽到最暗的一块，于是那 2px 墨线读成
 * "两堵墙之间的空隙" —— 语义从"纸被划开"变成"这里根本不是墙"。
 * 所以整格先提亮 6%，让它在视觉上仍然**属于这堵墙**，再把缝压成 2px。 */
function drawSlit(ctx, x, y, tx, ty) {
  drawStone(ctx, x, y, tx, ty);
  /* 整格只提亮 1.5%。上一版 6%、再上一版 3.5%，在 1:1 下这一列都比旁边亮一档 ——
   * 读出来是"这里换了一种砖"，不是"这堵墙被划开了"。
   * 真正撑住"这是墙"的是缝两侧的暗影，不是这一层提亮。 */
  ctx.fillStyle = 'rgba(232,226,214,.015)';
  ctx.fillRect(x, y, TILE, TILE);
  const cx = x + TILE / 2;
  /* 缝本体 4px。上一版是 2px，在暗墙上被两侧暖边夹成**一根发亮的线** ——
   * 那正好是"压扁的人"的轮廓，两者撞脸。让黑更宽、亮边更弱，
   * 读出来才是"墙被划开一道"，而不是"墙里嵌了一条灯丝"。 */
  /* 缝的断面，由外往里：1px 暗影 → 1px 冷边 → 4px 墨芯 → 1px 冷边 → 1px 暗影。
   * 外面那对**暗影**是关键：没有它，两条冷边就是两根白线，合起来像一根电缆
   * （1:1 截图里确实读成了电缆）。有了黑边，读出来才是"石头被切开一道沟"。
   * 冷色是裁定 Q13 的色彩法：环境全冷，人/敌人/道具/光全暖 ——
   * 于是侧身的人（暖）和缝（冷）在任何光照下都不会再撞脸。 */
  /* 缝芯 6px，不是 4px：侧身的人宽 6px，缝比人窄的时候，
   * 人会有一半画在石头上 —— 1:1 看就是"一根暖色的木棍插在砖里"。
   * 缝至少要不窄于人，画面才不撒谎。（站着的人 28px 仍然进不去，
   * 碰撞判据是 w > PAPER_W(12)。） */
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(cx - 5, y, 1, TILE);
  ctx.fillRect(cx + 4, y, 1, TILE);
  ctx.fillStyle = 'rgba(150,172,214,.12)';
  ctx.fillRect(cx - 4, y, 1, TILE);
  ctx.fillRect(cx + 3, y, 1, TILE);
  ctx.fillStyle = '#05040a';
  ctx.fillRect(cx - 3, y, 6, TILE);
  /* 缝里的冷光：贴着中线的一条竖光，中段最亮。
   * "后面有光"是"能进去"的唯一线索；它必须是冷的，
   * 暖光会把这道理缝变成第二个"压扁的人"。 */
  const lg = ctx.createLinearGradient(0, y, 0, y + TILE);
  lg.addColorStop(0, 'rgba(150,180,235,0)');
  lg.addColorStop(0.5, 'rgba(150,180,235,.20)');
  lg.addColorStop(1, 'rgba(150,180,235,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(cx - 0.5, y, 1, TILE);
  // 毛边碎屑：位置由哈希定死，不闪；同样归冷色
  for (let i = 0; i < 6; i++) {
    const fy = y + Math.floor(hash2(tx, ty, i * 5 + 2) * TILE);
    const side = hash2(tx, ty, i * 5 + 3) > 0.5 ? 1 : -1;
    const len = 2 + hash2(tx, ty, i * 5 + 4) * 5;
    ctx.fillStyle = 'rgba(160,178,210,.09)';
    ctx.fillRect(side > 0 ? cx + 4 : cx - 4 - len, fy, len, 1);
  }
}

/* 纸灯笼（裁定 Q14）：原来是"现代落地灯"轮廓（三角灯罩 + 细杆），
 * 好读但和纸的世界不搭。换成简化纸灯笼 —— 保留两件必须保留的东西：
 *   ① 轮廓清楚（宽的桶形，一眼和 6px 的人分开）；
 *   ② 光源不容误认（暖色、亮、有光晕，房间里唯一的暖光源）。
 * "简化"是指去掉骨架、提杆、流苏这些细节，只留桶身 + 竖棱 + 上下箍。 */
function drawLamp(ctx, l) {
  const bx = l.x, by = l.y;                      // by = 地面那一格的顶边
  /* 呼吸，不闪烁。幅度 12%、周期 2.6s：
   * 闪烁读成"坏了"，呼吸读成"还活着"。 */
  const br = 0.88 + Math.sin(P.t * 2.4) * 0.12;
  const g = ctx.createRadialGradient(bx, by - 118, 6, bx, by - 118, 172 * br);
  g.addColorStop(0, 'rgba(255,206,138,' + (0.30 * br).toFixed(3) + ')');
  g.addColorStop(0.45, 'rgba(255,190,120,' + (0.10 * br).toFixed(3) + ')');
  g.addColorStop(1, 'rgba(255,190,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(bx - 185, by - 300, 370, 320);

  // 灯杆（细，别抢轮廓）
  ctx.fillStyle = '#241d2c'; ctx.fillRect(bx - 2, by - 96, 4, 96);
  ctx.fillStyle = 'rgba(220,200,240,.10)'; ctx.fillRect(bx - 2, by - 96, 1, 96);

  /* 桶身：上窄下宽、中间略鼓 —— 纸灯笼的形。
   * 关键是**先画内芯的光，再压纸面**：纸是被里面照亮的，不是自己发白。
   * 上一版直接把纸面涂成 #e8dcc0，1:1 看像一个塑料杯子。 */
  const wTop = 17, wBot = 23, yT = by - 158, yB = by - 96;
  const inner = ctx.createRadialGradient(bx, (yT + yB) / 2, 2, bx, (yT + yB) / 2, 40);
  inner.addColorStop(0, 'rgba(255,236,190,.95)');
  inner.addColorStop(0.55, 'rgba(255,196,120,.60)');
  inner.addColorStop(1, 'rgba(255,170,96,0)');
  ctx.fillStyle = inner;
  ctx.fillRect(bx - 34, yT - 8, 68, (yB - yT) + 16);

  const body = ctx.createLinearGradient(0, yT, 0, yB);
  body.addColorStop(0, 'rgba(226,203,164,.80)');
  body.addColorStop(0.42, 'rgba(255,240,208,.88)');
  body.addColorStop(1, 'rgba(236,212,172,.82)');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(bx - wTop, yT + 4);
  ctx.quadraticCurveTo(bx - wBot - 4, (yT + yB) / 2, bx - wBot, yB);
  ctx.lineTo(bx + wBot, yB);
  ctx.quadraticCurveTo(bx + wBot + 4, (yT + yB) / 2, bx + wTop, yT + 4);
  ctx.closePath(); ctx.fill();

  // 竖棱：纸灯笼的"骨"，也是"这是纸"的唯一证据
  ctx.strokeStyle = 'rgba(126,100,64,.34)';
  ctx.lineWidth = 1;
  for (const t of [-0.62, -0.22, 0.22, 0.62]) {
    ctx.beginPath();
    ctx.moveTo(bx + wTop * t, yT + 5);
    ctx.quadraticCurveTo(bx + (wBot + 4) * t, (yT + yB) / 2, bx + wBot * t, yB - 1);
    ctx.stroke();
  }
  // 上下箍：两块深色纸箍，把桶形封住
  ctx.fillStyle = '#2a2130';
  ctx.fillRect(bx - wTop - 2, yT, (wTop + 2) * 2, 5);
  ctx.fillRect(bx - wBot - 1, yB - 3, (wBot + 1) * 2, 4);
  // 底口的光：整盏灯最亮的一条，告诉眼睛"光从这儿出来"
  ctx.fillStyle = 'rgba(255,226,160,.75)'; ctx.fillRect(bx - wBot + 2, yB - 2, (wBot - 2) * 2, 3);
  // 顶上的提环
  ctx.strokeStyle = 'rgba(120,104,84,.55)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(bx, yT - 1, 3.5, Math.PI, 0); ctx.stroke();
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
  } else if (ch === '|') {
    drawSlit(ctx, x, y, tx, ty);
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
   * 于是"手机能开、键盘不能"这类错位只是时间问题。
   *
   * 调布局时不接受 START：玩家手上正在拖格子，这时候弹菜单等于把刚摆好的
   * 位置盖住，而且菜单一开 hideplay 就把格子藏了（拖到一半人没了）。 */
  if (padTap('menu') && !editPause) { actReleaseTouch(); toggleMenu(); }

  if (msgT > 0) msgT -= dt;
  if (shakeT > 0) { shakeT -= dt; if (shakeT <= 0) { shakeT = 0; shakeAmp = 0; } }

  // 顿帧：世界停住，但提示、震屏、镜头照常走 —— 否则打中的那一帧"什么都没发生"
  if (hitStop > 0) {
    hitStop -= dt;
  } else if (!ended && !menuOpen && !editPause) {
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
  const tx = P.x + P_CW/2 - VIEW_W/2 + lookX;
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

  /* 灯画在地形之上、人物之下：它是"贴在这面墙上的东西"，
   * 挡在人前面会读成一盏悬在空中的灯笼。 */
  if (room.lamps) for (const l of room.lamps) drawLamp(ctx, l);

  // 展厅里的"展品"（画在人物之后、玩家之前 = 贴在墙上）
  // −26：画框要离地悬着。贴在踢脚线上的画框会读成"站在地上的人"，这是上一版的错。
  if (room.portraits) for (const p of room.portraits) drawWallMan(ctx, px(p.tx), px(p.ty) - 26, p.n);

  for (const it of pickups) {
    if (it.got) continue;
    const bob = Math.sin(it.t * 3) * 5;
    ctx.save();
    /* slim：卡在缝里的东西只能是一道细光。8px 的球会盖住 4px 的石头缝，
     * 读出来变成"墙上粘了颗珠子"。细光 + 晕开的暖雾才读成"缝里有东西在亮"，
     * 而且暖光外溢是合法的 —— 光当然会漏到石头上。 */
    const core = it.slim ? 2.5 : 8, halo = it.slim ? 10 : 20;
    ctx.globalAlpha = it.slim ? 0.26 : 0.22; ctx.fillStyle = '#ffd75e';
    ctx.beginPath(); ctx.arc(it.x, it.y - 30 + bob, halo, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = it.slim ? '#fff1c2' : '#ffd75e';
    ctx.beginPath(); ctx.arc(it.x, it.y - 30 + bob, core, 0, Math.PI*2); ctx.fill();
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
    /* 贴着缝的时候，画到缝中线上去（只影响绘制，不影响碰撞）。
     * 原因：缝芯 6px、人也是 6px，但碰撞是**整格 48px** 都算"缝内" ——
     * 人从左边走进去的那几帧，身体其实落在石头上，1:1 截图里就是
     * "一根暖色的木棍插在砖里"。按 0.6 的比例往缝中线吸，最多偏 9px，
     * 连续、不跳变，读出来是"身体顺着缝贴进去"。 */
    let feetX = P.x + P_CW/2;
    if (P.state === 'flat') {
      const stx = Math.floor(feetX / TILE), sty = Math.floor((P.y + 6) / TILE);
      if (room && room.g[sty] && room.g[sty][stx] === '|') {
        const seamCx = stx * TILE + TILE / 2;
        feetX += (seamCx - feetX) * 0.6;
      }
    }
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
    if (P.state === 'flat') {
      /* 侧身 = **把人压成一条**，而不是另画一条线。
       * 第一版是手画一根墨线 + 亮边，结果它和墙上的纸缝长得一模一样 ——
       * 玩家会找不到自己（这不是审美问题，是可用性问题）。
       * 正确做法：把同一张精灵横向压到 6px，竖向不动。
       * 压完之后上下仍是原色（头发、绿外套、裤子），读出来是"人转了个面"。 */
      /* 呼吸光晕**必须是渐变的**。第一版是一个 20px 宽、alpha 0.13 的硬边矩形，
       * 放大之后是一个发白的方块 —— 读起来像 UI 的选中框，不像"人在发光"。
       * 方块的边和角都太具体了；软掉的径向渐变才读成"这里有个人在喘"。 */
      const breath = 0.16 + Math.sin(P.t * 3.4) * 0.05;
      const hg = ctx.createRadialGradient(feetX, P.y + P_H * 0.45, 0,
                                          feetX, P.y + P_H * 0.45, 34);
      hg.addColorStop(0, 'rgba(255,217,160,' + breath.toFixed(3) + ')');
      hg.addColorStop(1, 'rgba(255,217,160,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(feetX - 34, P.y - 24, 68, P_H + 48);
      /* 运动拖影（裁定 Q12）。接受"一条线"，但一条**静止的**线只是线；
       * 一条在动的线才是"人在动"。所以拖影只表达速度：
       * 三层各自独立、逐层变淡的窄条跟在身后 —— 不是把 6px 拉宽成 20px。
       * 压扁那一瞬也吃这个：P.sq 的纵向拉伸让残影比本体长一点，
       * 读出来是"刚被拍扁还没回弹"，而不是"突然冒出个东西"。 */
      /* 压扁那一瞬的残影：P.sq 从 1.06 落回 1 的这几帧里，身体两侧各留一道极淡竖痕，
       * 然后消失。它不加宽本体（痕迹离得开、且立刻淡掉），但"被拍扁"这一下有交代。 */
      if (P.sq > 1.004) {
        const a = Math.min(0.30, (P.sq - 1) * 5);
        ctx.globalAlpha = a; ctx.fillStyle = '#ffeccb';
        ctx.fillRect(feetX - 6, P.y + 6, 2, P_H - 14);
        ctx.fillRect(feetX + 4, P.y + 6, 2, P_H - 14);
        ctx.globalAlpha = 1;
      }
      const spd = Math.abs(P.vx);
      if (spd > 30) {
        const k = Math.min(1, spd / 260);
        const prevA = ctx.globalAlpha;
        for (let i = 3; i >= 1; i--) {
          const off = -Math.sign(P.vx) * i * (2 + 4 * k);
          ctx.globalAlpha = prevA * (0.17 * k) / i;
          ctx.fillStyle = '#ffd9a0';
          const hh = (P_H - 14) * (1 + (P.sq > 1 ? (P.sq - 1) * i * 0.6 : 0));
          ctx.fillRect(feetX + off - 1.5, P.y + (P_H - hh) / 2, 3, hh);
        }
        ctx.globalAlpha = prevA;
      }
      ctx.save();
      ctx.translate(feetX, 0);
      ctx.scale(FLAT_W / P_W, 1);
      ctx.translate(-feetX, 0);
      if (playerPack.kind === 'atlas') {
        drawAtlasFrame(ctx, PACK_ATLAS.map.stand || 'idle', P.animT, feetX, feetY,
                       P_SPRITE_H, P.face < 0, null);
      } else {
        drawPhotoFrame(ctx, feetX, feetY, P_SPRITE_H, P.face < 0, 'stand', P.animT);
      }
      ctx.restore();
      /* 两侧各一条 1px 暗边。人是"一片"，就必须看得见片的**边** ——
       * 暗墙上没有轮廓的话，压扁的人会直接融进砖缝里。 */
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(feetX - 4, P.y + 3, 1, P_H - 8);
      ctx.fillRect(feetX + 3, P.y + 3, 1, P_H - 8);
      /* 面向观众那一侧的亮边：纸的侧棱。它同时是"我朝哪边"的唯一提示。
       * 压在暗边内侧，于是读出来是"这张纸朝这边卷了个口"。 */
      ctx.fillStyle = 'rgba(255,240,214,.42)';
      ctx.fillRect(feetX + (P.face > 0 ? 2 : -3), P.y + 3, 1, P_H - 8);
      /* 脚下压一小片影子，不然这条线看着像浮在墙上 */
      ctx.save();
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#05040a';
      ctx.beginPath(); ctx.ellipse(feetX, P.y + P_H - 1, 11, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (playerPack.kind === 'atlas') {
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
/* addLog 删了（裁定 Q6）：左下的常驻日志撤掉。
 * 它承担的三句说明改成**开场一次性**（见 boot 里的 say 序列），
 * "发生了什么"这种即时信息仍然走 say()，不受影响。 */

function syncHUD() {
  const hpPct = Math.max(0, P.hp / P.hpMax * 100);
  $('#hpfill').style.width = hpPct + '%';
  /* 可夺回段（rally）：贴在血的右端，宽度 = 额度占上限的比例。
   * 上限卡在 HP 条剩余的空白里（Math.min）—— 额度不该画到条子外面去。 */
  const rl = $('#hprally');
  if (rl) {
    const rlPct = P.rally > 0 ? Math.min(100 - hpPct, P.rally / P.hpMax * 100) : 0;
    rl.style.left = hpPct + '%';
    rl.style.width = rlPct + '%';
  }
  /* 数值：照参考图写在血条右端（"174 / 248"）。只在变化时写 DOM ——
   * syncHUD 每 0.1 秒跑一次，无条件重写会一直触发文本重排。 */
  const hpEl = $('#hpnum');
  if (hpEl) {
    const txt = Math.max(0, Math.round(P.hp)) + ' / ' + Math.round(P.hpMax);
    if (hpEl.__t !== txt) { hpEl.__t = txt; hpEl.textContent = txt; }
  }
  /* 蓝条删了（白哥 2026-11-24）：魂改成 CD，就没有第二条资源要显示。
   * 剩下的墨条只服务 Flatten（侧身的燃料），和魂无关。 */
  /* 墨条只在"这个房间有灯"时出现 —— 有资源可补，这条条才有意义。 */
  const inked = !!(room && room.lamps);
  const stageEl = document.getElementById('stage');
  if (stageEl) stageEl.classList.toggle('ink', inked);
  const inkf = $('#inkfill');
  if (inkf) inkf.style.width = Math.max(0, P.ink / P.inkMax * 100) + '%';
  $('#roomname').textContent = room.name;
  const setSlot = (sel, label, cls, cd, cdMax) => {
    const el = $(sel);
    if (!el) return;
    el.textContent = label;
    el.className = 'slot ' + cls + (cd > 0 && cdMax > 0 ? ' cd' : '');
    /* 冷却画成"从下往上退去的黑幕"，不写数字 —— 战斗中没人读小数，
     * 只看得懂"还剩多少"。这也是《重生细胞》格子的画法。 */
    el.style.setProperty('--cd', (cd > 0 && cdMax > 0 ? cd / cdMax : 0).toFixed(3));
  };

  /* 四格（白哥 2026-11-24，照《重生细胞》）：2 装备 + 2 道具。
   *   装备 1 = 剑（普攻）   装备 2 = 纸（侧身）
   *   道具 1 = 红魂         道具 2 = 蓝魂
   * 装备格永远有东西 —— 死细的格子从来不空，空格会一直提醒玩家"你缺东西"。 */
  const redId = SAVE.equipped.red, blueId = SAVE.equipped.blue;
  const flatOn = P.state === 'flat';
  /* 剑格**不常亮**。原来写死 'gear on'，效果是那一格永远高亮 ——
   * 参考图里四个格子都是常态，只有按下去才亮。
   * 常亮会被读成"一直按着"或"这是当前选中项"，两件都不成立。 */
  setSlot('#slotw1', '剑', 'gear', 0, 0);
  setSlot('#slotw2', flatOn ? '纸·扁' : '纸', 'gear' + (flatOn ? ' on' : ''), 0, 0);
  /* 格子上写**两字短名**（SOULS[].short），不写四字全名：格子 40px，
   * 四个字排两行字号只剩 9px。全名在魂匣菜单里，那里不缺空间。 */
  setSlot('#slotred', redId ? (SOULS[redId].short || SOULS[redId].name) : '未装备',
          'soul slot-red' + (redId ? '' : ' empty'), P.cdRed, redId ? SOULS[redId].cd : 0);
  setSlot('#slotblue', blueId ? (SOULS[blueId].short || SOULS[blueId].name) : '未装备',
          'soul slot-blue' + (blueId ? '' : ' empty'), P.cdBlue, blueId ? SOULS[blueId].cd : 0);
  /* 收集计数进魂匣（裁定 Q9）；留在主界面就必须带单位，这里直接搬走。 */
  const cnt = $('#menucount');
  if (cnt) cnt.textContent = '已收 ' + SAVE.owned.size + ' / ' + Object.keys(SOULS).length;
  paintLegend();          // 槽位一变，图例里"没有这个魂"的灰就跟着变

  /* 血瓶：次数写进右下角徽章，见底整格变灰。
   * 只在**变化时**写 DOM —— syncHUD 每 0.1 秒跑一次，每次都重写 textContent
   * 会让浏览器白排一次版。 */
  const fb = $('#flask');
  if (fb) {
    if (fb.__n !== P.flasks) {
      fb.__n = P.flasks;
      const fn = $('#flaskn');
      if (fn) fn.textContent = P.flasks;
    }
    fb.classList.toggle('out', P.flasks <= 0);
  }
  /* 小地图每帧重画的是"玩家橙点"，底图只在换房间时重画（见 paintMinimap）。 */
  paintMinimap();
}

/* ================= 小地图（白哥 2026-11-24 晚：右上角要有） =================
 * 画的**不是**"实心块"，也不是"可走区"，而是**露出来的那一条地面线**。
 *
 * 这个判据是踩过两次坑才定下来的：
 *   ① 按"可走区"涂 —— 横版关卡的可走区几乎占满整屏，涂出来是一整块方板，
 *      什么结构都看不出；
 *   ② 按"实心块"涂 —— 回廊是个四周有墙的大房间，涂出来是一个**空心方框**，
 *      看着像 UI 边框，不像地图（和参考图摆在一起差别一目了然）。
 *   ③ 现在：只画**上方为空**的实心格（即每个表面上露出来的那一层地面/天花板），
 *      加厚成 2 格。房间就变成几条横线 —— 地面一条、天花板一条、平台各一小段，
 *      和参考图那种"粗线条路径"是同一个读法：**读高度差，不读面积**。
 *
 * 颜色：墙地 #2f3c9e、平台 #5b3fb8、门 #c8622a、玩家 #ffb347（都取自参考图）。
 * 底图只在**换房间**时重画（32×36 = 1152 格），每帧只重画玩家橙点。
 *
 * 顺带把之前那句"小地图删掉了（裁定 Q10）"作废：Q10 的前提是"一屏能看全"，
 * 但钟塔是 32×36 —— 竖着两屏多，玩家确实需要知道自己在第几层。 */
const MM_BASE = document.createElement('canvas');
let mmRoomId = null;
function mmGeom() {
  const c = document.getElementById('mm');
  if (!c || !room) return null;
  const W = c.width, H = c.height;
  const t = Math.min(W / room.w, H / room.h);      // 等比；房间比画布窄就在两侧留白
  return { W, H, t, ox: (W - room.w * t) / 2, oy: (H - room.h * t) / 2 };
}
function paintMinimap() {
  const c = document.getElementById('mm');
  const L = mmGeom();
  if (!c || !L) return;
  if (mmRoomId !== room.id) {
    mmRoomId = room.id;
    MM_BASE.width = L.W; MM_BASE.height = L.H;
    const b = MM_BASE.getContext('2d');
    b.clearRect(0, 0, L.W, L.H);
    const solid = ch => ch !== '.' && ch !== ' ' && ch !== 'D';
    /* 一格 = 一列；x 方向取整、宽取 ceil，避免相邻格之间出现 1px 缝。
     * 竖直方向画 2 格：一条 1px 线在手机上等于看不见，2 格才读得出"这里是地面"。 */
    const put = (x, y, col, hTiles) => {
      b.fillStyle = col;
      b.fillRect(Math.floor(L.ox + x * L.t), Math.floor(L.oy + y * L.t),
                 Math.ceil(L.t), Math.ceil(L.t * (hTiles || 1)));
    };
    for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
      const ch = room.g[y][x];
      if (ch === '.' || ch === ' ') continue;
      if (ch === 'D') { put(x, y, '#c8622a', 1); continue; }   // 门：整格点出来
      if (ch === '=') { put(x, y, '#5b3fb8', 1); continue; }   // 平台：本来就是薄薄一条
      /* 墙面/地面：只在"上方是空的"时候画 —— 那就是玩家能踩到的那条线。 */
      const up = y > 0 ? room.g[y - 1][x] : '.';
      if (!solid(up)) put(x, y, '#2f3c9e', 2);
    }
    /* 传送门单独点一个橙点：门洞在墙上只是一个 '.'，涂不出来 */
    for (const p of (room.portals || [])) {
      b.fillStyle = '#ff9a3c';
      b.fillRect(Math.floor(L.ox + p.x * L.t) - 1, Math.floor(L.oy + p.y * L.t) - 1,
                 Math.max(3, L.t), Math.max(3, L.t));
    }
  }
  const g = c.getContext('2d');
  g.clearRect(0, 0, L.W, L.H);
  g.drawImage(MM_BASE, 0, 0);
  const px2 = L.ox + (P.x / TILE) * L.t, py2 = L.oy + (P.y / TILE) * L.t;
  g.fillStyle = '#ffb347';
  g.beginPath(); g.arc(px2, py2, Math.max(2.5, L.t * 0.9), 0, Math.PI * 2); g.fill();
}


let menuOpen = false;
function buildMenu() {
  const wrap = $('#souls'); wrap.innerHTML = '';
  const groups = [['red','红魂 · 主动（' + keyName('red') + ' 施放，走冷却）'],
                ['blue','蓝魂 · 激活（' + keyName('blue') + ' 点一下，走冷却）'],
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

/* ---- 魂匣页签（WO-003 §3）--------------------------------------------
 * 「魂槽」「操作」共用一块滚动区。为什么用页签而不是继续往菜单底部堆：
 * 菜单是 overflow:hidden，窗口一矮，堆在末尾的东西（触屏的照片/声音按钮）
 * 会被直接裁掉 —— 而被裁的正是最该能点的那几个。
 *
 * 页签状态必须**独立于 buildMenu()**：那个函数每次打开菜单都会重画魂槽，
 * 要是把当前页存在它的产物里，每次开菜单都会跳回第一页。 */
let menuPane = 'Souls';
function showPane(name) {
  menuPane = name || 'Souls';
  const menu = $('#menu');
  if (!menu || !menu.querySelectorAll) return;   // 无头测试的假 DOM
  menu.querySelectorAll('.tab').forEach(b => {
    b.classList.toggle('on', b.getAttribute('data-pane') === menuPane);
  });
  menu.querySelectorAll('.pane').forEach(p => {
    p.classList.toggle('on', p.id === 'pane' + menuPane);
  });
}
function initTabs() {
  const menu = $('#menu');
  if (!menu || !menu.querySelectorAll) return;
  menu.querySelectorAll('.tab').forEach(b => {
    b.onclick = () => showPane(b.getAttribute('data-pane'));
  });
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
  /* 键位图例从 KEY_OF 生成，HTML 里一个字母都不写死 ——
   * 上一版就是因为你改了 K 而图例没改，说明书把玩家按到坑里。 */
  /* 无头测试的假 DOM 没有 querySelectorAll —— 图例是给人看的，缺了不影响玩法 */
  buildLegend();           // 图例由 LEGEND 表生成，字母从 KEY_OF 取
  initTabs();              // 魂匣页签：魂槽 / 操作
  syncHUD();
  // 开场三句：先说你干了什么，再说你为什么还能动。
  // 不加"教程弹窗"，因为这不是规则说明，是事实陈述。
  say('这张照片是你拍的。', 0);
  setTimeout(() => say('你按下去的时候，手抖了一下。', 0), 2600);
  setTimeout(() => say('所以他还没被拍死。', 0), 5200);
  /* 原来常驻在左下日志里的三句，现在**一次性**说完（裁定 Q6）。
   * 排在三句台词之后：旁白先建立"这是张照片"，再说怎么办。
   * 间距 1.4s 而不是 0 —— 挤在一起只会看到最后一句。 */
  if (loaded) setTimeout(() => say('接着上次。', 0), 8200);
  setTimeout(() => say('打史莱姆拿魂，Tab 打开魂菜单。', 0), 9600);
  setTimeout(() => say('回廊右侧藏着东西，钟塔能往上爬。', 0), 11600);

  /* 画布是 tabindex=0 的可聚焦元素（index.html）。在 iframe 里（预览面板 /
   * 嵌入页）父窗口拿着焦点时，按键事件根本到不了这一层 —— 代码全对，玩家
   * 看到的就是"按什么都没反应"。启动先抢一次焦点；抢不到不影响任何逻辑，
   * mobile.js 会在第一次点击时补上。 */
  try {
    const c = document.getElementById && document.getElementById('cv');
    if (c && c.focus) c.focus({ preventScroll: true });
  } catch (e) { /* 无头环境 / 老浏览器：没有焦点这回事，忽略 */ }

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

  /* 血瓶：鼠标/触屏点一下就用。挂 onclick 不挂 pointerdown ——
   * 它不在动作层里，没有"按住"的语义，也就不需要手动配对 release。 */
  const flaskBtn = $('#flask');
  if (flaskBtn) flaskBtn.onclick = () => useFlask();

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
