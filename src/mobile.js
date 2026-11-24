/* ============================================================
 * 触屏层 —— 手游版的第一块试金石
 * ------------------------------------------------------------
 * 只做两件事，都不碰玩法代码：
 *   1. 自适应缩放：逻辑分辨率永远是 960×540，按屏幕等比缩放，画布 backing store
 *      跟物理像素对齐（Retina 不糊）。
 *   2. 虚拟摇杆 + 按键：只往 game.js 那份 keys 里写，按住的语义和键盘完全一致。
 *
 * 为什么先做这个：手游最大的风险不是引擎，是"拇指操作好不好玩"。
 * 这一层能当天在 iPhone Safari 上验证，不用等 Xcode。
 * ============================================================ */
(function () {
  'use strict';

  var stage = document.getElementById('stage');
  if (!stage) return;

  var cv = document.getElementById('cv');
  var STAGE_W = 960, STAGE_H = 540;

  /* ---- 判定"主输入是不是手指" ----------------------------------------
   * 上一版写的是 `('ontouchstart' in window) || navigator.maxTouchPoints > 0`。
   * 这两条在**触屏笔记本上恒为 true**（Windows 触摸屏普遍报 maxTouchPoints = 10），
   * 于是桌面玩家被当成手机：`#stage.touch #keys{display:none}` 把键鼠图例整个隐藏，
   * 画面被虚拟摇杆盖住，提示还写着"左滑移动"。
   * 玩家的结论只能是"这游戏没法操作"—— 而底层按键其实一直是通的。
   *
   * 正确的判据不是"有没有触摸硬件"，是**主指针是什么**：
   *   pointer:coarse + hover:none   → 主输入是手指（手机 / 平板）
   *   pointer:fine   + hover:hover  → 主输入是鼠标（触屏笔记本、外接触控屏）
   * 触屏笔记本同时"有触摸能力"和"用鼠标"，必须走路键鼠那条路。
   * 验收手机版用 ?touch=1 强制触屏，反过来用 ?touch=0 强制键鼠。 */
  var mq = function (q) {
    try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; }
  };
  var forceTouch = /[?&]touch=1/.test(location.search);
  var forceDesk = /[?&]touch=0/.test(location.search);
  var touch = forceTouch || (!forceDesk && mq('(pointer: coarse)') && mq('(hover: none)'));

  /* ---------------- 缩放 ---------------- */
  function fit() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var s, viewW;
    if (touch) {
      /* 手机：先按高度贴满，多出来的横向宽度变成"多看一段视野"。
         远超 2.4:1 的超宽屏才回退到留黑边（否则视野宽到看不清角色）。 */
      s = vh / STAGE_H;
      viewW = Math.max(960, Math.min(1280, Math.round(vw / s / 2) * 2));
      s = Math.min(vw / viewW, vh / STAGE_H);
    } else {
      s = Math.min(vw / STAGE_W, vh / STAGE_H, 1.1);   // 桌面上别放大到糊
      viewW = STAGE_W;
    }
    s = Math.max(0.28, s);
    stage.style.transform = 'scale(' + s + ')';
    stage.style.width = viewW + 'px';

    // backing store = 缩放 × DPR，让 1 个逻辑像素落到 1 个物理像素附近
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var rs = Math.max(1, Math.min(3, s * dpr));
    rs = Math.round(rs * 20) / 20;
    if (cv) {
      cv.width = Math.round(viewW * rs);
      cv.height = Math.round(STAGE_H * rs);
      cv.style.width = viewW + 'px';
      cv.style.height = STAGE_H + 'px';
    }
    if (window.__sk) { window.__sk.setRS(rs); window.__sk.setViewW(viewW); }
    /* HUD 的安全区内推量 = env(safe-area) / s，所以把 s 交给 CSS */
    document.documentElement.style.setProperty('--s', String(s));
  }

  /* ---------------- 触屏控件 ---------------- */
  var pad = null, rot = null;

  function buildPad() {
    if (!touch) return;
    stage.classList.add('touch');

    pad = document.createElement('div');
    pad.id = 'pad';
    /* 按钮文案按 WO-003 §4 调整：
     *   「后」→「后跃」：单一个字会被读成"向后移动"，它是后撤步，不是后退走动。
     *   「纸」加「按住」角标：它是**按住**动词，提示消失之后没人会记得。
     * 按钮数量一个没加 —— 这一轮只改命名、反馈和说明。 */
    /* 布局照《重生细胞》手机版（白哥 2026-11-24）：
     *   右下 = 3 个动作键（跳 / 冲刺 / 交互），四个装备格在 index.html 的 #slots 里，
     *          点在格子上就直接使用，不经过动作键。
     * 从七个圆键改成这个结构，靠的不是"少放两个"，而是**攻击被装进了装备格** ——
     * 死细右边之所以只剩三个键，是因为它的主武器占了一个格子。
     * 所以这里也不再有"攻"键，"剑"格就是攻击。 */
    pad.innerHTML =
      '<div id="stickzone"></div>' +
      '<div id="stick"><i></i></div>' +
      '<div id="acts">' +
        '<button class="pb" id="pbJump">跳</button>' +
        '<button class="pb" id="pbRoll">冲刺</button>' +
        '<button class="pb" id="pbUse">交互</button>' +
        '<div id="comboTip"></div>' +
      '</div>' +
      '<button class="pb" id="pbMenu">匣</button>' +
      /* 首次提示只讲"手放哪儿"，完整说明在「匣 → 操作」，随时能翻。 */
      '<div id="touchhint">左摇杆移动 · 右下四格点一下就用 · 三个键是跳/冲刺/交互<br>' +
      '完整操作：点左上「匣」→ 操作页</div>';
    document.body.appendChild(pad);

    rot = document.createElement('div');
    rot.id = 'rot';
    rot.innerHTML = '<div>请 横 屏 游 玩</div>';
    document.body.appendChild(rot);

    /* --- 摇杆：哪里按下去，摇杆就长在哪里（浮动式，比固定位好按） --- */
    var zone = pad.querySelector('#stickzone');
    var stick = pad.querySelector('#stick');
    var knob = stick.querySelector('i');
    var R = 52, DEAD = 11;
    var pid = null, ox = 0, oy = 0, dir = 0;

    function setDir(d) {
      if (d === dir) return;
      dir = d;
      window.__sk.release('left');
      window.__sk.release('right');
      if (d < 0) window.__sk.press('left');
      if (d > 0) window.__sk.press('right');
    }

    /* 垂直轴：下推 = 蹲（也是"下+跳"滑铲、"下+攻"穿板的修饰），
     * 上推 = 抬头（原版 ↑ 就是抬头/进门，不是跳）。
     * 上推这一路以前是空的 —— 手机上永远做不出抬头，
     * 等于把原版的一个方向位整个砍掉了。 */
    var vdir = 0;
    function setV(v) {
      if (v === vdir) return;
      vdir = v;
      window.__sk.release('down');
      window.__sk.release('up');
      if (v > 0) window.__sk.press('down');
      if (v < 0) window.__sk.press('up');
      /* 下压状态要有回执（WO-003 §5）：下推不只是"蹲"，它同时是滑铲和穿板的修饰键。
       * 摇杆边框亮起来，玩家才知道"现在是下压状态"，接下来按跳才会出滑铲。
       * 没有这个回执，组合动作只能靠猜 —— 玩家会以为自己按错了。 */
      if (stick) stick.classList.toggle('down', v > 0);
    }

    function move(e) {
      var dx = e.clientX - ox, dy = e.clientY - oy;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var k = Math.min(1, d / R);
      knob.style.transform = 'translate(' + (dx / d * k * R * 0.55).toFixed(1) + 'px,' +
                                              (dy / d * k * R * 0.55).toFixed(1) + 'px)';
      setDir(dx > DEAD ? 1 : (dx < -DEAD ? -1 : 0));
      setV(dy > DEAD ? 1 : (dy < -DEAD ? -1 : 0));
    }

    zone.addEventListener('pointerdown', function (e) {
      if (pid !== null) return;
      e.preventDefault();
      pid = e.pointerId;
      ox = e.clientX; oy = e.clientY;
      stick.style.left = ox + 'px';
      stick.style.top = oy + 'px';
      stick.classList.add('on');
      try { zone.setPointerCapture(pid); } catch (err) { /* 老浏览器 */ }
      move(e);
    });

    zone.addEventListener('pointermove', function (e) {
      if (e.pointerId !== pid) return;
      e.preventDefault();
      move(e);
    });

    function stickUp(e) {
      if (pid === null || (e && e.pointerId !== pid)) return;
      pid = null;
      setDir(0);
      /* 垂直轴必须一起复位。只复位水平的话，下推一次之后 `down` 就永远按着：
       * 角色卡在蹲姿，而且下一次按跳会被当成"下推 + 跳"变成滑铲。
       * 这是 WO-003 做下压回执时测出来的 —— 没有回执就不会有人去查这一路。 */
      setV(0);
      stick.classList.remove('on');
      knob.style.transform = 'translate(0,0)';
    }
    zone.addEventListener('pointerup', stickUp);
    zone.addEventListener('pointercancel', stickUp);

    /* 组合回执（WO-003.1）：下压 + 跳 = 滑铲，下压 + 攻 = 穿板。
     * 这里**不判断**组合成不成立 —— 空中下推+跳其实是普通跳，实地上
     * 下推+攻其实是普攻。回执由 game.js 在动作真正执行的那一行发出，
     * 所以看到"滑铲"就一定是滑出去了，不是"我猜你大概想滑铲"。 */
    var comboTip = pad.querySelector('#comboTip');
    function flashCombo(text) {
      if (!comboTip) return;
      comboTip.textContent = text;
      comboTip.classList.add('on');
      clearTimeout(comboTip.__t);
      comboTip.__t = setTimeout(function () { comboTip.classList.remove('on'); }, 620);
    }

    /* --- 按键：按住 = keys[k]=true，抬起立刻松开 --- */
    function bind(el, key) {
      var down = function (e) {
        /* 调布局时按下去是"抓住它"（见 initLayout 的拖动），不是按这个动作。
         * 和四格同一个理由：拖一下"跳"不该真的跳一次。 */
        if (layEdit) return;
        e.preventDefault();
        el.classList.add('on');
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
        window.__sk.press(key);
      };
      var up = function () {
        el.classList.remove('on');
        if (layEdit) return;
        window.__sk.release(key);
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    }

    /* 这里只说**动作名**，一个键名都不出现 —— 键位表只有 game.js 的 K 一份。
     * 以前这里写死 'k' / 'j' / 'u' / 'l' / 'i'：键盘那边一改，手机就悄悄错位
     * （按"红"起跳、按"蓝"放魔法），而桌面上测不出来，只有真机点按钮才会露。 */
    bind(pad.querySelector('#pbJump'), 'jump');
    bind(pad.querySelector('#pbRoll'), 'back');
    bind(pad.querySelector('#pbUse'), 'use');

    /* 匣：和别的键一样走"按下→动作，抬起→松开"。
     * 不能再直接调 toggleMenu()：菜单是全局唯一的，键盘和触屏必须走同一条路，
     * 否则又一次变成两份逻辑（其中一份迟早没人维护）。 */
    bind(pad.querySelector('#pbMenu'), 'menu');

    /* 订阅动作层的真实回执：只有滑铲真的滑出去、穿板真的掉下去才闪。
     * 在空地上"下推 + 攻"是普攻，这里什么都不显示 —— 玩家看到的就是他
     * 实际做出来的事，而不是他"大概想做"的事。 */
    if (window.__sk && window.__sk.onAct) {
      window.__sk.onAct(function (kind) {
        if (kind === 'slide') flashCombo('滑铲');
        else if (kind === 'plate') flashCombo('穿板');
      });
    }

    /* 开魂匣时藏掉摇杆和按键，否则会挡住卡片；"匣"按钮留着用来关 */
    var menuEl = document.getElementById('menu');
    if (menuEl && window.MutationObserver) {
      new MutationObserver(function () {
        var hide = menuEl.classList.contains('show');
        pad.classList.toggle('hideplay', hide);
        /* 四格不在 #pad 里（桌面也要用），所以 CSS 的 `#pad.hideplay` 够不到它，
         * 只能单独挂一个类。开菜单时格子必须让开，否则会压在菜单文字上。 */
        var sl = document.getElementById('slots');
        if (sl) sl.classList.toggle('hideplay', hide);
      }).observe(menuEl, { attributes: true, attributeFilter: ['class'] });
    }

    /* --- 触屏操作说明（WO-003 §2）-------------------------------------
     * 放在「匣 → 操作」页，随时能翻。为什么必须有这一块：
     * 首次提示 3.2 秒就淡了，而滑铲 / 穿板是**组合**动作，玩家第一次看到时
     * 通常还在找按钮。没有可回看的入口，这两条等于不存在。
     *
     * 表达规则（和键盘图例同一套）：
     *   · 按动作分组，不按按钮位置分组 —— 玩家问的是"我想滑铲怎么按"；
     *   · 每个动作标明**点按**还是**按住**，这是触屏独有的歧义；
     *   · 组合用「下推 + 跳」，不用"下推的同时按跳"这种一句话说完的写法。 */
    var ops = document.getElementById('touchops');
    if (ops) {
      ops.innerHTML =
        '<div class="grp" style="margin-top:0;color:#c8bda4">触 屏 操 作</div>' +
        '<div class="grp">移 动</div>' +
        '<div class="oprow"><b>左摇杆</b><span>左右 = 走</span><i>按住</i></div>' +
        '<div class="oprow"><b>下 推</b><span>蹲（也是滑铲/穿板的修饰）</span><i>按住</i></div>' +
        '<div class="oprow"><b>上 推</b><span>抬头</span><i>按住</i></div>' +
        '<div class="grp">三 个 动 作 键</div>' +
        '<div class="oprow"><b>跳</b><span>跳；空中再按一次是二段跳</span><i>点按</i></div>' +
        '<div class="oprow"><b>冲刺</b><span>向后急退一步，0.12 秒无敌（要在地面）</span><i>点按</i></div>' +
        '<div class="oprow"><b>交互</b><span>伸手拿附近的东西</span><i>点按</i></div>' +
        '<div class="grp">四 个 装 备 格（点一下就用）</div>' +
        '<div class="oprow"><b>剑</b><span>攻击；下推 + 剑 = 穿板（站在薄板上）</span><i>点按</i></div>' +
        '<div class="oprow"><b>红 魂</b><span>掷出火球 / 飞斧，走冷却</span><i>点按</i></div>' +
        '<div class="oprow"><b>蓝 魂</b><span>滑翔 3 秒，走冷却</span><i>点按</i></div>' +
        '<div class="oprow"><b>下推 + 跳</b><span>滑铲（要在地面）</span><i>组合</i></div>' +
        '<div class="grp">其 他</div>' +
        '<div class="oprow"><b>匣</b><span>魂槽 / 操作 / 外观（左上角）</span><i>点按</i></div>';
    }

    /* 触屏时把「触屏说明」排到「键盘键位表」前面（WO-003 的呈现原则：
     * 动作定义共用，呈现分开）。触屏玩家先看到自己手上的按键，
     * 外接键盘的人才需要往下看 —— 顺序反了，手机玩家第一眼就是一张用不上的表。 */
    var fk = document.getElementById('fullkeys');
    if (fk && ops) {
      var kh = document.createElement('div');
      kh.className = 'grp';
      kh.textContent = '键 盘（接外接键盘时用）';
      fk.parentNode.insertBefore(kh, fk);
      fk.parentNode.insertBefore(ops, kh);
    }

    /* 顶部那条"换成我的照片"在手机上太占地方 —— 收进「操作」页。
     * 容器由 index.html 提供（#touchfoot），不再往菜单末尾 append：
     * 追加的节点是 flex:0 0 auto，窗口一矮就被裁掉（WO-003 §3）。 */
    var foot = document.getElementById('touchfoot');
    if (foot) {
      foot.innerHTML =
        '<div class="grp">快 门</div>' +
        '<button class="btn" id="mSkin" type="button">按快门</button> ' +
        '<button class="btn" id="mReset" type="button">换回名片</button> ' +
        '<button class="btn" id="mSnd" type="button">声音 开</button>' +
        '<div class="none" style="margin-top:8px">按下去，一个人被印到平面上。他只少了一层厚度，别的什么都没变。</div>';
      foot.querySelector('#mSkin').onclick = function () {
        var f = document.getElementById('skinf'); if (f) f.click();
      };
      foot.querySelector('#mReset').onclick = function () {
        var b = document.getElementById('skinreset'); if (b) b.click();
      };
      var sndBtn = foot.querySelector('#mSnd');
      if (sndBtn) sndBtn.onclick = function () {
        if (!window.__audio) return;
        window.__audio.mute(!window.__audio.isMuted());
        sndBtn.textContent = '声音 ' + (window.__audio.isMuted() ? '关' : '开');
      };
    }

    /* 未装备的魂，按钮也要变灰（WO-003 §4）：手机上玩家看不到图例，
     * 按钮不变灰，他会一直按一个按不出东西的键。
     * 由 game.js 的 paintLegend() 每次变化时回调 —— 装备状态只有一份。 */
    /* 四格的类名由 game.js 的 syncHUD 一次写清（含空态、冷却、装备名），
     * 这里不再第二遍 toggle —— 两处都写类名，迟早会互相覆盖。 */
    window.__paintTouch = function () {};

    /* 首次提示，3 秒后淡出 */
    var hint = pad.querySelector('#touchhint');
    setTimeout(function () { hint.classList.add('off'); }, 3600);

    /* 触摸设备上不要有右键菜单 / 长按选择 */
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /* ---------------- 四格装备栏：点一下就使用 ----------------
   * 不依赖 touch：桌面上用鼠标点格子同样该有反应。没理由让"点击使用"
   * 变成只有手机才成立的事 —— 而桌面上原本连格子都没有。
   * 按下后 90ms 自己松开：这几个动作在动作层都是**边沿**触发（padTap），
   * 按住多久都不改变结果；不松开反而会让 atk 卡成长按。 */
  function bindSlots() {
    if (!window.__sk) return;
    /* slotw2 没有映射：它现在是空槽（原纸格）。点了不触发任何动作，
     * 比绑一个不存在的 'flat' 让输入层静默失败要好查。 */
    var map = { slotw1: 'atk', slotred: 'red', slotblue: 'blue' };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', function (e) {
        /* 调布局时按下去是"抓住它"，不是"用它"。
         * 少了这一句，拖一下"剑"格就等于砍了一刀 —— 玩家会以为格子坏了。 */
        if (layEdit) return;
        e.preventDefault();
        el.classList.add('on');
        window.__sk.press(map[id]);
        setTimeout(function () { el.classList.remove('on'); window.__sk.release(map[id]); }, 90);
      });
      /* 键盘可达：Tab 到格子 + 回车。e.detail === 0 表示这次 click 不是指针产生的，
       * 否则鼠标点击会走 pointerdown 一次、click 又一次，等于按两下。 */
      el.addEventListener('click', function (e) {
        if (e.detail !== 0 || layEdit) return;
        window.__sk.press(map[id]);
        window.__sk.release(map[id]);
      });
    });
  }

  /* ================= 布局编辑（WO-004） =================
   * 白哥的要求是"位置完全照《重生细胞》，并且玩家可调（像王者）"。
   * 默认值（CSS 里那四条 #slotXX）负责"照抄"；这一块负责"可调"。
   *
   * 三件事必须同时成立，缺一件这个功能就是负分：
   *   1) 拖完就记住 —— 存 localStorage。手机上尤其重要：拇指长度因人而异，
   *      没人愿意每次打开游戏先把四个格子摆一遍。
   *   2) 拖不丢 —— 每一帧都夹边界。调不回去的按键比不能调的按键更糟，
   *      因为玩家连"退回原样"都做不到。
   *   3) 拖的时候不触发动作 —— 否则拖"剑"格就是砍了一刀（见 bindSlots）。
   *
   * 只有**战斗中会按的**元素可拖：四格 + 三个圆键。
   * 「匣」固定在左上 —— 它是退出这段编辑的唯一出口，调丢了就没有回头路；
   * 摇杆区也不可拖 —— 它是"哪里按下去就长在哪里"的浮动式，本来就不占固定位置。
   *
   * 为什么四格只给一个**统一**的大小滑杆，不给每个格子单独缩放：
   * 四个格子是一个装备栏，大小不一就读不成一组；而三个圆键的字号是绑着
   * 直径写死的，缩下去字会糊成一团（它们原本就是"跳最大、交互最小"的层级）。 */
  var LKEY = 'soulkeep.layout.v1';
  /* 坐标一律存"离右下角多少 px"。为什么不用比例：右下是屏幕锚点，
   * 窗口变大时四格应该跟着右下角走，而不是浮到屏幕中间。
   * 也不分"触屏/桌面"存两份 —— 存的就是"你自己摆的那一份"，换设备跟着你走。 */
  var LAY = { v: 1, sz: 0, pos: {} };
  var LAY_MARGIN = 4;                 // 贴边的按键在圆角屏上按不到
  var layEdit = false;

  function laySlots() { return ['slotw1', 'slotw2', 'slotred', 'slotblue']; }
  function layPads()  { return ['pbJump', 'pbRoll', 'pbUse']; }
  function layAll()   { return laySlots().concat(layPads()); }
  function layEl(id)  { return document.getElementById(id); }

  function layLoad() {
    try {
      var raw = window.localStorage && localStorage.getItem(LKEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (!o || o.v !== 1) return;
      LAY.sz = +o.sz || 0;
      LAY.pos = o.pos || {};
    } catch (e) { LAY.sz = 0; LAY.pos = {}; }
  }
  function laySave() {
    try { localStorage.setItem(LKEY, JSON.stringify(LAY)); } catch (e) {}
  }
  /* 把存下来的值写进**内联样式**。内联一定赢过 #stage.touch 那几条 id 规则，
   * 所以不需要在 CSS 里再写一遍"自定义位置"的选择器。 */
  function layApply() {
    layAll().forEach(function (id) {
      var el = layEl(id); if (!el) return;
      var p = LAY.pos[id];
      if (!p) return;
      el.style.right = p[0] + 'px';
      el.style.bottom = p[1] + 'px';
    });
    if (LAY.sz) laySlots().forEach(function (id) {
      var el = layEl(id); if (el) el.style.setProperty('--sz', LAY.sz + 'px');
    });
  }
  function layClear() {
    LAY.sz = 0; LAY.pos = {};
    layAll().forEach(function (id) {
      var el = layEl(id); if (!el) return;
      el.style.right = ''; el.style.bottom = '';
      el.style.removeProperty('--sz');
    });
    try { localStorage.removeItem(LKEY); } catch (e) {}
  }
  function laySetSize(v) {
    LAY.sz = v;
    laySlots().forEach(function (id) {
      var el = layEl(id); if (el) el.style.setProperty('--sz', v + 'px');
    });
  }

  /* 拖动。跟手的难点是**两套坐标系**：
   *   四格在 #stage 里，整块舞台被 transform:scale() 缩过 —— 1 个屏幕像素
   *     不等于 1 个舞台像素，直接拿 clientX 的差去改 right 会"拖得比手快/慢"；
   *   三个圆键挂在 body 上的 #pad（position:fixed）里 —— 1:1，不用换算。
   * 所以换算比按"元素在哪个坐标系"取，而不是按"是不是触屏"。 */
  function layBindDrag(el, space) {
    var start = null;
    el.addEventListener('pointerdown', function (e) {
      if (!layEdit) return;
      e.preventDefault();
      e.stopPropagation();
      var cs = getComputedStyle(el);
      var s = 1;
      if (space === 'stage') {
        var w = stage.offsetWidth || STAGE_W;
        s = (stage.getBoundingClientRect().width || w) / w;
      }
      start = {
        x: e.clientX, y: e.clientY, s: s || 1,
        r: parseFloat(cs.right) || 0,
        b: parseFloat(cs.bottom) || 0,
        w: el.offsetWidth, h: el.offsetHeight,
      };
      el.classList.add('drag');
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    });
    el.addEventListener('pointermove', function (e) {
      if (!start) return;
      e.preventDefault();
      var nr = start.r - (e.clientX - start.x) / start.s;
      var nb = start.b - (e.clientY - start.y) / start.s;
      var bw = space === 'stage' ? (stage.offsetWidth || STAGE_W) : window.innerWidth;
      var bh = space === 'stage' ? STAGE_H : window.innerHeight;
      /* 三个圆键的坐标系原点是 #acts（离屏幕右下角各 6px 的零点），
       * 所以它的可用宽度要再让掉这 6px，否则最右只剩 2px 露在屏幕外。 */
      var off = space === 'stage' ? 0 : 6;
      /* 夹边界：right 越大越靠左，所以上界是"左边还剩一个完整按钮"。 */
      nr = Math.max(LAY_MARGIN, Math.min(bw - off - start.w - LAY_MARGIN, nr));
      nb = Math.max(LAY_MARGIN, Math.min(bh - off - start.h - LAY_MARGIN, nb));
      el.style.right = nr + 'px';
      el.style.bottom = nb + 'px';
    });
    var end = function () {
      if (!start) return;
      start = null;
      el.classList.remove('drag');
      LAY.pos[el.id] = [Math.round(parseFloat(el.style.right) || 0),
                        Math.round(parseFloat(el.style.bottom) || 0)];
      laySave();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  function layToggle(on) {
    layEdit = !!on;
    var slots = layEl('slots');
    if (slots) slots.classList.toggle('editing', layEdit);
    if (pad) pad.classList.toggle('editing', layEdit);
    var bar = layEl('laybar');
    if (bar) bar.classList.toggle('show', layEdit);
    if (window.__sk) {
      if (window.__sk.pause) window.__sk.pause(layEdit);
      /* 松开所有按键：进编辑前那一手指（或那一下 W）不能带进暂停态，
       * 否则退出编辑的瞬间人会自己往前走。 */
      window.__sk.releaseAll();
    }
    if (!layEdit) return;
    /* 进编辑时把滑杆对齐到**当前实际大小**：玩家可能上次调过大小，
     * 滑杆停在默认值上会让人以为"调了没用"。
     * 注意这里**不写** LAY.sz —— 仅仅拖了一下位置，不该把"触屏默认 68px"
     * 悄悄钉成桌面的 64px（那会让手机上下次进来格子莫名其妙变小）。 */
    var s0 = layEl('slotw1');
    if (s0) {
      var sl = layEl('laysz');
      if (sl) sl.value = String(Math.round(s0.offsetWidth) || 64);
    }
  }

  function initLayout() {
    layLoad();
    layApply();
    layAll().forEach(function (id) {
      var el = layEl(id);
      if (el) layBindDrag(el, id.indexOf('slot') === 0 ? 'stage' : 'vp');
    });

    var be = layEl('layedit');
    if (be) be.onclick = function () {
      /* 先关菜单再进编辑：菜单开着时 #slots 带 hideplay（opacity:0），
       * 格子看不见就无从拖起。关菜单用 __sk.menu(false) 走同一条路，
       * 不在这里自己 toggle class。 */
      if (window.__sk && window.__sk.menu) window.__sk.menu(false);
      layToggle(true);
    };
    var bd = layEl('laydone');
    if (bd) bd.onclick = function () { layToggle(false); };
    var br = layEl('layreset');
    if (br) br.onclick = function () {
      layClear();
      var sl = layEl('laysz');
      var s0 = layEl('slotw1');
      if (sl && s0) sl.value = String(Math.round(s0.offsetWidth) || 64);
    };
    var szIn = layEl('laysz');
    if (szIn) {
      szIn.addEventListener('input', function () {
        laySetSize(parseInt(szIn.value, 10) || 64);
      });
      szIn.addEventListener('change', laySave);
    }
  }

  /* ---------------- 竖屏提示 ---------------- */
  function checkRot() {
    if (!rot) return;
    rot.classList.toggle('show', window.innerHeight > window.innerWidth * 1.02);
  }

  /* ---------------- 桌面：把键盘焦点抓回来 ----------------
   * 游戏可能跑在 iframe 里（预览面板 / 嵌入页）。父窗口拿着焦点时，
   * 按键事件根本到不了这一层 —— 现象就是"按什么都没反应"，而代码完全正常。
   * 键盘无法凭空请求焦点，只能借一次点击，所以：
   *   1) 页面任何位置 pointerdown 都把焦点抓回来（零成本，不打扰）；
   *   2) 在 iframe 里且 4 秒内没收到任何按键，就把这句话说出来。
   * 本地双击打开（顶层窗口）不显示那条提示 —— 它不该挡画面。 */
  function deskFocus() {
    document.addEventListener('pointerdown', function () {
      try { window.focus(); } catch (e) {}
      if (cv) { try { cv.focus({ preventScroll: true }); } catch (e) { try { cv.focus(); } catch (e2) {} } }
    }, true);

    if (window.self === window.top) return;      // 顶层窗口焦点本来就是我们的
    var gotKey = false;
    var onKey = function () { gotKey = true; };
    addEventListener('keydown', onKey, true);

    var el = document.createElement('div');
    el.id = 'wake';
    el.innerHTML = '点一下画面，再按键' +
                   '<small>A / D 移动 · K 跳 · J 攻 · F 冲刺 · O 魂匣</small>';
    document.body.appendChild(el);
    var off = function () {
      el.classList.add('off');
      removeEventListener('keydown', onKey, true);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 520);
    };
    document.addEventListener('pointerdown', off, true);
    setTimeout(function () { if (gotKey) off(); }, 4000);
  }

  /* ---------------- 启动 ---------------- */
  function onResize() {
    fit();
    checkRot();
  }

  buildPad();
  bindSlots();
  /* 布局编辑放在 fit() 之前初始化：它写的是 right/bottom，和缩放比无关；
     但要在 buildPad() 之后，否则拿不到那三个圆键。 */
  initLayout();
  if (!touch) deskFocus();
  fit();
  checkRot();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', function () { setTimeout(onResize, 120); });

  /* 切到后台再回来：帧时间会跳，清干净按键避免"卡着走" */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && window.__sk) window.__sk.releaseAll();
  });
})();
