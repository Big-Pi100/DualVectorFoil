# Work Order 001 — Response
## Dual-Vector Foil: Prototype Audit & Architecture Plan

**Audited artifact:** `SoulKeep.html` — 889 KB, single file, built from `src/` (3,622 LOC total)
**Method:** read the source; ran the five existing suites; wrote one new read-only probe
(`audit_probe.js`) driven by a real Chromium with real key events and CDP CPU throttling.
**Changed during the audit:** one P0 text defect (§4.3) + a single-source key table. Nothing else.
**Not changed:** physics, level data, rendering, input architecture. No rewrites.
**Legend:** ✅ verified by measurement · ○ verified by reading code · △ stated as assumption

---

## 0. Summary for the planner

1. **This is a feel laboratory, not a codebase to grow.** 2,253 of the 3,622 lines are one file that
   contains physics, combat, level data, rendering and UI. That was the right trade for finding out
   whether the game *feels* right, and it is the wrong trade for the next phase. But the answer to
   "should we modularise?" is **not yet** — see below.
2. **Three findings block new features, and all three are cheap:**
   | # | Finding | Evidence | Cost to fix |
   |---|---|---|---|
   | 1 | The jump is **framerate-dependent**: +8.4 % height and +11–32 % airtime at ~20 fps | measured, §4.1 | 0.5 session |
   | 2 | **No persistence at all.** `SAVE` lives in memory; refresh = lose everything | grep: zero `localStorage` | 0.5 session |
   | 3 | The keymap exists in **5 places** and had already produced a user-facing contradiction | §4.3, fixed today | 0.5 session |
3. **Do not port to Godot yet.** Godot is the right *shipping* target — and its fixed physics tick
   would have prevented finding #1 for free — but porting an unproven central mechanic buys nothing
   and costs two weeks. Port **after** the mechanic is validated (§7).
4. **The central mechanic is currently cosmetic.** The photograph produces a sprite; it does not
   change what the player can *do*. That is the real risk in your §4, and it is a design risk, not
   an engineering one. §7 is my proposed smallest falsifiable test of it.
5. Everything in §6 of the work order (test design) already partly exists: **116 automated
   assertions across 5 layers**, all green. The gap is not coverage, it is *what the layers can see*.

---

## 1. Inventory

| Component | LOC | Responsibility | Coupling | Verified |
|---|---|---|---|---|
| `src/game.js` — physics/collision | ~230 | `moveBody`, `platformTop`, `solidBox`, `tileAt`, substep integration | reads global `room`, `P` | ✅ jump/stop/turn measured |
| `src/game.js` — player FSM | ~330 | 10 states, `checkInput` gate, timers, gravity tiers | writes global `P` (36 fields) | ✅ 60 logic assertions |
| `src/game.js` — combat | ~180 | attack windows, hitbox rect, red soul projectile, damage | reads `enemies`, `SAVE` | ✅ |
| `src/game.js` — level data | ~90 | 2 rooms (32×18, 32×36) built by `fill`/`put` calls | **code, not data** | ○ |
| `src/game.js` — render | ~350 | tile atlas cache, 3 enemy painters, player, HUD, minimap | reads `P`, `room`, `enemies` | ✅ pixel-level |
| `src/game.js` — UI/menu/save | ~120 | soul menu, log, HUD sync at 10 Hz | reads/writes `SAVE` | ○ |
| `src/audio.js` | 259 | WebAudio synthesis, one scene track + 12 SFX | isolated via `window.__sfx` | ✅ 15 assertions |
| `src/mobile.js` | 252 | virtual stick + 5 buttons → **raw key names** | duplicates keymap | ✅ real pointer events |
| `src/index.html` | 239 | HUD/canvas/CSS, touch layout | — | ✅ geometry test |
| `build.py` | 57 | inlines atlas b64 + 4 sources into one HTML | — | ○ |

**Build composition:** 889 KB total; **766 KB (86 %) is one base64 PNG** (atlas 1993×744, 20 frames).
The "single file" is a build *artifact* — artwork cannot change without a rebuild. Worth stating
plainly, because it affects how we version and how we test.

---

## 2. Physics constants and provenance

All values derive from a decompiled source, not from tuning by feel. Each is one line of arithmetic.

| Constant | Value | Source | Derivation |
|---|---|---|---|
| Walk / air speed | 270 px/s | `pl_steps.c:128` `RicSetSpeedX(FIX(1.25))` | 1.25 px/frame × 3 (our tile scale) × 60 |
| Ground friction | 1350 px/s² | `pl_steps.c` `RicDecelerateX(FIX(0.125))` | 0.125 × 3 × 3600 |
| Air friction | 675 px/s² | same, `FIX(0.0625)` | 0.0625 × 3 × 3600 |
| Gravity | 2362 px/s² | `velocityY += 0x3800` per frame | 0.21875 × 3 × 3600 |
| Jump impulse | 961 px/s | `pl_setstep.c:141` `FIX(-5.4375)` | 979 theoretical; 961 lands at 203 px after discrete integration + apex gravity |
| Apex window | −22.5 … +67.5 px/s, gravity ×0.2 | `pl_collision.c:18-26` | `vy < FIX(3/8) && vy > FIX(-1/8)`, asymmetric |
| Jump cut | rise clamped to 400 px/s | — | **only deliberate deviation** (verbatim −180 px/s makes a tap-jump unable to clear one tile) |
| Max fall | 1260 px/s | `FIX(7)` per frame clamp | 7 × 3 × 60 |
| Ceiling clamp | −45 px/s | `FIX(-0.25)` | 0.25 × 3 × 60 |
| Hitstun | 0.4 s | `ric_hit_stun_timer = 0x18` (24 fr) | 24 / 60 |
| Knockback | 225 / 540 px/s | `FIX(-1.25)` + `velocityY = FIX(-3)` | ×3 ×60 |
| Attack lock | 0.30 s | `unk46` clears at end of brandish | 9-pose whip animation |
| Substepping | 4× when \|v\| > 360 px/s | `if (|vx|>FIX(2)) v>>=2 … ×4` | prevents tunnelling a 48 px tile |

**Measured outcome:** jump apex 203.8 px = **2.03 body heights** (character 100 px), airtime 984 ms,
stop distance 20.6 px over 200 ms, turn 1 frame. All within 1 % of the arithmetic model. ✅

---

## 3. Main loop and input

```
frame(ts) → dt = min((ts-last)/1000, 0.05) → update(dt) → render() → latchPad()
update:  msg/shake timers → hitStop? (freeze world) → updatePlayer → enemies → projectiles
         → particles → camera → HUD @10Hz
updatePlayer: timers → soul drain/regen → lookUp → state dispatch → jump buffer → gravity tier
              → physics() → hit detection → squash/step SFX
physics: substep moveBody ×4 (or ×1) → ceiling/floor resolution → ground sensor → land FX → jump buffer
```

Three rules carried over from the reference implementation, each of which was a bug before it was a rule:

1. **Animation advances before physics**, so "which pose" and "how far" are decoupled.
2. **State functions only write velocity; position moves in one place.** (`physics()` is the only writer of `x/y`.)
3. **Hit detection runs before the state dispatch**, so a hit interrupts any state.

Input is a tri-state, latched once per frame: `keys` (held) / `taps` (pressed this frame, cleared at
frame end). `taps` rather than an XOR of previous state, so a press+release inside one frame is not lost.

---

## 4. Findings

### 4.1 P0 — the jump depends on framerate ✅ (measured, new)

`dt` is the variable RAF delta, clamped at 0.05 s. Physics is one semi-implicit Euler step per frame,
and the apex window is defined in instantaneous velocity, so the number of steps spent inside it
varies with `dt`. Result:

| Condition | Jump apex | Airtime (real) | Game time | Frames |
|---|---|---|---|---|
| 60 fps (p50 16.7 ms) | **203.8 px** | 984 ms | 983 ms | 58 |
| ~47 fps (CPU 8×) | 214.3 px | 1019 ms | 1017 ms | 46 |
| ~20 fps (CPU 12×, 15 frames clamped) | **220.9 / 221.2 / 221.8 px** | **1094 / 1094 / 1295 ms** | 983–1067 ms | 20–23 |

Three separate runs at 60 fps agree to 0.1 px. Three runs at ~20 fps disagree with each other by
**200 ms of airtime**. So the low-framerate case is not merely biased — it is **not reproducible**.

Consequence: the same input produces a different jump on a mid-range Android than on the machine
every parameter was tuned on, and QA cannot file a reproducible bug about it. For a game whose entire
pitch is "the jump feels exactly like X", this is the highest-priority defect in the build.

**Fix:** fixed-step accumulator (physics at 120 Hz, render interpolated). Half a session. Adds a
regression test that asserts apex σ < 0.5 px across simulated 30/60/120 Hz.

### 4.2 P0 — there is no persistence ○

`grep localStorage|sessionStorage` → zero hits. `SAVE` is an in-memory object; `respawn()` restores
HP but a page refresh discards souls, flags and room. Every playtest is one accidental swipe away
from a reset, and a boss retry loop is impossible to test.

**Fix:** versioned `localStorage` write on room transition + checkpoint, with a `SAVE_VERSION` field
so the shape can change during prototyping. Half a session.

### 4.3 P0 — the keymap lives in five places, and it had already rotted ✅ (found and fixed)

Where a key name exists today: `KEY_OF/K` (game.js), `bind(...)` calls (mobile.js), the hint bar
(index.html), `README.md`, `./LOOP.md`, **and ~130 raw key literals inside the test scripts**.

The rot was already user-visible. The soul menu said:

> 红魂 · 主动（**L** 施放）… 蓝魂 · 持续（按住 **K**，耗蓝）… 按住 **K** 减缓下落

after the remap made `L` the blue soul and `K` the jump. A player following the in-game manual
presses jump. This is exactly the failure mode the planner flagged in §4 — a supporting system
contradicting the main one — except it was literal text.

**Fixed (text + one source of truth):** `KEY_OF` is now the only place a primary key letter is
written; `K` is generated from it, and the soul descriptions and menu group titles interpolate it.
Verified by reading the rendered menu: `红魂 · 主动（U 施放）`, `向前掷出火球（U）`,
`蓝魂 · 持续（按住 L）`. All 116 assertions still pass.

**Still duplicated:** mobile.js binds raw keys, and the test scripts use raw letters. Planned fix in §5.3.

### 4.4 P1 — level data is code ○

`hall` and `tower` are built by 66 lines of `fill(...)`/`put(...)` calls inside `game.js`. A designer
cannot add a room without editing gameplay code, and no test can validate a room's reachability from
data. Move to `src/data/rooms.js` (a data module — not JSON, because `file://` blocks `fetch`).

### 4.5 P1 — one global `P` with 37 fields, and test hooks ship in the build ○

Every system reads and writes `P`. `window.__sk` (13 methods, including `tile()` and `probe()`) is
unconditionally present in the 889 KB artifact, so the release build exposes level data and a
state-write API. Fine for a prototype; must be stripped by a build flag before any public build.

### 4.6 P1 — "what is under me" is answered in six places ○

`tileAt`, `touchingGround`, `groundBelow`, `platformTop`, `onOneWay`, `dropThrough` each implement a
partial ground query with slightly different rules (`>= 0` vs `> 0`, `=` vs `#`). This is where the
"stands still, falls into `fall` state" and "hangs inside a one-way platform" bugs came from. Should
collapse into one `sensor.ground(x, y, vy)` returning `{solid, oneWay, gap}`.

### 4.7 P2 — smaller items ○

- `physics()`: the ceiling clamp `if (P.vy > VY_CEIL) P.vy = VY_CEIL` is immediately followed by
  `P.vy = 0`, so the clamp is dead code that reads as if it works.
- `render()` allocates a new `CanvasGradient` every frame; `particles.filter` allocates a new array
  every frame. Negligible on desktop, measurable on low-end Android.
- `updateEnemy` is three hardcoded `if (type === …)` branches with per-type physics; it needs a
  strategy table before the second enemy type is added (there are already three).
- Death state integrates `P.y` directly, bypassing collision, so a corpse can sink through the floor.

### 4.8 Art is the actual constraint, not code ○

The atlas has **20 frames across 5 animations at 3.3–6.7 fps**, and **no walk cycle**. Walking is
currently faked procedurally (bob + tilt + dust). The renderer is ready for a `walk` animation the
moment one exists (`PACK_ATLAS.map.walk` is a one-line switch). Every judgement about "does it feel
like a hand-drawn gothic game" is being made against placeholder frames — worth remembering before
we act on any art-related feedback.

### 4.9 Perf headroom ✅

Mobile profile (844×390 CSS, DPR 3 → canvas 2511×1161 = 2.9 Mpx): p50 16.6 ms, p95 19.9 ms in
headless Chromium. That is 60 fps in a software-rasterised browser; real GPU devices have more
headroom, but fill-rate is the risk once sprites are HD rather than 1993×744 atlases.

---

## 5. Proposed architecture (no rewrite)

Keep the build model: `build.py` concatenates sources into one HTML. Change *boundaries*, not the
model. Six rules, in dependency order:

### 5.1 Fixed timestep
`frame(ts)` accumulates real time, steps `update(FIXED)` at 120 Hz, passes `alpha` to `render(alpha)`.
Kills §4.1 and makes every timing assertion deterministic.

### 5.2 Data out of logic
`src/data/{rooms,enemies,souls,feel}.js` — plain `const` modules. Level editing stops being code
editing; rooms become validatable.

### 5.3 Input becomes an action layer
`SK.input.act('attack' | 'jump' | 'red' | 'blue' | 'back' | 'up' | 'down')`; the keyboard and the
touch layer both emit **actions**, never keys. `mobile.js` stops knowing that jump is `'k'`. This
removes the duplication class that produced §4.3 and the earlier "phone blue button casts red soul"
bug. Tests keep using physical keys at the boundary, which is correct — they are testing the mapping.

### 5.4 One ground sensor
Per §4.6.

### 5.5 Render reads a snapshot
`render()` consumes `snapshot()` only; no logic writes inside render, no `P` reads scattered through
draw calls. This is what makes the pixel-layer tests trustworthy.

### 5.6 Test hooks behind a flag
`build.py --release` drops `window.__sk`.

**Ordering note:** 5.1 and 5.3 are prerequisites for everything else and each is half a session.
5.2 and 5.4 can wait until a room or an enemy is actually being added — do not do them for tidiness.

---

## 6. Test design: what each layer can and cannot see

| Layer | Count | Runs on | Sees | **Cannot see** |
|---|---|---|---|---|
| Logic (`test.js`) | 60 | Node `vm`, fake canvas, synthetic RAF | state transitions, numbers, ordering | anything visual; framerate; real key events |
| Audio (`test_audio.js`) | 15 | Node, stub graph | node graph structure, envelopes | whether it sounds right |
| Keymap (`keymap_check.js`) | 19 | real Chromium + real keys + real touch | physical key → action; button geometry; pointer events actually fire | whether the action is *readable* on screen |
| Pixel (`verify_fix.js`) | 10 | real Chromium, in-page `getImageData` | did pixels change, did the player get drawn | effects shorter than one sampling window (`screenshot()` is 200 ms) |
| Stress (`stress_input.js`) | 12 | real Chromium, 2 s holds | states you cannot exit | states you can exit but that look wrong |

**Three tests to add, in this order:**
1. **Framerate invariance** (§4.1): apex/airtime at simulated 30/60/120 Hz, assert σ < 0.5 px.
   *This is the one test the current suite structurally cannot express.*
2. **UI text vs keymap**: render the soul menu and assert every key letter it prints is the letter
   `KEY_OF` currently holds. Catches §4.3 mechanically instead of by reading the screen.
3. **Save round-trip**: mutate progression, reload, assert it survived and that an old
   `SAVE_VERSION` is rejected rather than half-loaded.

---

## 7. Smallest experiment that validates the central 2D-brane mechanic

The planner's question — *"what can the player do because the world was photographed once that they
couldn't do elsewhere?"* — has four plausible answers. Ranked by cost to falsify:

| # | Verb | What the player does | Cost | Risk |
|---|---|---|---|---|
| A | **Flatten** | Hold a button: the character turns edge-on, becomes a line. Passes gaps thinner than a silhouette; immune to anything not on its plane; cannot attack. | **1 session** | must not become "free invulnerability" |
| B | **Photograph** | Aim and capture an enemy, flattening it into a card you can deploy as a platform or a one-shot strike. | 2–3 sessions | it is Aria of Sorrow's soul system re-skinned; also creates an economy that fights "no XP" |
| C | **Blank back** | The world was photographed from one side, so nothing has a back. Step behind geometry into an unrendered void: pass through walls, lose vision, on a timer. | 2 sessions | reads as "walk through walls with a timer" unless the cost is real |
| D | **Depth collapse** | Collapse two parallax layers into one plane so a far ledge becomes adjacent. | 4+ sessions | needs depth-aware level data; hard to read in a side-scroller |

**Recommend A, and A only.** It is the literal reading of the title (*二向箔* collapses 3D into 2D),
it is expressible with **one new state + one new tile character** on the existing FSM, and it works
with five buttons on a phone because it is a *hold*, not a combo.

### Experiment spec (one session)

- New tile `|` = "paper gap": solid to a standing body, passable while flat.
- New state `flat`: body width 28 → 6, cannot attack, cannot jump, ink drains, refills at lamps.
- One room, 40 tiles long, no text, no tutorial prompts:
  1. an **optional** alcove behind a paper gap, containing a pickup, guarded by a slime;
  2. then a **mandatory** paper gap in the only corridor forward.
- Two enemy behaviours to make the verb matter in combat: slime contact cannot hit a flat player;
  a thrown projectile can.

### Metrics (instrumented, not asked)

- time from spawn to first `flat` use (target < 45 s, no prompt);
- whether the player re-uses it *unprompted* within 3 minutes after the mandatory gate;
- whether flattening ever saves them from damage in a way they initiated (not accidental).

### Kill criteria

If ≥ 50 % of first-time players never re-use the verb once it stops being mandatory, the verb is
decoration and the premise needs rework — that is a **design** answer worth having before any Godot
work. If it survives, this is the mechanic we port, and the rest of the systems get designed around it.

---

## 8. Prioritised roadmap

| Step | Work | Gate (must be true before next step) | Cost |
|---|---|---|---|
| S0 | §4.3 keymap single-source text fix | menus match the keymap | **done today** |
| S1 | Fixed timestep + invariance test | apex σ < 0.5 px at 30/60/120 Hz | 0.5 session |
| S2 | Persistence + save round-trip test | reload preserves room/souls/flags | 0.5 session |
| S3 | Input action layer | mobile.js contains zero key letters; can't regress §4.3 | 0.5 session |
| S4 | **Flatten experiment** (§7) | kill criteria evaluated, written up | 1 session |
| S5a | If pass: rooms → data, ground sensor unify | a new room added without touching logic | 1 session |
| S5b | If fail: write the post-mortem, re-pick the mechanic | — | 0.5 session |
| S6 | **Then** decide Godot port of the validated core | port has a spec, not a vibe | — |

S1–S4 is **2.5 sessions**, and every one of them removes a way the current build can lie to us.
Nothing in this list is a feature.

---

## 9. Decisions I need from you

1. **Do we accept "no new content until S1–S3 are done"?** Those three are pure de-risking and will
   produce no visible change — the temptation will be to skip them for a new enemy or a new room.
2. **Is `Flatten` (A) the sanctioned experiment, or do you want C (`blank back`) instead?** C is more
   distinctive in fiction and much harder to make legible; A is cheaper and more tactile. I recommend A
   and would keep C as the second act's twist once the world has established "fronts exist, backs don't".
3. **What is the vertical slice's success criterion** — a 10-minute playable that a stranger finishes
   without help, or a 30-second loop that testers voluntarily repeat? These imply different S4 designs.
   My preference is the second: it is the only one measurable with five people.
4. **Art**: the walk cycle (8 frames) is the single highest-leverage asset in the project and the only
   thing blocking every animation judgement. Do we commission/draw it now, in parallel with S1–S3, or
   keep prototyping against procedural motion?

---

*All numbers in this document came from the build in this directory. `audit_probe.js` reproduces the
§4.1 table: `node audit_probe.js`.*
