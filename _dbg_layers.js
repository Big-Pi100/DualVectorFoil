'use strict';
/* 一次性排查：画面里那条深紫色横杆是谁画的。
 * 做法：打印相机与图层关键量，再出三张"只画一部分"的图 ——
 * ①只画背景板 ②只画瓦片 ③只画实体（画框/门）。三张一比，归属立刻清楚。 */
const path = require('path'), fs = require('fs');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 })).newPage();
  await p.goto(FILE, { waitUntil: 'load' });
  await p.waitForTimeout(1500);

  const info = await p.evaluate(() => {
    P.state = 'stand'; P.animT = 0; P.sq = 1; render(0);
    return {
      room: room.id, camX: +camX.toFixed(1), camY: +camY.toFixed(1),
      px: +P.x.toFixed(1), py: +P.y.toFixed(1),
      plate: !!bgPlates.hall, plateSize: bgPlates.hall ? [bgPlates.hall.naturalWidth, bgPlates.hall.naturalHeight] : null,
      slabs: room.g.map((row, y) => row.map((c, x) => c === '=' ? [x, y] : null).filter(Boolean)).flat().slice(0, 12),
      portraits: (room.portraits || []).map(q => [q.tx, q.ty, q.n]),
    };
  });
  console.log('房间=%s camX=%s camY=%s  P=(%s,%s)', info.room, info.camX, info.camY, info.px, info.py);
  console.log('背景板=%s 尺寸=%s', info.plate, JSON.stringify(info.plateSize));
  console.log('平台格 =', JSON.stringify(info.slabs));
  console.log('展品框 =', JSON.stringify(info.portraits));

  // 三张分解图
  const parts = await p.evaluate(() => {
    const mk = () => { const c = document.createElement('canvas'); c.width = VIEW_W; c.height = VIEW_H; return c; };
    const shots = {};
    // ① 只有背景板
    let cv2 = mk(), c = cv2.getContext('2d');
    c.fillStyle = '#ff00ff'; c.fillRect(0, 0, VIEW_W, VIEW_H);
    c.save(); c.translate(-Math.round(camX), -Math.round(camY));
    if (bgPlates.hall) drawBgPlate(c, bgPlates.hall, 0.28);
    c.restore(); shots.plate = cv2.toDataURL();
    // ② 只有瓦片（跳过背景板路径）
    cv2 = mk(); c = cv2.getContext('2d');
    c.fillStyle = '#ff00ff'; c.fillRect(0, 0, VIEW_W, VIEW_H);
    c.save(); c.translate(-Math.round(camX), -Math.round(camY));
    for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
      const ch = room.g[y][x];
      if (ch !== '.' && ch !== 'H') drawTile(c, ch, x * TILE, y * TILE);
    }
    c.restore(); shots.tiles = cv2.toDataURL();
    // ③ 只有实体（展品框）
    cv2 = mk(); c = cv2.getContext('2d');
    c.fillStyle = '#ff00ff'; c.fillRect(0, 0, VIEW_W, VIEW_H);
    c.save(); c.translate(-Math.round(camX), -Math.round(camY));
    if (room.portraits) for (const q of room.portraits) drawWallMan(c, q.tx * TILE, q.ty * TILE - 26, q.n);
    c.restore(); shots.wall = cv2.toDataURL();
    return shots;
  });
  for (const k in parts) fs.writeFileSync(path.join(__dirname, 'shots', `dbg_${k}.png`), Buffer.from(parts[k].split(',')[1], 'base64'));
  console.log('→ shots/dbg_plate.png / dbg_tiles.png / dbg_wall.png（洋红=没有东西的地方）');
  await b.close();
})();
