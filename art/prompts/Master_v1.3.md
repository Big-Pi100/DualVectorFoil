# DUAL VECTOR FOIL — OFFICIAL ART STYLE PROMPT v1.3

> 用途：《二向箔》(Dual Vector Foil) 所有游戏美术资产的**固定前缀**。生成任一资产时，将本文件全文置于资产专属描述之前。
> 参考图：`art/reference/character_style_sheet.jpg`（唯一视觉基准）。
> 版本说明：风格本体逐字继承 v1.1（用户确认，不得改写）；v1.3 将正式前缀改为 `DUAL VECTOR FOIL`，追加洋红/青技术附加段与边缘污染约束。
> 命名纪律：旧代号 SoulKeep 仅用于历史兼容记录，不得作为当前项目名或正式 Prompt 前缀。

---

## Style identity

Create original 2D game artwork for **Dual Vector Foil (《二向箔》)** in the established visual style:

**Childlike Wax Crayon Doodle Illustration.**

The artwork should look like a charming, expressive drawing made by a child using real wax crayons on textured off-white drawing paper.

It combines innocent childlike character design with rich, visible wax-crayon drawing texture.

The result must feel handmade, tactile, warm, playful, and imperfect — not like a polished digital cartoon with a crayon filter applied afterward.

**CRITICAL: The wax-crayon texture is not noise sprinkled on afterwards — it is the very drawing process that constructs the form and color. Do NOT simplify into flat cartoon shapes or replace with generic children's illustration style.**

## 1. Drawing medium and pigment

- Use dense, layered wax-crayon strokes to construct colored shapes.
- Make individual strokes visible, irregular, and naturally overlapping.
- Use short directional strokes that follow the shape and volume of the object.
- Allow uneven pigment coverage, small paper-colored gaps, and overlapping color deposits.
- Create a tactile waxy appearance through layered marks rather than blur or digital noise.
- Let different colors overlap naturally while retaining clear color identity.
- Keep the paper texture visible in both colored and uncolored areas.

## 2. Outlines and sketching

- Use expressive, irregular, hand-drawn outlines.
- Prefer dark warm brown or other suitable dark natural crayon colors.
- Allow outlines to have variable thickness, repeated strokes, slight gaps, and imperfect joins.
- Use loose sketch marks to define hair, fur, fabric, grass, and other organic forms.
- Avoid perfectly smooth vector contours and uniform digital strokes.

## 3. Character design

- Use childlike proportions: relatively large heads, compact bodies, and simplified limbs.
- Keep silhouettes clear and recognizable.
- Use playful, slightly exaggerated anatomy without losing structural readability.
- Faces should have simple, clear, expressive features.
- Hair should be drawn with many irregular, directional crayon strokes.
- Clothing and accessories should have recognizable shapes and visible hand-colored texture.
- Maintain consistent character proportions, clothing, facial features, and accessories across all views and animation frames.

## 4. Color language

- Use bright, cheerful, warm, lively colors.
- Favor natural combinations of warm browns, reds, blues, yellows, greens, and cream tones.
- Use layered crayon pigment rather than perfectly flat digital fills.
- Allow small variations in pigment density and color within the same region.
- Keep important gameplay elements visually distinct.

## 5. Paper surface

- Use a warm off-white or cream drawing-paper base when a paper background is appropriate.
- Include subtle, visible paper fibers and embossed paper grain.
- The texture should feel physical and consistent, not like random digital static.
- For transparent game assets, preserve the crayon strokes and pigment texture inside the artwork while keeping the surrounding background transparent.
- Any paper-white gap inside the subject must be painted cream/off-white pigment, NOT exposed background. Do not render gaps as holes that reveal the extraction color.

## 6. Asset-specific clarity

- Characters must remain recognizable at small gameplay sizes.
- Enemies need distinct silhouettes and readable attack poses.
- Terrain must clearly communicate solid surfaces, edges, and collision boundaries.
- Collectibles and interactive objects need immediately recognizable shapes.
- Effects must communicate direction, impact, and timing without obscuring gameplay.
- UI illustrations must preserve legibility and must not let texture interfere with text or icons.

## 7. Overall artistic character

The entire game should look like different drawings from the same child's imaginative crayon sketchbook.

Every asset must share the same wax-crayon material, hand-drawn line quality, imperfect coloring, paper-based artistic character, and playful visual personality.

Preserve the reference image's distinctive handmade appearance.

---

## 8. 技术附加段（按用途二选一，追加在资产专属描述之后）

> 🔴 洋红底色与青色分隔线是生成/抠图的临时技术辅助色，**不是美术配色**。主角红色围巾、粉色脸颊与洋红相邻色相，抠图须防误删——详见 `ART_GUIDE.md` 第 9.6 节。

### 独立资产（默认，主角一律用此项）

```text
BACKGROUND AND EXTRACTION:
Use a perfectly uniform solid magenta background (#FF00FF, RGB 255, 0, 255).
No paper texture, gradient, shadow, vignette, particles, or decoration in the background.
Keep all crayon pigment, rough outlines, and texture contained within the asset.
Leave clear empty margin around the complete subject.
Do not let the subject touch the canvas edges.
The magenta background is a temporary extraction color, not part of the artwork.
```

### 多单元格资产（仅同类动作帧/同规格道具；不得用于主角）

```text
CELL SEPARATORS:
Arrange each requested asset/action in its own clearly separated rectangular cell.
Draw straight, continuous technical separator lines only in the empty gutters between cells.
Use cyan (#00FFFF) as a temporary separator marker, not as part of the artwork.
Never draw separator lines through, around, or touching any subject.
Keep consistent cell dimensions, alignment, and generous margins.
Do not add labels, numbers, titles, decorative frames, or extra assets.
All separator lines are temporary production marks and must be removed during extraction.
```

---

## 资产专属补充（写在固定前缀之后）

按 `ART_GUIDE.md` 第 2.3 节选择对应的笔触密度与细节重点：主角 / 敌人 / 地形 / 背景 / 道具 / 特效 / UI。
若生成主角，必须追加 `ART_GUIDE.md` 第 1.3 节的六项外观锁定与「不增加纸片变身形态」约束，并使用**独立资产**技术附加段（禁止多格）。
