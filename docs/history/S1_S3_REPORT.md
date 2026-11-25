# Implementation report — S1 / S2 / S3

**Project:** Dual-Vector Foil (`SoulKeep.html`, single file, 902 KB)
**Date:** 2026-11-24
**Scope authorised:** fixed timestep, persistence, input action layer. **Stopped before Flatten**, as instructed.
**Branch of truth:** `src/game.js` is the source; `SoulKeep.html` is the build output (`python build.py`).

---

## 1. What was asked, what was done

| # | Requirement | Status | Evidence |
|---|---|---|---|
| **S1** | 120 Hz fixed-step physics with interpolated rendering | Done | apex identical to 0.01 px across 30/60/120/144 Hz |
| S1 | 30/60/120 Hz invariance test | Done — `timestep_check.js`, 11 assertions (also runs 144 Hz) | sd = **0.000 px**, pass condition was < 0.5 px |
| S1 | jump-apex σ < 0.5 px | **0.000 px** (30/60/120/144 all 199.72 px) | 3 jumps per clock, 12 runs total |
| **S2** | Versioned localStorage saves | Done — key `dvf.save`, `v: 1` | `save_check.js` |
| S2 | Save on room transitions and checkpoints | Done — room entry (the only checkpoint boundary this build has), plus kill / soul pickup / equip change / page hide | 35 assertions |
| S2 | Save round-trip + version-rejection tests | Done | round-trip byte-stable except `at`; v=999, truncated JSON, array root, wrong types, bogus soul ids, bogus room, poisoned numbers all rejected |
| **S3** | Keyboard and touch emit **actions**, not key names | Done | `padDown('jump')`; `K` is the only place a physical key name appears |
| S3 | Remove duplicated key knowledge from `mobile.js` | Done — zero key names remain in `mobile.js` | `grep` for key letters returns nothing; touch layer sends `jump/atk/red/blue/back/menu/left/right/up/down` |
| S3 | Existing input and touch tests still pass | Done | keymap 21/21, stress 12/12 groups, verify_fix 10/10 |

Constraints honoured: playable build preserved, no rewrite, no Godot port, no new content, no optional features.

---

## 2. Files changed

| File | Change |
|---|---|
| `src/game.js` | S1 loop + interpolation; S2 save system; S3 action layer; instrumentation (`airMinY`, `simT`, `stepDt`) |
| `src/mobile.js` | emits action names only; menu button joins the action layer instead of calling `toggleMenu()` |
| `SoulKeep.html` | rebuilt (902 KB) |
| `timestep_check.js` | **new** — 11 assertions, 4 clocks |
| `save_check.js` | **new** — 35 assertions incl. corrupt-save matrix |
| `keymap_check.js` | `__sk` calls moved to action names; new touch-menu check; new `file://` reload-persistence check |
| `verify_fix.js` | `__sk.press('j')` → `press('atk')` |
| `README.md` | test list + "three foundations" section |

---

## 3. S1 — how it works, and what it cost

`frame()` now accumulates real frame time and consumes whole 1/120 s steps; the leftover drives an interpolation factor passed to `render(alpha)`. Player position **and camera** are lerped between the pre-step and current state, then restored — `render()` stays side-effect free.

Three details that are easy to get wrong, and are the reason this took the afternoon:

1. **`latchPad()` per physics step, not per frame.** At 60 fps a frame runs two steps; with taps cleared only at frame end, an attack tapped once fires twice in that frame. It would have been a 60-fps-only double-damage bug.
2. **A frame can run zero steps** (240 Hz display: 4.2 ms < 8.3 ms). Taps must survive that frame untouched, otherwise a high-refresh phone drops every third input.
3. **Anti-spiral cap.** Max 12 steps (100 ms) per frame; beyond that the debt is dropped rather than caught up. A tab switched back after 30 s must not teleport the player through a wall.

`dt` fed to gameplay is now constant. Everything time-dependent — gravity, jump buffer, camera smoothing, hit-stop — became frame-rate independent as a side effect.

**Real-browser measurement** (headless Chromium, 1280×720): 60.3 fps idle, 59.1 fps with 4× CPU throttling (CDP `Emulation.setCPUThrottlingRate`). Physics at 120 Hz is not the frame-cost bottleneck.

---

## 4. S2 — save shape and rejection policy

```
{ v:1, room, hp, mp, luck, owned:[...], equipped:{red,blue,yellow}, flags:[...], at }
```

- Save points: room entry, enemy killed, soul picked up, equip changed, `visibilitychange→hidden`.
- **Read failures are always "new game"**, never a partial load: bad version, truncated JSON, wrong root type, `owned` not an array, unknown soul id (menu would dereference `SOULS[id].name` and crash), unknown room, NaN/huge hp.
- No `localStorage` (Safari private mode, blocked policy): probed by an actual write, falls back to playable-no-save. `save()` returns `false` instead of throwing.
- Death respawn restores full HP, keeps flags/room — a boss retry is now possible without replaying the castle.
- Verified both headlessly (`save_check.js`) and in a real `file://` page: open `?room=tower`, reload with no query string, still in tower, 148 bytes on disk.

---

## 5. S3 — one key table, one action vocabulary

`K` (action → keys) is unchanged; a reverse `KEYMAP` is derived from it, so there is exactly one place that knows `k` means jump. Both sources feed one action state:

- `held[action]` is a **counter of sources**, not a boolean. Press W and ↑ together, release one: the player keeps walking. A boolean would stop them mid-stride.
- Menu now travels the same path: Tab/O and the touch "匣" button both emit `menu` and are consumed by the same edge detector. Previously the touch layer called `toggleMenu()` directly — two paths for one global.
- On menu open, only **touch** sources are released (`actReleaseTouch`), because the stick is hidden by CSS and never receives `pointerup`. Keyboard keys stay held, so holding D through a menu open/close keeps walking.

---

## 6. Test results

| Script | Assertions | Result |
|---|---|---|
| `test.js` | 60 | all pass |
| `test_audio.js` | 15 | all pass |
| `timestep_check.js` | 11 | all pass |
| `save_check.js` | 35 | all pass |
| `keymap_check.js` (real Chromium) | 21 | all pass |
| `verify_fix.js` (real Chromium) | 10 | all pass |
| `stress_input.js` (real Chromium) | 12 groups | all pass |

Defect ledger, newest first — what the tests caught, not what I remembered:

1. My first `airMinY` design reset the apex tracker on landing, so the measured apex was always 0. The invariance test instantly showed `-1.00 px` — the number was wrong, not the physics.
2. A 1.84 px spread in horizontal distance across clocks turned out to be **input sampling**, not physics: the key lands on a frame boundary, so 30 Hz starts up to 33 ms late. Metric changed to steady-state speed (270.0 px/s, sd 0.000) — the honest measure.
3. Touch "匣" button: `actReleaseAll()` on menu open killed keyboard-held direction keys. Split into `actReleaseTouch()`.

---

## 7. Deviations — please rule on item 1

1. **Jump apex is 2% lower: 203.8 → 199.72 px at 60 fps.** Halving the integration step reduces semi-implicit Euler's overshoot, so the same `v₀` now produces a slightly lower arc. This is a real, if small, feel change. Level-reachability assertions still pass (mid platform 144 px, double-jump gate 288 px). If you want the old number back exactly, it is one constant: `P_JUMP_V × 1.020`. I did not apply it — that is a feel decision, not a bug fix.
2. **Jump-buffer window tightened from ~25 ms to ~12.5 ms** (it was `dt × 1.5`, i.e. frame-rate dependent; now it is `1/120 × 1.5`). In the AoS preset the buffer is deliberately near-zero anyway.
3. **Rendering is up to one physics step (8.3 ms) behind simulation.** That is inherent to interpolation; it is invisible, and it is why the camera had to be interpolated with the player.
4. **No explicit save-room entity was invented.** "Checkpoint" = the room you are in. A dedicated save room would be new content, which is out of scope.
5. **HP/MP are saved.** Quitting at 5 HP resumes at 5 HP. Death respawn still refills (unchanged).
6. **Frames longer than 100 ms drop time instead of catching up.** Deliberate: a 30-second tab switch must not fast-forward the world.

---

## 8. Remaining risks

1. **120 Hz simulation doubles physics work per frame.** Headless numbers are comfortable, but the target is a mid-range Android on a real GPU; the honest measurement is a 30 fps device with the render load included. Not measured — no device here.
2. **iOS Safari private mode** silently loses progress (guarded, no crash, no UI hint). A one-line "进度不会被保存" notice would fix the confusion; it needs a decision on where it lives.
3. **No save migration.** Any change to `SAVE` shape must bump `v` and will wipe existing saves. Fine before launch, not fine after.
4. **Six independent ground queries** (`tileAt` / `touchingGround` / `groundBelow` / `platformTop` / `onOneWay` / `dropThrough`) are untouched — still the most likely source of "fell through the floor" reports.
5. **Walk cycle is still procedural.** Deferred per your decision; the atlas has no walk frames.
6. One transient `keymap_check` failure occurred once in ~6 runs and did not reproduce in 3 consecutive clean runs. I did not identify it; flagging it rather than claiming green.

---

## 9. Not started

Flatten (mandated wait for approval). No content, rooms, enemies, art, or Godot work.

**Commands:** `python build.py && node test.js && node timestep_check.js && node save_check.js && node keymap_check.js`
