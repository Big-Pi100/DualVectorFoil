// WO-003 取证：桌面 / 960×540 / 触屏 / 矮横屏，以及魂匣两个页签
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');
const OUT = path.join(__dirname, 'shots');

const tab = (page, name) => page.evaluate(n => {
  const b = document.querySelector('.tab[data-pane="' + n + '"]');
  if (b) b.click();
}, name);

async function scenario(browser, opts, fn) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1100);
  await fn(page);
  if (errs.length) console.log('  ERR:', errs.slice(0, 2));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });

  // 1 桌面 1366×768 主界面
  await scenario(browser, { viewport: { width: 1366, height: 768 } }, async p => {
    await p.screenshot({ path: path.join(OUT, 'wo3_a1_hud.png') });
    await p.keyboard.press('o'); await p.waitForTimeout(600);
    await p.screenshot({ path: path.join(OUT, 'wo3_a2_menu_souls.png') });
    await tab(p, 'Ops'); await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(OUT, 'wo3_a3_menu_ops.png') });
    console.log('1 桌面 1366×768 完成');
  });

  // 2 桌面 960×540（最小逻辑舞台，无缩放）
  await scenario(browser, { viewport: { width: 960, height: 540 } }, async p => {
    await p.keyboard.press('o'); await p.waitForTimeout(500);
    await tab(p, 'Ops'); await p.waitForTimeout(350);
    await p.screenshot({ path: path.join(OUT, 'wo3_b1_960_ops.png') });
    console.log('2 960×540 完成');
  });

  // 3 触屏主界面（首次提示还在）
  await scenario(browser, { viewport: { width: 1280, height: 592 }, hasTouch: true }, async p => {
    await p.screenshot({ path: path.join(OUT, 'wo3_c1_touch_hud.png') });
    await p.evaluate(() => document.querySelector('#pbMenu').dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })));
    await p.waitForTimeout(400);
    await p.evaluate(() => document.querySelector('#pbMenu').dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })));
    await p.waitForTimeout(500);
    await tab(p, 'Ops'); await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(OUT, 'wo3_c2_touch_ops.png') });
    console.log('3 触屏完成');
  });

  // 4 触屏 + 矮横屏（1024×520）：验菜单底部不被裁
  await scenario(browser, { viewport: { width: 1024, height: 520 }, hasTouch: true }, async p => {
    await p.evaluate(() => document.querySelector('#pbMenu').dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })));
    await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('#pbMenu').dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })));
    await p.waitForTimeout(400);
    await tab(p, 'Ops'); await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(OUT, 'wo3_d1_short_ops.png') });
    // 滚到底，确认快门按钮滚得到、且完整落在可视区内（不是被裁掉）
    await p.evaluate(() => {
      const pane = document.getElementById('paneOps');
      if (pane) pane.scrollTop = pane.scrollHeight;
    });
    await p.waitForTimeout(150);
    const reach = await p.evaluate(() => {
      const pane = document.getElementById('paneOps');
      const btn = document.getElementById('mSkin');
      if (!pane || !btn) return { ok: false, why: 'missing' };
      const pr = pane.getBoundingClientRect(), br = btn.getBoundingClientRect();
      return {
        ok: br.bottom <= pr.bottom + 2 && br.top >= pr.top - 2,
        scrollable: pane.scrollHeight > pane.clientHeight,
        pane: [Math.round(pr.top), Math.round(pr.bottom)],
        btn: [Math.round(br.top), Math.round(br.bottom)],
      };
    });
    await p.screenshot({ path: path.join(OUT, 'wo3_d2_short_ops_bottom.png') });
    console.log('4 矮横屏：滚到底后快门按钮可见 =', reach.ok, JSON.stringify(reach));
  });

  await browser.close();
  console.log('完成');
})();
