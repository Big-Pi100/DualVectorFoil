'use strict';
/* 用 p5.brush 出透明贴片（苔藓 / 水渍 / 裂缝 / 剥落）。
 *
 * 用法：  node art/tools/p5brush/render.js decal [kind...]
 *         node art/tools/p5brush/render.js cap          # 能力谱系样张
 *
 * 前置：  sh art/tools/p5brush/setup.sh   （拉 .deps/p5.brush）
 *
 * 为什么要在 http 下跑：ES module import 不能走 file://，必须起个静态服务。
 * 服务根目录是项目根，HTML 用相对路径引 .deps 里的 dist。
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require(path.join(
  process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));

const ROOT = path.resolve(__dirname, '..', '..', '..');
const P5 = path.join(ROOT, '.deps', 'p5.brush');
const OUT = path.join(ROOT, 'shots');
const PORT = 8171;

const KIND = ['moss', 'stain', 'crack', 'peel'];

/** 纸底抠图：p5.brush 的 stroke/fill 在透明画布上会失准，
 *  所以一律纸底渲染，这里按"与纸色的最大通道差"做 alpha。
 *  lo=14 才不会把纸纹当内容；hi=34 让确实沾色的地方实心。
 *  MinFilter(3) 收 1px —— 边缘那圈混着纸色的像素最容易看出方块感。 */
function cutPaper(src, dst, lo = 14, hi = 34) {
  const { execFileSync } = require('child_process');
  execFileSync('python', ['-c', `
from PIL import Image, ImageFilter
import numpy as np
PAPER = np.array([232, 220, 190], np.float32)
a = np.asarray(Image.open(r"${src}").convert('RGB'), np.float32)
d = np.abs(a - PAPER).max(2)
al = np.clip((d - ${lo}) / (${hi} - ${lo}), 0, 1)
im = Image.fromarray(np.dstack([a, al * 255]).astype(np.uint8), 'RGBA')
im.putalpha(im.getchannel('A').filter(ImageFilter.MinFilter(3)))
im.save(r"${dst}")
`], { stdio: 'inherit' });
}

(async () => {
  if (!fs.existsSync(path.join(P5, 'dist', 'brush.esm.js'))) {
    console.error('缺少 .deps/p5.brush —— 先跑 sh art/tools/p5brush/setup.sh');
    process.exit(1);
  }
  const mode = process.argv[2] || 'decal';
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'art', 'decal'), { recursive: true });

  const srv = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' });
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
      viewport: { width: 280, height: 280 }, deviceScaleFactor: 1,
    })).newPage();
    page.on('pageerror', e => console.log('  !', e.message.slice(0, 160)));

    const base = 'art/tools/p5brush';
    if (mode === 'cap') {
      await page.setViewportSize({ width: 1240, height: 860 });
      await page.goto(`http://127.0.0.1:${PORT}/${base}/cap.html`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__ok || window.__err, { timeout: 60000 }).catch(() => {});
      const r = await page.evaluate(() => ({ ok: window.__ok, err: window.__err, ms: window.__ms }));
      console.log('cap ok=%s  %sms', r.ok, r.ms);
      if (r.err) console.log('ERR', r.err.slice(0, 400));
      const cv = await page.$('canvas');
      await cv.screenshot({ path: path.join(OUT, 'p5brush_cap.png') });
      console.log('→ shots/p5brush_cap.png');
    } else {
      const kinds = process.argv.slice(3).length ? process.argv.slice(3) : KIND;
      for (const k of kinds) {
        const t = Date.now();
        await page.goto(`http://127.0.0.1:${PORT}/${base}/decal.html?kind=${k}`,
          { waitUntil: 'load' });
        await page.waitForFunction(() => window.__ok || window.__err, { timeout: 60000 }).catch(() => {});
        const cv = await page.$('canvas');
        const raw = path.join(ROOT, 'art', 'decal', `_raw_${k}.png`);
        const out = path.join(ROOT, 'art', 'decal', `decal_${k}.png`);
        fs.writeFileSync(raw, await cv.screenshot());
        cutPaper(raw, out);
        fs.unlinkSync(raw);
        console.log('→ art/decal/decal_%s.png  %dms', k, Date.now() - t);
      }
    }
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }
})();
