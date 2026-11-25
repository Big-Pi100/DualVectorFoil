const path = require('path');
const { chromium } = require(path.join(
  process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE,
  'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');

/* 场景截图：把当前瓦片放进真实房间看整体。
 * 单看瓦片的检查图会高估质量 —— 游戏里有视差、灯光、暗角、装饰压在上面，
 * 也有"隔壁那格是同一张图"的重复问题。 */
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  for (const [room, w, h] of [['hall', 1366, 768], ['tower', 1366, 768]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage();
    await p.goto(`${FILE}?room=${room}`, { waitUntil: 'load' });
    await p.waitForTimeout(2200);          // 等蜡笔包 + 瓦片解码
    await p.screenshot({ path: path.join(__dirname, 'shots', `scene_${room}.png`) });
    await ctx.close();
    console.log('→ shots/scene_%s.png', room);
  }
  await b.close();
})();
