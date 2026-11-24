# WO-003.1 实现报告 —— 修正组合回执的语义

日期：2026-11-24 · 触发：WO-003 审查结论第 2 条（"组合反馈可能造成误导"）
范围：**只改组合回执这一个点**。键位映射、手感、关卡、敌人、Flatten 数值、HUD 架构，一行没碰。

---

## 1. 问题

旧实现把"组合输入"当成了"动作成功"：

```js
// src/mobile.js（WO-003）
bind(pad.querySelector('#pbJump'), 'jump', '滑铲');
bind(pad.querySelector('#pbAtk'),  'atk',  '穿板');

function bind(el, key, comboLabel) {
  ...
  if (comboLabel && vdir > 0) flashCombo(el, comboLabel);   // ← 按下就闪
}
```

但滑铲还要 `P.onGround`，穿板还要 `onOneWay()`。于是：

| 玩家做的事 | 游戏真实发生 | 旧界面说的是 |
|---|---|---|
| 空中下推 + 跳 | 普通跳（或二段跳） | 「滑铲」 |
| 实地上下推 + 攻 | 普攻 | 「穿板」 |

界面在**替玩家猜**，而且猜错了。这正是审查说的"让玩家误以为动作已经成功执行"。

## 2. 改法：回执只由真正执行动作的那一行发出

审查给了两个方案（改文案 / 动作层发回执），并倾向第二个。这里做第二个，改动很小。

### 2.1 动作层（`src/game.js`）

```js
/* 输入层"猜"组合会不会成立不可靠 …… 回执只能由真正执行动作的那一行发出。 */
let ACT_BEAT = null;
function actDone(kind) { if (ACT_BEAT) { try { ACT_BEAT(kind); } catch (e) {} } }
```

两处调用点，都在**判定已经通过之后**：

```js
// 滑铲：要求 CK.SLIDE && padDown('down') && padTap('jump') && P.onGround
P.state = 'slide'; P.animT = 0; P.vx = P.face * 420; P.lock = 0.28;
actDone('slide');

// 穿板：dropThrough() 里，那只"底下就是实心、掉不下去"会 return
if (best === P.y) return;
P.y = best; P.vy = 150; P.dropT = 0.20;
P.onGround = false; P.state = 'fall';
actDone('plate');
```

对外只加一个订阅口：

```js
onAct(fn) { ACT_BEAT = typeof fn === 'function' ? fn : null; },
```

没有订阅者时 `actDone` 是空操作 —— 桌面端一次都不执行，键盘路径不受影响。

### 2.2 表现层（`src/mobile.js`）

删掉 `bind()` 的第三个参数和 `vdir` 判断，改成订阅：

```js
window.__sk.onAct(function (kind) {
  if (kind === 'slide') flashCombo('滑铲');
  else if (kind === 'plate') flashCombo('穿板');
});
```

于是：**看到「滑铲」就一定是滑出去了**；空中下推按跳什么都不闪 —— 玩家看到的是
自己真的跳了一下，那就是最准确的反馈。

## 3. 顺手修掉的一个显示缺陷

回执第一版画在按钮**下方**（`.pb.combo::after{bottom:-19px}`）。跳和攻贴着屏幕底边，
截图里「穿板」被底边切掉一半：

```
before（按钮下方）        after（按钮组左侧）
      [攻]                 [攻] [跳]
   [穿板] ← 被切掉        [穿板]  ← 完整
```

改成按钮组左侧空地上的一条独立提示 `#comboTip`：不进按钮、不参与布局，
620ms 后淡出；开魂匣时随按钮组一起隐藏（`#pad.hideplay`）。

## 4. 测试

`ui_check.js` 的 D 段重写为**双向**用例，49 项（原 42 + 7）：

| 用例 | 断言 |
|---|---|
| 地面上下推 + 跳 | `state === 'slide'` 且提示为「滑铲」 |
| **空中**下推 + 跳 | `state !== 'slide'` 且**提示为 null** |
| **实地上**下推 + 攻 | `state === 'attack'` 且**提示为 null** |
| **薄板上**下推 + 攻 | `state === 'fall' && dropT > 0` 且提示为「穿板」 |

写这条时踩了个坑：第一次把测试点放在大厅中段薄板（12~15 列）上，那里站着一只史莱姆，
放上去就被撞成 `hurt` —— 测出来的是"挨打"而不是"穿板"。换到左高台（1~5 列，
无敌人巡逻）后才是干净的对照组。

全量 **389 项**通过。`timestep_check` 顶点仍是 203.79–203.80px，`flat_check` 57 项原样通过，
`ime_check` 50 项、`ctrl_check` 39 项、`input_env_check` 20 项均未受影响。

## 5. 截图

| 文件 | 证明什么 |
|---|---|
| `shots/wo31_a_solid_no_flash.png` | 实地下推 + 攻：角色在出普攻，按钮组左边**没有**标签 |
| `shots/wo31_b_plank_flash.png` | 薄板上下推 + 攻：角色已离板下落，左侧显示完整的「穿板」 |

## 6. 没解决的问题（按审查意见列为试玩验收，不阻塞本轮）

1. **真机拇指体验仍然没有数据。** 本轮只做了 Chromium 触摸模拟；误触率、长按疲劳、
   安全区、刘海，都需要一台 iPhone + 一台 Android 横屏真机。
2. **首玩者发现率仍然没有数据。** 完成操作说明不等于玩家会去开魂匣。
   需要 3–5 名没看过说明的玩家，观察他们能否自己找到 `匣 → 操作`。
3. 这两项都不是代码能回答的，所以本轮**没有**为此再加任何界面元素。
