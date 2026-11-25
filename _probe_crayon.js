'use strict';
/* 蜡笔包接入的**量化**验证 —— 只回答三个会毁掉手感的问题：
 *   1. 脚底是不是真的踩在地面线上（不是"看起来差不多"）
 *   2. 蹲下有没有真的变矮（出图阶段的 --scale-by 是否生效）
 *   3. 左右翻转时人物有没有横跳（镜像原点是否真的在 80）
 * 全部输出数字，并附 4× 局部放大图，人工只需看一眼确认。
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');
const OUT = path.resolve(__dirname, 'shots');

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + String(e)));
  await p.goto(FILE, { waitUntil: 'load' });
  await p.waitForTimeout(1600);

  /* ── 1. 脚底 / 地面 ──────────────────────────────────────── */
  const ground = await p.evaluate(() => {
    P.state = 'stand'; P.animT = 0; P.vx = 0; P.vy = 0; P.onGround = true;
    for (let i = 0; i < 40; i++) update(1 / 120);   // 让它落地稳定
    render(0);
    const feetY = P.y + P_H;
    /* 瓦片顶：从脚底往下找第一块实心瓦片的顶边，再往上一格看是不是空的。
     * 站地面上时 feetY 应当**正好等于**这块瓦片的顶。 */
    const tx = Math.floor((P.x + P_CW / 2) / TILE);
    let ty = Math.floor(feetY / TILE);
    let topY = ty * TILE;
    return {
      feetY: +feetY.toFixed(2),
      tileTopY: topY,
      diff: +(feetY - topY).toFixed(2),
      onGround: P.onGround, vy: +P.vy.toFixed(2),
      charTopAt: +(feetY - P_SPRITE_H).toFixed(2),   // 站立时头顶世界坐标
      px_to_ground: +(P.y + P_H).toFixed(2),
    };
  });
  console.log('【脚底/地面】feetY=%s  瓦片顶=%s  差=%spx  onGround=%s',
    ground.feetY, ground.tileTopY, ground.diff, ground.onGround);

  /* ── 2. 蹲下身高 ─────────────────────────────────────────── */
  /* 量**渲染路径真正画出来的东西**，不是量原图：
   * 用离屏 160×160 画布调 drawCrayonFrame，透明底，扫 alpha 的上下边界。
   * 这样测的是 drawCrayonFrame 的缩放与锚点，任何 k / ay 写错都会露出来。
   * （上一版在游戏画面上按颜色扫，扫到的是墙和画框 —— 量错了对象比不量更糟。） */
  const heights = await p.evaluate(() => {
    const out = {};
    for (const st of ['stand', 'walk', 'crouch', 'slide', 'jump']) {
      const off = document.createElement('canvas');
      off.width = 160; off.height = 160;
      const c = off.getContext('2d');
      drawCrayonFrame(c, st, 0.02, 80, 152, false, null);
      const d = c.getImageData(0, 0, 160, 160).data;
      let top = 160, bot = -1, l = 160, r = -1;
      for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
        if (d[(y * 160 + x) * 4 + 3] > 40) {
          if (y < top) top = y; if (y > bot) bot = y;
          if (x < l) l = x; if (x > r) r = x;
        }
      }
      out[st] = { top, bot, h: bot - top + 1, footGap: 152 - bot, cx: +((l + r) / 2).toFixed(1) };
    }
    return out;
  });
  for (const k of ['stand', 'walk', 'crouch', 'slide', 'jump']) {
    const v = heights[k];
    console.log('  %s  高=%s  顶=%s  底=%s  离锚点=%s  水平中线=%s',
      k.padEnd(7), String(v.h).padStart(3), String(v.top).padStart(3),
      String(v.bot).padStart(3), String(v.footGap).padStart(2), v.cx);
  }
  console.log('  → 蹲/站 = %s（出图阶段定的是 92/128 = 0.719）',
    (heights.crouch.h / heights.stand.h).toFixed(3));

  /* ── 3. 翻转横跳 ─────────────────────────────────────────── */
  const flip = await p.evaluate(() => {
    P.state = 'stand'; P.animT = 0; P.onGround = true; P.sq = 1; render(0);
    const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
    const RSv = cv.width / VIEW_W;
    const scan = () => {
      const cx = Math.round((P.x + P_CW / 2 - camX) * RSv);
      const fy = Math.round((P.y + P_H - camY) * RSv);
      let L = null, R = null;
      for (let dx = -90 * RSv; dx <= 90 * RSv; dx++) {
        for (let dy = 10 * RSv; dy < 130 * RSv; dy += 2) {
          const d = ctx.getImageData(Math.round(cx + dx), Math.round(fy - dy), 1, 1).data;
          if (d[0] > 150 && d[0] - d[2] > -20) {
            if (L === null) L = dx / RSv;
            R = dx / RSv; break;
          }
        }
      }
      return { L: +L.toFixed(1), R: +R.toFixed(1), mid: +((L + R) / 2).toFixed(1) };
    };
    P.face = 1; render(0); const a = scan();
    P.face = -1; render(0); const b2 = scan();
    return { right: a, left: b2, shift: +(b2.mid - a.mid).toFixed(2) };
  });
  console.log('【翻转】朝右 bbox 中线=%s  朝左中线=%s  横移=%spx',
    flip.right.mid, flip.left.mid, flip.shift);

  /* ── 4. 4× 局部放大图，画脚底线 ──────────────────────────── */
  const zoom = [['stand', 0], ['crouch', 0.02], ['walk', 0.01], ['attack', 0.1], ['slide', 0.1]];
  for (const [st, t] of zoom) {
    const r = await p.evaluate(({ st, t }) => {
      P.state = st; P.animT = t; P.sq = 1; P.onGround = true; P.face = 1; render(0);
      const cv = document.getElementById('cv');
      const RSv = cv.width / VIEW_W;
      const cx = Math.round((P.x + P_CW / 2 - camX) * RSv);
      const fy = Math.round((P.y + P_H - camY) * RSv);
      const half = Math.round(76 * RSv), up = Math.round(150 * RSv), dn = Math.round(24 * RSv);
      const off = document.createElement('canvas');
      off.width = half * 2; off.height = up + dn;
      const c = off.getContext('2d');
      c.imageSmoothingEnabled = false;
      c.drawImage(cv, cx - half, fy - up, half * 2, up + dn, 0, 0, half * 2, up + dn);
      // 脚底线：就在 fy 那一行
      c.fillStyle = 'rgba(255,60,60,.85)';
      c.fillRect(0, up - 1, off.width, 1);
      return { url: off.toDataURL('image/png'), scale: RSv, footRow: up };
    }, { st, t });
    fs.writeFileSync(path.join(OUT, `zoom_${st}.png`), Buffer.from(r.url.split(',')[1], 'base64'));
    console.log('  zoom_%s.png  (1 逻辑px = %s 截图px, 红线 = 脚底基准)', st, r.scale);
  }

  await b.close();
  console.log(errs.length ? '\n⚠ ' + errs.slice(0, 4).join('\n⚠ ') : '\n无 JS 报错');
})();
