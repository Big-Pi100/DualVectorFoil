// 用注入旧样式的方式重建 WO-003 之前的 HUD 外观，用于前后对比
const path = require('path');
const { chromium } = require(path.join(process.env.NPM_GLOBAL || 'D:/node-dev/npm-global', 'node_modules/playwright-core'));
const EXE = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const FILE = 'file:///' + path.resolve(__dirname, 'SoulKeep.html').replace(/\\/g, '/');
const OLD = `
#keys{font-size:12px;color:#6f685c;line-height:22px;padding:0;border-radius:0;
  background:none;border:none;box-shadow:none;text-shadow:0 1px 3px rgba(0,0,0,.9)}
#keys .k{font-size:11px;color:#c9bfa8;border-color:#4a443a;background:rgba(255,255,255,.035);
  min-width:14px;line-height:15px;font-weight:600;padding:1px 4px}
#keys .pair{color:#4b453c;margin:0 3px}
#keys .jo{color:#6b6357}
#keys .alias{color:#453f37;font-size:11px;margin-top:1px}
#keys .alias b{color:#453f37;font-weight:400}
.slot.empty{color:#5c574e;border-style:solid;letter-spacing:.5px}
`;
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  await p.goto(FILE, { waitUntil: 'load' });
  await p.waitForTimeout(1100);
  await p.addStyleTag({ content: OLD });
  await p.evaluate(() => {
    const a = document.querySelector('#keys .alias');
    if (a) a.textContent = 'O 全部按键';
    document.querySelectorAll('#main .slot.empty').forEach(e => { e.textContent = '空'; });
  });
  await p.waitForTimeout(200);
  await p.screenshot({ path: 'shots/wo3_a0_hud_before.png' });
  await b.close();
  console.log('改前对照图已生成');
})();
