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
  var touch = ('ontouchstart' in window) ||
              (navigator.maxTouchPoints || 0) > 0 ||
              /[?&]touch=1/.test(location.search);

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
    pad.innerHTML =
      '<div id="stickzone"></div>' +
      '<div id="stick"><i></i></div>' +
      '<div id="btns">' +
        '<button class="pb" id="pbBack">后</button>' +
        '<button class="pb" id="pbRed">红</button>' +
        '<button class="pb" id="pbBlue">蓝</button>' +
        '<button class="pb" id="pbAtk">攻</button>' +
        '<button class="pb" id="pbJump">跳</button>' +
      '</div>' +
      '<button class="pb" id="pbMenu">匣</button>' +
      '<div id="touchhint">左滑移动 · 下推蹲 · 上推抬头 · 下推+跳滑铲<br>右：攻 / 跳 / 红 / 蓝 / 后</div>';
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
      window.__sk.release('arrowleft');
      window.__sk.release('arrowright');
      if (d < 0) window.__sk.press('arrowleft');
      if (d > 0) window.__sk.press('arrowright');
    }

    /* 垂直轴：下推 = 蹲（也是"下+跳"滑铲、"下+攻"穿板的修饰），
     * 上推 = 抬头（原版 ↑ 就是抬头/进门，不是跳）。
     * 上推这一路以前是空的 —— 手机上永远做不出抬头，
     * 等于把原版的一个方向位整个砍掉了。 */
    var vdir = 0;
    function setV(v) {
      if (v === vdir) return;
      vdir = v;
      window.__sk.release('arrowdown');
      window.__sk.release('arrowup');
      if (v > 0) window.__sk.press('arrowdown');
      if (v < 0) window.__sk.press('arrowup');
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
      stick.classList.remove('on');
      knob.style.transform = 'translate(0,0)';
    }
    zone.addEventListener('pointerup', stickUp);
    zone.addEventListener('pointercancel', stickUp);

    /* --- 按键：按住 = keys[k]=true，抬起立刻松开 --- */
    function bind(el, key) {
      var down = function (e) {
        e.preventDefault();
        el.classList.add('on');
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
        window.__sk.press(key);
      };
      var up = function () {
        el.classList.remove('on');
        window.__sk.release(key);
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    }

    /* 键名必须和键盘表里的**主键**一致（game.js 的 K 表）：
     *   k 跳 / j 攻 / u 红魂 / l 蓝魂 / i 后跃
     * 以前这里发 ' ' 和 'l'、'i'，而 'l' 那时是红魂、'i' 是蓝魂 ——
     * 键盘一改，手机就会悄悄错位：按"红"起跳、按"蓝"放魔法。
     * 这类错误在桌面上测不出来，只有真机点按钮才会露。 */
    bind(pad.querySelector('#pbJump'), 'k');
    bind(pad.querySelector('#pbAtk'), 'j');
    bind(pad.querySelector('#pbRed'), 'u');
    bind(pad.querySelector('#pbBlue'), 'l');
    bind(pad.querySelector('#pbBack'), 'i');

    var menuBtn = pad.querySelector('#pbMenu');
    menuBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      window.__sk.releaseAll();
      toggleMenu();
    });

    /* 开魂匣时藏掉摇杆和按键，否则会挡住卡片；"匣"按钮留着用来关 */
    var menuEl = document.getElementById('menu');
    if (menuEl && window.MutationObserver) {
      new MutationObserver(function () {
        pad.classList.toggle('hideplay', menuEl.classList.contains('show'));
      }).observe(menuEl, { attributes: true, attributeFilter: ['class'] });
    }

    /* 顶部那条"换成我的照片"在手机上太占地方 —— 收进魂匣菜单底部 */
    if (menuEl) {
      var foot = document.createElement('div');
      foot.className = 'touchfoot';
      foot.innerHTML =
        '<div class="grp">快 门</div>' +
        '<button class="btn" id="mSkin">按快门</button> ' +
        '<button class="btn" id="mReset">换回名片</button> ' +
        '<button class="btn" id="mSnd">声音 开</button>' +
        '<div class="none" style="margin-top:8px">按下去，一个人被印到平面上。他只少了一层厚度，别的什么都没变。</div>';
      menuEl.appendChild(foot);
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

    /* 首次提示，3 秒后淡出 */
    var hint = pad.querySelector('#touchhint');
    setTimeout(function () { hint.classList.add('off'); }, 3200);

    /* 触摸设备上不要有右键菜单 / 长按选择 */
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /* ---------------- 竖屏提示 ---------------- */
  function checkRot() {
    if (!rot) return;
    rot.classList.toggle('show', window.innerHeight > window.innerWidth * 1.02);
  }

  /* ---------------- 启动 ---------------- */
  function onResize() {
    fit();
    checkRot();
  }

  buildPad();
  fit();
  checkRot();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', function () { setTimeout(onResize, 120); });

  /* 切到后台再回来：帧时间会跳，清干净按键避免"卡着走" */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && window.__sk) window.__sk.releaseAll();
  });
})();
