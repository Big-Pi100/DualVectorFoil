'use strict';
/* 蜡笔包接入验证：把游戏画面按状态定格，出一张 10 列总表 + 一张场景全景。
 *
 * 为什么定格而不是"按键录屏"：要看的是**帧与状态是否对得上**，
 * 按键录屏混进了物理时序，看到的是"运气"不是"素材"。
 * 定格 = 状态 → 帧 → 画面，三段一一对应，出错时能立刻指出是哪一段。
 *
 * 用法：node _shot_crayon.js
 * 产物：shots/crayon_<state>.png / shots/crayon_all.png
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');
const OUT = path.resolve(__dirname, 'shots');
const TMP = path.resolve(__dirname, '.tmp');
fs.mkdirSync(TMP, { recursive: true });

/* 每个状态取"最该被看见的那一帧"：
 * attack 取 f2（判定帧，前伸最远）、jump 取 f2（上升，收腿最高）、
 * hurt 取 f1（后仰最大）—— 这三帧是"画错了就一眼看得出"的哨兵帧。 */
const PICK = {
  stand:  0.00,
  walk:   0.06,   // f1 CONTACT
  jump:   0.15,   // f2 RISING
  fall:   0.20,   // f1
  attack: 0.10,   // f2 判定帧
  cast:   0.10,   // f2 释放
  hurt:   0.02,   // f1 后仰
  crouch: 0.05,   // f1
  slide:  0.10,   // f2 最低
  dash:   0.10,   // f2
};
const ORDER = ['stand','walk','jump','fall','attack','cast','hurt','crouch','slide','dash'];

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });

  await p.goto(FILE, { waitUntil: 'load' });
  await p.waitForTimeout(1800);   // base64 解码 + onload

  const info = await p.evaluate(() => ({
    pack: playerPack.kind,
    bytes: Object.keys(window.CRAYON_B64 || {}).length,
    ready: crayonReady,
    loaded: Object.keys(crayonImgs).filter(k => crayonImgs[k] && crayonImgs[k].complete && crayonImgs[k].naturalWidth).length,
    cell: CRAYON.cell, spriteH: CRAYON.spriteH,
    dark: Object.keys(crayonImgs).filter(k => !(crayonImgs[k] && crayonImgs[k].naturalWidth)),
  }));
  console.log('包 =', info.pack, '| 内联', info.bytes, '张 | 解码成功', info.ready, '/', info.loaded);
  if (info.dark.length) console.log('未加载:', info.dark.join(','));

  fs.mkdirSync(OUT, { recursive: true });
  const shots = [];
  for (const st of ORDER) {
    const r = await p.evaluate(({ st, t }) => {
      /* 定格：先把物理钉住（否则下一帧 update 会把它改回去），
       * 再直接调 render —— render 是纯读函数，不动任何状态。 */
      P.state = st; P.animT = t; P.vx = 0; P.vy = 0;
      P.onGround = st !== 'jump' && st !== 'fall';
      P.invuln = 0; P.sq = 1; P.walkW = st === 'walk' ? 1 : 0;
      if (st === 'crouch') P.sq = 1;      // 蜡笔包不做结构压缩，蹲的高度全在帧里
      render(0);
      // 把人物那一块单独裁出来，便于并排核对
      const cv = document.getElementById('cv');
      const RSv = cv.width / VIEW_W;
      const cx = Math.round((P.x + P_CW / 2 - camX) * RSv);
      const cy = Math.round((P.y + P_H - camY) * RSv);
      const half = Math.round(110 * RSv), h = Math.round(190 * RSv);
      const off = document.createElement('canvas');
      off.width = half * 2; off.height = h;
      off.getContext('2d').drawImage(cv, cx - half, cy - h + Math.round(20 * RSv), half * 2, h, 0, 0, half * 2, h);
      return { full: cv.toDataURL('image/png'), crop: off.toDataURL('image/png') };
    }, { st, t: PICK[st] });
    /* 整屏图 3.4MB/张，10 张就是 34MB —— 只留在 .tmp（不入库），
     * shots 里保留裁好的单人图（几十 KB），足够核对姿态。 */
    const save = (b64, name, dir) => fs.writeFileSync(path.join(dir || OUT, name), Buffer.from(b64.split(',')[1], 'base64'));
    save(r.full, `crayon_${st}_full.png`, TMP);
    save(r.crop, `crayon_${st}.png`);
    shots.push(path.join(OUT, `crayon_${st}.png`));
    console.log('  ✓', st);
  }

  // 场景全景（回到 stand，看整体构图）
  const scene = await p.evaluate(() => {
    P.state = 'stand'; P.animT = 0; render(0);
    return document.getElementById('cv').toDataURL('image/png');
  });
  fs.writeFileSync(path.join(OUT, 'crayon_scene.png'), Buffer.from(scene.split(',')[1], 'base64'));

  await b.close();

  // 拼总表：10 列并排 + 标签
  const { execFileSync } = require('child_process');
  let py = `
import sys
from PIL import Image, ImageDraw, ImageFont
import os
order = ${JSON.stringify(ORDER)}
d = r"${OUT.replace(/\\/g, '/')}"
imgs = [Image.open(os.path.join(d, "crayon_%s.png" % s)) for s in order]
w, h = imgs[0].size
pad, top = 6, 34
W = (w + pad) * len(imgs) + pad
out = Image.new("RGB", (W, h + top + pad), (24, 22, 32))
dr = ImageDraw.Draw(out)
try:
    f = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 22)
except Exception:
    f = ImageFont.load_default()
for i, (s, im) in enumerate(zip(order, imgs)):
    x = pad + i * (w + pad)
    out.paste(im, (x, top), im if im.mode == "RGBA" else None)
    dr.text((x + 4, 6), "%d %s" % (i + 1, s), font=f, fill=(235, 230, 245))
out.save(os.path.join(d, "crayon_all.png"))
print("crayon_all.png", out.size)
`;
  fs.writeFileSync(path.join(OUT, '_mk_crayon_all.py'), py, 'utf8');
  console.log(execFileSync('python', [path.join(OUT, '_mk_crayon_all.py')], { encoding: 'utf8' }).trim());
  if (errs.length) console.log('\n⚠ 错误:', errs.slice(0, 6));
  else console.log('\n无 JS 报错');
})();
