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
const PORT = Number(process.env.P5B_PORT || 8171);

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
    } else if (mode === 'tile') {
      /* 192×192 平铺瓦片实验：A=全 hatch  B=hatch+局部 mass  C=mass 铺底（对照） */
      const vs = process.argv.slice(3).length ? process.argv.slice(3) : ['A', 'B', 'C'];
      await page.setViewportSize({ width: 220, height: 220 });
      for (const v of vs) {
        const t = Date.now();
        await page.goto(`http://127.0.0.1:${PORT}/${base}/tile.html?variant=${v}&seed=0`,
          { waitUntil: 'load' });
        await page.waitForFunction(() => window.__ok || window.__err, { timeout: 60000 }).catch(() => {});
        const r2 = await page.evaluate(() => ({ ok: window.__ok, err: window.__err }));
        if (!r2.ok) { console.log('  ERR', String(r2.err).slice(0, 300)); continue; }
        const cv = await page.$('canvas');
        const p = path.join(ROOT, 'art', 'tiles', `_exp_${v}.png`);
        fs.writeFileSync(p, await cv.screenshot());
        console.log('→ art/tiles/_exp_%s.png  %dms', v, Date.now() - t);
      }
    } else if (mode === 'coat') {
      const COATLIST = process.argv.slice(3).length ? process.argv.slice(3) : ['A','B','C','D'];
      /* 涂法变体实验：同一种子下 A/B/C/D 四种填色，比"露纸率"。 */
      await page.setViewportSize({ width: 220, height: 220 });
      for (const c of COATLIST) {
        const t = Date.now();
        await page.goto(`http://127.0.0.1:${PORT}/${base}/tilegen.html?kind=wall&seed=0&coat=${c}`,
          { waitUntil: 'load', timeout: 150000 });
        await page.waitForFunction(() => window.__ok || window.__err, { timeout: 180000 }).catch(() => {});
        const r3 = await page.evaluate(() => ({ ok: window.__ok, err: window.__err }));
        if (!r3.ok) { console.log('  ERR %s: %s', c, String(r3.err).slice(0, 300)); continue; }
        const cv = await page.$('canvas');
        fs.writeFileSync(path.join(ROOT, 'art', 'tiles', `_coat_${c}.png`), await cv.screenshot());
        console.log('→ _coat_%s.png  %dms', c, Date.now() - t);
      }
    } else if (mode === 'tileset') {
      /* 正式瓦片：墙 6 变体 + 地 2 变体。前缀 _new_ 便于与旧版对比，
       * 确认后用 --publish 参数写出正式名。 */
      const pub = process.argv.includes('--publish');
      /* `--coat=X` 让正式瓦片走指定的涂法变体（默认不放参数 = tilegen 的 Z 定版）。 */
      const coatA = process.argv.find(a => a.startsWith('--coat='));
      const cq = coatA ? `&coat=${coatA.split('=')[1]}` : '';
      const plan = [['wall', 6], ['floor', 6], ['slab', 6]];
      await page.setViewportSize({ width: 220, height: 220 });
      for (const [k, n] of plan) {
        for (let i = 0; i < n; i++) {
          const t = Date.now();
          await page.goto(
            `http://127.0.0.1:${PORT}/${base}/tilegen.html?kind=${k}&seed=${i}${cq}`,
            { waitUntil: 'load', timeout: 150000 });
          await page.waitForFunction(() => window.__ok || window.__err, { timeout: 90000 }).catch(() => {});
          const r3 = await page.evaluate(() => ({ ok: window.__ok, err: window.__err }));
          if (!r3.ok) { console.log('  ERR %s/%d', k, i, String(r3.err).slice(0, 240)); continue; }
          const cv = await page.$('canvas');
          const name = pub ? `${k}_${i}.png` : `_new_${k}_${i}.png`;
          fs.writeFileSync(path.join(ROOT, 'art', 'tiles', name), await cv.screenshot());
          console.log('→ art/tiles/%s  %dms', name, Date.now() - t);
        }
      }
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
