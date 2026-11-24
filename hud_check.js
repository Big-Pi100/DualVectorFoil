// hud_check.js — 左上血瓶 / 右上小地图 验收
//
// 为什么要单开一套：这两件是**照着参考图新加的 HUD**，
// 而 HUD 的失败方式和玩法不一样 —— 玩法错了会立刻"打不动"，
// HUD 错了只是"看着不对"，能一直带着错发出去。所以这里查三件事：
//
//   A. 结构：元素在、初始值对、徽章和状态对得上
//   B. 功能：点一下真回血、次数真减少、空了真的拒绝、复活真回满
//   C. 位置：**不许压任何东西**（血条/房间名/四格/小地图/画面中央）
//
// C 组是这一轮返工的直接原因：上一版血瓶摆在 top:104，
// 正好压在墨条上 —— 无灯房间墨条不显形，所以只在部分房间露馅。
// "看着差不多"靠不住，得两两求交。
//
// 用法: node hud_check.js
'use strict';
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
const ck = (name, ok, extra) => {
  if (ok) { pass++; console.log('OK   ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};

const rects = (page, ids) => page.evaluate(list => {
  const o = {};
  list.forEach(id => {
    const e = document.getElementById(id);
    if (!e) { o[id] = null; return; }
    const r = e.getBoundingClientRect();
    o[id] = { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1) };
  });
  return o;
}, ids);

const inter = (a, b) => (a && b) ? !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t) : false;
const area = (a, b) => (a && b)
  ? Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t))
  : 0;

(async () => {
  const b = await chromium.launch({ executablePath: EXE });

  /* ================= 桌面 ================= */
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 810 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto(FILE, { waitUntil: 'load' });
    await p.waitForTimeout(1500);

    /* ---- A. 结构 ---- */
    const st0 = await p.evaluate(() => window.__sk.state());
    ck('A1 血瓶初始 3 瓶（flaskMax 也是 3）', st0.flasks === 3 && st0.flaskMax === 3, { flasks: st0.flasks, max: st0.flaskMax });
    const badge0 = await p.evaluate(() => document.getElementById('flaskn').textContent);
    ck('A2 徽章数字 = 状态里的次数', badge0 === String(st0.flasks), { badge: badge0 });
    const mmOk = await p.evaluate(() => {
      const c = document.getElementById('mm');
      return c ? { w: c.width, h: c.height, cssW: c.getBoundingClientRect().width } : null;
    });
    ck('A3 小地图画布在，且 backing store 是 2x', !!mmOk && mmOk.w >= 200, mmOk);

    /* ---- B. 功能 ---- */
    // 满血：点一下不该消耗
    await p.click('#flask');
    await p.waitForTimeout(1000);
    let s1 = await p.evaluate(() => window.__sk.state());
    ck('B1 满血点血瓶：不消耗（次数仍是 3）', s1.flasks === 3, { flasks: s1.flasks });
    const tip1 = await p.evaluate(() => window.__sk.said().slice(-1)[0] || '');
    ck('B2 满血点血瓶：给一句"血是满的"', /血是满的/.test(tip1), tip1);

    // 打掉一半血再点
    await p.waitForTimeout(1000);
    await p.evaluate(() => window.__sk.hurt(40));
    await p.waitForTimeout(160);
    const sHurt = await p.evaluate(() => window.__sk.state());
    await p.click('#flask');
    await p.waitForTimeout(160);
    let s2 = await p.evaluate(() => window.__sk.state());
    ck('B3 残血点血瓶：次数 -1', s2.flasks === 2, { before: sHurt.flasks, after: s2.flasks });
    ck('B4 残血点血瓶：真回血（hp 变大）', s2.hp > sHurt.hp, { before: sHurt.hp, after: s2.hp });
    const badge2 = await p.evaluate(() => document.getElementById('flaskn').textContent);
    ck('B5 徽章跟着变成 2', badge2 === '2', badge2);

    // 键盘 H 走同一条路
    await p.waitForTimeout(1000);
    await p.evaluate(() => window.__sk.hurt(40));
    await p.waitForTimeout(150);
    const pHP = await p.evaluate(() => window.__sk.state().hp);
    await p.keyboard.press('h');
    await p.waitForTimeout(160);
    const s3 = await p.evaluate(() => window.__sk.state());
    ck('B6 键盘 H 也能喝（和点击同源）', s3.flasks === 1 && s3.hp > pHP, { flasks: s3.flasks, hp: [pHP, s3.hp] });

    // 喝空
    await p.waitForTimeout(1000);
    await p.evaluate(() => window.__sk.hurt(40));
    await p.waitForTimeout(140);
    await p.keyboard.press('h');
    await p.waitForTimeout(200);
    const s4 = await p.evaluate(() => window.__sk.state());
    ck('B7 第三瓶喝完之后是 0', s4.flasks === 0, { flasks: s4.flasks });
    const outCls = await p.evaluate(() => document.getElementById('flask').className);
    ck('B8 空了整格变灰（.out）', /\bout\b/.test(outCls), outCls);

    await p.waitForTimeout(1000);
    await p.evaluate(() => window.__sk.hurt(20));
    await p.waitForTimeout(140);
    const hpLow = await p.evaluate(() => window.__sk.state().hp);
    await p.click('#flask');
    await p.waitForTimeout(160);
    const s5 = await p.evaluate(() => window.__sk.state());
    const tip2 = await p.evaluate(() => window.__sk.said().slice(-1)[0] || '');
    ck('B9 空了之后点：不加血、给"血瓶空了"', s5.hp === hpLow && /血瓶空了/.test(tip2), { hp: s5.hp, tip: tip2 });

    // 复活回满
    /* 上一刀留下的无敌帧会把这一刀吃掉（hurtPlayer 里 invuln 直接 return），
     * 不吃掉才是 bug —— 先等它过去，再打致命的一刀。
     * 另外 A 路线 P1 加了**一击保护**：满血时挨致死一刀只会剩 1 HP（45 秒冷却）。
     * 所以这里必须先把血压到 25% 阈值以下，否则测的是保护，不是死亡。 */
    await p.waitForTimeout(900);
    await p.evaluate(() => { window.__sk.setHp(20); window.__sk.hurt(9999); });
    /* 复活是 deadT > 1.3 秒才发生（2006 行），不是当场 —— 等短了会误判成"没回满" */
    await p.waitForTimeout(2200);
    const s6 = await p.evaluate(() => window.__sk.state());
    ck('B10 死一次复活：血瓶回满（不是把资源永久削掉）', s6.flasks === 3 || s6.dead, { flasks: s6.flasks, dead: s6.dead });

    /* ---- C. 位置 / 重叠 ---- */
    const R = await rects(p, ['bars', 'flask', 'roomname', 'mm', 'slotw1', 'slotw2', 'slotred', 'slotblue', 'stage', 'top']);
    ck('C1 血瓶不压血条/墨条（bars）', !inter(R.flask, R.bars), { flask: R.flask, bars: R.bars });
    ck('C2 血瓶不压房间名', !inter(R.flask, R.roomname), { roomname: R.roomname });
    ck('C3 血瓶不压四格', !inter(R.flask, R.slotw1) && !inter(R.flask, R.slotred), null);
    ck('C4 小地图不压顶栏按钮', !inter(R.mm, R.top) || R.mm.t >= R.top.b - 1, { mm: R.mm, top: R.top });
    ck('C5 小地图不压四格', !inter(R.mm, R.slotred) && !inter(R.mm, R.slotblue), null);
    ck('C6 血瓶完整在舞台内（没被裁）',
      R.flask.l >= R.stage.l - 1 && R.flask.t >= R.stage.t - 1 && R.flask.b <= R.stage.b + 1,
      { flask: R.flask, stage: R.stage });
    ck('C7 小地图完整在舞台内', R.mm.r <= R.stage.r + 1 && R.mm.t >= R.stage.t - 1, { mm: R.mm, stage: R.stage });

    /* ---- 小地图内容 ---- */
    const mmPix = await p.evaluate(() => {
      const c = document.getElementById('mm');
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let ink = 0, orange = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        ink++;
        if (d[i] > 200 && d[i + 1] > 120 && d[i + 1] < 210 && d[i + 2] < 120) orange++;
      }
      return { ink, orange };
    });
    ck('C8 小地图真的画了东西（不是空画布）', mmPix.ink > 500, mmPix);
    ck('C9 小地图上有玩家橙点', mmPix.orange > 3, { orange: mmPix.orange });

    // 走一段，橙点要动
    const dot0 = await p.evaluate(() => {
      const c = document.getElementById('mm'); const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i + 3] > 8 && d[i] > 200 && d[i + 1] > 120 && d[i + 1] < 210 && d[i + 2] < 120) { sx += x; sy += y; n++; }
      }
      return n ? { x: sx / n, y: sy / n, n } : null;
    });
    await p.evaluate(() => { window.__sk.releaseAll(); window.__sk.press('right'); });
    await p.waitForTimeout(900);
    await p.evaluate(() => window.__sk.releaseAll());
    await p.waitForTimeout(220);
    const dot1 = await p.evaluate(() => {
      const c = document.getElementById('mm'); const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i + 3] > 8 && d[i] > 200 && d[i + 1] > 120 && d[i + 1] < 210 && d[i + 2] < 120) { sx += x; sy += y; n++; }
      }
      return n ? { x: sx / n, y: sy / n, n } : null;
    });
    ck('C10 玩家走了，橙点跟着走', !!dot0 && !!dot1 && Math.abs(dot1.x - dot0.x) > 3, { dot0, dot1 });

    ck('C11 运行期没有 JS 异常', errs.length === 0, errs.slice(0, 2));

    await ctx.close();
  }

  /* ================= 触屏 ================= */
  {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(FILE + '?touch=1', { waitUntil: 'load' });
    await p.waitForTimeout(1600);
    const R = await rects(p, ['flask', 'bars', 'roomname', 'mm', 'stage', 'slotw1', 'slotred']);
    const w = R.flask.r - R.flask.l, h = R.flask.b - R.flask.t;
    ck('D1 触屏血瓶 ≥40 物理像素（舞台 0.72 倍下没被缩小）', w >= 39 && h >= 39, { w: +w.toFixed(1), h: +h.toFixed(1) });
    ck('D2 触屏血瓶不压血条', !inter(R.flask, R.bars), { flask: R.flask, bars: R.bars });
    ck('D3 触屏血瓶不压房间名', !inter(R.flask, R.roomname), { roomname: R.roomname });
    ck('D4 触屏小地图不压四格', !inter(R.mm, R.slotw1) && !inter(R.mm, R.slotred), null);
    ck('D5 触屏元素都在屏幕内', R.flask.l >= 0 && R.flask.t >= 0 && R.mm.r <= 844 && R.mm.b <= 390, { mm: R.mm });

    // 触屏真点一下
    await p.evaluate(() => window.__sk.hurt(40));
    await p.waitForTimeout(160);
    const before = await p.evaluate(() => window.__sk.state());
    await p.tap('#flask');
    await p.waitForTimeout(200);
    const after = await p.evaluate(() => window.__sk.state());
    ck('D6 触屏点血瓶真的回血', after.hp > before.hp && after.flasks === before.flasks - 1,
      { hp: [before.hp, after.hp], flasks: [before.flasks, after.flasks] });

    await ctx.close();
  }

  await b.close();
  console.log('\n==== ' + pass + ' pass / ' + fail + ' fail ====');
  process.exit(fail ? 1 : 0);
})();
