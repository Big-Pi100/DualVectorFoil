# S5 — Rulings applied (Q1–Q17, Q22–Q24)

**Build:** `SoulKeep.html` (~946KB, single file)
**Scope:** only the items you ruled on. **Q18–Q21 (implementation: tilesets, enemy atlases, single-file size) received no ruling, so I did not touch any of that architecture.**

---

## 0. Two structural changes you should know about before the item list

Applying Q23 and Q22 as written exposed a rendering problem that forced two changes of *shape*, not just of size. Both are visible at 1:1 and both are documented below with the screenshot that caused them.

**(a) A cavity inside a wall reads as a panel, not as a hole.**
My first pass at Q23 kept the old structure (5 tiles wide, hollow inside) and simply lowered it from 4 tiles to 3. At 1:1 the empty cavity showed the background through a rectangular opening whose edges aligned with the tile grid. It read as **a framed panel with an orb displayed in it**, and — worse — as something a player might try to walk into. In a 2D side view there is no depth, so an empty tile inside a wall *is* a window.

So the first affordance is no longer a hollow block. It is **a one-tile-thick stone slab, 3 tiles tall (144px), with the crack running through it**, and the ink vial wedged *in the crack*. There is no empty tile anywhere near it, so there is nothing to misread.

**(b) A 3-tile-wide cavity past the gate reads as a doorway.**
Same cause. Q22's alcove was built as a hollow block with a 3-tile cavity; at 1:1 it looks like an archway you can walk through, and you cannot. A false door is worse than no door. The second alcove is now **a sealed niche with a one-tile-wide slot** (48px wide × 144px tall), which reads as "a slot with something in it", not as a passage.

Both changes shrink the geometry but not the experiment: the affordance is still flat-only, and the measurements still answer the same questions.

---

## 1. Controls and legend (Q1–Q5)

**Q1 — grouped and labelled by action.** The legend's groups are now `移动 / 战斗 / 工具 / 系统`. The finger logic ("index = strike, middle = displacement, ring = state") survives on the keyboard and in the code comment, but it is no longer printed — the player is never asked to learn it.

**Q2 — A: combos kept, documented properly.** `S + K` slide (ground) and `S + J` drop-through (on a thin ledge) are in the full table with their preconditions. Nothing was split into extra keys.

**Q3 — B: four in-game, full table in the soul box.** The HUD shows `A / D 移动 · K 跳 · J 攻 · F 纸`. The complete 12-entry table is rendered inside the soul box, under the soul list.

**Q4 — greyed *and* explicitly labelled.** An unavailable soul action is dimmed **and** carries a bordered `未装备` tag; empty soul slots spell out `空` rather than being blank. The tag is only rendered (not just dimmed) so the reason is readable before pressing.

**Q5 — Space = jump kept.** It stays in the alias line: `方向键=WASD · 空格=跳 · Tab=魂匣 · R×2 重开 · M 静音`.

**One defect found while doing this:** multiple keys were printed as a bare list, so `A D 移动` (alternatives) and `S K 滑铲` (simultaneous) looked identical. Multi-key entries now print their operator: `A / D` vs `S + K`.

Evidence: `ctrl_check.js` reads the legend **out of the live DOM** and presses what it says. 39 assertions, including "the four in-game entries are exactly 移动/跳/攻/纸", "the full table has 12", "the greyed entry must produce no effect", "groups are 移动/战斗/工具/系统".

## 2. HUD (Q6–Q11)

| Ruling | Implementation |
|---|---|
| Q6 cut the log | `#log` and `addLog()` deleted. The three lines it carried are now a **staggered one-time intro** (2.6s / 5.2s / 8.2s / 9.6s / 11.6s). Contextual messages still work — `say()` is untouched, and `双跃之魂到手` moved from the log to `say()`. |
| Q7 reserve ink space | `display:none` → `visibility:hidden`. The row always occupies 32px; only its visibility changes. |
| Q8 two slots | Yellow slot removed from the HUD; the yellow soul is described as `黄魂 · 被动（装备即生效）` in the soul box. |
| Q9 count into the soul box | `已收 1 / 5` inside the soul box, unit included. |
| Q10 remove minimap | Canvas + `drawMinimap()` (≈60 lines) deleted. The bottom-right corner now holds the four-key legend. |
| Q11 +1px | Body 11→12, labels 10→11, room name 12→13, key caps 10→11. |

Q7 needed a fix in two places: because the ink row now always occupies space, the room name had to move down (142 → 156px, and 132 → 180px on touch) or it overlapped the ink label. `ctrl_check.js` verifies the invariant directly — it **toggles `.ink` and measures the room name's position before and after**, asserting it does not move. That assertion caught the overlap the first time round.

## 3. Art direction (Q12–Q17)

**Q12 — accepted the line, added smear.** Three effects, none of which widens the body: trailing streaks behind the body while moving (three layers, fading, offset by speed), a 6px-wide pair of side streaks during the 1–2 frames the squash-stretch settles, and a rendering nudge — while the body is inside a seam tile it is drawn 60% of the way toward the seam's centre line (max 9px, continuous). The nudge is *drawing only*; collision is untouched.

Why the nudge: the crack is 6px and the body is 6px, but collision treats the whole 48px tile as "inside the seam". Without the nudge, the body is drawn on top of the stone for most of a traversal — at 1:1 it looked like **a warm stick stuck into a brick**.

**Q13 — the colour law is now enforced.** Environment cold, player/enemies/items/light warm, **seam cold**. Concretely: the seam's torn fibres and inner glow changed from warm (`255,206,140`) to cold (`150,180,235`); the seam is the only cold light source in the room.

This had a second-order benefit and a second-order cost:
- Benefit: person (warm line) vs seam (cold cut) can no longer be confused under any lighting. That was the largest readability risk in the build.
- Cost: my first cold version read as **a cable** — two bright hairlines with black between them. Fixed by adding a 1px dark shadow outside each highlight, so the profile is `shadow → cold edge → 6px dark core → cold edge → shadow`. A groove, not a wire.

**Q14 — paper lantern.** The modern floor lamp is gone. Replaced with a simplified lantern: barrel body, four ribs, two dark paper bands, a top ring, no pole hardware beyond a 4px rod. The first attempt read as **a plastic cup**, because the paper was filled with a flat pale colour and lit from nowhere. Fixed by drawing the **inner core first** and then laying the paper over it — the paper is lit from inside, which is the only thing that makes it read as paper.

**Q15 — restrained expressions.** The slime's brows went from 2.5px / alpha .85 / 20° inward to **1.2px / alpha .38 / almost horizontal**. They read as a crease pressed into a damaged photograph rather than an angry cartoon brow. Eyes, folds and tears unchanged.

**Q16 — arches left empty.** No change.
**Q17 — system sans-serif kept.** No change.

## 4. Flatten experiment (Q22–Q24)

**Q23 — pillar is 144px.** The slab's top is at exactly 144px; the jump apex is 203.8px, so the margin is now 59.8px instead of 11.8px. It reads as "slightly taller than me", not as "probably impossible".

Because the slab is now one tile thick and the vial sits in the crack, the reward needed one new rule to stay flat-only: **per-item pickup radius** (`reach`, default 52). The vial uses `reach: 24`. The numbers:

| | distance from vial |
|---|---|
| standing (centre max 562px) | **38.5px** → outside 24 |
| flattened at the crack centre | **6px** → inside 24 |

Both directions are asserted, not estimated: `站着靠过去，缝里的东西没被吸走` and `侧身过去顺手拿到缝里的墨囊`.

**Q22 — optional incentive added past the wall.** A sealed niche at x32–35, one tile wide slot, holding the axe soul. Claimed by flattening in; a standing body is stopped 1px short of the seam. Three assertions cover it: standing is blocked, flat enters, the soul is collected.

**Q24 — 3.8 seconds kept.** 100 ink at 26/s. No change.

### Instrumentation now separates the three uses

Your rule — *don't count forced use as discovery or voluntary reuse* — is now structural, not a note in a report. Classification is by **press position**, not by elapsed time:

```
firstUse.kind      beforeGate  = the player found it themselves
                   atGate      = pressed while standing at the mandatory wall
mandatoryUses      presses inside ±90px of the gate, before crossing
voluntaryReuses    presses after crossing, outside the gate zone
useBreakdown       { beforeGate, atGate, atGateAfterCross, voluntary }
reuseAfterGate     kept for compatibility = voluntary + atGateAfterCross
```

There is a **negative control** in the suite: after crossing, the player is teleported to the gate and presses F again — `voluntaryReuses` must stay 0 and the press must land in `atGateAfterCross`. If that control ever fails, criterion 2 is being inflated by "the player fidgeted at the wall", and the numbers stop meaning anything.

Live check from a browser run (script bot, 12.2s):

```
firstUse { at: 8.34, kind: "atGate" }
useBreakdown { beforeGate: 0, atGate: 1, atGateAfterCross: 0, voluntary: 0 }
mandatoryUses 1   voluntaryReuses 0   voluntarilyReused false
```

## 5. Test results

| Suite | Assertions | Result |
|---|---|---|
| `test.js` | 60 | pass |
| `test_audio.js` | 15 | pass |
| `timestep_check.js` | 18 | pass (apex 203.79–203.80px at 30/60/120/144Hz, jump buffer 25.00ms) |
| `save_check.js` | 35 | pass |
| `flat_check.js` | **57** (was 36) | pass |
| `ctrl_check.js` | **39** (was 26) | pass |
| `keymap_check.js` | 23 | pass, including `KM_THROTTLE=20` |
| `verify_fix.js` | 11 | pass |
| `stress_input.js` | 12 | pass |

Total **270**. `flat_check.js` grew by 21 because the room's structure, the pickup radius rule and the three-way metrics each earned their own assertions.

## 5b. Why the build could not be operated at all (root cause, not a guess)

The reviewer's report was "still completely un-operable". It was not the key bindings — those had been verified by probes. It was **input environment detection**, and the evidence is a screenshot of what the reviewer actually saw: no keyboard legend in the bottom-right corner, six round touch buttons (后 / 纸 / 红 / 蓝 / 攻 / 跳) sitting over the play area, and a hint reading "左滑移动" (swipe left to move).

Cause, `src/mobile.js`:

```js
// old
var touch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
```

Windows touchscreen laptops report `maxTouchPoints = 10`. Every one of them was classified as a phone. That triggers `#stage.touch #keys{display:none}` — the entire mouse-and-keyboard legend disappears — and builds the virtual pad on top of the frame. A player on such a machine is told to swipe, cannot find which key does what, and concludes the controls are broken. The keys were live the whole time; the legend that explained them was hidden by a hardware sniff.

Fix — the criterion is **what the primary pointer is**, not whether touch hardware exists:

```js
// new
var touch = forceTouch || (!forceDesk && mq('(pointer: coarse)') && mq('(hover: none)'));
```

`pointer: coarse` + `hover: none` is true on phones and tablets and false on a touchscreen laptop, because the laptop's primary pointer is still a mouse. `?touch=1` / `?touch=0` remain as explicit overrides for device acceptance.

Second, independent cause of the same symptom: **focus**. When the build runs inside an iframe (the preview panel), the parent window holds keyboard focus and no keydown ever reaches the game. Mitigated three ways: the canvas is `tabindex=0` and `boot()` takes focus once; any `pointerdown` re-takes focus; and only when framed, if four seconds pass with no keydown, a "点一下画面，再按键" strip appears. It is not a tutorial and it is not shown for a top-level window.

Verification, `input_env_check.js` (new, 20 assertions, four real Chromium environments):

| Environment | touch mode | legend | pad | press D |
|---|---|---|---|---|
| plain desktop | off | visible | none | +117.0px |
| Windows touchscreen laptop (`maxTouchPoints=10`, mouse pointer) | **off** | visible | none | +112.5px |
| phone (`hasTouch`) | on | hidden | present | — |
| inside an iframe | off | visible | none | +96.8px, focus strip shown |

Total now **290**.

## 5c. The actual reason letter keys did nothing: Chinese IME

The report after 5b was precise: arrows work, `A D W S J K U L I F O` do nothing. That rules out the touchscreen theory — if the page were in touch mode, the arrow keys would be equally dead. One mechanism explains "arrows work, letters don't":

In a Chinese IME (Microsoft Pinyin, Sogou), letter keys are taken by the IME to compose characters. Chrome still dispatches a `keydown`, and it looks like this — captured, not guessed:

```js
{ key: 'Process', code: 'KeyD', keyCode: 229, isComposing: true }
```

The old handler read `e.key.toLowerCase()` → `'process'` → not in `KEYMAP` → nothing happens. Arrow keys are not part of composition, so `key` stays `'ArrowRight'` and they keep working. `preventDefault` was also never reached on the letter path, so the composition window kept opening.

Reproduced and fixed in the same probe:

| event shape | before | after |
|---|---|---|
| `ArrowRight` | +113.3px | +111.7px |
| `KeyD` with `key:'Process'` | **+2.6px** (residual velocity, not input) | **+84.0px**, `preventDefault=true` |

Fix: read `e.code` (physical position — unaffected by IME, case, Shift) and keep `e.key` only as a fallback. Two details matter as much as the field swap:

- `preventDefault` now runs on **every** game-shaped key (`Key[A-Z]`, `Space`, `Tab`, arrows), not only on keys that map to an action. That stops the IME from ever starting composition; once composition starts, even `code` can be lost.
- Listeners moved to **capture** phase, so no element in the page can `stopPropagation` them away, and they run ahead of the IME.

Key tables are still generated from `K` — `CODE_ACT` is derived, so there is not a second definition of the bindings. `ime_check.js` (new, **50** assertions) drives the real composition-shaped events through all ten actions plus arrows, space, caps, and `O`; `input_env_check.js` still passes. Total **340**.

Documentation requested by the reviewer: `DOC_CONTROLS.md` — the full control path (tables → listeners → action tokens → per-physics-step reads), the complete key table with conditions, and the checklist for verifying it without taking my word for it.

## 6. Screenshots

| File | What it proves |
|---|---|
| `shots/flat_02_slit.png` | 144px slab, crack, glint in the crack, jumpable height vs the player |
| `shots/flat_03_inside.png` | flattened player mid-traversal, motion trail |
| `shots/zoom_inside_still.png` | 1:1: the body inside the crack, colour bands and lit edge intact |
| `shots/flat_06_gate_blocked.png` | mandatory wall backlit by two lanterns |
| `shots/flat_07_gate_through.png` | same wall after crossing |
| `shots/flat_08_alcove2.png` | the sealed slot past the gate with the soul inside |
| `shots/zoom_block.png` / `zoom_lamp.png` | 1:1 crops used to reject the first two versions of both |
| `shots/hud_legend_full.png` | 4-entry legend, 2 slots, no minimap, no log |
| `shots/fullkeys_1280.png` | full table in the soul box, grouped by action |
| `shots/flat_05_mobile.png` | touch layout, 7 buttons, hint |

## 7. Known gaps and honest limitations

1. **First-time players: still 0.** All numbers above come from a script bot. Criteria 1 and 2 remain untested.
2. **The slot past the gate is one tile wide**, so you cannot stand up deep inside it — you collect the soul while still flat, and you have to back out to stand. That is a consequence of keeping the slot narrow enough not to read as a doorway. It works, but it is not the "walk in, stand up, take it" flow I described in the S4 report.
3. **The axe soul is a duplicate** of the one in the corridor. The experiment room has no exit portal and is reached by URL only, so there is no progression conflict; if you object, the alternative is a large ink canister.
4. **Ink is still 3.8s** and there are now three lamps in the room (x4, x26.5, x30.5). The third one exists so the new seam is lit — the same reasoning as the second, but it does add a refill opportunity between the gate and the niche.
5. **Android on a real device: still untested.** Unchanged from S4.
6. **Q18–Q21 untouched.** Tileset vs code-drawn terrain, enemy atlases, the name-card/6px conflict, and splitting the single file all remain as they were, pending a ruling.
