# Work Order 002 — Flatten Experiment

**Status:** Phase A complete (re-verified). Phase B implemented, instrumented, all suites green.
**Not done:** no human playtest has been run. First-time-player count is **0**. §7 says exactly what that means for the three criteria.

---

## 1. Phase A — the two physics adjustments

Both were re-measured after the rebuild, not assumed from the previously reported multipliers.

| Item | Requested | Result | How it was verified |
|---|---|---|---|
| Jump apex | ≈203.8px | **203.79–203.80px** at 30 / 60 / 120 / 144 Hz | Bisection on `P_JUMP_V` → **971.3** (started from the approved ×1.020 = 980.2, which overshot). Old loop at 60Hz measured 203.73px with the same sampling rig; delta 0.06px. |
| Double-jump increment | (not in WO, found broken) | **136.34px** restored | The apex fix alone dropped the second jump's increment from 136.34 to 133.24. Proportional scaling (+1.07%) did **not** work (still 133.71). Measured the *increment* and bisected → `P_DJUMP_V = 792.7`. |
| Jump buffer | ≈25ms, in physics ticks | **3 ticks = 25.00ms** at 60 / 120 / 144 Hz | `JBUF_TICKS * FIXED_DT`. Frame-end readings are 25.00 / 25.00 / 25.00ms. Assertion is "integer multiple of the step", not a hard-coded millisecond value, so it cannot pass by accident at one frame rate. |
| 100ms anti-spiral cap | accepted | unchanged | `MAX_SUBSTEPS = 12`. |

> The multiplier you approved was treated as a starting point. It was 0.9% high; bisection produced 971.3. The comment in `src/game.js` records why this is a re-calibration rather than a numerical improvement: halving the step changes how much displacement semi-implicit Euler loses per step, so the integrator changed and the constant had to be re-derived.

**Transient keymap failure — root cause found, not papered over.**
Reproduced deterministically with `KM_THROTTLE=20` (20ms busy-wait per frame). The failing assertion read *"你按下去的时候，手抖了一下。"* — an opening `setTimeout` line overwriting the single-line HUD. On a slow machine the sample landed after the overwrite.

Two fixes, at two layers:
1. **Product:** `say()` now takes a priority (`0` story / `1` player action) and a player-action echo is not overwritten by a story line while it is fresh. This was a real bug — on any slow device the player's own action feedback could be swallowed.
2. **Test:** reads `__sk.says()` (append-only history) instead of the current message.

Also fixed while chasing it: two assertions that measured wall-clock time where they meant game time (`holdUntil` now polls on a game-time budget), and a summary counter that only recursed one level, so a broken direction row printed "all passed". `process.exitCode` is now set on failure.

`KM_THROTTLE=20` passes 3/3 runs; normal speed passes.

---

## 2. Phase B — Flatten, as built

### 2.1 The state

| Property | Value | Note |
|---|---|---|
| Collision width | `28 → 6` (`P_CW`) | Height unchanged (100). Every `P_W` in collision paths is now `P_CW` (25 sites). |
| Speed | `0.55 ×` run speed | You crawl. |
| Allowed flags | `FACING \| GRAV_FALL` only | Attack, jump, dash, cast are *structurally* unavailable — the state machine never sees those buttons. Not a blacklist that can be forgotten. |
| Enter | hold `F` / mobile `纸` | Refused while hurt / sliding / dashing / attacking / casting, and at ink 0. |
| Exit | release, or ink hits 0 | Exit measures available space first. If there is no room to stand up, you stay flat — you cannot un-flatten into a wall. |
| Damage while flat, in a seam | damage applies, **knockback does not** | Otherwise the knockback ejects you from the seam and the mechanic fights itself. |

### 2.2 The tile

`|` is solid for any body wider than `PAPER_W = 12`. It is drawn as a *seam*: a 2px ink line, 1px warm fibre edges on both sides, torn crumbs, and a faint warm bloom. A previous revision let the stone-hash give that column its darkest block, which read as "a gap between two walls" — the seam now paints a 6%-lighter plate first so it reads as *the wall has a slit in it*, not *the wall has a hole in it*.

The flattened player is **the same sprite squashed to 6px**, not a separate hand-drawn line. The first version drew a line and it was indistinguishable from the wall seam at 1:1 — a usability failure, not a taste issue. It now carries a soft radial breath halo (a hard-edged `fillRect` read as a UI selection box), 1px dark edges both sides, one warm rim on the facing side, and a contact shadow.

### 2.3 Ink

| Constant | Value |
|---|---|
| Capacity | 100 |
| Drain while flat | 26 / s → ~3.8s of continuous flatness |
| Refill | **lamps only**, 70 / s, within 78px — and only while *not* flat |
| Vial in the alcove | +20, one-shot |

Ink resets to full on room load (`loadRoom`), so it is a **per-room** resource, deliberately not persisted — `SAVE_VER` stays 1, no save migration needed. HP/MP continue to be saved as accepted.

### 2.4 The room (`paper`, 显影室, 40×18)

```
 0 ########################################
 1 #...........................#..........#
...
10 #...........................#..........#
11 #........===#####...........#..........#
12 #...........|...#...........|..........#
13 #...........|...#...........|..........#
14 #...........|...#...........|..........#
15 ########################################
```

- `===` at x9–11: a 3-tile ledge at the same height as the alcove roof — the *intended* non-flatten route over the alcove.
- `#####` x12–16 y11–14 + `|` at x12 y12–14: **optional alcove**. Cavity is 3×3, contains one ink vial.
- `|` at x28 y12–14 under a solid column: **mandatory slit**. Nothing else crosses that column.
- 2 lamps, 2 slimes, 1 bat. Enemies: slime at x14 (drop 1 soul), slime at x21, bat at x24 that **shoots paper darts**.

One change was made after looking at the 1:1 evidence: the second lamp moved from x34 to **x26.5**, i.e. to the *near* side of the mandatory wall. At x34 it lit ground the player has already crossed, and the slit sat in darkness where it read as a hairline on brick. Moved, the seam is backlit and silhouettes as "light coming through the wall". Rationale: if first-time players cannot see the entrance, the experiment fails for a reason that has nothing to do with the mechanic.

### 2.5 The two specified enemy interactions

| Interaction | Implementation | Counter |
|---|---|---|
| Body contact while flat **does nothing** | In the contact loop, a flat player sets `e._flatSkip` instead of taking damage; a puff of paper dust plays. Re-armed when contact ends. | `contactsSuppressed` |
| Projectiles **still hit** a flat player | `p.foe` projectiles test against the player independently of the flat state. The bat fires every 1.9s, only when the player is within 430px horizontally. | `shotsHit` |

So Flatten is not invulnerability: it buys you the ability to occupy the same space as a body, and nothing else.

### 2.6 Presentation, input, audio

- HUD gains an **ink bar**, shown only in rooms that have lamps (`#stage.ink`). It exists nowhere else.
- Desktop key `F` (label auto-generated from `KEY_OF`, so no hard-coded key names in HTML).
- Mobile: 7th button `纸`, `right:190px; bottom:112px`, hold-to-stay-flat, bound through the same `bind(..., 'flat')` path. No key names anywhere in `mobile.js`.
- `audio.js`: `case 'paper'` — bandpass noise 2900→880Hz plus a short triangle, deliberately dry (paper, not magic).

---

## 3. Instrumentation

All timestamps are **game time** (`P.t`), not wall clock, so a 20fps machine and a 144Hz machine produce comparable numbers. Reset on room entry, not on death — dying does not erase that you already learned the verb.

`window.__sk.metrics()`:

| Field | Meaning |
|---|---|
| `elapsed` | seconds in this room |
| `timeToFirstFlat` | seconds from spawn to **first** flat activation; `null` = never |
| `flatUses` | total activations |
| `flatSeconds` | total time spent flat |
| `gateTime` | seconds to first crossing of `room.gateX`; `null` = never crossed |
| `reuseAfterGate` | flat activations **after** `gateTime` |
| `voluntarilyReused` | `gateTime != null && reuseAfterGate > 0` ← the single boolean for criterion 2 |
| `contactsSuppressed` | enemy body contacts that would have been damage |
| `defensiveSaves` | subset of the above where the nearest enemy was within 160px — i.e. the player flattened *because* something was closing in |
| `shotsHit` | darts that hit a flat player — the anti-invincibility control |

`__sk.grid()`, `__sk.state()` (now includes `ink`/`inkMax`/`cw`), `__sk.says()` (message history) are also exposed.

---

## 4. Test results

| Suite | Assertions | Result |
|---|---|---|
| `test.js` | 60 | pass |
| `test_audio.js` | 15 | pass |
| `timestep_check.js` | 18 | pass |
| `save_check.js` | 35 | pass |
| `flat_check.js` (new) | 36 | pass |
| `keymap_check.js` | 23 | pass (normal + `KM_THROTTLE=20`, 3/3 runs) |
| `verify_fix.js` | 10 | pass |
| `stress_input.js` | 12 | pass |

`flat_check.js` covers: seam passable flat / impassable standing; cannot un-flatten inside a wall; attack, jump and red soul all inert while flat; ink drains, hits zero and force-exits; only lamps refill; contact suppressed but darts connect; gate crossing recorded; room and lamp count.

Frame-rate independence: the whole simulation runs on `FIXED_DT = 1/120`, and every flat quantity is either per-second (`FLAT_DRAIN`, `FLAT_SPD`) or in ticks (`JBUF_TICKS`). There is no `dt`-scaled branch that can drift, and `timestep_check.js` asserts the same apex and the same buffer at 30/60/120/144Hz.

---

## 5. Evidence

`shots/flat_01_room.png` (spawn, lamp readable), `flat_03_inside.png` (flat inside the seam), `flat_04_alcove.png` (alcove + vial), `flat_06_gate_blocked.png` (the mandatory wall, backlit seam, standing player blocked), `flat_07_gate_through.png` (same wall, player now on the far side), `flat_05_mobile.png` (7 buttons), `flat_zoom_inside.png` / `flat_zoom_static.png` (1:1 crops used to judge player-vs-seam legibility).

---

## 6. What I deliberately did not do

No extra rooms, no new enemy types, no progression, no lore, no tutorial text, no unrelated polish. The S3 stop-and-review gate is lifted per your instruction; the build is otherwise the same game.

---

## 7. Honest gaps — read before scheduling a playtest

1. **First-time players: 0.** Every number above comes from scripted input. Criteria 1–3 are *unmeasured*. The instrumentation is ready; the data is not there.
2. **`reuseAfterGate` has no occasion in this room.** Past the mandatory wall there is a dead-end corridor and a lamp — nothing worth flattening for. So on a real playtest that field will read 0 for structural reasons, not disinterest. `voluntarilyReused` is therefore currently uninformative. Before playtesting, the room needs one *optional* post-gate incentive (a second niche, a soul, anything). I did not add it because it is a design decision, and your forbidden list is explicit.
3. **The alcove pillar is 192px high; the single-jump apex is 203.8px.** That is an 11.8px margin on an optional route. It is possible (a scripted run cleared it on the 4th attempt) but tight enough that many first-time players will read the pillar as impassable and flatten *there* instead of at the gate. If that happens, `timeToFirstFlat` and `gateTime` still work, but the "first use" they describe is the alcove, not the experiment's introduction. Cheapest fix if you want a clean baseline: drop the pillar by one tile, or lower the `===` ledge one tile so it is reachable from the ground.
4. **A 6px-wide player is hard to see at 1:1** on a dark background. The squash, halo, rim and contact shadow make it findable, and in motion the player knows where they are, but a static screenshot reads as a warm sliver. I did not raise the brightness further because at some point it becomes a glow-stick and stops reading as paper.
5. **Only two bodies in the room can demonstrate immunity** (2 slimes), and one dart source. That is thin for criterion 3 ("tactical decision, not invincibility"). The numbers will say *whether* contact immunity was used, weakly *why* (`defensiveSaves`).
6. **Android on-device performance still unverified.** Fine for a desktop/browser experiment; must be measured before any release decision.
7. **iOS private-mode "no save" notice** remains deferred, per your instruction not to widen the order.

---

## 8. Decisions I would like from you

1. Add a post-gate incentive so criterion 2 can actually be measured, or accept that criterion 2 is deferred to a later build?
2. Lower the alcove pillar (or its approach ledge) so the optional route is genuinely optional?
3. Flatten's ink budget: 3.8s of continuous flatness — is that the intended pressure, or should the drain be tuned before playtests so the number is not confounded with "the bar ran out before I understood the mechanic"?

---

## 9. Control surface — fixed after review

**The complaint was correct, and it was mine to fix.** The bindings were never broken (`keymap_check.js`, 23 assertions, has been green for three revisions). What was broken was the *description*: the legend claimed `W A S D  移动 · 蹲 · 抬头`, which does not say which key does which, and it **omitted both combo moves entirely** — slide (`down + jump`) and drop-through (`down + attack`). It also printed `L 蓝魂` as a live binding while the blue slot is empty, where `L` correctly does nothing.

To a player, "the manual is wrong" and "the controls are wrong" are the same bug. So the fix is not a text edit:

**One table, and the interface is generated from it.** `LEGEND` in `game.js` now holds key(s), verb, precondition, and whether it needs an equipped soul. The legend row in the HUD is rendered from that table; the letters are taken from `KEY_OF`, so a letter cannot be printed incorrectly.

**The legend is now the test spec.** `ctrl_check.js` (26 assertions, new) does not read expectations from code — it reads `#keys .ent` from the live DOM (`data-keys`, `data-verb`, `data-need`, `.off`), then presses those keys and checks the effect:

| Legend claim | Asserted by |
|---|---|
| `A D 移动` | x moves > 20px |
| `W 抬头` | camera rises |
| `S 蹲` | state `crouch` |
| `S K 滑铲` (ground) | state `slide` |
| `S J 穿板` (on a thin ledge) | `P.dropT > 0` after standing on a real `=` tile |
| `J 攻` | state `attack` |
| `U 红魂` (needs red soul) | MP drops 12 |
| `K 跳` | leaves the ground |
| `I 后跃` (ground) | moves backwards |
| `L 蓝魂` (needs blue soul, **greyed**) | greyed entry must produce **no effect** |
| `O 魂匣` | menu opens and closes |
| `F 纸` | `cw` 28 → 6, and back on release |

Consequences: a legend entry that does nothing fails; a working key that is not in the legend fails the completeness check; changing `KEY_OF` without updating the table fails on the letters. The description can no longer drift from the implementation.

Also fixed: the greyed state for unequipped souls (so `L` explains itself before you press it), per-entry preconditions (`地面`, `薄板上`) because "nothing happened" is usually a precondition, not a broken key, and an alias line (`方向键=WASD · 空格=跳 · Tab=魂匣 · R×2 重开 · M 静音`) so the undocumented-but-live bindings stop being invisible. The touch hint now lists both combos.

Full suite after the change: 60 / 15 / 18 / 35 / 36 / **26** / 23 / 10 / 12 — all green.

Two things I did **not** do, because they are design calls, not defects: I did not remove the combo moves, and I did not hide the legend. Both are open questions Q2 / Q3 in the attached consultation document.
