#!/usr/bin/env python3
"""验「经营 ↔ 战斗」的兑换率是否闭合。

为什么用它：03 与 06 里对「打一房要多少发」有两套互相矛盾的说法 ——
06 §4 写「一房 30–50 敌 × 0.5 发（穿透 2）≈ 20–25 发」，
但 06 §5 又写「普通怪 40 血、投掷 20 伤」= 2 发才死一只 → 40 敌要 80 发。
两者差 4 倍。这条不算清，「种一次够打几房」就是拍脑袋，农→战链路无法验收。

本脚本不发明数，只做三件事：
  1. 用 06 既有数值推「一房耗弹」与「一块地能打几房」
  2. 反解「近战必须承担多少输出」才能让一局的弹药预算成立
  3. 算基质收支（打几房够投一次 2 星 / 3 星）

并且把关键结论断言回 03 / 06 的字面，防止文档被顺手改了而脚本不知道。

用法：
  python tools/ref/farming_check.py             # 打印算术 + 校验
  python tools/ref/farming_check.py --json      # 输出 JSON（给构建器用）
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GDD = ROOT / "docs" / "gdd"

# ── 输入：全部来自 docs/gdd/06_数值表.md，改这张表就要同步这里 ────────────
ENEMY_HP = 40            # 06 §5 普通怪血量（根系基准）
THROW_DMG = 20           # 06 §4 投掷基础伤害
ROOM_ENEMIES = (30, 50)  # 06 §5 一房累计敌人
CARRY_MAX = 80           # 06 §4 弹药携带上限
PLOT_YIELD = (40, 60)    # 03 §3 一块地产量
SUPPLY_RATE = 0.40       # 06 §4 暗房补给 40%
ROOMS_PER_RUN = 4.5      # 01 §2 一局 4–5 战斗房，取中位
DARKROOMS_PER_RUN = 2    # 01 §2 一局 2–3 暗房，取保守值

MATRIX_DROP = 0.08       # 新增：普通敌基质掉率
MATRIX_ELITE = 3         # 新增：精英一次掉 3 份
MATRIX_2STAR = 3         # 新增：★★ 投料成本
MATRIX_3STAR = 6         # 新增：★★★ 投料成本
MATRIX_STORE = 60        # 新增：基质仓库上限

# 新增：三档弹药的伤害与穿透（06 §6）
STAR_DMG = (20, 24, 30)
STAR_PIERCE = (2, 2, 3)

# 战斗角色占比下限（02 §2.0.3 裁决的目标）
MELEE_TARGET = 0.60


def _r(x: float, nd: int = 2) -> float:
    return round(x, nd)


def compute() -> dict:
    shots_per_kill = math.ceil(ENEMY_HP / THROW_DMG)
    mild, wild = ROOM_ENEMIES

    full = (mild * shots_per_kill, wild * shots_per_kill)

    # 一局可用弹药 = 初始携带 + 暗房补给次数 × 补给量
    supply_each = int(CARRY_MAX * SUPPLY_RATE)
    ammo_per_run = CARRY_MAX + DARKROOMS_PER_RUN * supply_each
    budget_per_room = ammo_per_run / ROOMS_PER_RUN

    # 中位一房 40 敌，纯投掷要 80 发
    mid_enemies = (mild + wild) / 2
    mid_throw = mid_enemies * shots_per_kill

    # 反解：要让每房预算 <= budget_per_room，投掷占比上限
    throw_share_max = budget_per_room / mid_throw
    melee_share_min = 1 - throw_share_max

    # 纯投掷时，80 发能打几房（中位）
    rooms_pure = CARRY_MAX / mid_throw

    # 一块地产量能打几房（按目标近战占比）
    throw_per_room_at_target = mid_throw * (1 - MELEE_TARGET)
    plot_rooms = (PLOT_YIELD[0] / throw_per_room_at_target,
                  PLOT_YIELD[1] / throw_per_room_at_target)

    # 基质收支
    matrix_per_room = mid_enemies * MATRIX_DROP
    room_per_2star = MATRIX_2STAR / matrix_per_room
    room_per_3star = MATRIX_3STAR / matrix_per_room
    batches_in_store_2 = MATRIX_STORE / MATRIX_2STAR
    runs_in_store = batches_in_store_2 / ROOMS_PER_RUN

    # 星级对"几发打死"的影响：普通怪 vs 精英
    star_shots_normal = tuple(math.ceil(ENEMY_HP / d) for d in STAR_DMG)
    elite_hp = (ENEMY_HP * 4, ENEMY_HP * 6)   # 06 §5 精英 4–6 × 普通
    star_shots_elite = tuple(
        (math.ceil(elite_hp[0] / d), math.ceil(elite_hp[1] / d)) for d in STAR_DMG
    )

    return {
        "shots_per_kill": shots_per_kill,
        "full_throw_per_room": full,
        "supply_each": supply_each,
        "ammo_per_run": ammo_per_run,
        "budget_per_room": _r(budget_per_room, 1),
        "mid_throw_per_room": _r(mid_throw, 1),
        "throw_share_max": _r(throw_share_max, 3),
        "melee_share_min": _r(melee_share_min, 3),
        "rooms_pure_throw": _r(rooms_pure, 2),
        "throw_per_room_at_target": _r(throw_per_room_at_target, 1),
        "plot_rooms": (_r(plot_rooms[0], 2), _r(plot_rooms[1], 2)),
        "matrix_per_room": _r(matrix_per_room, 2),
        "room_per_2star": _r(room_per_2star, 2),
        "room_per_3star": _r(room_per_3star, 2),
        "batches_in_store_2": _r(batches_in_store_2, 1),
        "runs_in_store": _r(runs_in_store, 2),
        "star_shots_normal": list(star_shots_normal),
        "star_shots_elite": [list(x) for x in star_shots_elite],
        "criteria": {
            "melee_target": MELEE_TARGET,
            "rooms_per_run": ROOMS_PER_RUN,
        },
    }


def has(text: str, *parts: str) -> bool:
    """同一行内同时出现所有片段。只查「文中出现过」会漏，必须同行匹配。"""
    return any(all(p in line for p in parts) for line in text.splitlines())


def check(r: dict) -> list[str]:
    errs: list[str] = []

    r06 = (GDD / "06_数值表.md").read_text(encoding="utf-8")
    r03 = (GDD / "03_经营与种植.md").read_text(encoding="utf-8")

    # 1. 输入与 06 字面一致
    if not has(r06, "普通怪血量", "40"):
        errs.append("06 §5 找不到「普通怪血量 40」——输入已失效，本脚本的算术前提出错")
    if not has(r06, "投掷", "20"):
        errs.append("06 §4 找不到「投掷基础伤害 20」")
    if not has(r06, "携带上限", "80"):
        errs.append("06 §4 找不到「弹药携带上限 80」")

    # 2. 纯投掷撑不住一局 —— 这是本脚本要证伪的旧说法
    if r["rooms_pure_throw"] >= ROOMS_PER_RUN:
        errs.append(
            f"纯投掷能打 {r['rooms_pure_throw']} 房 ≥ 一局 {ROOMS_PER_RUN} 房，"
            "说明「近战必须升级」的前提不成立，需重算"
        )

    # 3. 近战占比下限必须落在 50%–70% 这个可操作区间
    if not (0.5 <= r["melee_share_min"] <= 0.7):
        errs.append(
            f"反解出的近战占比下限 {r['melee_share_min']:.0%} 超出 50%–70%，"
            "说明弹药预算或携带上限需要重定"
        )

    # 4. 一块地至少覆盖 1 房，否则回访节奏碎成一房一收
    if r["plot_rooms"][0] < 1.0:
        errs.append(
            f"一块地最低只够打 {r['plot_rooms'][0]} 房 < 1 房，"
            "玩家会一房回一次田，回访 5 分钟预算被击穿"
        )

    # 5. 打 1 房应该刚好够一次 2 星播种（基质收支不能太松也不能太紧）
    if not (0.8 <= r["room_per_2star"] <= 1.5):
        errs.append(
            f"打 {r['room_per_2star']} 房才够一次 2 星，不在 0.8–1.5 区间，"
            "基质掉落率与投料成本不匹配"
        )

    # 6. 仓库上限要能撑一局以上，但不能撑太多（否则战→农依赖断掉）
    if not (2.0 <= r["runs_in_store"] <= 8.0):
        errs.append(
            f"仓库上限折合 {r['runs_in_store']} 局，超出 2–8 局，"
            "要么太紧（逼刷）要么太松（战→农依赖断）"
        )

    # 7. 文档必须写出这套结论，否则等于没落
    need = f"{r['melee_share_min']:.0%}"
    if not has(r03, "近战", f"≥{need}"):
        errs.append(f"03 没有「近战 ≥{need}」的弹药经济结论 —— 打通只停在分析层面")
    if not has(r03, "基质", "掉率") and not has(r03, "普通敌", "8%"):
        errs.append("03 没有写基质掉率")
    if "基质仓库上限" not in r03:
        errs.append("03 没有写基质仓库上限")

    # 8. 旧的错误口径必须已经清掉，不能两个说法并存
    if has(r06, "0.5 发"):
        errs.append("06 仍保留「0.5 发/敌」的错误口径 —— 它漏算了 2 发/只")

    # 9. 三档伤害对普通怪必须都是 2 发 —— 星级的收益只能来自穿透，不能来自伤害
    sn = r["star_shots_normal"]
    if len(set(sn)) != 1:
        errs.append(
            f"三档弹药对普通怪击杀发数 {sn} 不一致 —— 星级偷偷改了「2 发」的手感基准，"
            "或者有人把伤害调过了 40"
        )
    elif sn[0] != 2:
        errs.append(f"普通怪需 {sn[0]} 发，与 06 §5「投掷 2 发」不符")

    # 10. 精英必须真的被伤害梯度影响（否则星级对精英也没意义）
    if r["star_shots_elite"][0][0] == r["star_shots_elite"][2][0]:
        errs.append("三档弹药打精英的发数相同 —— 伤害梯度对精英无效，星级彻底只剩穿透")

    return errs


def main() -> int:
    r = compute()

    if "--json" in sys.argv:
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return 0

    print("── 弹药经济 ──")
    print(f"击杀一只普通怪：ceil({ENEMY_HP} / {THROW_DMG}) = {r['shots_per_kill']} 发")
    print(f"一房 {ROOM_ENEMIES[0]}–{ROOM_ENEMIES[1]} 敌，纯投掷：{r['full_throw_per_room'][0]}–{r['full_throw_per_room'][1]} 发")
    print(f"携带 {CARRY_MAX} 发，纯投掷能打：{r['rooms_pure_throw']} 房  ← 一局 {ROOMS_PER_RUN} 房")
    print(f"一局可用：{CARRY_MAX} + {DARKROOMS_PER_RUN}×{r['supply_each']} = {r['ammo_per_run']} 发")
    print(f"→ 每房预算 {r['budget_per_room']} 发，中位一房纯投掷 {r['mid_throw_per_room']} 发")
    print(f"→ 投掷占比上限 {r['throw_share_max']:.1%}，即近战须承担 ≥ {r['melee_share_min']:.0%}")

    print("\n── 农 → 战 ──")
    print(f"近战 {MELEE_TARGET:.0%} 时每房耗弹 {r['throw_per_room_at_target']} 发")
    print(f"一块地产 {PLOT_YIELD[0]}–{PLOT_YIELD[1]} 发 → 覆盖 {r['plot_rooms'][0]}–{r['plot_rooms'][1]} 房")

    print("\n── 战 → 农（基质）──")
    print(f"中位一房掉基质：{ROOM_ENEMIES[0]}–{ROOM_ENEMIES[1]} 敌 × {MATRIX_DROP:.0%} ≈ {r['matrix_per_room']} 份")
    print(f"一次 2 星（{MATRIX_2STAR} 份）≈ 打 {r['room_per_2star']} 房")
    print(f"一次 3 星（{MATRIX_3STAR} 份）≈ 打 {r['room_per_3star']} 房")
    print(f"仓库 {MATRIX_STORE} 份 = {r['batches_in_store_2']} 次 2 星 ≈ {r['runs_in_store']} 局")

    print("\n── 星级对谁有用 ──")
    print(f"普通怪 {ENEMY_HP} 血：三档击杀发数 {r['star_shots_normal']} ← 都一样")
    print(f"  收益只能来自穿透 {STAR_PIERCE}（★/★★ 串 2、★★★ 串 3）")
    print(f"精英 {ENEMY_HP*4}–{ENEMY_HP*6} 血：{r['star_shots_elite']} ← 伤害梯度在这里生效")

    errs = check(r)
    print()
    if errs:
        for e in errs:
            print(f"FAIL  {e}")
        return 1

    r02 = (GDD / "02_战斗系统.md").read_text(encoding="utf-8")
    if "必须裁决的冲突" in r02:
        print("NOTE  02 §2.0.3 的近战裁决仍未落地 —— 03 的弹药经济依赖它，两者必须同批做")

    print("PASS  弹药经济 / 农→战 / 战→农 / 星级分层 四组校验全过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
