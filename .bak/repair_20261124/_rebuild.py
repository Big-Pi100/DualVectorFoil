# -*- coding: utf-8 -*-
"""从 .bak/20261124/game_pre_flat.js 重建 src/game.js。

背景：上一次用 s.index("    if (P.state === 'flat') {") 当锚点，结果匹配到了
updateEnemy 里的同名片段，把 updateEnemy→hurtPlayer→…→渲染 约 1180 行删掉了。
这次的纪律：
  1. 每一处替换都断言 **恰好命中一次**，不成立就整份不落盘；
  2. 逻辑顺序固定：先做全局 P_W→P_CW，再做带 P_CW 的锚点补丁；
  3. 段与段之间用行数组拼接，不用字符串 index 找边界。
"""
import io, re, sys

BAK = '.bak/20261124/game_pre_flat.js'
PRE = '_recover_prefix.txt'     # 备份 1..901 + 侧身前缀改动
FLAT = '_recover_flat.txt'      # 渲染里的压扁精灵
REST = '_recover_rest.txt'      # 备份 2269.. 末尾 + HUD 改动

raw = io.open(BAK, 'r', encoding='utf-8', newline='').read().replace('\r\n', '\n')
bk = raw.split('\n')
if bk and bk[-1] == '':
    bk.pop()


def rd(p):
    s = io.open(p, 'r', encoding='utf-8', newline='').read().replace('\r\n', '\n')
    L = s.split('\n')
    if L and L[-1] == '':
        L.pop()
    return L


pre, flat, rest = rd(PRE), rd(FLAT), rd(REST)

# 备份 902 是 "if (overlap({ x:P.x..."，2269 是 "if (playerPack.kind === 'atlas') {"
assert bk[901].strip().startswith('if (overlap({ x:P.x'), bk[901][:60]
assert bk[2267] == '    }', repr(bk[2267])
assert bk[900].strip() == '', repr(bk[900])

mid = bk[901:2268]          # 备份 902..2268（2269 是渲染的 if/else 分叉，由 flat+rest 拼）
mid_s = '\n'.join(mid)

# ---------- 0. 全局把碰撞宽度换成动态量 ----------
# P_CW 在非侧身时恒等于 P_W，所以这一换在正常状态下行为完全不变；
# 侧身时它变成 6。唯一**不能**换的是压扁精灵的缩放比（FLAT_W / P_W），
# 那一句在 flat 块里，不经过这里。
n_pw = mid_s.count('P_W')
assert not re.search(r'P_W[A-Za-z0-9_]', mid_s), 'P_W 出现在更长的标识符里，不能盲替'
mid_s = mid_s.replace('P_W', 'P_CW')
print('P_W -> P_CW : %d 处' % n_pw)

patches = []


def patch(tag, old, new, count=1):
    patches.append((tag, old, new, count))


# ---------- 1. 接触免疫 ----------
patch('contact', """  if (overlap({ x:P.x, y:P.y, w:P_CW, h:P_H }, ebox(e)) && P.invuln <= 0 && !P.dead) {
    hurtPlayer(e.dmg, e.x + e.w/2);
  }
}
""", """  /* 侧身的人**在同平面里没有身体**。这是机制的核心：
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
""")

# ---------- 2. hurtPlayer：缝里只掉血不击退 ----------
patch('hurtStuck', """function hurtPlayer(dmg, fromX) {
  if (P.invuln > 0 || P.dead) return;
  P.hp -= dmg;
  P.invuln = 0.9;
  P.state = 'hurt'; P.animT = 0;
""", """function hurtPlayer(dmg, fromX) {
  if (P.invuln > 0 || P.dead) return;
  /* 在缝里被打：**掉血但不击退**。
   * 28px 的击退会把人塞进两侧的墙里 —— 那不是惩罚，是卡死。
   * 所以先问一句"现在撑得开吗"，撑不开就只扣血。 */
  const stuckFlat = P.state === 'flat' && !tryEndFlat();
  P.hp -= dmg;
  P.invuln = 0.9;
  if (stuckFlat) {
    P.animT = 0;
    P.cutOK = false;
    shakeIt(0.18, 6); hitStop = 0.05; sfx('hurt');
    if (P.hp <= 0) { P.hp = 0; P.dead = true; P.deadT = 0; sfx('death'); }
    return;
  }
  P.state = 'hurt'; P.animT = 0;
""")

# ---------- 3. 侧身状态机 ----------
patch('flatMachine', """/* ---- 状态函数：只改速度和 step，不碰位置 ---- */
""", """/* ======================== 侧身（Flatten，S4）========================
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
  /* 过了必经缝之后再按 = 自发复用。这是整个实验的唯一判据，
   * 所以它必须记在**按下的边沿**上，不能记"处在 flat 状态的时长" ——
   * 后者会把"过缝时一直按着"算成复用，指标就自己骗自己了。 */
  if (MET.gateT >= 0) MET.reuseAfterGate++;
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
""")

# ---------- 4. 状态分派 ----------
patch('dispatch', """    case 'dash':   stepDash(dt);   break;
""", """    case 'dash':   stepDash(dt);   break;
    case 'flat':   stepFlat(dt);   break;
""")

# ---------- 5. updatePlayer 里的侧身 / 墨 / 灯 ----------
patch('flatUpdate', """  if (P.atkPending > 0) { P.atkPending -= dt; if (P.atkPending <= 0) doAttackHit(); }
""", """  if (P.atkPending > 0) { P.atkPending -= dt; if (P.atkPending <= 0) doAttackHit(); }

  /* ---- 侧身：按住保持，松开尽量站起（撑不开就继续扁着）----
   * 为什么是"按住"而不是"切换"：切换状态下人会忘记自己还扁着，
   * 走到缝口站着过不去，然后判定为 bug。按住的因果是即时可见的。 */
  if (P.state === 'flat') {
    P.ink = Math.max(0, P.ink - FLAT_DRAIN * dt);
    MET.flatMs += dt * 1000;
    /* 墨见底自动起身。这不是惩罚，是让资源真的有价格：
     * 墨空了还能一直扁着的话，墨就只是 HUD 上一条装饰。 */
    if (P.ink <= 0 || !padDown('flat')) tryEndFlat();
  } else if (padDown('flat')) {
    if (!beginFlat() && padTap('flat') && P.ink <= 0) say('墨尽了 —— 找灯');
  }
  /* 灯只在不扁的时候补。站在灯下扁着不动就能无限续航，
   * 这个漏洞比"墨不够用"糟糕得多。 */
  if (P.state !== 'flat' && P.ink < P.inkMax && nearLamp()) {
    P.ink = Math.min(P.inkMax, P.ink + INK_REFILL * dt);
  }
""")

# ---------- 6. 扁着不消费跳跃缓冲 ----------
patch('jbuf', """  if (padTap('jump')) P.jumpBuf = JBUF_TICKS * FIXED_DT;
""", """  if (padTap('jump') && P.state !== 'flat') P.jumpBuf = JBUF_TICKS * FIXED_DT;
""")

# ---------- 7. 必经缝埋点 ----------
patch('gate', """  // 6. 物理：位置 + 碰撞（统一做，状态函数碰不到 x/y）
  physics(dt);
""", """  // 6. 物理：位置 + 碰撞（统一做，状态函数碰不到 x/y）
  physics(dt);

  /* 必经缝：第一次**身体中心**越过 gateX 的那一刻。
   * 用中心而不是左边缘 —— 左缘贴到就记，会让"站在缝口张望"也算过墙。 */
  if (MET.gateT < 0 && room.gateX != null && (P.x + P_CW / 2) > room.gateX) {
    MET.gateT = P.t;
  }
""")

# ---------- 8. 扁着不踩出脚步声 ----------
patch('stepT', """  if (P.onGround && Math.abs(P.vx) > 60) {
    P.stepT += moveDx;
""", """  if (P.onGround && P.state !== 'flat' && Math.abs(P.vx) > 60) {
    P.stepT += moveDx;
""")

# ---------- 9. 墨囊拾取 ----------
patch('vial', """    it.got = true;
    SAVE.owned.add(it.soul);
    SAVE.flags.add('took_' + room.id + '_' + it.id);
""", """    it.got = true;
    SAVE.flags.add('took_' + room.id + '_' + it.id);
    /* 墨囊不是魂：它不给能力，只给一次墨。
     * 走独立分支而不是塞进 SOULS，是因为两者回答的问题不同 ——
     * 魂回答"我还会什么"，墨回答"我还能不能继续侧身"。 */
    if (it.ink) {
      P.ink = Math.min(P.inkMax, P.ink + it.ink);
      say('墨囊：+' + it.ink + ' 墨');
      sfx('pickup');
      onProgress('pickup');
      continue;
    }
    SAVE.owned.add(it.soul);
""")

pre_s = '\n'.join(pre)   # prefix 已含 updateEnemy 的 bat 改动，不再重复补

# ---------- 11. 投射物：纸缝挡镖 + 敌方飞镖打玩家 ----------
patch('proj', """    const t = tileAt(p.x, p.y);
    if (t === '#' || t === '=' || t === 'H') p.life = 0;
    for (const e of enemies) {
""", """    const t = tileAt(p.x, p.y);
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
""")

# ---------- 12. 纸缝与灯的绘制 ----------
patch('slitDraw', """function drawSlab(ctx, x, y, tx, ty) {
""", """/* 墙上的一道缝。为什么不能直接"画一条黑缝"：
 * 石头哈希会给这一列抽到最暗的一块，于是那 2px 墨线读成
 * "两堵墙之间的空隙" —— 语义从"纸被划开"变成"这里根本不是墙"。
 * 所以整格先提亮 6%，让它在视觉上仍然**属于这堵墙**，再把缝压成 2px。 */
function drawSlit(ctx, x, y, tx, ty) {
  drawStone(ctx, x, y, tx, ty);
  ctx.fillStyle = 'rgba(232,226,214,.06)';
  ctx.fillRect(x, y, TILE, TILE);
  const cx = x + TILE / 2;
  // 缝本体
  ctx.fillStyle = '#05040a';
  ctx.fillRect(cx - 1, y, 2, TILE);
  // 双侧暖边：纸被划开时翻起来的纤维。它同时是"这是缝、不是阴影"的证据
  ctx.fillStyle = 'rgba(255,226,178,.30)';
  ctx.fillRect(cx - 3, y, 1, TILE);
  ctx.fillRect(cx + 2, y, 1, TILE);
  // 毛边碎屑：位置由哈希定死，不闪
  for (let i = 0; i < 7; i++) {
    const fy = y + Math.floor(hash2(tx, ty, i * 5 + 2) * TILE);
    const side = hash2(tx, ty, i * 5 + 3) > 0.5 ? 1 : -1;
    const len = 2 + hash2(tx, ty, i * 5 + 4) * 5;
    ctx.fillStyle = 'rgba(226,214,190,.10)';
    ctx.fillRect(side > 0 ? cx + 2 : cx - 2 - len, fy, len, 1);
  }
  /* 缝里透出的一点暖光。这是全套美术里唯一一条**纯玩法提示**：
   * 缝必须读成"能进去"，否则玩家永远不会想到要压扁。 */
  const rg = ctx.createRadialGradient(cx, y + TILE / 2, 0, cx, y + TILE / 2, TILE * 0.55);
  rg.addColorStop(0, 'rgba(255,206,140,.14)');
  rg.addColorStop(1, 'rgba(255,206,140,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(x, y, TILE, TILE);
}

/* 纸折灯。它是房间里**唯一**的墨来源，所以必须一眼读成"这里能补"，
 * 而不是当装饰 —— "走到灯下回墨"是侧身能持续的前提。 */
function drawLamp(ctx, l) {
  const bx = l.x, by = l.y;                      // by = 地面那一格的顶边
  /* 呼吸，不闪烁。幅度 12%、周期 2.6s：
   * 闪烁读成"坏了"，呼吸读成"还活着"。 */
  const br = 0.88 + Math.sin(P.t * 2.4) * 0.12;
  const g = ctx.createRadialGradient(bx, by - 120, 8, bx, by - 120, 158 * br);
  g.addColorStop(0, 'rgba(255,214,150,' + (0.20 * br).toFixed(3) + ')');
  g.addColorStop(1, 'rgba(255,214,150,0)');
  ctx.fillStyle = g;
  ctx.fillRect(bx - 170, by - 280, 340, 300);
  // 灯杆
  ctx.fillStyle = '#241d2c'; ctx.fillRect(bx - 2, by - 102, 4, 102);
  ctx.fillStyle = 'rgba(220,200,240,.10)'; ctx.fillRect(bx - 2, by - 102, 1, 102);
  // 灯罩：折纸的四面，上宽下窄
  ctx.fillStyle = '#e8dcc0';
  ctx.beginPath();
  ctx.moveTo(bx - 22, by - 102);
  ctx.lineTo(bx + 22, by - 102);
  ctx.lineTo(bx + 16, by - 138);
  ctx.lineTo(bx - 16, by - 138);
  ctx.closePath(); ctx.fill();
  // 折痕
  ctx.strokeStyle = 'rgba(120,100,70,.42)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx - 16, by - 138); ctx.lineTo(bx - 22, by - 102);
  ctx.moveTo(bx, by - 138);      ctx.lineTo(bx, by - 102);
  ctx.moveTo(bx + 16, by - 138); ctx.lineTo(bx + 22, by - 102);
  ctx.stroke();
  // 底口的光
  ctx.fillStyle = 'rgba(255,226,160,.55)'; ctx.fillRect(bx - 21, by - 102, 42, 3);
  ctx.fillStyle = 'rgba(255,240,214,.30)'; ctx.fillRect(bx - 22, by - 103, 44, 1);
}

function drawSlab(ctx, x, y, tx, ty) {
""")

patch('tileBar', """  if (ch === '#') {
    drawStone(ctx, x, y, tx, ty);
  } else if (ch === '=') {
""", """  if (ch === '#') {
    drawStone(ctx, x, y, tx, ty);
  } else if (ch === '|') {
    drawSlit(ctx, x, y, tx, ty);
  } else if (ch === '=') {
""")

# ---------- 13. 渲染里画灯 ----------
patch('lampRender', """  // 展厅里的"展品"（画在人物之后、玩家之前 = 贴在墙上）
""", """  /* 灯画在地形之上、人物之下：它是"贴在这面墙上的东西"，
   * 挡在人前面会读成一盏悬在空中的灯笼。 */
  if (room.lamps) for (const l of room.lamps) drawLamp(ctx, l);

  // 展厅里的"展品"（画在人物之后、玩家之前 = 贴在墙上）
""")

# ---------- 执行 ----------
for tag, old, new, count in patches:
    got = mid_s.count(old)
    if got != count:
        sys.exit('!! 锚点 %s 命中 %d 次（期望 %d）:\n%s' % (tag, got, count, old[:200]))
    mid_s = mid_s.replace(old, new)
    print('patched %-12s' % tag)

out = pre_s.split('\n') + mid_s.split('\n') + flat + rest
text = '\n'.join(out)
if not text.endswith('\n'):
    text += '\n'

# 只做结构性断言，语义由 flat_check/test/save_check 兜底
for must in ['function beginFlat()', 'function tryEndFlat()', 'function stepFlat(dt)',
             'function drawSlit(', 'function drawLamp(', "case 'flat':", 'P_CW = FLAT_W']:
    if must not in text:
        sys.exit('!! 重建结果缺 %s' % must)

io.open('src/game.js', 'w', encoding='utf-8', newline='\r\n').write(text)
print('\nsrc/game.js = %d 行 / %d 字节' % (text.count('\n'), len(text.encode('utf-8'))))
