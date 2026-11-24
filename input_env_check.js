// 验收：桌面 / Windows 触屏本 / 真手机 / iframe 四种环境下的输入链路
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');

const OUTER = path.join(__dirname, '_probe_outer.html');
fs.writeFileSync(OUTER,
  '<!doctype html><body style="margin:0;background:#111">' +
  '<iframe src="SoulKeep.html" style="border:0;width:100vw;height:100vh"></iframe></body>');

let pass = 0, fail = 0;
const ck = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  ' + extra : '')); }
};

async function probe(browser, label, { touch = false, fakeTouchHw = false, iframe = false }) {
  console.log('\n=== ' + label + ' ===');
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, hasTouch: touch });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  if (fakeTouchHw) {
    // Windows 触屏本：有触摸硬件（maxTouchPoints=10、ontouchstart 存在），
    // 但主指针仍是鼠标 → matchMedia('(pointer: coarse)') 为 false
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 10, configurable: true });
      window.ontouchstart = null;
    });
  }

  let t = page;
  if (iframe) {
    await page.goto('file:///' + OUTER.replace(/\\/g, '/'), { waitUntil: 'load' });
    await page.waitForTimeout(700);
    const fr = page.frames().find(f => f.url().indexOf('SoulKeep.html') >= 0);
    t = fr;
  } else {
    await page.goto(FILE, { waitUntil: 'load' });
  }
  await page.waitForTimeout(1000);

  const info = await t.evaluate(() => {
    const st = document.getElementById('stage'), keys = document.getElementById('keys');
    return {
      maxTouch: navigator.maxTouchPoints,
      onto: 'ontouchstart' in window,
      coarse: matchMedia('(pointer: coarse)').matches,
      fine: matchMedia('(pointer: fine)').matches,
      hover: matchMedia('(hover: hover)').matches,
      touchClass: st.classList.contains('touch'),
      keysDisplay: keys ? getComputedStyle(keys).display : 'no-el',
      keysText: keys ? keys.innerText.replace(/\s+/g, ' ').trim() : '',
      pad: !!document.getElementById('pad'),
      wake: !!document.getElementById('wake'),
      x0: window.__sk.state().x,
    };
  });
  console.log('  环境: ' + JSON.stringify({ maxTouch: info.maxTouch, onto: info.onto, coarse: info.coarse, fine: info.fine, hover: info.hover }));
  console.log('  图例: ' + (info.keysDisplay === 'none' ? '(被隐藏)' : info.keysText));

  // 按 D 走
  await page.keyboard.down('d');
  await page.waitForTimeout(320);
  const walked = await t.evaluate(() => ({ x: window.__sk.state().x, st: window.__sk.state().state }));
  await page.keyboard.up('d');
  const moved = walked.x - info.x0;

  return { info, moved, walked, errs, page, ctx, t };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });

  // 1 普通桌面
  let r = await probe(browser, 'A 普通桌面（双击打开）', {});
  ck('不进触屏模式', r.info.touchClass === false);
  ck('无虚拟摇杆', r.info.pad === false);
  ck('键鼠图例可见', r.info.keysDisplay !== 'none');
  ck('图例含 A/D 移动', /A\/?D\s*移\s*动|A.*D.*移动/.test(r.info.keysText), JSON.stringify(r.info.keysText));
  ck('按 D 能走', r.moved > 60, '位移 ' + r.moved.toFixed(1) + 'px');
  ck('无 JS 报错', r.errs.length === 0, r.errs[0] || '');
  await r.page.screenshot({ path: 'shots/_v_desktop.png' });
  await r.ctx.close();

  // 2 Windows 触屏笔记本（旧版在这里会误判）
  r = await probe(browser, 'B Windows 触屏本（maxTouchPoints=10，主指针是鼠标）', { fakeTouchHw: true });
  ck('不进触屏模式（修复目标）', r.info.touchClass === false);
  ck('无虚拟摇杆', r.info.pad === false);
  ck('键鼠图例可见', r.info.keysDisplay !== 'none');
  ck('按 D 能走', r.moved > 60, '位移 ' + r.moved.toFixed(1) + 'px');
  ck('无 JS 报错', r.errs.length === 0, r.errs[0] || '');
  await r.page.screenshot({ path: 'shots/_v_touchlaptop.png' });
  await r.ctx.close();

  // 3 真手机
  r = await probe(browser, 'C 真手机（hasTouch）', { touch: true });
  ck('进触屏模式', r.info.touchClass === true);
  ck('有虚拟摇杆', r.info.pad === true);
  ck('键鼠图例隐藏', r.info.keysDisplay === 'none');
  ck('无 JS 报错', r.errs.length === 0, r.errs[0] || '');
  await r.ctx.close();

  // 4 iframe（预览面板）
  r = await probe(browser, 'D iframe 内（预览面板）', { iframe: true });
  ck('出现"点一下画面"提示', r.info.wake === true);
  ck('图例可见', r.info.keysDisplay !== 'none');
  ck('按 D 能走', r.moved > 60, '位移 ' + r.moved.toFixed(1) + 'px');
  ck('无 JS 报错', r.errs.length === 0, r.errs[0] || '');
  await r.page.screenshot({ path: 'shots/_v_iframe.png' });
  await r.ctx.close();

  // 5 ?touch=1 强制触屏（手机验收通道还在）
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    await page.goto(FILE + '?touch=1', { waitUntil: 'load' });
    await page.waitForTimeout(900);
    const v = await page.evaluate(() => document.getElementById('stage').classList.contains('touch'));
    console.log('\n=== E ?touch=1 强制触屏 ===');
    ck('?touch=1 仍能强制触屏', v === true);
    await ctx.close();
  }

  await browser.close();
  fs.unlinkSync(OUTER);
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
