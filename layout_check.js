// layout_check.js — WO-004（四格装备栏 · 布局可调）的验收
//
// 为什么单开一个文件：ui_check 验的是"看不看得见"，这一份验的是
// **"摆过之后还在不在"**。这两件事的失败方式完全不同 ——
// 一个是文案问题（改一行 CSS 就好），一个是数据问题（下次打开就没了）。
//
// 白哥的要求原话是"位置完全照《重生细胞》，并且玩家可调（像王者）"。
// 拆成三件事验：
//   照抄 —— 默认位置必须和参照一致，四格与三键不许压在一起（A/G）；
//   可调 —— 拖得动、夹得住、按得准（B/C/G）；
//   记得 —— 重开还是你的位置（D），并且能一键退回默认（F）。
//
// 用法: node layout_check.js
'use strict';
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');
const KEY = 'soulkeep.layout.v1';

let pass = 0, fail = 0;
const ck = (name, ok, extra) => {
  if (ok) { pass++; console.log('OK   ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};

const geo = (page, ids) => page.evaluate(list => {
  const o = {};
  list.forEach(id => {
    const e = document.getElementById(id);
    if (!e) { o[id] = null; return; }
    const r = e.getBoundingClientRect();
    o[id] = {
      l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      right: e.style.right || '', bottom: e.style.bottom || '',
    };
  });
  return o;
}, ids);

const openEdit = async (page) => {
  await page.keyboard.press('o');
  await page.waitForTimeout(320);
  await page.evaluate(() => { const b = document.querySelector('.tab[data-pane="Ops"]'); if (b) b.click(); });
  await page.waitForTimeout(160);
  await page.evaluate(() => document.getElementById('layedit').click());
  await page.waitForTimeout(260);
};
const dragBy = async (page, id, dx, dy) => {
  const c = await page.evaluate(s => {
    const r = document.getElementById(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(140);
};
const stageScale = page => page.evaluate(() => {
  const st = document.getElementById('stage');
  return (st.getBoundingClientRect().width || 1) / (st.offsetWidth || 1);
});
/* 两两不相交。矩形自己和自己不算，所以从 j = i+1 开始。 */
const noOverlap = (g) => {
  const ids = Object.keys(g).filter(k => g[k]);
  const bad = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = g[ids[i]], b = g[ids[j]];
    const ox = Math.min(a.l + a.w, b.l + b.w) - Math.max(a.l, b.l);
    const oy = Math.min(a.t + a.h, b.t + b.h) - Math.max(a.t, b.t);
    if (ox > 2 && oy > 2) bad.push(ids[i] + '×' + ids[j] + ' ' + ox + 'x' + oy);
  }
  return bad;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });

  /* ================= A. 入口与编辑态 ================= */
  console.log('--- A 入口 ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(FILE, { waitUntil: 'load' });
    await page.waitForTimeout(1100);

    await page.keyboard.press('o');
    await page.waitForTimeout(320);
    await page.evaluate(() => { const b = document.querySelector('.tab[data-pane="Ops"]'); if (b) b.click(); });
    await page.waitForTimeout(200);
    const entry = await page.evaluate(() => {
      const b = document.getElementById('layedit');
      if (!b) return { ok: false };
      /* 入口必须在「操作」页的**最前面**：玩家点进来十有八九是来改按键的，
         不是来读键位表的。用"它在第几个子块"来判断，而不是靠肉眼。 */
      const pane = document.getElementById('paneOps');
      const first = pane.querySelector('.grp');
      const r = b.getBoundingClientRect(), pr = pane.getBoundingClientRect();
      return { ok: true, grp: first && first.textContent.trim(), inView: r.top >= pr.top - 2 && r.top < pr.top + 120 };
    });
    ck('「操作」页有调布局入口', entry.ok === true);
    ck('布局是「操作」页的第一块', entry.grp === '布 局', entry.grp);
    ck('入口在首屏（不用滚就能看见）', entry.inView === true);

    await page.evaluate(() => document.getElementById('layedit').click());
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({
      bar: document.getElementById('laybar').classList.contains('show'),
      menu: document.getElementById('menu').classList.contains('show'),
      slots: document.getElementById('slots').classList.contains('editing'),
      hideplay: document.getElementById('slots').classList.contains('hideplay'),
      opa: getComputedStyle(document.getElementById('slots')).opacity,
      dashed: getComputedStyle(document.getElementById('slotw1')).borderTopStyle,
    }), []);
    ck('进编辑后出现编辑条', st.bar === true);
    ck('进编辑自动收起魂匣（否则格子被 hideplay 藏着）', st.menu === false && st.hideplay === false);
    ck('格子可见', st.opa === '1', st.opa);
    ck('格子显示可拖（虚线框）', st.dashed === 'dashed', st.dashed);

    /* 世界必须停住。玩家在摆按键，这时候被史莱姆撞一下是最坏的时机 ——
     * 手一抖就把格子拖到别人身上了。 */
    const x0 = await page.evaluate(() => window.__sk.state().x);
    await page.keyboard.down('d');
    await page.waitForTimeout(700);
    await page.keyboard.up('d');
    const x1 = await page.evaluate(() => window.__sk.state().x);
    ck('进编辑后世界暂停（按住 D 人不动）', Math.abs(x1 - x0) < 0.5, x0 + '→' + x1);
    await ctx.close();
  }

  /* ================= B. 拖动 ================= */
  console.log('\n--- B 拖动 ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    await page.goto(FILE, { waitUntil: 'load' });
    await page.waitForTimeout(1100);
    await openEdit(page);
    const s = await stageScale(page);
    const g0 = await geo(page, ['slotw1']);

    await dragBy(page, 'slotw1', -60, -40);
    const g1 = await geo(page, ['slotw1']);
    /* 换算：舞台被 scale 过，1 个屏幕像素 = 1/s 个舞台像素。
     * 往左上拖，right/bottom 都应该变大（离右下角更远）。 */
    ck('拖格子真的动了位', g1.slotw1.l !== g0.slotw1.l || g1.slotw1.t !== g0.slotw1.t, [g0.slotw1.l, g1.slotw1.l]);
    ck('拖动按屏幕像素跟手（÷缩放比）',
       Math.abs((g1.slotw1.l - g0.slotw1.l) + 60) <= 3 && Math.abs((g1.slotw1.t - g0.slotw1.t) + 40) <= 3,
       { dx: g1.slotw1.l - g0.slotw1.l, dy: g1.slotw1.t - g0.slotw1.t, scale: +s.toFixed(3) });

    /* 拖"剑"格不能砍一刀：按下是抓住它，不是使用它。 */
    const stt = await page.evaluate(() => window.__sk.state().state);
    ck('拖剑格不会顺手砍一刀', stt !== 'attack', stt);
    const inp = await page.evaluate(() => window.__sk.input());
    ck('拖完没有残留按住的动作', Object.keys(inp).length === 0, inp);

    const after = await page.evaluate(() => localStorage.getItem('soulkeep.layout.v1'));
    ck('松手就落盘', !!after && JSON.parse(after).pos.slotw1 !== undefined, after);

    await page.evaluate(() => document.getElementById('laydone').click());
    await page.waitForTimeout(260);
    const out = await page.evaluate(() => ({
      bar: document.getElementById('laybar').classList.contains('show'),
      slots: document.getElementById('slots').classList.contains('editing'),
    }));
    ck('「完成」退出编辑', out.bar === false && out.slots === false);
    const xa = await page.evaluate(() => window.__sk.state().x);
    await page.keyboard.down('d');
    await page.waitForTimeout(400);
    await page.keyboard.up('d');
    const xb = await page.evaluate(() => window.__sk.state().x);
    ck('退出后世界恢复（按住 D 人会走）', xb - xa > 20, xa + '→' + xb);
    await ctx.close();
  }

  /* ================= C. 边界 ================= */
  console.log('\n--- C 边界 ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    await page.goto(FILE, { waitUntil: 'load' });
    await page.waitForTimeout(1100);
    await openEdit(page);
    const viewW = await page.evaluate(() => document.getElementById('stage').offsetWidth);
    const sz = await page.evaluate(() => document.getElementById('slotw1').offsetWidth);

    await dragBy(page, 'slotred', 900, 900);        // 一路拖到右下角外
    const gA = await geo(page, ['slotred']);
    const rA = await page.evaluate(() => {
      const e = document.getElementById('slotred');
      return { r: parseFloat(e.style.right), b: parseFloat(e.style.bottom) };
    });
    ck('往右下拖被夹在边上（right/bottom ≥ 4）', rA.r >= 4 && rA.b >= 4, rA);
    ck('夹住之后格子仍在舞台内', gA.slotred.l + gA.slotred.w <= 1366, [gA.slotred.l, gA.slotred.w]);

    await dragBy(page, 'slotred', -9999, -9999);     // 一路拖到左上角外
    const rB = await page.evaluate(() => {
      const e = document.getElementById('slotred');
      return { r: parseFloat(e.style.right), b: parseFloat(e.style.bottom) };
    });
    ck('往左上拖也不出界（右边还留得下一整个格子）',
       rB.r <= viewW - sz - 4 + 1 && rB.b <= 540 - sz - 4 + 1, { r: rB.r, b: rB.b, viewW, sz });
    await ctx.close();
  }

  /* ================= D/E/F. 记忆 / 大小 / 恢复 ================= */
  console.log('\n--- D 记忆 ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    await page.goto(FILE, { waitUntil: 'load' });
    await page.waitForTimeout(1100);
    await openEdit(page);
    await dragBy(page, 'slotw2', -90, -70);
    /* 拖完把大小也改一下：两件事要分别记住，谁也不该被对方覆盖 */
    await page.evaluate(() => {
      const sl = document.getElementById('laysz');
      sl.value = '88';
      sl.dispatchEvent(new Event('input', { bubbles: true }));
      sl.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(200);
    const before = await geo(page, ['slotw2']);
    const szBefore = await page.evaluate(() => ['slotw1', 'slotw2', 'slotred', 'slotblue']
      .map(id => document.getElementById(id).offsetWidth));
    ck('大小滑杆一次改四格', szBefore.every(w => w === 88), szBefore);

    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1100);
    const after = await geo(page, ['slotw2']);
    const szAfter = await page.evaluate(() => ['slotw1', 'slotw2', 'slotred', 'slotblue']
      .map(id => document.getElementById(id).offsetWidth));
    ck('重开之后位置还在', Math.abs(after.slotw2.l - before.slotw2.l) <= 2 &&
                          Math.abs(after.slotw2.t - before.slotw2.t) <= 2,
       [before.slotw2.l, after.slotw2.l]);
    ck('重开之后大小还在', szAfter.every(w => w === 88), szAfter);
    const editing = await page.evaluate(() => document.getElementById('slots').classList.contains('editing'));
    ck('但不会记住"正在编辑"（重开是能玩的）', editing === false);

    /* 恢复默认：位置、大小、磁盘上的那份，三样一起清 */
    await openEdit(page);
    await page.evaluate(() => document.getElementById('layreset').click());
    await page.waitForTimeout(220);
    const reset = await page.evaluate(() => ({
      store: localStorage.getItem('soulkeep.layout.v1'),
      inline: ['slotw1', 'slotw2', 'slotred', 'slotblue']
        .map(id => (document.getElementById(id).style.right || '') + '|' +
                   (document.getElementById(id).style.bottom || '')),
      w: document.getElementById('slotw1').offsetWidth,
    }));
    ck('恢复默认清掉落盘的那份', reset.store === null, reset.store);
    ck('恢复默认清掉内联位置', reset.inline.every(v => v === '|'), reset.inline);
    /* 默认格子从 64 改成 44（白哥 2026-11-24「界面没抄对」之后重做布局）：
     * 参考图实测格子 34px，64 比它大近一倍，摆在一起完全不像同一套 UI。
     * 44 是 iOS/安卓的可点下限，位置锚点严格照参考。 */
    ck('恢复默认把大小退回默认', reset.w === 44, reset.w);
    await ctx.close();
  }

  /* ================= G. 触屏：不重叠 / 可拖 / 不误触 ================= */
  console.log('\n--- G 触屏 ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(FILE + '?touch=1', { waitUntil: 'load' });
    await page.waitForTimeout(1400);

    const g = await geo(page, ['slotw1', 'slotw2', 'slotred', 'slotblue', 'pbJump', 'pbRoll', 'pbUse']);
    const bad = noOverlap(g);
    /* 这一条是这次改动真正的驱动：四格用**舞台**像素写偏移，会跟着舞台一起缩
     * （手机上 ≈0.72），而三个圆键是 fixed、不缩。844×390 上算出来
     * "剑格离右缘 147px、翻滚键占 102~180px"，直接压在一起。
     * 位置一致是白哥的硬要求，所以这条必须在实机尺寸下验。 */
    ck('844×390 下四格与三键互不重叠', bad.length === 0, bad);
    ck('四格自己之间也不重叠',
       noOverlap({ slotw1: g.slotw1, slotw2: g.slotw2, slotred: g.slotred, slotblue: g.slotblue }).length === 0);

    await openEdit(page);
    const s = await stageScale(page);
    const j0 = await geo(page, ['pbJump']);
    await dragBy(page, 'pbJump', -100, -70);
    const j1 = await geo(page, ['pbJump']);
    ck('触屏的圆键也能拖', Math.abs((j1.pbJump.l - j0.pbJump.l) + 100) <= 4 &&
                          Math.abs((j1.pbJump.t - j0.pbJump.t) + 70) <= 4,
       { dx: j1.pbJump.l - j0.pbJump.l, dy: j1.pbJump.t - j0.pbJump.t, scale: +s.toFixed(3) });
    const pin = await page.evaluate(() => window.__sk.input());
    ck('拖圆键不会真的按下去', Object.keys(pin).length === 0, pin);

    /* 「匣」不可拖：它是退出这段编辑的出口，调丢了就没有回头路 */
    const m0 = await geo(page, ['pbMenu']);
    await dragBy(page, 'pbMenu', -60, 120);
    const m1 = await geo(page, ['pbMenu']);
    ck('「匣」拖不动（它是退出口）', m0.pbMenu.l === m1.pbMenu.l && m0.pbMenu.t === m1.pbMenu.t,
       [m0.pbMenu.l, m1.pbMenu.l]);

    /* 暂停时不该能出招 —— 否则玩家在摆按键，角色在旁边挥刀。 */
    await page.keyboard.press('j');
    await page.waitForTimeout(200);
    const pj = await page.evaluate(() => window.__sk.state().state);
    ck('编辑态按 J 不出招', pj !== 'attack', pj);
    ck('页面没有报错', errs.length === 0, errs);
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + (fail ? '有 ' + fail + ' 项失败' : '布局可调验收全通过') + '（' + pass + ' 项）');
  process.exit(fail ? 1 : 0);
})();
