'use strict';
/* p5.brush standalone 可行性验证：
 * 1) headless chromium 里 WebGL2 到底能不能跑
 * 2) crayon 笔刷画出来像不像真蜡笔（对照 art/ref 的样本表）
 * 3) seed 是否确定（同 seed 两次渲染像素一致 = 可复现，瓦片才有意义）
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require(path.join(
  process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));

const DIR = path.resolve(__dirname, '.deps', 'p5.brush');
const OUT = path.resolve(__dirname, 'shots');
const PORT = 8123;

(async () => {
  const srv = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
    { cwd: DIR, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));

  const exe = path.join(process.env.USERPROFILE,
    'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: exe,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader',
             '--use-gl=angle', '--ignore-gpu-blocklist'],
    });
    const page = await (await browser.newContext({
      viewport: { width: 660, height: 500 }, deviceScaleFactor: 2,
    })).newPage();
    const logs = [];
    page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));

    await page.goto(`http://127.0.0.1:${PORT}/_probe.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ok || window.__err, { timeout: 20000 })
      .catch(() => {});

    const st = await page.evaluate(() => ({
      ok: window.__ok || false, err: window.__err || null,
      webgl2: !!document.createElement('canvas').getContext('webgl2'),
    }));
    console.log('WebGL2 =', st.webgl2, '| render ok =', st.ok);
    if (st.err) console.log('ERR:', st.err.slice(0, 500));
    logs.slice(0, 8).forEach(l => console.log('  ', l.slice(0, 300)));

    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'p5brush_probe.png') });
    console.log('→ shots/p5brush_probe.png');

    // 同 seed 再渲染一次，比对像素 —— 不确定的话瓦片就不能复现
    const again = await page.goto(`http://127.0.0.1:${PORT}/_probe.html`);
    await page.waitForFunction(() => window.__ok || window.__err, { timeout: 20000 })
      .catch(() => {});
    await page.screenshot({ path: path.join(OUT, 'p5brush_probe2.png') });
    const a = fs.readFileSync(path.join(OUT, 'p5brush_probe.png'));
    const b = fs.readFileSync(path.join(OUT, 'p5brush_probe2.png'));
    console.log('seed 确定性:', a.equals(b) ? '一致 ✓' : '不一致 ✗ (字节不同)');
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }
})();
