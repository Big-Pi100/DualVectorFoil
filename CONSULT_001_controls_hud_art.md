# Consultation 001 — Controls, HUD, Art Direction, and Implementation

> Written for an external design / art consultant.
> Every item is phrased so it can be answered with **one line**: reply `A / B / C`, or a single judgement. No proposal needed.
> Everything described as "current" is measured from the build, not intended design.

---

## 0. The situation in three minutes

**Product:** *SoulKeep*, a side-scrolling action game. Single-file HTML, pure 2D Canvas, no engine.
**Hook:** the protagonist is a **photograph that has been taken** — and the player can upload their own photo to replace the protagonist with it.
**New mechanic under test:** the protagonist can **flatten himself into a sheet of paper** and squeeze through a 2px seam in a wall.

**Technical facts** (these constraints determine whether your advice is buildable):

| Item | Current state |
|---|---|
| Rendering | One `<canvas>`. Logical resolution ~890×480, scaled to the window. |
| Terrain | **Drawn in code.** Each brick's shading comes from a hash function. Not a tilemap. |
| Character | 20-frame sprite atlas (1993×744) produced by a "name card" pipeline; replaceable by a player photo. |
| Enemies, items, lamps, seams, particles | **All drawn in code** (paths + gradients). No textures. |
| Physics | 120Hz fixed timestep. Jump apex 203.8px, identical at 30/60/120/144Hz. |
| Audio | Fully synthesised at runtime. Zero audio files. |
| Shipping form | One HTML file, ~934KB (atlas inlined as base64). |
| Save | localStorage, versioned. |

**Visual pitch in one line:** indigo-black environment; off-white and warm gold for paper and light; stone walls, arched windows, wall lamps, framed photographs (No.07 / 08 / 11 / 12); the enemies are **badly exposed photographs** — crumpled paper with folds and tears, and paper bats.

**Screenshot index** (`shots/`):

| File | Contents |
|---|---|
| `01_hall.png` / `probe_13_real.png` | The corridor, the main combat room |
| `flat_01_room.png` | Entrance to the experiment room: lamp, seam, enemies |
| `flat_06_gate_blocked.png` | The mandatory wall — player stopped, seam visible in the wall |
| `flat_07_gate_through.png` | Same wall, player now on the far side (the body is 6px wide) |
| `flat_zoom_inside.png` / `flat_zoom_static.png` | 1:1 crops: the flattened body vs. the seam in the wall |
| `hud_legend_full.png` | Full HUD: three bars top-left, soul slots top-right, minimap bottom-right, log bottom-left, key legend bottom-right |
| `legend_1280.png` | Key legend at 3× |
| `flat_05_mobile.png` | Phone, landscape: virtual stick + seven buttons |

---

## 1. Controls and the on-screen legend (just reworked — needs your confirmation)

### 1.1 What was actually wrong

The bindings have always worked; 23 automated assertions watch them. **What was broken was the legend: it described two-thirds of the scheme.**

- `W A S D` was collapsed into one phrase — "move · crouch · look up" — so the player could not tell which key did which.
- **Two combo moves were not mentioned at all:** slide = `down + jump`, drop-through = `down + attack`.
- With the blue soul slot empty, `L` does **nothing**, yet the legend stated "blue soul" as if it worked.

The result was "the manual and the controls disagree, so I can't test it." **The controls were never broken; the manual was — but to a player those are the same bug.**

### 1.2 What it does now

Key-to-action mapping lives in **one table**. The legend line is generated from that table (including the letters, so a letter cannot be printed wrong), and a new 26-assertion suite **reads the legend out of the live DOM** and then presses those keys to verify each claim:

- a legend entry that does nothing → test fails
- a working key missing from the legend → test fails
- changing a binding without updating the table → letters disagree → test fails

Current table (the on-screen legend is a rendering of it):

| Hand | Keys | Action | Precondition |
|---|---|---|---|
| Left | A / D | Move | |
| Left | W | Look up (camera tilts up to see above) | |
| Left | S | Crouch | |
| Left | S + K | **Slide** | on the ground |
| Left | S + J | **Drop through** (fall through a thin ledge) | standing on a thin ledge |
| Right | J | Attack | |
| Right | U | Red soul (fireball) | red soul equipped; greyed out when not |
| Right | K | Jump | |
| Right | I | Backdash (retreat with invulnerability frames) | on the ground |
| Right | L | Blue soul (hold to glide) | blue soul equipped; greyed out when not |
| Right | O | Soul box (menu) | |
| Right | F | Paper (hold = flatten sideways) | has ink; not while hurt / sliding / dashing / attacking |

Alias line: arrows = WASD · Space = jump · Tab = soul box · R twice = restart · M = mute.

### 1.3 Judgements I need from you

**Q1. Is the finger grouping legible?**
The scheme is "one finger, one semantic family": index J/U = strike, middle K/I = displacement (jump / backdash), ring L/O = state (held ability / system menu). Can a player feel that logic, or should the layout be re-sorted by **frequency of use** instead?

**Q2. Keep the combo moves?**
Slide (`down + jump`) and drop-through (`down + attack`) are lifted from *Symphony of the Night*. Upside: saves keys, and the "old game" feel. Downside: **undiscoverable without a manual**, and on a phone it needs two thumbs at once.
Options: **A** keep combos, document them properly ／ **B** split into standalone keys (more keys, but discoverable) ／ **C** keep combos but retrigger slide with something intuitive, e.g. "jump while running".

**Q3. Should the legend be permanent?**
It now sits in three lines at bottom-right, over the brick floor. It solved "can't test it", but it is the **fifth information block on screen** (three bars top-left, soul slots top-right, minimap bottom-right, log bottom-left).
Options: **A** permanent but dimmer ／ **B** four high-frequency keys on the main screen, full table inside the soul box (pause) ／ **C** show for 10s at start, then fade; recall with a key.

**Q4. Is greying out an unavailable soul enough?**
Or should the entry be **hidden** instead? (Greyed says "later". Hidden says "everything you see is real right now".)

**Q5. Keep the Space = jump alias?**
It appears in no marketing copy; it is just convention. Keeping it is convenient, but it makes the "WASD left hand / JKL right hand" split unnecessary. Removing it is purer.

---

## 2. HUD design

**Q6. All five corners are occupied. Which one goes?**
Top-left: HP / MP / ink bars + room name. Top-right: three soul slots + collect counter "1/5". Bottom-right: minimap (150×120). Bottom-left: three-line log. Bottom-right: key legend.
My own read is that **the log should go** — but the log carries the narration ("this photograph is one you took"), and cutting it cuts the narration. Your call?

**Q7. Where does the ink bar belong?**
Ink is the fuel for flattening (100 points, 26/sec, refilled only by lamps). It currently **appears only in rooms that contain a lamp** (as a third bar), so the whole left block shifts when it appears and disappears.
Options: **A** always present as the third bar (full, even in empty rooms) ／ **B** only present when relevant, but **reserve the space** (no shift) ／ **C** not a bar at all — express it on the character (thinner = brighter, etc.).

**Q8. The soul slots are wasteful.**
Three slots top-right take real estate; most of the time the content is "fire soul / empty / empty".
Options: **A** keep three (configure at a glance) ／ **B** show only the equipped red and blue soul (the yellow soul is a permanent passive and needn't hold a slot) ／ **C** collapse to one icon, expand on demand.

**Q9. "1/5" of what?**
It is a bare number with no unit and no icon. Should it read "souls 1/5", or move into the soul box entirely?

**Q10. Keep the minimap?**
A room is 32×18 tiles and fits on one screen. The map draws only an outline plus a few dots — very low information. Removing it frees the bottom-right corner for the legend.

**Q11. Type size.**
Body text is 11px Chinese (= 22 device pixels at 2× DPR). Legend 11px, precondition notes 9px. Small on a 1080p display. Bump everything 1–2px at the cost of a wider legend?

---

## 3. Art direction

**Q12. The flattened body is 6px wide. How do we keep it reading as a person?**
Currently it is **the same sprite squashed horizontally to 6px** (vertically untouched, so the hair / coat / trousers colour banding survives), plus a breathing glow, a lit edge on one side, and a contact shadow.
At 1:1 (`flat_zoom_inside.png`) it reads as a person. At full-screen it is a warm vertical line. Is there a better approach — silhouette plus a single specular edge? Or accept "a line" and carry the meaning with **motion smear**?

**Q13. How do we separate the person from the wall seam once and for all?**
Both are thin vertical strips. This is the largest readability risk right now. My current fix is "person warm (gold), seam cold (ink), person has internal value steps". A more radical answer is a **colour law**: environment always cold (indigo / ink green), characters and light always warm (off-white / gold), never mixed. Would you endorse a law that strict? It constrains every future room.

**Q14. What should the lamp be?**
Right now it is a modern floor-lamp silhouette (triangular shade, thin pole, warm halo). It reads well and the light source is unambiguous, but it does not belong to a paper world. Swap for a **paper lantern / origami lamp**? Cost: a more complex silhouette, weaker first-glance "this is the light source".

**Q15. Should enemies have expressions?**
The crumpled-paper enemies have brush-drawn brows (two thin strokes, with a tear as the mouth) and read emotionally at a glance. But how explicit should "a badly exposed photograph" be? Stronger expression → cartoon monster. Weaker → set dressing. Which side?

**Q16. The arched windows are empty.**
The background is a large dark-indigo arch with almost no information; it only says "this is not sky". Add a layer of "photo wall / filing cabinet" texture for narrative, or keep it empty and leave all attention to the foreground?

**Q17. Typeface.**
Currently system sans-serif with wide letter-spacing, aiming at an "archive" feel. Should we commit to a monospace / typewriter face? (Readily available Chinese monospace faces are few — that is a real constraint.)

---

## 4. Implementation (this decides whether advice is buildable)

**Q18. Terrain: code-drawn vs. tileset.**
Every brick's shading is hashed, which buys arbitrary sizes, no seams, and levels edited as plain characters. It costs **hand-crafted texture** — there is no way to say "this particular brick is special". Moving to a tileset lets an artist in, but level editing, collision, and hidden walls all get rebuilt. Worth it?

**Q19. Character and enemies use two different drawing methods.**
The character is a sprite atlas (20 frames, photo-replaceable); enemies are code-drawn paths. They coexist, and the seam shows. Should enemies get atlases too? (Cost: 4–8 frames each, and each must survive being "photo-ified".)

**Q20. The photo hook is the selling point — does it survive flattening?**
The player uploads a photo and the character becomes that photo. But **flattening compresses the body to 6px** — a photograph at 6px is a colour band; the face is gone.
This is a direct collision between the mechanic and the hook. Is there a way to keep the photo recognisable while flattened — e.g. preserve a small unflattened "face" window? Or accept that you cannot see yourself while flattened?

**Q21. Should the 934KB single file be split?**
Everything is inlined in one HTML (double-click to play, easy to pass around). Splitting buys caching and lazy loading at the cost of a real deploy step. In your experience, is that worth it at this size?

---

## 5. Three decisions this experiment needs from you

(Background: the goal is to establish whether "flatten" deserves to exist. Criteria — can a first-time player find it unprompted; do they **voluntarily** reuse it after the mandatory seam; is it a tactical choice rather than a free invulnerability window.)

**Q22. There is nothing worth flattening for on the far side of the wall.**
Room structure: entrance → optional alcove (contains an ink vial) → mandatory wall (passable only by flattening) → exit. Beyond the wall is a dead end with one lamp.
So "voluntary reuse after the gate" is **structurally always zero** — not a sign that players didn't want to use it. Do we add an optional incentive past the wall (a second alcove / a soul only reachable while flat), or accept that this criterion must wait for the next build?

**Q23. The alcove pillar is 192px tall; a single jump reaches 203.8px.**
That is 11.8px of margin. The intent is "you can jump it, so the alcove is optional" — but it will very likely read as "you can't get up there", so the **first flatten happens at the alcove instead of at the mandatory wall**, and the "first use" measurement no longer measures the introduction. Drop the pillar one tile (144px, comfortably jumpable)?

**Q24. Ink lasts 3.8 seconds.**
100 points at 26/sec. The number was guessed; there is no basis for it. It decides whether flattening is a **short tactical action** or **a form you can explore in**. Which way do you want it to lean?

---

## 6. What I do not need

- General "could be more polished / more atmospheric" — please point at a specific element.
- Anything requiring an engine, shaders, or 3D (the product constraint is single-file 2D Canvas).
- A full UI redesign proposal. I need decisions at the level of "delete this block / merge these two / move that".

## 7. Cheapest way to reply

One line per number is enough:

```
Q3  B
Q6  cut the log; move the narration to a one-time intro
Q12 accept the line, add a motion smear
```

Write "skip" for anything you don't want to rule on. I won't follow up.
