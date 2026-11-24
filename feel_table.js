// feel_table.js — 手感数字表（两套预设各测一遍）
//
// 为什么要有这个文件：
//   "手感顺不顺"是主观的，但**手感的物理量**是客观的：跑多快、跳多高、
//   滞空多久、后跃多远、出招几帧。这些数一变，手感就变，而变的时候
//   没人会发现 —— 一次"顺手改个重力"就能让跳跃矮 8px，肉眼看不出来，
//   老玩家一上手就知道不对。
//
//   所以这张表做两件事：
//     1. 把数**量出来**（不是抄常量：常量是承诺，量出来的是事实）；
//     2. 给每个数一个漂移区间，超了就红 —— 手感变成可回归的东西。
//
// 量法：所有数值都在真实浏览器里跑真实物理，用 __sk.state() 的只读快照采样。
// 采样走 rAF（约 16ms 一格），所以时间类数字有 ±8ms 的解析度 ——
// 区间按这个留，不假装精确到毫秒。
//
// 用法:
//   node feel_table.js            # 测 + 断言漂移
//   node feel_table.js --write    # 测 + 把结果写进 FEEL_TABLE.md
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const BASE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');

/* 漂移区间 = 当前实测值 ×±5%，取整。
 * 为什么是 5%：跳跃高度差 5% 是 10px，玩家能感觉到；差 2% 是 4px，感觉不到还天天报红。
 * 这两条都写在这里，改区间的人先回答"你凭什么放宽"。 */
const BOUNDS = {
  aos: {
    /* aireTime 比"真空中的抛物线"长得多（2×sqrt(2h/g)=0.83s），
     * 多出来的是顶点窗口 APEX_MUL=0.2 —— 按住跳键在顶点附近重力只剩 1/5。
     * 上一版按 440~480 设区间，是漏算了这一段。 */
    runSpeed:  [258, 282], jumpHeight: [196, 212], airTime: [880, 970],
    dashDist:  [96, 112],  dashTime:   [172, 212], atkTime:  [252, 316],
    doubleGain:[116, 142],
  },
  modern: {
    runSpeed:  [278, 302], jumpHeight: [160, 180], airTime: [832, 930],
    dashDist:  [86, 102],  dashTime:   [172, 212], atkTime:  [252, 316],
    doubleGain:[68, 100],
  },
};

const STAND = { x: 336, y: 620 };   // 回廊地面，与 dc_feel_check 同一处

/* 取"第一段连续离地"的毫秒数。samples 每格是 [simT, y, vx, onGround, state]。
 * 落地之后可能又起跳一次（跳键还按着 + 跳跃缓冲），那属于第二次跳跃，
 * 不该并进"一次跳跃的滞空"里。 */
function firstAirRun(samples) {
  let t0 = null, t1 = null;
  for (const s of samples) {
    if (s[3] === 0) {
      if (t0 === null) t0 = s[0];
      t1 = s[0];
    } else if (t0 !== null) {
      break;                      // 回到地面，这一段结束
    }
  }
  return t0 === null ? -1 : Math.round((t1 - t0) * 1000);
}

let ok = 0, bad = 0;
function ck(name, val, range) {
  const [lo, hi] = range;
  const pass = val >= lo && val <= hi;
  if (pass) ok++; else bad++;
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${name.padEnd(26)} ${String(val).padStart(7)}  区间 ${lo}~${hi}`);
}

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const rows = {};
  const errs = [];

  for (const feel of ['aos', 'modern']) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 810 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(feel + ': ' + String(e)));
    await p.goto(BASE + '?feel=' + feel, { waitUntil: 'load' });
    await p.waitForTimeout(1600);

    const st = () => p.evaluate(() => window.__sk.state());
    const place = async (x = STAND.x, y = STAND.y) => {
      await p.evaluate(([a, c]) => window.__sk.place(a, c), [x, y]);
      await p.waitForTimeout(260);
    };
    /* 采样器：在页面里按 rAF 记录 [simT, y, vx, onGround, state]。
     * 放到页面里而不是 Node 侧轮询 —— 每次 evaluate 要几毫秒往返，
     * 测 200ms 的后跃会被采样延迟吃掉 10% 精度。 */
    const startProbe = () => p.evaluate(() => {
      window.__probe = [];
      window.__probeOn = true;
      const tick = () => {
        if (!window.__probeOn) return;
        const s = window.__sk.state();
        window.__probe.push([s.simT, s.y, s.vx, s.onGround ? 1 : 0, s.state]);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const stopProbe = () => p.evaluate(() => {
      window.__probeOn = false;
      return window.__probe;
    });

    const r = {};

    /* --- 1. 地面最高速 --- */
    await place();
    await p.evaluate(() => window.__sk.press('right'));
    await p.waitForTimeout(600);
    r.runSpeed = Math.round(Math.abs((await st()).vx));
    await p.evaluate(() => window.__sk.release('right'));
    await p.waitForTimeout(300);

    /* --- 2. 跳跃高度与滞空 --- */
    await place();
    const y0 = (await st()).y;
    await startProbe();
    await p.evaluate(() => window.__sk.press('jump'));
    await p.waitForTimeout(700);             // 全程按住：顶点窗口要能吃到
    await p.evaluate(() => window.__sk.release('jump'));
    await p.waitForTimeout(500);
    const jumpSamples = await stopProbe();
    const s2 = await st();
    r.jumpHeight = Math.round(y0 - s2.airMinY);
    /* 滞空 = **第一段连续的离地**的时长。
     * 上一版取"所有离地样本的首尾差"，按住跳键时落地瞬间可能又触发一次起跳
     * （jumpBuf 还在），两跳被连成一段，量出 925ms —— 那不是滞空，是两次跳跃。
     * 采样只有 rAF 一格（16ms），所以这里只认"第一段"，不认总和。 */
    r.airTime = firstAirRun(jumpSamples);

    /* --- 3. 二段跳增量 --- */
    await place();
    /* 双跃要先有这个魂（`SAVE.owned.has('djump')`）。新存档里没有，
     * 不给就一直只算一次跳 —— 上一版量出来的"增量"其实是单跳高度。 */
    await p.evaluate(() => window.__sk.grant('djump'));
    const y2 = (await st()).y;
    await p.evaluate(() => window.__sk.press('jump'));
    await p.waitForTimeout(260);             // 第一跳上升中
    /* 松手和再按**必须隔一帧**：同一个 evaluate 里 release+press，
     * 动作层看不到"松开过"，第二次按会被当成"还按着"直接吞掉 ——
     * 上一版就是这么量的，双跳增益等于单跳高度。 */
    await p.evaluate(() => window.__sk.release('jump'));
    await p.waitForTimeout(40);
    await p.evaluate(() => window.__sk.press('jump'));
    await p.waitForTimeout(700);
    await p.evaluate(() => window.__sk.release('jump'));
    await p.waitForTimeout(400);
    const s3 = await st();
    /* 记的是**双跃的总高度**；增量 = 总高 - 单跳高度。
     * airMinY 是绝对最高点，直接拿它当"增量"会把第一跳的高度也算进去
     * （上一版就是这么报出 330 的，看着像双跃能翻一倍）。 */
    r.djTotal = Math.round(y2 - s3.airMinY);

    /* --- 4. 后跃：距离与时长 --- */
    await place();
    await startProbe();
    const x0 = (await st()).x;
    await p.evaluate(() => window.__sk.press('back'));
    await p.waitForTimeout(60);
    await p.evaluate(() => window.__sk.release('back'));
    await p.waitForTimeout(420);
    const dashSamples = await stopProbe();
    r.dashDist = Math.round(Math.abs((await st()).x - x0));
    const ds = dashSamples.filter(s => s[4] === 'dash');
    r.dashTime = ds.length > 1 ? Math.round((ds[ds.length - 1][0] - ds[0][0]) * 1000) : -1;

    /* --- 5. 攻击全程 --- */
    await place();
    await startProbe();
    await p.evaluate(() => window.__sk.press('atk'));
    await p.waitForTimeout(40);
    await p.evaluate(() => window.__sk.release('atk'));
    await p.waitForTimeout(450);
    const atkSamples = await stopProbe();
    const as_ = atkSamples.filter(s => s[4] === 'attack');
    r.atkTime = as_.length > 1 ? Math.round((as_[as_.length - 1][0] - as_[0][0]) * 1000) : -1;

    r.doubleGain = r.djTotal - r.jumpHeight;
    rows[feel] = r;
    await ctx.close();
  }
  await b.close();

  console.log('\n=== 漂移检查 ===');
  for (const feel of ['aos', 'modern']) {
    console.log(`\n[${feel}]`);
    for (const k of Object.keys(BOUNDS[feel])) {
      ck(`${feel}.${k}`, rows[feel][k], BOUNDS[feel][k]);
    }
  }

  if (errs.length) { console.log('\nJS 异常:', errs); bad++; }

  if (process.argv.includes('--write')) {
    const md = buildMd(rows);
    fs.writeFileSync(path.join(__dirname, 'FEEL_TABLE.md'), md, 'utf8');
    console.log('\n已写入 FEEL_TABLE.md');
  }

  console.log(`\n==== 手感数字表 — OK ${ok} / FAIL ${bad} ====`);
  process.exit(bad ? 1 : 0);
})();

function buildMd(rows) {
  const A = rows.aos, M = rows.modern;
  const line = (n, k, note) =>
    `| ${n} | ${A[k]} | ${M[k]} | ${BOUNDS.aos[k][0]}~${BOUNDS.aos[k][1]} | ${BOUNDS.modern[k][0]}~${BOUNDS.modern[k][1]} | ${note} |`;
  return `# 手感数字表（自动生成，勿手改）

> 由 \`node feel_table.js --write\` 生成。数字是**在浏览器里跑出来的**，
> 不是抄常量表 —— 常量和事实对不上的时候，以这张表为准，然后去改常量。

## 一、实测（两套预设）

| 量 | 恶魔城(aos) | 现代(modern) | aos 允许区间 | modern 允许区间 | 说明 |
|---|---|---|---|---|---|
${line('地面最高速', 'runSpeed', 'px/s，跑起来按住的稳态速度')}
${line('跳跃高度', 'jumpHeight', 'px，脚底到顶点；÷20 就是格数')}
${line('滞空时间', 'airTime', 'ms，离地到落地')}
${line('二段跳增量', 'doubleGain', 'px，第二跳相对第一次起跳点再高多少')}
${line('后跃距离', 'dashDist', 'px，按下到停住')}
${line('后跃时长', 'dashTime', 'ms，state=dash 的持续')}
${line('攻击全程', 'atkTime', 'ms，前摇+判定+后摇')}

## 二、为什么要盯这些数

手感是主观的，但这些是**客观的**：改一个重力常数，跳跃就从 204 变成 196，
肉眼看不出来，玩过的人一上手就知道不对。所以把它们做成回归项，
红了先问"是不是我顺手改了物理"，而不是"这测试真烦"。

区间取 ±5%：跳跃差 5% 是 10px，玩家能感觉到；差 2% 是 4px，感觉不到还天天报红。

## 三、区间怎么改

先跑 \`node feel_table.js\` 看实测值，再用**一句话**说明为什么旧的区间不对
（例如"modern 的跳跃高度按设计改成 180，区间上界跟着抬到 190"）。
没有这句话就别改 —— 区间是承诺，不是噪音的橡皮擦。

## 四、这份表不管什么

- 不管**攻击**的前摇/后摇边界（那是 \`dc_feel_check.js\` 的 A 组，测的是"能不能取消"）。
- 不管**命中手感**（顿帧、震屏、音效）—— 那些没有可量化的判据，只能上手。
- 不管**敌人**的数值。
`;
}
