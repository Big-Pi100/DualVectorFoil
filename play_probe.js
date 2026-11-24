/* play_probe.js — 脚本机器人试玩，验证"能不能真的玩下去"
 *
 * test.js 证明的是"每个环节的逻辑对"，但它是一段段单独调的。
 * 这个脚本关心的是另一件事：把按键按玩家那样连起来，角色会不会卡住、
 * 会不会掉进某个坑里出不来、房间能不能推过去、有没有 NaN。
 *
 * 策略故意做得很笨（一直往右、定时跳、定时砍），因为笨机器人卡住的地方，
 * 真人也会卡住。它不需要通关，只需要证明"路是通的"。
 *
 * 用法: node play_probe.js [秒数]
 */
const path = require('path');
const { chromium } = require(path.join(
  process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));

const HOME = process.env.USERPROFILE || process.env.HOME;
const EXE = path.join(HOME, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');
const SECS = +(process.argv[2] || 90);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await sleep(900);
  await page.keyboard.press('Enter');
  await sleep(500);

  const state = () => page.evaluate(() => window.__sk.state());
  const log = [];
  let last = await state();
  log.push(last);

  const t0 = Date.now();
  let tick = 0, stuckSince = null, maxStuck = 0;
  const rooms = new Set([last.room]);
  let hpMin = last.hp, hits = 0, deaths = 0, prevHp = last.hp;

  await page.keyboard.down('d');
  while (Date.now() - t0 < SECS * 1000) {
    tick++;
    // 定时跳（尽量跨坑）
    if (tick % 7 === 0) { await page.keyboard.press(' '); }
    // 定时砍
    if (tick % 5 === 0) { await page.keyboard.press('j'); }
    // 卡住了就往回走一段再冲 —— 真人也是这么干的
    const s = await state();
    if (Math.abs(s.x - last.x) < 1.5) {
      if (stuckSince === null) stuckSince = Date.now();
      const dur = Date.now() - stuckSince;
      if (dur > maxStuck) maxStuck = dur;
      if (dur > 900) {
        await page.keyboard.up('d');
        await page.keyboard.down('a');
        await sleep(420);
        await page.keyboard.up('a');
        await page.keyboard.down(' ');
        await sleep(180);
        await page.keyboard.down('d');
        stuckSince = null;
      }
    } else stuckSince = null;

    if (s.hp < prevHp) hits++;
    prevHp = s.hp;
    hpMin = Math.min(hpMin, s.hp);
    if (s.dead && !last.dead) { deaths++; }
    rooms.add(s.room);
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) {
      errors.push('NaN 坐标 @' + tick);
      break;
    }
    last = s;
    log.push(s);
    await sleep(90);
  }
  await page.evaluate(() => window.__sk.releaseAll());

  const xs = log.map(r => r.x);
  console.log(JSON.stringify({
    seconds: SECS,
    ticks: tick,
    samples: log.length,
    startX: +xs[0].toFixed(0),
    endX: +xs[xs.length - 1].toFixed(0),
    maxX: +Math.max(...xs).toFixed(0),
    minX: +Math.min(...xs).toFixed(0),
    forwardProgress: +(Math.max(...xs) - xs[0]).toFixed(0),
    roomsVisited: [...rooms],
    gotHitTimes: hits,
    hpMin,
    deaths,
    longestStuckMs: maxStuck,
    statesSeen: [...new Set(log.map(r => r.state))],
    finalState: last,
    errors,
  }, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
