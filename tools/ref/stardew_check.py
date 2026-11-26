#!/usr/bin/env python3
"""星露谷参考文档校验器。

它守的不是"数字对不对"（那要靠 wiki 复核），而是三件容易悄悄烂掉的事：
  1. JSON 里的派生数仍然自洽（改了源头没改派生）
  2. 文档里手写的数字与 JSON 仍然一致（改了 JSON 忘了改文档）
  3. 那几条"算出来才发现"的结论还在（被后来的编辑删掉或软化）

第 3 条最重要：结论句被删掉，文档看起来更干净，但那正是这份文档的价值。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "docs" / "ref"
JSON_PATH = REF / "stardew_refs.json"
DOC = REF / "REF_STARDEW.md"
FARMING = REF / "REF_FARMING.md"
GDD03 = ROOT / "docs" / "gdd" / "03_经营与种植.md"

TOL = 0.05


def load():
    with JSON_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def same_line(text: str, a: str, b: str) -> bool:
    """a 与 b 必须出现在同一行 —— 只查"全文都出现过"会放过改错一处的情况。"""
    for line in text.splitlines():
        if a in line and b in line:
            return True
    return False


def check_derived(d: dict) -> list[str]:
    errs: list[str] = []
    t, e, s, p = d["time"], d["energy"], d["space"], d["processing"]

    # 时间层
    if abs(t["real_seconds_per_game_hour"] - t["real_seconds_per_game_minute"] * 60) > 0.01:
        errs.append("time: 每小时秒数 ≠ 每分秒数 × 60")
    expect_day = t["day_hours"] * t["real_seconds_per_game_hour"] / 60
    if abs(t["real_minutes_per_day"] - expect_day) > TOL:
        errs.append(f"time: 一天 {t['real_minutes_per_day']} 分 ≠ {t['day_hours']}h×{t['real_seconds_per_game_hour']}s = {expect_day:.1f}")
    expect_season = t["season_days"] * t["real_minutes_per_day"] / 60
    if abs(t["real_hours_per_season"] - expect_season) > TOL:
        errs.append(f"time: 一季 {t['real_hours_per_season']}h ≠ 28 天 × {t['real_minutes_per_day']} 分 = {expect_season:.2f}h")
    if t["season_days"] * t["seasons_per_year"] != 112:
        errs.append("time: 28 × 4 ≠ 112")

    # 体力层
    if e["start"] + e["stardrops"] * e["stardrop_bonus"] != e["max"]:
        errs.append(f"energy: {e['start']} + {e['stardrops']}×{e['stardrop_bonus']} ≠ {e['max']}（应为 508）")
    bar = e["start"] / e["watering_per_tile"]
    if abs(e["tiles_per_full_bar"] - bar) > 0.01:
        errs.append(f"energy: 一管体力 {e['tiles_per_full_bar']} 格 ≠ {e['start']}/{e['watering_per_tile']} = {bar:g}")

    # 空间层：铱制要足够多才超过体力上限，否则"自动化换层"的论证是假的
    cover = s["sprinkler_iridium"]["tiles"] * 6
    if cover <= e["tiles_per_full_bar"]:
        errs.append(f"space: 6 个铱制只覆盖 {cover} 格 ≤ 体力上限 {e['tiles_per_full_bar']}，§4 的结论不成立")

    # 加工链临界点：由公式反解，写死数字必须与反解一致
    fruit = p["keg_vs_jar_breakpoint_gold"]["fruit"]
    veg = p["keg_vs_jar_breakpoint_gold"]["vegetable"]
    # 2x+50 = 3x  => x = 50 ; 2x+50 = 2.25x => x = 200
    if abs(fruit - 50 / (3 - 2)) > TOL:
        errs.append("processing: 水果临界价与 2x+50=3x 反解不一致")
    if abs(veg - 50 / (2.25 - 2)) > TOL:
        errs.append("processing: 蔬菜临界价与 2x+50=2.25x 反解不一致")

    return errs


def check_doc(d: dict, doc: str) -> list[str]:
    errs: list[str] = []
    t, e, s, p = d["time"], d["energy"], d["space"], d["processing"]

    # 数字必须同行出现，防止"文档里有这个数"被别处兜住
    pairs = [
        ("270", f"{e['tiles_per_full_bar']} 格", "体力起始与 135 格上限不同行"),
        ("6 个铱制洒水器", "144 格", "§4 的 6×24 论证句被改动"),
        ("一整天", "14 分钟整", "一天 14 分整被改动（14.3 是错的）"),
        ("一季 28 天", "6 小时 32 分", "一季时长不同行"),
        ("2 × 原料价 + 50", "腌菜桶", "腌菜桶公式被改"),
        ("酒桶·果酒", "3 × 原料价", "果酒倍率被改"),
    ]
    for a, b, msg in pairs:
        if not same_line(doc, a, b):
            errs.append(f"文档: {msg}（缺「{a}」+「{b}」同行）")

    # 错误口径必须已经被明确否掉，不能两说并存
    if "14.3" in doc and "43 秒" in doc:
        if not any("14.3" in ln and ("错" in ln or "不是" in ln) for ln in doc.splitlines()):
            errs.append("文档: 出现了 14.3 分却没有标明它是错的")

    # 单点数字
    for v, msg in [
        (str(s["scarecrow_protected_tiles"]), "稻草人 248 格丢了"),
        (str(e["stardrops"]), "星之果实个数丢了"),
        (str(e["stardrop_bonus"]), "星之果实加成丢了"),
        (str(t["season_days"]), "一季天数丢了"),
    ]:
        if v not in doc:
            errs.append(f"文档: {msg}（{v}）")
    if "种田" not in doc:
        errs.append("文档: 标题口径不是种田")

    # 结论句：这些是文档的价值所在，删了就是空壳
    must = [
        ("瓶颈在换", "不是数值在涨"),
        ("互斥产生决策", "叠加只产生数值"),
        ("品质对料理和加工品完全无效", ""),
        ("先亲手浇过", "135 格"),
        ("算不通的", "待裁决"),
    ]
    for a, b in must:
        ok = same_line(doc, a, b) if b else (a in doc)
        if not ok:
            errs.append(f"文档: 关键结论「{a}」缺失或被软化")

    # 版本差异必须留痕，否则下次会重新踩
    if "3 级" in doc and "2 级" in doc:
        pass
    else:
        errs.append("文档: 洒水器解锁等级的版本差异未留痕")
    return errs


def check_cross(doc: str, farming: str) -> list[str]:
    errs: list[str] = []
    if "REF_STARDEW" not in farming:
        errs.append("REF_FARMING: §2.5 没有链到 REF_STARDEW，读者按编号找不到")
    if "REF_FARMING" not in doc:
        errs.append("REF_STARDEW: 没有回指 REF_FARMING，两份参考会脱钩")
    return errs


def check_gdd_open_issue(d03: str) -> list[str]:
    """03 的星级表若仍"伤害+产量"双出口，只提醒不判失败 —— 已标待裁决，不是漏改。"""
    if "待裁决" in d03 and "星级" in d03:
        print("NOTE  03 的星级双出口仍标「待裁决」—— §10.3 的建议还没落地，属已知未决")
    else:
        return ["03: 星级双出口既没修也没标待裁决 —— 会在读者那里变成既成事实"]
    return []


def parse_03(d03: str):
    """从 03 的星级表与掉率里抽参数 —— 不写死副本，否则文档改了脚本还在算旧账。"""
    rows: dict[int, dict] = {}
    for ln in d03.splitlines():
        m = re.match(r"\|\s*(★{1,3})\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|", ln)
        if not m:
            continue
        pay = m.group(2)
        cost = 0 if "不投" in pay else int(re.sub(r"\D", "", pay) or 0)
        rows[len(m.group(1))] = {
            "cost": cost,
            "dmg": int(m.group(3)),
            "pierce": int(m.group(4)),
            "yld": int(m.group(5)),
        }
    dm = re.search(r"普通敌\s*\*\*(\d+)%\*\*", d03)
    return rows, (int(dm.group(1)) / 100 if dm else None)


def payback(rows: dict, drop: float, melee: float) -> dict:
    """投料回本：净收益 = 本档产能 − ★产能 − 投料折合房数。负 = 亏，理性玩家不投。"""
    enemy, plot, hit_e = 40, 6, 0.5
    per_room = enemy * drop
    out = {}
    base = None
    for star in (1, 2, 3):
        r = rows[star]
        hits = 1 + (r["pierce"] - 1) * hit_e
        shots_per_room = (enemy * 2 * (1 - melee)) / hits
        cap = r["yld"] * plot / shots_per_room
        if star == 1:
            base = cap
            out[1] = cap
        else:
            out[star] = cap - base - r["cost"] / per_room
    return out


def check_matrix_payback(d03: str, doc: str) -> list[str]:
    errs: list[str] = []
    rows, drop = parse_03(d03)
    if len(rows) != 3 or drop is None:
        return ["03: 星级表或基质掉率解析失败 —— 表结构变了，10.3 的回本表要重算"]

    pure = payback(rows, drop, 0.0)
    at50 = payback(rows, drop, 0.5)
    at60 = payback(rows, drop, 0.6)
    at70 = payback(rows, drop, 0.7)

    # 结论 1：★★ 全区间为负（死档）。若哪天转正，10.3 的整段论证要重写
    if not (pure[2] < 0 and at50[2] < 0 and at70[2] < 0):
        errs.append("矩阵: ★★ 不再恒亏 —— 10.3「★★ 是死档」的结论失效，需重写")
    # 结论 2：★★★ 的转正门槛落在 50%~60% 之间
    if not (at50[3] < 0 < at60[3]):
        errs.append(f"矩阵: ★★★ 门槛变了（50%={at50[3]:+.2f}, 60%={at60[3]:+.2f}）—— 10.3 的「卡在 60%」不再成立")

    # 结论 3：文档里手写的四个数必须与当前参数算出来的一致
    flat = doc.replace("\u2212", "-")  # 文档用 U+2212 减号
    for val, label in [
        (pure[3], "纯投掷 ★★★"),
        (at50[3], "近战 50% ★★★"),
        (at60[3], "近战 60% ★★★"),
        (pure[2], "纯投掷 ★★"),
    ]:
        s = f"{val:+.2f}"
        if s not in flat and f"{val:.2f}" not in flat:
            errs.append(f"文档: 10.3 表里没有 {label} 的当前值 {s} —— 参数改了但表没重算")

    if "待裁决" not in d03:
        errs.append("03: 星级表没标「待裁决」—— 负收益的投料链会变成既成事实")
    return errs


def main() -> int:
    d = load()
    doc = DOC.read_text(encoding="utf-8")
    farming = FARMING.read_text(encoding="utf-8")
    d03 = GDD03.read_text(encoding="utf-8")

    errs = (check_derived(d) + check_doc(d, doc) + check_cross(doc, farming)
            + check_gdd_open_issue(d03) + check_matrix_payback(d03, doc))

    rows, drop = parse_03(d03)
    pb = payback(rows, drop, 0.6) if rows and drop else {}
    print(f"一天 {d['time']['real_minutes_per_day']} 分 / 一季 {d['time']['real_hours_per_season']}h / "
          f"一管体力 {d['energy']['tiles_per_full_bar']} 格 / 6 铱制 {d['space']['sprinkler_iridium']['tiles']*6} 格")
    if pb:
        print(f"投料回本（近战 60%）: ★★ {pb[2]:+.2f} 房 / ★★★ {pb[3]:+.2f} 房")
    print()
    if errs:
        for x in errs:
            print("FAIL  " + x)
        return 1
    print("PASS  派生数自洽 + 文档数字一致 + 6 条结论句在位 + 投料回本表未失效")
    return 0


if __name__ == "__main__":
    sys.exit(main())
