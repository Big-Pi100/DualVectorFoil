// ui_check.js — WO-003（操作与 HUD 可用性）的验收
//
// 为什么单开一个文件：其余套件验的是"按下去有没有反应"，这一份验的是
// "玩家看不看得见、找不找得到"。两者会用同一份 DOM 得出相反结论 ——
// 功能全对但字看不见，玩家一样玩不了。
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

const openMenu = async (page) => {
  await page.keyboard.press('o');
  await page.waitForTimeout(350);
};
const clickTab = (page, n) => page.evaluate(name => {
  const b = document.querySelector('.tab[data-pane="' + name + '"]');
  if (b) b.click();
}, n);

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });

  /* ================= A. 桌面 HUD（1366×768） ================= */
  console.log('--- A 桌面 HUD ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(FILE, { waitUntil: 'load' });
    await page.waitForTimeout(1100);

    const hud = await page.evaluate(() => {
      const k = document.getElementById('keys');
      const cs = getComputedStyle(k);
      const alias = k.querySelector('.alias');
      const caps = k.querySelectorAll('.k');
      return {
        size: parseFloat(cs.fontSize),
        bg: cs.backgroundImage,
        shadow: cs.boxShadow,
        color: cs.color,
        aliasText: alias ? alias.textContent : '',
        capSize: caps.length ? parseFloat(getComputedStyle(caps[0]).fontSize) : 0,
        ents: k.querySelectorAll('.ent').length,
        slots: [...document.querySelectorAll('#slots .slot')].map(e => ({
          text: e.textContent, empty: e.classList.contains('empty'),
          dashed: getComputedStyle(e).borderTopStyle,
        })),
        // 图例区域是否压住角色所在的左下/中下区（只判不越过中线）
        box: (() => { const r = k.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })(),
      };
    });

    ck('图例字号 ≥13px（WO-003 §1）', hud.size >= 13, hud.size);
    ck('键帽字号 ≥12px', hud.capSize >= 12, hud.capSize);
    ck('图例有底衬（不是纯文字压在砖地上）', hud.bg !== 'none');
    ck('图例有投影', hud.shadow !== 'none');
    ck('主界面仍是 4 个动作（裁定 Q3 未被破坏）', hud.ents === 4, hud.ents);
    ck('入口文案说清是"完整操作"', /完整操作/.test(hud.aliasText) && /O/.test(hud.aliasText) && /Tab/.test(hud.aliasText), hud.aliasText);
    ck('入口文案不再像第五个动作', !/^O\s*全部按键$/.test(hud.aliasText.trim()), hud.aliasText);
    ck('空槽写明「未装备」', hud.slots.some(s => s.empty && s.text === '未装备'), hud.slots.map(s => s.text));
    ck('空槽用虚线边', hud.slots.filter(s => s.empty).every(s => s.dashed === 'dashed'), hud.slots.map(s => s.dashed));
    ck('图例宽度不超过半屏（不盖角色）', hud.box[2] < 960 / 2 + 60, hud.box);

    /* ================= B. 魂匣页签 ================= */
    console.log('\n--- B 魂匣页签 ---');
    await openMenu(page);
    const tabs = await page.evaluate(() => ({
      n: document.querySelectorAll('#menu .tab').length,
      on: [...document.querySelectorAll('#menu .tab.on')].map(b => b.textContent.trim()),
      paneOn: [...document.querySelectorAll('#menu .pane.on')].map(p => p.id),
      menuOverflow: getComputedStyle(document.getElementById('menu')).overflow,
    }));
    ck('两个页签', tabs.n === 2, tabs.n);
    ck('默认停在魂槽', tabs.paneOn[0] === 'paneSouls', tabs.paneOn);
    ck('菜单本身不滚（只有 pane 滚）', tabs.menuOverflow === 'hidden', tabs.menuOverflow);

    await clickTab(page, 'Ops');
    await page.waitForTimeout(250);
    const ops = await page.evaluate(() => {
      const pane = document.getElementById('paneOps');
      const fk = document.getElementById('fullkeys');
      return {
        paneOn: pane.classList.contains('on'),
        soulsOff: !document.getElementById('paneSouls').classList.contains('on'),
        groups: [...document.querySelectorAll('#fullkeys .gname')].map(e => e.textContent),
        entCount: document.querySelectorAll('#fullkeys .ent').length,
        paneScroll: getComputedStyle(pane).overflowY,
        tabOn: (document.querySelector('#menu .tab.on') || {}).textContent,
      };
    });
    ck('点「操作」后该页可见', ops.paneOn === true);
    ck('魂槽页同时收起（不是叠加）', ops.soulsOff === true);
    ck('完整表四组齐全', JSON.stringify(ops.groups) === JSON.stringify(['移动', '战斗', '工具', '系统']), ops.groups);
    /* 数量是**故意写死**的：表里加一条，这里就该红一次，逼人确认
     * "新条目真的渲染出来了"。12 = 13 − 纸（侧身删除，2026-11-25）。 */
    ck('完整表条目数与 LEGEND 一致（12）', ops.entCount === 12, ops.entCount);
    ck('操作页可滚动', ops.paneScroll === 'auto' || ops.paneScroll === 'scroll', ops.paneScroll);

    // 页签状态在关开菜单后保持
    await page.keyboard.press('o');
    await page.waitForTimeout(200);
    await openMenu(page);
    const kept = await page.evaluate(() => [...document.querySelectorAll('#menu .pane.on')].map(p => p.id));
    ck('重开菜单不跳回魂槽（页签状态独立于 buildMenu）', kept[0] === 'paneOps', kept);

    ck('无脚本异常', errs.length === 0, errs.slice(0, 2));
    await ctx.close();
  }

  /* ================= C. 960×540 最小舞台 ================= */
  console.log('\n--- C 960×540 ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await ctx.newPage();
    await page.goto(FILE, { waitUntil: 'load' });
    await page.waitForTimeout(1000);
    const r = await page.evaluate(() => {
      const k = document.getElementById('keys');
      const st = document.getElementById('stage');
      const kr = k.getBoundingClientRect(), sr = st.getBoundingClientRect();
      return { fit: kr.right <= sr.right + 1 && kr.bottom <= sr.bottom + 1, kr: [Math.round(kr.left), Math.round(kr.right), Math.round(kr.bottom)] };
    });
    ck('960×540 下图例不越出舞台', r.fit === true, r.kr);
    await openMenu(page);
    await clickTab(page, 'Ops');
    await page.waitForTimeout(200);
    const pane = await page.evaluate(() => {
      const p = document.getElementById('paneOps');
      return { h: Math.round(p.getBoundingClientRect().height), scrollable: p.scrollHeight > p.clientHeight };
    });
    ck('960×540 下操作页有可用高度', pane.h > 200, pane.h);
    await ctx.close();
  }

  /* ================= D. 触屏 ================= */
  console.log('\n--- D 触屏 ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 592 }, hasTouch: true });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(FILE, { waitUntil: 'load' });
    await page.waitForTimeout(1100);

    /* 四格装备 + 三键（WO-004，对齐《重生细胞》手机版）之后，这一段跟着改：
     *   「后跃」不再是独立按钮，它是三键里的「冲刺」（白哥的叫法，动作就是后跃）；
     *   「纸」从按钮变成**格子**（点一下就压扁，再点一下起来）；
     *   红/蓝也不再是按钮，它们就是第三、第四个格子。
     * 判据仍是同一件事：玩家能不能看出"哪个现在按不出东西"。 */
    const pad = await page.evaluate(() => {
      const q = s => document.querySelector(s);
      return {
        roll: q('#pbRoll').textContent.trim(),
        use: q('#pbUse').textContent.trim(),
        gearW1: q('#slotw1').textContent.trim(),
        gearW2: q('#slotw2').textContent.trim(),
        redEmpty: q('#slotred').classList.contains('empty'),
        blueEmpty: q('#slotblue').classList.contains('empty'),
        nBtns: document.querySelectorAll('#pad .pb').length,
        nSlots: document.querySelectorAll('#slots .slot').length,
        hint: q('#touchhint').textContent,
      };
    });
    ck('三键里第二键是「冲刺」（原「后跃」）', pad.roll === '冲刺', pad.roll);
    ck('三键里第三键是「交互」', pad.use === '交互', pad.use);
    /* 第二格现在是空槽：侧身删了，格子里写"未装备"而不是硬塞一个东西。 */
    ck('两个装备格是 剑 / 未装备（点一下就用）', pad.gearW1 === '剑' && pad.gearW2 === '未装备',
       [pad.gearW1, pad.gearW2]);
    ck('已装备的红格不标空（红魂是初始魂）', pad.redEmpty === false);
    ck('未装备的蓝格标「未装备」', pad.blueEmpty === true);
    ck('圆键只剩 4 个（跳/冲刺/交互/匣）', pad.nBtns === 4, pad.nBtns);
    ck('装备格是 4 个', pad.nSlots === 4, pad.nSlots);
    ck('首次提示指向操作页', /匣/.test(pad.hint) && /操作/.test(pad.hint), pad.hint.replace(/\s+/g, ' '));

    /* ---- 下压状态回执（WO-003 §5） ----
     * 下推不只是蹲，它还是滑铲/穿板的修饰键。没有回执，玩家不知道
     * "现在按跳会出滑铲"，只会以为自己按错了。 */
    await page.evaluate(() => {
      const z = document.getElementById('stickzone');
      const r = z.getBoundingClientRect();
      z.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerId: 2, clientX: r.left + 120, clientY: r.top + 120,
      }));
      z.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, pointerId: 2, clientX: r.left + 120, clientY: r.top + 190,
      }));
    });
    await page.waitForTimeout(140);
    const pushed = await page.evaluate(() => ({
      stickDown: document.getElementById('stick').classList.contains('down'),
      input: window.__sk.input(),
    }));
    ck('下推时摇杆亮起（状态回执）', pushed.stickDown === true);
    ck('下推真的按下了 down', pushed.input.down === 1, pushed.input);

    /* ---- 组合回执的语义（WO-003.1）----
     * 旧实现是"按下跳且下推 → 显示滑铲"，于是空中下推按跳（其实是普通跳）
     * 也会显示"滑铲"。判定在动作层，回执就必须由动作层发 —— 这一组用例
     * 一半验"该闪的时候闪"，一半验"不该闪的时候**不**闪"。 */
    const press = (id, pid) => page.evaluate(([id, pid]) => {
      document.getElementById(id).dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerId: pid }));
    }, [id, pid]);
    const release = (id, pid) => page.evaluate(([id, pid]) => {
      document.getElementById(id).dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerId: pid }));
    }, [id, pid]);
    const stickDown = push => page.evaluate(d => {
      const z = document.getElementById('stickzone');
      const r = z.getBoundingClientRect();
      if (d) {
        z.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, pointerId: 2, clientX: r.left + 120, clientY: r.top + 120 }));
        z.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, pointerId: 2, clientX: r.left + 120, clientY: r.top + 190 }));
      } else {
        z.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
      }
    }, push);
    const snap = () => page.evaluate(() => {
      const tip = document.getElementById('comboTip');
      return {
        st: window.__sk.state().state,
        onGround: window.__sk.state().onGround,
        dropT: window.__sk.state().dropT,
        /* 只有 .on 时才算"正在显示"：文字会留在节点里，靠类名控制可见性。 */
        tip: tip && tip.classList.contains('on') ? tip.textContent : null,
      };
    });

    // 1) 地面上：下推 + 跳 = 真的滑铲，且回执
    await page.evaluate(() => window.__sk.place(6 * 48 + 10, 620));
    await page.waitForTimeout(340);
    await press('pbJump', 3);
    await page.waitForTimeout(100);
    const slid = await snap();
    ck('地面上 下推+跳 真的滑出去（state=slide）', slid.st === 'slide', slid.st);
    ck('真滑铲才显示「滑铲」', slid.tip === '滑铲', slid.tip);
    await release('pbJump', 3);
    await page.waitForTimeout(760);            // 滑铲结束 + 回执自然消失

    // 2) 空中：下推 + 跳 = 普通跳，**不该**出现「滑铲」
    await stickDown(false);
    await page.waitForTimeout(420);
    await press('pbJump', 5);
    await page.waitForTimeout(40);
    await release('pbJump', 5);
    await page.waitForTimeout(150);
    await stickDown(true);                     // 空中才下推
    const inAir = await snap();
    await press('pbJump', 6);
    await page.waitForTimeout(90);
    const airCombo = await snap();
    await release('pbJump', 6);
    ck('空中下推+跳 不是滑铲', airCombo.st !== 'slide', airCombo);
    ck('空中下推+跳 不显示「滑铲」', airCombo.tip === null, airCombo.tip);

    // 3) 实地上：下推 + 攻 = 普攻，**不该**出现「穿板」
    await stickDown(false);
    await page.evaluate(() => window.__sk.place(6 * 48 + 10, 620));
    await page.waitForTimeout(340);
    await stickDown(true);
    await press('slotw1', 8);
    await page.waitForTimeout(100);
    const solidAtk = await snap();
    await release('slotw1', 8);
    ck('实地下推+攻 是普攻（state=attack）', solidAtk.st === 'attack', solidAtk.st);
    ck('实地不显示「穿板」', solidAtk.tip === null, solidAtk.tip);

    // 4) 薄板上：下推 + 攻 = 真的掉下去，且回执
    await stickDown(false);
    /* 用左高台（1~5 列、第 9 行）：那一带没有敌人巡逻。
     * 中间平台（12~15 列）上站着一只史莱姆 —— 第一次写这条时放上去就被撞成
     * hurt，测出来的是"挨打"，不是"穿板"。 */
    await page.evaluate(() => window.__sk.place(3 * 48 + 10, 332));
    await page.waitForTimeout(380);
    const onPlank = await snap();
    await stickDown(true);
    await press('slotw1', 9);
    await page.waitForTimeout(100);
    const dropped = await snap();
    await release('slotw1', 9);
    ck('测试点确实站在薄板上', onPlank.onGround === true, onPlank);
    ck('薄板上 下推+攻 真的掉下去', dropped.st === 'fall' && dropped.dropT > 0, dropped);
    ck('真穿板才显示「穿板」', dropped.tip === '穿板', dropped.tip);

    // 松手，别把下压状态带进后面的用例
    await stickDown(false);
    await page.waitForTimeout(140);
    const released = await page.evaluate(() => ({
      stickDown: document.getElementById('stick').classList.contains('down'),
      input: window.__sk.input(),
    }));
    ck('松手后下压状态清除', released.stickDown === false && !released.input.down, released);

    // 打开魂匣：提示必须让开
    await page.evaluate(() => {
      const b = document.querySelector('#pbMenu');
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    });
    await page.waitForTimeout(400);
    const hintHidden = await page.evaluate(() => getComputedStyle(document.getElementById('touchhint')).display);
    ck('开菜单时首次提示隐藏', hintHidden === 'none', hintHidden);

    await clickTab(page, 'Ops');
    await page.waitForTimeout(250);
    const tops = await page.evaluate(() => {
      const ops = document.getElementById('touchops');
      const fk = document.getElementById('fullkeys');
      const order = ops && fk ? (ops.compareDocumentPosition(fk) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 : false;
      return {
        opsFirst: order,
        groups: [...ops.querySelectorAll('.grp')].map(e => e.textContent.trim()),
        rows: [...ops.querySelectorAll('.oprow')].map(r => ({
          label: r.querySelector('b').textContent.trim(),
          tag: r.querySelector('i').textContent.trim(),
        })),
      };
    });
    ck('触屏说明排在键盘表之前', tops.opsFirst === true);
    ck('触屏说明有四组（含总标题）', tops.groups.length >= 5, tops.groups);
    ck('滑铲/穿板用组合表达', tops.rows.some(r => /下推/.test(r.label) && r.tag === '组合'),
       tops.rows.filter(r => r.tag === '组合').map(r => r.label));
    /* 纸那一行随侧身一起删了：说明里只列玩家真能按的东西。
     * 留一行"（已停用）"会让"每个动作都标了点按/按住/组合"当场破功 ——
     * 那是对的，说明表里不该有既不是点按也不是按住的条目。 */
    ck('每个动作都标了点按/按住/组合',
       tops.rows.every(r => ['点按', '按住', '组合'].indexOf(r.tag) >= 0),
       tops.rows.map(r => r.tag));
    ck('无脚本异常', errs.length === 0, errs.slice(0, 2));
    await ctx.close();
  }

  /* ================= E. 矮横屏：菜单底部可达 ================= */
  console.log('\n--- E 矮横屏 1024×520 ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 520 }, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(FILE, { waitUntil: 'load' });
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      const b = document.querySelector('#pbMenu');
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    });
    await page.waitForTimeout(350);
    await clickTab(page, 'Ops');
    await page.waitForTimeout(250);
    const tabFixed = await page.evaluate(() => {
      const pane = document.getElementById('paneOps');
      const tabs = document.querySelector('#menu .tabs');
      const before = Math.round(tabs.getBoundingClientRect().top);
      pane.scrollTop = 9999;
      const after = Math.round(tabs.getBoundingClientRect().top);
      return { same: before === after, top: before };
    });
    ck('滚动时页签不动（只有内容区滚）', tabFixed.same === true, tabFixed);
    const reach = await page.evaluate(() => {
      const pane = document.getElementById('paneOps');
      const btns = ['mSkin', 'mReset', 'mSnd'].map(id => document.getElementById(id));
      const pr = pane.getBoundingClientRect();
      return btns.map(b => {
        if (!b) return { id: 'missing', ok: false };
        const r = b.getBoundingClientRect();
        return { id: b.id, ok: r.top >= pr.top - 2 && r.bottom <= pr.bottom + 2 };
      });
    });
    ck('滚到底后三个设置按钮都完整可见', reach.every(r => r.ok), reach);
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + (fail ? '有 ' + fail + ' 项失败' : 'WO-003 界面验收全通过') + '（' + pass + ' 项）');
  process.exit(fail ? 1 : 0);
})();
