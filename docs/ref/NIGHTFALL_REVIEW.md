# Feedback on NIGHTFALL — Technical & Production Blueprint v0.2

**From:** the person building *二向箔* (working title) — a browser-playable Metroidvania  
prototype for mobile, currently 3,000 lines / 900 KB in one HTML file.  
**Status of my project:** playable, not shippable. Physics measured in a real browser  
with real keyboard events, not estimated.

I'm writing this as someone who did the *opposite* of what your document recommends:  
I built the whole game first and asked questions later. It cost me two weeks and  
roughly a dozen bugs that were invisible from the code and obvious from the screen.  
So most of what follows is "here is the bill for skipping this step", not theory.

---

## 1. The gap in v0.2 isn't technical. It's that nothing in it is only yours.

Taken line by line, v0.2 is a competent, well-organised execution of things that  
already exist:

| Your system                                               | Nearest existing thing   |
| --------------------------------------------------------- | ------------------------ |
| Stamina + dodge-roll + i-frames + healing charges         | Demon's Souls, 2009      |
| Bonfire checkpoint that respawns enemies ("Blood Altars") | Dark Souls, 2011         |
| Interconnected castle, ability gates                      | Castlevania: SotN, 1997  |
| Equipment instead of levels, finite +N upgrades           | Salt and Sanctuary, 2016 |
| Hand-drawn gothic 2D, readable telegraphs                 | Blasphemous, 2019        |
| Relics that change how you play                           | Hollow Knight, 2017      |

That's not a criticism of taste — it's a criticism of *positioning*. The document's  
own framing is "moving away from a traditional action RPG toward something more  
deliberate", but the replacement it proposes is the most crowded shelf in indie  
games. Meanwhile the one thing a solo first-time developer cannot win on is  
execution quality: you cannot out-polish a studio that has five animators.

So the question I'd want answered before Milestone 001 is not "which engine" —  
you got that right, see §2 — but:

> **What is the sentence a player repeats to a friend?**

Hollow Knight: *"the map is a character."* Blasphemous: *"look at it."* Hades:  
*"death is the story."* If NIGHTFALL's sentence is currently *"it's a Soulsvania,  
but well made"*, that sentence cannot survive contact with the App Store, because  
there are forty games with the same sentence and better screenshots.

This is the exact question my own project had to answer, and it's why it looks the  
way it does: one mechanic — *every photograph is a 2D-brane; this world was  
photographed once* — and then physics, key layout, HUD, level design all exist to  
serve that one sentence. The combat is Castlevania-derived because the mechanic  
demands a specific, readable, committed moveset, not because I like Castlevania.

**If NIGHTFALL doesn't have its sentence yet, I'd spend a week on that before  
writing the FSM.** It retro-decides the combat verbs, the art direction, and the scope,  
and it's much cheaper to change now than at Milestone 010.

---

## 2. What I would keep exactly as written

Not politeness — these are the parts I'd defend in a meeting:

- **Godot 4 + GDScript.** Correct for this game and for this developer. GDScript's  
  hot-reload and `@export`-driven tuning is worth more here than C# performance.
- **"A sequence of small working systems, not one enormous game."** This is the single  
  most useful line in the document.
- **Components + `Resource`-driven weapon data.** Right call, and it's the difference  
  between adding a weapon in 2 hours and in 2 days.
- **"One enemy with three readable attacks beats ten enemies with simple behaviour."**  
  Rare and correct. Most first projects die the other way.
- **Animation-event-driven hitboxes** instead of a permanently active Area2D. Also correct,  
  and it's an architectural decision that's painful to retrofit.
- **Finite weapon upgrade paths.** Correct, and it removes an entire balance treadmill.

---

## 3. Your movement table is missing the only unit that matters

The parameters in §3.3 are plausible round numbers. They are also, as specified,  
not testable, because **the character's on-screen height is never stated** — and  
without it, every number in that table is meaningless.

Movement is read by players in *body heights per second*, not pixels per second.  
Normalised, here's the difference between "plausible" and "measured":

|                 | NIGHTFALL v0.2                     | AoS (values pulled from the decompilation, one per source line) | Our build                       |
| --------------- | ---------------------------------- | --------------------------------------------------------------- | ------------------------------- |
| Walk / run      | 130 / 190 px/s                     | 1.25 px/frame ≈ 225 px/s at our 3× scale                        | 225 px/s                        |
| Gravity         | 1,000 px/s²                        | 2,362 px/s²                                                     | 2,362                           |
| Jump impulse    | −360 px/s                          | 979 px/s (FIX(−5.4375))                                         | 961 → real peak 203 px          |
| **Jump apex**   | **64.8 px** (= v²/2g)              | **203 px**                                                      | 203 px = **2.03 body heights**  |
| **Airtime**     | **0.72 s**                         | 0.98 s                                                          | **983 ms**                      |
| Ground friction | 1,600 px/s² → stop in 0.081 s      | 1,350 px/s² → stop in 0.10 s                                    | stop = 200 ms, 20.6 px slide    |
| Dodge           | 0.35 s, **distance not specified** | n/a (backstep: 90 px / 0.2 s)                                   | 90 px / 0.2 s + 0.12 s i-frames |

Now do the arithmetic on your own jump. 64.8 px apex. If your knight is 180 px tall  
on 720p, that's **0.36 body heights** — a hop over a curb. If you want the jump to  
read as 1.5 body heights, the character has to be **43 px tall**, i.e. shorter than  
one tile. Something in that table is off by a factor of 3–4, and it will not be  
obvious until the walk animation is in, at which point you'll re-tune everything  
downstream of it (level geometry, enemy reach, camera).

And note the compound oddity: 64.8 px of height with 0.72 s of airtime is *floatier  
per pixel* than AoS's 203 px in 0.98 s. So it will read as "moon gravity on a small  
hop" — slow and weak simultaneously, which is the one combination no animation  
polish can rescue.

**Concretely, I'd rewrite §3.3 as ratio targets with assertions:**

```
jump apex      = 1.5–2.0 × character height   (our measured reference: 2.03)
airtime        = 0.85–1.0 s
walk           = 2.0–2.4 body-heights / s
dodge distance = 0.7–0.9 × character height, i-frames over the first 60% of it
turn-around    = N frames, stated explicitly (ours: 1 frame, and only because
                 AoS resets speed every frame — that's a design choice, not a default)
```

Then write these as a headless test that runs on every build. I have four such  
suites now (60 logic + 19 keymap + 10 pixel + 12 stress assertions). The pixel suite  
exists because logic tests passed for two weeks while the attack hitbox was 10 px  
above every enemy's hurtbox — the animation played, the sound played, nothing died.

---

## 4. Your light attack is a heavy attack, and that breaks the risk/reward of dodging

§4.3: startup 0.22 / active 0.12 / recovery 0.38 = **0.72 s of commitment** for a  
light attack with a longsword. Compare §3.3: dodge = **0.35 s**.

That ratio is the problem. If attacking costs twice the commitment of dodging,  
then **dodging is strictly dominant** — the correct play against any enemy is to  
never press attack. Players find this out in about four minutes, and then your  
combat system is a dodge-roll simulator with a sword-shaped ornament.

For scale: 0.22 s of startup is 13 frames of *your own* telegraph. Enemies in this  
genre become readable at 8–12 frames. You're asking the player to commit more  
readably than the thing they're reading.

Suggested split to start from (then tune against animation, not against the table):

| Attack | Startup | Active | Recovery | Total      |
| ------ | ------- | ------ | -------- | ---------- |
| Light  | 0.11 s  | 0.09 s | 0.24 s   | **0.44 s** |
| Heavy  | 0.28 s  | 0.10 s | 0.40 s   | 0.78 s     |

Rule of thumb I'd write into the design doc: **light attack commitment ≤ 1.3 ×  
dodge duration.** Heavy attacks are allowed to exceed it — that's what makes them  
a decision.

---

## 5. Art is the bottleneck, and the schedule doesn't contain any art

Count your own §6.1 table for the player alone: idle 6–8, walk 8, run 8, jump 4–6,  
fall 3–4, light 6–8, heavy 8–10, dodge 6–8, hurt 3–4, death 8–12 = **60–76 frames**.  
Add one more weapon family, two enemies, one two-phase boss, and two NPCs, and a  
conservative total is **350–500 hand-drawn frames**.

At HD hand-drawn quality (say 2–4 h per frame including cleanup and colour, which is  
optimistic for a first-timer), that's **700–2,000 hours**. Your §9 schedule budgets  
**120–180 hours total** for 12 weeks at 10–15 h/week.

The schedule has zero art weeks in weeks 1–10 and then expects, in weeks 11–12, a  
village, two NPCs, a boss, *and* mobile controls. That's not a schedule, it's a wish.

Also the hidden cost nobody puts in the table: at 1080p, each frame is a ~500×600 PNG.  
Re-timing one attack (which you will do constantly in weeks 5–8) means redrawing  
2–4 frames, because the pose was drawn for a different duration. **Frame-by-frame  
hand-drawn HD is the least iteration-friendly format that exists**, and iteration is  
the entire activity of a prototype.

Three honest options, in order of how much I'd recommend them:

1. **Hybrid:** hand-drawn *key poses* (5–7 per action), rigged with cutout/deform  
   in Godot (`Skeleton2D` or `Bone2D`), with hand-drawn in-betweens only on the  
   attacks that matter. Keeps the drawn look, cuts frame count ~60%, and lets you  
   re-time without redrawing.
2. **Shrink the game instead of the art.** One area, one enemy, one boss, 40 minutes,  
   $3. If the sentence from §1 is strong enough, that ships and sells; if it isn't,  
   the 12-week version wouldn't have either.
3. **Hire one animator for the player's core 40 frames.** This is the only item in  
   your budget I'd move money toward.

Also missing entirely from a "gothic atmosphere" plan: **audio.** One line in the  
tools table (Audacity) and nothing else. For this genre, music and ambient sound  
carry more identity per hour of work than any single system in the document.

---

## 6. The milestone order tells you whether it's fun at week 8, which is too late

Steps 1–17 are ordered by *dependency*, which is correct engineering and wrong  
production. The player learns whether the combat is fun at **step 12**, roughly  
week 8, 60–120 hours in — and by then the FSM, the stamina system and the attack  
architecture all assume the answer is yes.

I'd insert a throwaway gate at week 2:

> Grey boxes, no art, no camera polish, no menus, no save system. One player, one  
> enemy, one attack, one dodge, hit-stop and screen shake. Play the same 30 seconds  
> fifty times. Then ask: do I want to press it again?


If the answer is no, you've spent 15 hours instead of 120, and the fix is in the  
numbers (§3, §4), not in the architecture. This is the single change I'd make to  
the document's ordering. It is also the mistake I made: my loop was "done" and  
"tested" for two weeks while the whole combat system couldn't deal damage.

---

## 7. On mobile, the control scheme is a design input — not step 17

§8 puts mobile controls at step 17 of 17. §11 lists "mobile controls feel awkward"  
as a risk, mitigated by "test on an actual phone early". But by step 17 the combat  
system is finished, and this is a *design* constraint that invalidates finished work.

Count the verbs in v0.2: move, jump, light attack, heavy attack, charged attack,  
dodge, block, parry (mentioned as "later"), interact, heal, menu. That's 9–11 inputs.  
A right thumb has one anchor point and can reliably own **three** buttons, four if  
two of them are adjacent and low-frequency.

Every precise 2D Soulslike that has shipped on touch either cut verbs or made them  
directional. So the question isn't "how do we fit six buttons" — it's:

> **Which two verbs survive the phone?**

Because whichever two survive become the game's combat identity. If block doesn't  
survive, you don't have a Soulslike, you have a dodge game — and that's a perfectly  
good game, but it must be designed as one, not discovered at step 17.

Practically: build the touch layout **before** the attack system, in the same week  
as the combat toy, and test with a real thumb on a real phone. On our 6-verb desktop  
layout we still ended up having to exile a system button to a screen corner because  
the thumb kept clipping it, and our automated test for that is pure geometry —  
every button's rect vs every other button's rect, minimum edge 44 px.

Two related questions I'd want answered in the document: **maximum simultaneous  
touch points** you're designing for (2? 3?), and **Android-first** — is that a hard  
constraint? Premium + Android + solo first-timer + no marketing is the hardest  
possible combination; iOS pays for premium substantially better, which is why we  
chose iOS-first with mainland China in scope.

---

## 8. "No XP" creates a problem the document doesn't solve: the stuck player

Removing levels is a good decision. It also removes the only self-service difficulty  
valve the genre has: a player who can't beat a boss can grind three levels and come  
back. Without it, you need a designed alternative, and v0.2 doesn't name one.

Options, all of which are cheaper than they look: farmable upgrade materials,  
optional abilities hidden in optional areas (already in your plan — good), explicit  
boss weaknesses (fire vs. the Hollow Knight's shadow phase), or a plain assist mode.  
Pick one on purpose.

One more: §1 lists "weapon-specific mastery" as a progression axis. **That is XP  
under a different name** unless it's purely ability unlocks with no numeric gain.  
Worth being explicit, because if mastery has numbers, you have levels, and the  
"no traditional leveling" promise in the pitch is misleading — which is the kind of  
thing reviewers find in the first hour.

---

## 9. The bonfire loop assumes a session length phones don't have

"Blood Altars restore resources and recover defeated enemies" is the exact Dark  
Souls loop, and it's designed around 20–40 minute sessions with a controller.

On a phone: sessions are 3–10 minutes, interrupted constantly, and the single most  
frustrating thing a mobile player can experience is **re-clearing trash to get back  
to the boss**. This is where mobile Soulslikes get review-bombed, not on difficulty.

The number to design against isn't difficulty, it's **death → control latency**.  
Target: under 10 seconds from dying in a boss room to being back in the fight.  
That usually means a boss-door checkpoint and enemy respawn only on *manual* rest,  
not on death.

---

## 10. Three config items to fix in five minutes

1. **`Renderer: Forward+` is the wrong default for 2D on Android.** Godot 4's  
   Forward+ is the desktop renderer. Use **Mobile**, or **Compatibility (GLES3)**  
   if you want low-end Android coverage and/or a web build for playtesting links.  
   This is a one-line change now and a painful migration later.
2. **Dodge distance is missing.** A duration without a speed is not a spec. Write it  
   as px, plus the i-frame window as `[start_ms, end_ms]`. Our backstep is 90 px over  
   0.2 s with i-frames for the first 0.12 s — and the number that took the longest to  
   get right was not the distance, it was *when the i-frames end*.
3. **`move_and_slide()` will fight you on one-way platforms.** It's fine for week 3.  
   But for frame-precise ledge work you'll want `move_and_collide()` with manual  
   resolution, and either way you must set `up_direction`, `floor_snap_length`,  
   `floor_max_angle` and per-shape `one_way_collision` explicitly.  
   Also `if not is_on_floor(): velocity.y += gravity * delta` gives you one frame of  
   zero gravity when stepping off a ledge, and there's no max-fall clamp — add both.

---

## 11. What we can hand you, concretely

GDScript can't import JavaScript, but the parts that matter port 1:1:

- **The measured physics table** (§3) with a source line for every value — walk speed,  
  friction, gravity, jump impulse, apex-gravity window, cut-off velocity, hitstun frames.
- **A 9-step main-loop ordering** taken from a decompiled Castlevania, including the  
  three counter-intuitive bits: animation advances *before* physics; state functions  
  only write velocity and never position; hit detection happens *before* the state  
  dispatch, so a hit interrupts anything.
- **An input tri-state model** (held / pressed / tapped-this-frame) — the distinction  
  that makes "hold jump to jump higher" and "tap to attack" coexist without  
  double-firing. Getting this wrong is what made our jump not work at all for a day.
- **The test discipline**: assertion suites that check pixels and physical outcomes,  
  not just state transitions.

**Offer:** I can build you a Godot 4 `CharacterBody2D` + FSM skeleton with those  
constants and a headless test that asserts jump apex, airtime, stop distance and  
turn frames. That de-risks weeks 3–4, which are the two highest-risk weeks in your  
schedule, and it costs me less time than writing this document did.

---

## 12. Questions I'd want answered before Milestone 001

1. What is the one-sentence hook? (Not the pitch — the thing a player says to a friend.)
2. How tall is the knight on screen, in pixels at the logical resolution? Every number  
   in §3.3 depends on it.
3. Are the §3.3 values measured from a reference game, or chosen because they look  
   reasonable? If measured, from what?
4. Is the art pipeline frame-by-frame HD, or keyframe + rig? What's the hour budget  
   per frame, and who draws frame 400?
5. How many simultaneous touch inputs, and which two verbs survive on the phone?
6. With no XP: what does a stuck player do? And is "weapon mastery" numeric?
7. What's the target death→retry latency in a boss room?
8. Is Android-first a hard constraint, or a default that can be revisited?

---

## Closing

"Don't start by building the castle, start by making the knight feel incredible"  
is the right instruction and I'd keep it verbatim.

The sentence I'd add to it:

> **Don't start by building the combat system either. Start by building the 30  
> seconds you want to play 500 times — and then check whether those 30 seconds are  
> still interesting when you can't dodge.**
