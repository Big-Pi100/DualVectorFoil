"""风格锚点 —— 全项目提示词的唯一真源（2026-11-26 建，同日两次实测后收紧）。

这份文件的规矩，每一条都是踩出来的
------------------------------------
1. **五层常量 + 两个几何槽位 + 底色**。层与层职责不重叠：
   画风层管"用什么笔"，几何层管"从哪个角度看、地上有没有影子"。
   第一版把 `orthographic front view` 塞进画风句，结果石头被画成立体方块。

2. **总长度必须压在 ~2000 字符**（不含 subject）。
   实测：3844 字符那版，subject 里的 "Exactly TWELVE" 和末尾复述都没生效，出了 13 块、
   还是 3D 方块。1900 字符那版（`ART_PIPELINE §4.5.2`）一次就成。
   **提示词不是越详细越好，越长 subject 越弱。**

3. **否定要少，且只否"风格"，不否"几何"**。
   写 "NO top face, NO side face, NO thickness, NO box, NO cube"（6 个否定）那版，
   石头比不加约束时更立体 —— 模型把被否定的名词当特征提取。
   几何靠**正向类比**（剪纸/立面图），风格靠 L5 那一条清单。

4. **色板是上限，不是清单**。
   写成 "Palette strictly this twelve-crayon box" 时，模型理解为"12 色都要用"，
   石头出了红砖蓝砖绿砖。必须加一句"只用上面点名的少数几色"。

5. **底色是工序参数，不是画风层**。把 "on cream paper" 写进画风句，
   等于让洋红键失效。依据 `STYLE_LOCK.md §L3.5`：白 T 与米纸底 G 通道差 27，洋红差 247。

6. **`draft` 调只能用于画里没有成品主角的背景板**。风格参考图里有主角，
   套了 draft 就出现"比站在它前面的角色更草"——但主角就在画面里。

用法
----
    from style_anchor import compose, PROFILE
    prompt = compose(SUBJECT, **PROFILE["tile"])

    python art/prompts/style_anchor.py --check     # 与 sprite_template.txt 对账
    python art/prompts/style_anchor.py --show tile # 打印某个 profile 的完整锚点
    python art/prompts/style_anchor.py --budget    # 检查长度是否超标
"""
from __future__ import annotations

import argparse
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
TEMPLATE = HERE / "sprite_template.txt"

# 锚点（不含 subject）的经验上限。
# 依据：唯一成功过的那版是 1900 字符（`ART_PIPELINE §4.5.2`），
# 唯一明确的失败是 3844 字符（subject 被淹没，数量约束失效）。
# 取 1900 × 1.15 ≈ 2200 作为上限 —— 这是估计值，不是实验结论。
# 真要卡死，得做一组 1900/2600/3400 的对照出图，现在没做。
BUDGET = 2200

# ── L1 媒介（常量）────────────────────────────────────────────
# 含 orthographic 那半句：实测把它挪走后，石头全成了 3D 方块。
# 它描述的是"相机机位"，不是"笔"，但和笔一样是全局的，放这里不冲突。
L1_MEDIUM = (
    "2D hand-drawn crayon illustration, children's picture book. Flat 2D graphic art, "
    "orthographic front view, no perspective, no vanishing point. Real wax crayon, every "
    "mark made by a hand holding one."
)

# ── L2 笔触（常量）────────────────────────────────────────────
L2_STROKE = (
    "Visible waxy crayon strokes, the paper's tooth showing through, wax skipping the grain "
    "instead of flooding it. Fill built from overlapping short strokes. Outlines gentle, "
    "irregular, about 3px, wobbly, slightly broken, no smooth vector curves."
)

# grain 槽位：一改就变样的一句
GRAIN = {
    # 要抠图的资产（角色 / 瓦片 / 敌人 / 道具）
    # 颗粒只许在轮廓内侧：边缘长毛会让连通域把相邻块粘成一团。
    "inner": (
        "Grain and wax texture stay inside each shape; every outline is one clean closing "
        "contour so the shape can be cut out with a key. No speckles drifting outside."
    ),
    # 整幅使用的背景
    "full": (
        "Grain and wax texture run across the whole sheet, empty areas included. Strokes "
        "may overshoot and leave crumbs; it reads as one physical drawing."
    ),
}

# ── L3 可读性（常量）───────────────────────────────────────────
L3_READ = (
    "Readable silhouette first: at a glance you can tell what each thing is and where its "
    "edge is. No clutter competing with the shape."
)

# ── L3.5 朝向（几何层）────────────────────────────────────────
# 正向类比，不列否定。实测否定清单会把物体画得更立体。
ORIENT = {
    # 瓦片 / 正面素材
    "flat": (
        "Each object reads as a flat shape cut from coloured paper and laid on the sheet: "
        "an outline plus the colour inside, the way a paving stone looks in an elevation drawing."
    ),
    # 角色
    "side": (
        "Strict side view, one shoulder, one eye, one readable arm silhouette, no "
        "three-quarter turn, head not turned toward the camera."
    ),
    # 背景
    "room": (
        "A flat room seen straight on, parallel wall and floor lines, no wide-angle "
        "distortion."
    ),
    # 多类物体同框：朝向按各自描述算，不互相传染
    "per_object": (
        "Each object keeps the view angle stated in its own description, and that angle "
        "does not spread to the others."
    ),
}

# ── L3.6 投影（几何层）───────────────────────────────────────
SHADOW = {
    # 素材：投影会被洋红键算成主体，抠完是一圈脏边
    "none": (
        "Each object is pasted flat onto the bare background: its outline meets the "
        "background colour directly all the way around, nothing beneath it."
    ),
    "hatch": (
        "Shadows are made of visible charcoal hatching or a darker crayon layer, never a "
        "soft edge, never a smooth falloff."
    ),
}

# ── L3.7 分离（常量 + 槽位）──────────────────────────────────
SEPARATION = {
    "strict": (
        "Every subject stands completely apart with a wide clean gap of bare background "
        "between; nothing touches, nothing overlaps."
    ),
    "layered": (
        "The foreground must read as nearer than the wall behind it, but with no hard "
        "occlusion edge and no cast shadow: separation comes from drawing density."
    ),
}

# ── L4 色板（常量，语义是"上限"）─────────────────────────────
# "only the few named above" 这句不能删：少了它，模型会把 12 色全用上。
L4_PALETTE = (
    "Only the few colours named above may appear, and all of them belong to this "
    "fixed palette: "
    "cream #E8DCBE, wax white #FBF7EC, charcoal #2B2320, cool grey #8C8B84, "
    "deep blue #1F2E5C, slate blue #4C6E8C, blood red #9B2226, ochre #B98A2E, "
    "umber #6B4B32, skin #D9A16B, moss #4F6B3A, violet black #3B2340. "
    "In-between tones only by overlapping two."
)

MOOD = {
    # 明调。不提"纸"，因为洋红底的 profile 也用它。
    "storybook": (
        "Bright warm daylight: lightest areas left uncoloured so the base shows through, "
        "shadows are thin hatching, never muddy."
    ),
    # 世界调：同一支笔，但明显更草。画里不许有成品主角。
    "draft": (
        "Same crayons, visibly rougher than the finished character who will stand in front: "
        "colour thinner, paper white showing 30 to 50 percent, some areas only outlined."
    ),
}

# ── L5 禁区（常量，只否风格）─────────────────────────────────
L5_NOT = (
    "STRICTLY NOT: 3D render, CGI, photograph, cast shadow, contact shadow, airbrush, "
    "smooth gradient, soft shadow, ambient occlusion, glow, vector-clean linework, "
    "pixel art, dithering, watercolour, oil paint, anime cel shading, text, letters, "
    "numbers, labels, signature, watermark, border, frame."
)

# ── 底色：工序参数，不是画风层 ───────────────────────────────
BED = {
    "magenta": (
        "BACKGROUND: flat solid pure magenta #FF00FF, bright neon magenta, edge to edge, "
        "filling every gap between strokes. NOT mauve, NOT pink, NOT maroon, NOT muted. "
        "No paper, no cream, no white, no texture. No magenta inside the shapes."
    ),
    "cream": (
        "GROUND: warm cream paper #E8DCBE visible across the whole sheet, its tooth and "
        "slight unevenness both visible. No frame drawn around the sheet."
    ),
    "none": "",
}


def compose(subject: str, *, bed: str = "magenta", grain: str = "inner",
            separation: str = "strict", mood: str = "storybook",
            orient: str = "flat", shadow: str = "none",
            extra_not: str = "", tail: str = "") -> str:
    """按固定顺序拼七层 + 底色。subject 是唯一自由撰写的层。

    `tail` 放首尾呼应的可数硬指标（数量、网格）。但注意：锚点超预算时，
    连 tail 也救不了 subject —— 先看 `--budget`。
    """
    for name, table, key in (("bed", BED, bed), ("grain", GRAIN, grain),
                             ("separation", SEPARATION, separation), ("mood", MOOD, mood),
                             ("orient", ORIENT, orient), ("shadow", SHADOW, shadow)):
        if key not in table:
            raise KeyError(f"{name} 没有 {key!r}，可选：{', '.join(table)}")

    parts = [
        subject.strip(),
        L1_MEDIUM, L2_STROKE, GRAIN[grain], L3_READ,
        ORIENT[orient], SHADOW[shadow], SEPARATION[separation],
        L4_PALETTE, MOOD[mood], BED[bed],
        L5_NOT + ((" " + extra_not.strip()) if extra_not.strip() else ""),
        tail.strip(),
    ]
    return "\n\n".join(p for p in parts if p)


# ── 用途 profile：按"这张图里有什么"切，不是按资产名切 ──────
_MAGENTA = dict(bed="magenta", grain="inner", separation="strict",
                mood="storybook", shadow="none")

PROFILE = {
    "sheet": dict(_MAGENTA, orient="side"),      # 角色帧表：侧视
    "tile": dict(_MAGENTA, orient="flat"),       # 瓦片：正面
    "prop": dict(_MAGENTA, orient="flat"),       # 道具 / 敌人 / UI
    # 纯背景板：整幅使用，纸感全开，世界调，可有排线影（画里不许有成品主角）
    "bg": dict(bed="cream", grain="full", separation="layered",
               mood="draft", orient="room", shadow="hatch"),
    # 风格参考图：多类物体同框验"同一支笔"，朝向按物体各自算
    "ref": dict(bed="cream", grain="full", separation="strict",
                mood="storybook", orient="per_object", shadow="none"),
}


# ── 对账：定版模板与本模块必须同源 ──────────────────────────
# sprite_template.txt 是已出 31 帧的实证基线，措辞不许改；
# 但它和锚点必须能对上，否则"同一支笔"只是嘴上说的。
#
# 两组不能混：
#   SHARED      —— 两边都该有
#   ANCHOR_ONLY —— 只该在锚点。模板故意没有纸色（`STYLE_LOCK`：删 cream，
#                  那是纸色不是蜡笔色），拿它去量模板就是量错了尺子。
SHARED_PHRASES = [
    "real wax crayon",
    "wobbly",
    "no smooth vector curves",
    "flat solid pure magenta",
    "#2B2320", "#8C8B84", "#6B4B32", "#D9A16B", "#FBF7EC",
]
ANCHOR_ONLY_PHRASES = ["#E8DCBE"]


def check() -> int:
    if not TEMPLATE.exists():
        print(f"! 找不到 {TEMPLATE}")
        return 1
    text = TEMPLATE.read_text(encoding="utf-8").lower()
    mine = " ".join([L1_MEDIUM, L2_STROKE, GRAIN["inner"], L3_READ, ORIENT["flat"],
                     SHADOW["none"], L4_PALETTE, MOOD["storybook"],
                     BED["magenta"], BED["cream"], L5_NOT]).lower()
    bad = 0
    for ph in SHARED_PHRASES:
        in_tpl, in_anchor = ph.lower() in text, ph.lower() in mine
        if in_tpl and in_anchor:
            print(f"  ✓ 共用  {ph!r}")
            continue
        bad += 1
        where = "、".join(n for n, ok in (("模板缺", in_tpl), ("锚点缺", in_anchor)) if not ok)
        print(f"  ✗ 共用  {ph!r}  {where}")
    for ph in ANCHOR_ONLY_PHRASES:
        ok = ph.lower() in mine
        bad += 0 if ok else 1
        print(f"  {'✓' if ok else '✗'} 仅锚点 {ph!r}")
    print(f"\n{'通过：两边同源' if bad == 0 else f'{bad} 条不同源，先对齐再出图'}")
    return 0 if bad == 0 else 1


def budget() -> int:
    print(f"锚点预算 {BUDGET} 字符（不含 subject）\n")
    worst = 0
    for name, kw in PROFILE.items():
        body = compose("", **kw).strip()
        flag = "✓" if len(body) <= BUDGET else f"✗ 超 {len(body) - BUDGET}"
        worst = max(worst, len(body))
        print(f"  {name:6s} {len(body):5d}  {flag}")
    print(f"\n最长 {worst} / 预算 {BUDGET}")
    print("超预算时先砍 L5 清单与 L4 色表，别砍 subject —— subject 是唯一在说画什么的一层。")
    return 0 if worst <= BUDGET else 1


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="与 sprite_template.txt 对账")
    ap.add_argument("--budget", action="store_true", help="检查锚点长度是否超预算")
    ap.add_argument("--show", choices=list(PROFILE), help="打印某个 profile 的完整锚点")
    a = ap.parse_args()

    if a.check:
        sys.exit(check())
    if a.budget:
        sys.exit(budget())
    if a.show:
        print(compose("<<SUBJECT goes here>>", **PROFILE[a.show]))
        return
    print("L1 媒介\n" + L1_MEDIUM + "\n")
    print("L2 笔触\n" + L2_STROKE + "\n")
    print("L5 禁区\n" + L5_NOT + "\n")
    print("槽位：" + " / ".join(f"{k}={list(v)}" for k, v in
                                (("bed", BED), ("grain", GRAIN), ("orient", ORIENT),
                                 ("shadow", SHADOW), ("separation", SEPARATION),
                                 ("mood", MOOD))))


if __name__ == "__main__":
    main()
