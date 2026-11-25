"""精灵表 prompt 生成器 —— 唯一出图入口。

规矩（白哥 2026-11-25 04:0x 定）：
  1. 骨架逐字取自**旧版**（`/tmp/calls.json` 的 #3 walk / #4 attack / #5 jump），一个字不改；
  2. **只允许**改背景相关句子（洋红 + 绿分割线），因为它们必须与 `build_sheet_magenta.py` 对齐；
  3. 10 个状态共用同一段 LAYOUT / Character / PROPORTIONS / Medium / NOT，**不许逐状态改写**；
  4. 参考图 `art/out/hero_side_idle.png` + `input_fidelity=high` 是**固定参数**，不许省。

用法：
    python art/prompts/sprite_prompt.py            # 列出全部状态
    python art/prompts/sprite_prompt.py walk       # 打印某一个的完整 prompt
    python art/prompts/sprite_prompt.py --diff     # 与旧版逐句对比，验证只改了背景
"""
import argparse
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
TEMPLATE = HERE / "sprite_template.txt"

# ── 地面状态 / 空中状态，唯一允许参数化的一句 ──────────────────
GROUND = {
    "ground": "All {nw} pairs of shoes on exactly the SAME ground line.",
    "ground2": "Both pairs of shoes on exactly the SAME ground line.",
    "air": ("Their vertical positions are uneven as the arc below describes, but every figure "
            "is exactly the same size; the ground contact, if any, is stated in the pose itself."),
}

REF_IMAGE = r"E:\IdentityCard\game-soulkeep\art\out\hero_side_idle.png"
OUT_DIR = r"E:\IdentityCard\game-soulkeep\art\hero\raw"

# ── 10 个状态 ────────────────────────────────────────────────
# 有旧版原文的（walk / attack / jump / fall）直接照抄，不重写措辞。
STATES = {
    "stand": dict(
        n=4, anchor="ground", fps=6,
        title=("A hand-drawn CRAYON idle sprite sheet: ONE horizontal row of EXACTLY {n} "
               "complete figures, the same man standing and breathing in place, four very "
               "slightly different poses. The difference between them must be small but real."),
        header="THE FOUR POSES (the difference is in the chest and the shoulders, not in the legs):",
        poses="""1) SETTLED: weight even on both feet, shoulders slightly low, arms hanging at the sides, standing straight.
2) INHALE: chest lifted a little, chin raised slightly, shoulders up a hair, feet planted exactly as in pose 1.
3) EXHALE: height drops back to pose 1, shoulders settle, the whole body a little softer.
4) HANDS DRIFT: same stance as pose 1, one hand drifting a few pixels away from the hip, the other still.""",
    ),
    "walk": dict(
        n=2, anchor="ground", fps=9,
        title=("A hand-drawn CRAYON walk-cycle sprite sheet: ONE horizontal row of EXACTLY {n} "
               "complete figures, two very different poses of the same walk cycle. The two poses "
               "must look clearly different from each other at a glance."),
        header="THE TWO POSES (this is the most important part — exaggerate the leg difference):",
        poses="""1) CONTACT: legs scissored wide open, front foot far forward with heel down, back foot far behind with heel lifted high, arms swung opposite.
2) PASSING UP: both legs together under the body, one knee lifted HIGH and bent sharply, the other leg straight and vertical as the only support, body at its highest point, arms close to body.""",
    ),
    "jump": dict(
        n=3, anchor="air", fps=10,
        title=("CRAYON jump sprite sheet: ONE horizontal row of EXACTLY {n} complete figures, the "
               "rising part of a jump, three clearly different poses."),
        header="POSES IN ORDER:",
        poses="""1) TAKEOFF: both shoes planted flat on the ground, knees bent deep, body compressed low, arms swung back, about to push off.
2) RISING: well off the ground, body stretched tall, both knees pulled up HIGH toward the chest, arms thrown up above the head, hair and shirt hem pulled DOWN by the upward motion.
3) APEX: highest of the three, body elongated, legs hanging down loose and almost straight, arms falling out to the sides, shirt hem and hair hanging limp.""",
        extra_layout=("Vertical positions: pose 1 is standing on the ground, pose 2 is above it, "
                      "pose 3 is highest of all."),
    ),
    "fall": dict(
        n=3, anchor="air", fps=3,
        title=("CRAYON falling sprite sheet: ONE horizontal row of EXACTLY {n} complete figures, the "
               "falling part of a jump, three clearly different poses."),
        header="POSES IN ORDER:",
        poses="""1) FALL START: legs beginning to reach forward and down, arms opening outward, shirt hem and hair flipping UP.
2) FALL MID: legs spread wider, both arms out for balance, knees bent, shirt hem blown up high.
3) NEAR LANDING: front foot reaching down first, back leg trailing, arms forward to balance.""",
        extra_layout=("Vertical positions: pose 1 highest, pose 2 lower, pose 3 lowest — tracing the "
                      "falling arc through the air."),
    ),
    "attack": dict(
        n=4, anchor="ground", fps=12,
        title=("CRAYON attack animation sprite sheet: ONE horizontal row of EXACTLY {n} complete "
               "figures, one unarmed strike, four clearly different poses."),
        header="POSES (exaggerate):",
        poses="""1) WIND-UP: weight shifted to the back foot, torso twisted back, striking arm pulled far behind the body, fist at hip level, front shoulder high.
2) FULL EXTENSION (the peak frame — must be the most extreme of the four): front arm punched straight forward and fully extended, body leaning forward, back leg trailing straight behind, front knee bent.
3) RECOVERY: arm pulled halfway back, body straightening, weight coming back to center.
4) NEUTRAL: standing upright, arms at sides, ready to repeat pose 1.""",
        extra_neg="weapon, sword, ",
    ),
    "cast": dict(
        n=4, anchor="ground", fps=12,
        title=("CRAYON casting animation sprite sheet: ONE horizontal row of EXACTLY {n} complete "
               "figures, casting a spell with both hands, no object in the hands, four clearly "
               "different poses."),
        header="POSES (exaggerate):",
        poses="""1) GATHER: both hands pulled in close to the chest, elbows tight against the body, head lowered slightly, weight back on the heels.
2) RELEASE (the peak frame — must be the most extreme of the four): both arms pushed straight out to the front and fully extended at chest height, body leaning forward, front knee bent.
3) AFTERMATH: arms still extended forward but softening, hands starting to drop, body straightening up.
4) RECOVER: arms lowered back to the sides, standing upright, ready to repeat pose 1.""",
        extra_neg="magic glow, aura, sparkles, orb, weapon, staff, sword, ",
    ),
    "hurt": dict(
        n=3, anchor="ground", fps=10,
        title=("CRAYON hurt animation sprite sheet: ONE horizontal row of EXACTLY {n} complete "
               "figures, taking a hit and being knocked backward, three clearly different poses."),
        header="POSES IN ORDER:",
        poses="""1) IMPACT: the whole body thrown backward, the torso tilted back about 35 degrees from vertical, both arms thrown out wide and up above shoulder height, the front leg kicked straight out in front with the heel low, the back leg straight behind taking the weight.
2) KNOCKED BACK (the most extreme of the three): the torso tilted back about 50 degrees, almost falling over backward, the head now at the same height as the chest and far behind the hips, both arms flailing up and behind, the back knee bent and buckling.
3) RECOVERING: the torso coming back up to about 15 degrees of lean, the arms dropping forward, one knee bent deep underneath the hips, the other leg straight, one hand reaching toward the floor.""",
        extra_neg="blood, wound, gore, weapon, sword, ",
    ),
    "crouch": dict(
        n=2, anchor="ground", fps=4,
        title=("CRAYON crouch sprite sheet: ONE horizontal row of EXACTLY {n} complete figures, "
               "crouching low, two poses."),
        header="POSES IN ORDER:",
        poses="""1) CROUCH DOWN: the whole body compressed very low, knees spread outward, back rounded, head pulled down between the shoulders, arms hanging forward.
2) CROUCH HOLD: the same low crouch, chest lifted a little as if breathing, still ready to stand up at any moment.""",
    ),
    "slide": dict(
        n=3, anchor="ground", fps=11,
        title=("CRAYON slide animation sprite sheet: ONE horizontal row of EXACTLY {n} complete "
               "figures, sliding forward along the ground, three clearly different poses."),
        header="POSES (exaggerate):",
        poses="""1) PUSH OFF: body dropped very low and thrown forward, back leg straight out behind, front leg folded under the body, arms pulled back.
2) SLIDING (the lowest of the three): torso almost flat and horizontal, close to the ground, front hand touching the floor, back leg stretched out behind.
3) RISE: hips coming back up, torso leaning forward, one knee bent under the body, halfway between sliding and standing.""",
    ),
    "dash": dict(
        n=3, anchor="ground", fps=15,
        title=("CRAYON backdash animation sprite sheet: ONE horizontal row of EXACTLY {n} complete "
               "figures, leaping backward away from the camera side, three clearly different poses."),
        header="POSES IN ORDER:",
        poses="""1) PUSH: the body leaning backward at a steep angle, the back leg deeply bent and driving hard into the ground, the front leg lifted high and folded in front of the body, both arms swinging forward.
2) STRETCHED (the longest silhouette of the three): the body stretched out long and diagonal, leaning back at the steepest angle, both legs trailing behind with the feet up, arms pulled in tight to the chest.
3) LANDING: the body upright again with the knees bent deep and wide to absorb the impact, the arms out at the sides for balance, the weight very low.""",
        extra_neg="weapon, sword, ",
    ),
}


def build(state):
    cfg = STATES[state]
    tpl = TEMPLATE.read_text(encoding="utf-8")
    n = cfg["n"]
    nw = {2: "two", 3: "three", 4: "four", 5: "five", 6: "six"}.get(n, str(n))
    rep = {
        "<<TITLE>>": cfg["title"].format(n=n),
        "<<NFRAMES>>": str(n),
        "<<NWORD>>": nw,
        "<<GROUND>>": (GROUND["ground2"] if n == 2 else GROUND[cfg["anchor"]]).format(n=n, nw=nw),
        "<<POSES_HEADER>>": cfg["header"],
        "<<POSES>>": cfg["poses"],
        "<<EXTRA_LAYOUT>>": ("\n" + cfg["extra_layout"] + "\n") if cfg.get("extra_layout") else "",
        "<<EXTRA_CHAR>>": "",
        "<<EXTRA_NEG>>": cfg.get("extra_neg", ""),
        "<<NSEPS>>": str(n - 1),
    }
    for k, v in rep.items():
        tpl = tpl.replace(k, v)
    tpl = tpl.replace("in all two cells", "in both cells")
    # 清掉多余空行（三段之间只留一个空行）
    while "\n\n\n" in tpl:
        tpl = tpl.replace("\n\n\n", "\n\n")
    assert "<<" not in tpl, f"{state}: 还有未替换的占位符"
    return tpl.strip() + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("state", nargs="?")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--json", action="store_true", help="输出 params，可直接喂给生图工具")
    a = ap.parse_args()

    if a.list or not a.state:
        for k, v in STATES.items():
            print(f"{k:8s} {v['n']}帧  {v['anchor']:6s} @{v['fps']}fps  → art/hero/hero_{k}.png")
        print(f"\n共 {sum(v['n'] for v in STATES.values())} 帧 / {len(STATES)} 张表")
        return

    if a.state not in STATES:
        sys.exit(f"没有这个状态：{a.state}（可选：{', '.join(STATES)})")

    prompt = build(a.state)
    if a.json:
        import json
        print(json.dumps({
            "prompt": prompt,
            "size": "1536x1024",
            "quality": "high",
            "background": "opaque",
            "image1": REF_IMAGE,
            "input_fidelity": "high",
            "output_dir": OUT_DIR,
        }, ensure_ascii=False, indent=1))
    else:
        print(prompt)


if __name__ == "__main__":
    main()
