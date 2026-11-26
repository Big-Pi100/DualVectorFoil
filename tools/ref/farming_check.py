#!/usr/bin/env python3
"""验「经营 ↔ 战斗」的兑换率是否闭合（种子方案 · 11-27 换模型）。

换过一次模型，记在这里免得下次又绕回去：
  旧：基质投料定星级 —— 算下来是负收益（`REF_STARDEW §10.3` 记了全表），已废弃。
  新：地（清图所得）+ 种子（战斗掉落）→ 播种 → 收成。锚点见 `03 §3.4`。

本脚本守四件事：
  1. 纯投掷撑不住一局（否则种植是多余的）
  2. 种植补给能补上一个有意义的缺口（否则农→战是假的）
  3. 1 块地 / 2 块地的近战下限落在可操作区间（否则"清图得地"不构成成长线）
  4. 种子仓库、保底种子、以及"第一版零决策"这个诚实项都写在文档里

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

# ── 输入：全部来自 docs/gdd/06_数值表.md，改那张表就要同步这里 ────────────
ENEMY_HP = 40            # 06 §5 普通怪血量（根系基准）
THROW_DMG = 20           # 06 §4 投掷基础伤害
ROOM_ENEMIES = (30, 50)  # 06 §5 一房累计敌人
CARRY_MAX = 80           # 06 §4 弹药携带上限
SUPPLY_RATE = 0.40       # 06 §4 暗房补给 40%
ROOMS_PER_RUN = 4.5      # 01 §2 一局 4–5 战斗房，取中位
DARKROOMS_PER_RUN = 2    # 01 §2 一局 2–3 暗房，取保守值

# 11-27 新增：种子方案（06 §6）
SEED_DROP = 0.01         # 普通敌掉种率
SEED_PER_PLOT = 1        # 一颗种子 = 一块地
PLOT_GRID = (4, 6)       # 一块地格数
YIELD_PER_GRID = 8       # 单格产量（无品质档）
SEED_STORE = 8           # 种子仓库上限
RELIEF_SEED = 1          # 暗房保底种子

# 近战占比目标：第一版 1 块地时的下限（03 §9.3）
MELEE_TARGET = 0.50


def _r(x: float, nd: int = 2) -> float:
    return round(x, nd)


def compute() -> dict:
    shots_per_kill = math.ceil(ENEMY_HP / THROW_DMG)
    mild, wild = ROOM_ENEMIES
    mid_enemies = (mild + wild) / 2

    full = (mild * shots_per_kill, wild * shots_per_kill)
    mid_throw = mid_enemies * shots_per_kill

    # 一局可用弹药 = 初始携带 + 暗房补给次数 × 补给量
    supply_each = int(CARRY_MAX * SUPPLY_RATE)
    ammo_per_run = CARRY_MAX + DARKROOMS_PER_RUN * supply_each

    # 战 → 农：一局能掉几颗种子
    enemies_per_run = mid_enemies * ROOMS_PER_RUN
    seeds_per_run = enemies_per_run * SEED_DROP

    # 农 → 战：一颗种子（一块地）产多少发
    plot_yield = tuple(g * YIELD_PER_GRID for g in PLOT_GRID)
    plant_supply = seeds_per_run * plot_yield[1]   # 按 6 格口径，较宽松的一侧

    # 纯投掷能打几房
    rooms_pure = ammo_per_run / mid_throw

    # 各近战占比下的缺口与覆盖
    rows = []
    for melee in (0.0, 0.3, 0.4, 0.5, 0.6, 0.7):
        need = enemies_per_run * shots_per_kill * (1 - melee)
        gap = need - ammo_per_run
        rows.append({
            "melee": melee,
            "need": _r(need, 0),
            "gap": _r(gap, 0),
            "one_plot": bool(gap <= plot_yield[1]),
            "two_plots": bool(gap <= plot_yield[1] * 2),
        })

    def melee_needed(plots: int) -> float:
        """缺口 <= plots 块地产量时，近战至少要承担多少。"""
        cap = plot_yield[1] * plots
        return 1 - (ammo_per_run + cap) / (enemies_per_run * shots_per_kill)

    melee_min_1 = melee_needed(1)
    melee_min_2 = melee_needed(2)

    store_runs = SEED_STORE / seeds_per_run

    return {
        "shots_per_kill": shots_per_kill,
        "full_throw_per_room": full,
        "supply_each": supply_each,
        "ammo_per_run": ammo_per_run,
        "mid_throw_per_room": _r(mid_throw, 1),
        "rooms_pure_throw": _r(rooms_pure, 2),
        "enemies_per_run": _r(enemies_per_run, 0),
        "seeds_per_run": _r(seeds_per_run, 2),
        "plot_yield": plot_yield,
        "plant_supply": _r(plant_supply, 1),
        "melee_min_1plot": _r(melee_min_1, 3),
        "melee_min_2plots": _r(melee_min_2, 3),
        "store_runs": _r(store_runs, 1),
        "rows": rows,
        "criteria": {
            "melee_target": MELEE_TARGET,
            "rooms_per_run": ROOMS_PER_RUN,
            "seed_store": SEED_STORE,
            "relief_seed": RELIEF_SEED,
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
    if not has(r06, "种子掉落率", "1%"):
        errs.append("06 §6 找不到「种子掉落率 1%」")
    if not has(r06, "种子", "一块地"):
        errs.append("06 §6 没写「一颗种子 = 一块地」")
    if not has(r06, "保底", "1 颗"):
        errs.append("06 §6 没写保底种子 —— 断种死锁没有出口")

    # 2. 纯投掷撑不住一局 —— 这是种植存在的理由
    if r["rooms_pure_throw"] >= ROOMS_PER_RUN:
        errs.append(
            f"纯投掷能打 {r['rooms_pure_throw']} 房 ≥ 一局 {ROOMS_PER_RUN} 房，"
            "种植变成多余的，整章的经营设计失去前提"
        )

    # 3. 种植补给必须能补上一个有意义的缺口（至少半房）
    if r["plant_supply"] < r["mid_throw_per_room"] * 0.5:
        errs.append(
            f"一局种植补给只有 {r['plant_supply']} 发 < 半房 {r['mid_throw_per_room']*0.5:.0f} 发，"
            "农→战补不上缺口，链条是断的"
        )

    # 4. 1 块地的近战下限应落在 42%–55%（文档写"≥50%"是取整）
    if not (0.42 <= r["melee_min_1plot"] <= 0.55):
        errs.append(
            f"1 块地反解出的近战下限 {r['melee_min_1plot']:.0%} 不在 42%–55%，"
            "文档里的「近战 ≥50%」不再成立"
        )

    # 5. 2 块地必须明显更宽松，否则"清图得地"不构成成长线
    if not (r["melee_min_2plots"] < r["melee_min_1plot"] - 0.08):
        errs.append(
            f"2 块地只把近战下限从 {r['melee_min_1plot']:.0%} 降到 {r['melee_min_2plots']:.0%}，"
            "差距 <8 个百分点 —— 多一块地的意义不足以支撑「地是成长线」"
        )

    # 6. 种子仓库要撑 2–8 局：太紧逼刷，太松战→农断掉
    if not (2.0 <= r["store_runs"] <= 8.0):
        errs.append(
            f"种子仓库折合 {r['store_runs']} 局，超出 2–8 局，"
            "要么太紧（逼刷）要么太松（战→农依赖断）"
        )

    # 7. 文档必须写出这套结论，否则等于没落
    if not has(r03, "近战", "≥50%"):
        errs.append("03 没有「近战 ≥50%」的弹药经济结论 —— 打通只停在分析层面")
    # 数字要和算出来的一致：只查「1 块地」「48 发」两个词同现会放过"改了格数忘改文档"
    if not has(r03, "1 块地", f"{r['plot_yield'][1]} 发"):
        errs.append(
            f"03 没写「1 块地 {r['plot_yield'][1]} 发」—— 格数或单格产量改了，补给口径没跟着改"
        )
    if not has(r06, f"{r['plot_yield'][0]}–{r['plot_yield'][1]} 发"):
        errs.append(f"06 §6 没写「{r['plot_yield'][0]}–{r['plot_yield'][1]} 发」的整块地产量")
    if not has(r03, "地", "清完一个区域"):
        errs.append("03 没有写「地来自清图」—— 锚点少一条")

    # 8. 诚实项：第一版零决策必须明写，不能被悄悄改成"有深度"
    if "零决策" not in r03:
        errs.append("03 没有承认「第一版播种零决策」—— 这是粉饰，不是设计")

    # 9. 旧口径必须清干净，不能两套说法并存
    #    注意：不禁止「投料」二字本身 —— 03 §3.4 需要用它解释"为什么换掉"，
    #    禁掉会逼着文档删掉改动的理由，那比留着更糟。只禁旧规范的具体短语。
    for bad in ("基质掉落率", "基质仓库", "★★★ 弹药", "星级上限", "每次播种 3 份", "6 份（★★★）"):
        if bad in r03 or bad in r06:
            errs.append(f"旧规范「{bad}」仍残留在 03/06 —— 两套经济模型并存，读者会按旧的做")
    if has(r06, "0.5 发"):
        errs.append("06 仍保留「0.5 发/敌」的错误口径 —— 它漏算了 2 发/只")

    # 10. 近战结论必须已经从 60% 改成 50%，两处不能打架
    if has(r03, "→ 60%", "108"):
        errs.append("03 §9.3 仍留着 60% 的旧表 —— 与「≥50%」并存会让人不知道信哪个")

    # 11. 跨文档格数口径：07 的 P2 是"第一版就是 1 块地"，它必须按上限 6 格做。
    #     写成 4 格的话，P2 的 1 块地只有 32 发 < 缺口 36，第一版直接不成立。
    r07 = (GDD / "07_MVP与里程碑.md").read_text(encoding="utf-8")
    top = PLOT_GRID[1]
    if not has(r07, "1 块地", f"{top} 格"):
        errs.append(
            f"07 §5.1 的 P2 没写「1 块地 {top} 格」—— 4 格只有 {PLOT_GRID[0]*YIELD_PER_GRID} 发，"
            "补不上第一版的缺口，P2 验收会假通过"
        )

    return errs


def main() -> int:
    r = compute()

    if "--json" in sys.argv:
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return 0

    print("── 弹药经济 ──")
    print(f"击杀一只普通怪：ceil({ENEMY_HP} / {THROW_DMG}) = {r['shots_per_kill']} 发")
    print(f"一房 {ROOM_ENEMIES[0]}–{ROOM_ENEMIES[1]} 敌，纯投掷：{r['full_throw_per_room'][0]}–{r['full_throw_per_room'][1]} 发")
    print(f"一局可用：{CARRY_MAX} + {DARKROOMS_PER_RUN}×{r['supply_each']} = {r['ammo_per_run']} 发")
    print(f"纯投掷能打 {r['rooms_pure_throw']} 房  ← 一局要 {ROOMS_PER_RUN} 房")

    print("\n── 战 → 农（种子）──")
    print(f"一局 {r['enemies_per_run']:.0f} 敌 × {SEED_DROP:.0%} = {r['seeds_per_run']} 颗种子")
    print(f"一颗种子 → 一块地 {PLOT_GRID[0]}–{PLOT_GRID[1]} 格 → {r['plot_yield'][0]}–{r['plot_yield'][1]} 发")
    print(f"一局种植补给合计 {r['plant_supply']} 发")
    print(f"种子仓库 {SEED_STORE} 颗 ≈ {r['store_runs']} 局；保底 {RELIEF_SEED} 颗/次暗房")

    print("\n── 补给线能不能补上缺口 ──")
    print(f"{'近战':>6}{'一局耗弹':>10}{'缺口':>8}{'1 块地':>10}{'2 块地':>10}")
    for x in r["rows"]:
        m1 = "够" if x["one_plot"] else "不够"
        m2 = "够" if x["two_plots"] else "不够"
        print(f"{x['melee']:>5.0%}{x['need']:>10.0f}{x['gap']:>8.0f}{m1:>10}{m2:>10}")
    print(f"\n反解：1 块地需近战 ≥{r['melee_min_1plot']:.0%}；2 块地 ≥{r['melee_min_2plots']:.0%}")

    errs = check(r)
    print()
    if errs:
        for e in errs:
            print(f"FAIL  {e}")
        return 1

    r02 = (GDD / "02_战斗系统.md").read_text(encoding="utf-8")
    if "必须裁决的冲突" in r02:
        print("NOTE  02 §2.0.3 的近战裁决仍未落地 —— 新方案放宽到 50%，但手感理由仍然成立")

    print("PASS  弹药经济 / 战→农 / 农→战 / 地盘成长线 四组校验全过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
