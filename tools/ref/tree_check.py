#!/usr/bin/env python3
"""验「世界树生理」这条主线有没有真的落到文档上（2026-11-27）。

白哥给的主线只有一句：世界树被入侵，**运输和产生都出了问题**。
这句话要么变成设定书上的一段话，要么变成一把能 judge 新机制的尺子。
本脚本守后者：六处翻译必须在位，且必须真的出现在该出现的文档里。

守四件事：
  1. JSON 内部不矛盾（两条流能独立切断 ⇒ 环剥时木质部必须完好）
  2. 05 的六处翻译齐全，且 05 / JSON 的条数一致（防止只改一头）
  3. 禁令在位：树的生理不接数值、不做修复清单（否则变成第四个系统）
  4. 03 / 04 真的接到了这条背景上，不是只在 05 写了一段就完事

用法：
  python tools/ref/tree_check.py
  python tools/ref/tree_check.py --json
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GDD = ROOT / "docs" / "gdd"
REF = ROOT / "docs" / "ref"

DOC05 = GDD / "05_叙事与主角.md"
DOC03 = GDD / "03_经营与种植.md"
DOC04 = GDD / "04_关卡与地图.md"
DOC_REF = REF / "REF_TREE_PHYSIOLOGY.md"
JSON_REF = REF / "tree_physiology_refs.json"

# 六处翻译：系统词 → 生理词（必须同一行出现）
MAPPINGS = [
    ("清完一个区域", "打通一段被堵的管"),
    ("得到一块地", "断面"),
    ("打怪掉种子", "取回"),
    ("种植 → 收成", "愈伤组织"),
    ("守卫军", "免疫细胞"),
    ("袭击", "感染复发"),
]

# 04 五层各自的生理角色（区名 → 关键词）
AREA_ROLES = [
    ("深根", "吸水吸矿"),
    ("根", "起点"),
    ("干 · 中庭", "主管道"),
    ("西翼", "分配"),
    ("东翼", "分配"),
    ("冠", "产生端"),
]

# REF 必须写出的关键数字（数字错了比没有更糟）
REF_FACTS = [
    ("140 天", "松树苗断糖存活"),
    ("2–4 周", "愈伤开始时间"),
    ("1–2 个生长季", "小伤口封口"),
    ("3–5 年", "大伤口封口"),
    ("两侧", "愈伤从哪长"),
]


def same_line(text: str, *parts: str) -> bool:
    return any(all(p in line for p in parts) for line in text.splitlines())


def load() -> dict:
    return json.loads(JSON_REF.read_text(encoding="utf-8"))


def tree_section(doc: str, head: str, tail: str) -> str:
    i = doc.find(head)
    if i < 0:
        return ""
    j = doc.find(tail, i)
    return doc[i:j if j > 0 else len(doc)]


def check_internal(d: dict) -> list[str]:
    errs: list[str] = []
    ts, g, w = d["two_streams"], d["girdling"], d["wound"]

    # 两条流能独立切断 ⇒ 环剥剥掉韧皮部时，木质部必须完好
    if ts["independently_cuttable"] and not g["xylem_intact"]:
        errs.append("JSON: 声明两条流可独立切断，但环剥项写木质部不受影响为假 —— 自相矛盾")
    if g["phloem_removed"] and not g["roots_starve"]:
        errs.append("JSON: 剥掉韧皮部却不断根 —— 与下行流的定义矛盾")
    if g["roots_starve"] and not g["leaves_stay_hydrated"]:
        errs.append("JSON: 根断糖的同时叶子也缺水 —— 这就不是'独立切断'了，整个设定的支点没了")
    # 环剥后叶子仍含水，则蒸腾不能有即时影响
    if g["leaves_stay_hydrated"] and g["transpiration_immediate_effect"]:
        errs.append("JSON: 叶子含水却说蒸腾立刻受影响 —— 两者不能同时成立")
    # 树不愈合，则愈伤只能是'封口'，不能叫'修复'
    if w["heals"]:
        errs.append("JSON: wound.heals=true —— 树不修复组织，这条错了整段结局论证就塌了")
    # 愈伤必须在第一个生长季内就开始（一季约 13 周）；否则"当季封口"不成立
    if w["callus_starts_weeks"][1] >= 13:
        errs.append(f"JSON: 愈伤 {w['callus_starts_weeks'][1]} 周才开始，超出一个生长季 —— "
                    "与'小伤口 1–2 季封口'对不上")
    if w["small_wound_growing_seasons"][0] < 1:
        errs.append("JSON: 小伤口封口少于 1 个生长季 —— 树不可能当周长好")
    if len(d["design_map"]) != 6:
        errs.append(f"JSON: design_map 有 {len(d['design_map'])} 条，05 里写的是六处翻译")
    return errs


def check_05(doc: str, d: dict) -> list[str]:
    errs: list[str] = []

    # 1. 六处翻译逐条在位（同段内，不要求同行 —— 表里有换行风险）
    seg = tree_section(doc, "### 1.4", "### 1.5")
    if not seg:
        errs.append("05: 找不到 §1.4「六处翻译」—— 主线只停在叙述，没变成尺子")
        return errs
    for sys_word, phys in MAPPINGS:
        if not same_line(seg, sys_word, phys):
            errs.append(f"05 §1.4: 「{sys_word} → {phys}」这一行没了 —— 映射少一条")

    # 2. 05 的表格条数必须与 JSON 一致（防止只改一头）
    #    只数第一张表 —— §1.4 里还有第二张「三条硬规则」，一起数会误判
    blocks = [b for b in seg.split("\n\n") if b.strip().startswith("|")]
    if not blocks:
        errs.append("05 §1.4: 找不到翻译表 —— 映射可能被改成了散文")
    else:
        rows = [ln for ln in blocks[0].splitlines()[2:] if ln.strip().startswith("|")]
        if len(rows) != len(d["design_map"]):
            errs.append(f"05 §1.4: 表里 {len(rows)} 行，JSON 里 {len(d['design_map'])} 条 —— 两头不同步")

    # 3. 禁令必须在位：只做表现、不接数值
    seg15 = tree_section(doc, "### 1.5", "## 2.")
    if "不接数值" not in seg15:
        errs.append("05 §1.5: 没有「不接数值」的禁令 —— 树会变成第四个系统")
    if not same_line(seg15, "健康度", "不做"):
        errs.append("05 §1.5: 没写「不做健康度进度条」—— 迟早有人加")

    # 4. 结局方向：不是复原，是带疤活着
    if "带着疤" not in doc:
        errs.append("05: 少了「带着疤活着」—— 结局又回到'复原'，与 CODIT 的事实相反")

    # 5. 内核同构那句（照片里的人 ↔ 树）不能丢，这是设定的立意
    if not same_line(doc, "回不到立体", "回不到原样"):
        errs.append("05: 少了「人回不到立体 / 树回不到原样」的同构句 —— 设定退化成生态修复")
    return errs


def check_03(doc: str) -> list[str]:
    errs: list[str] = []
    seg = tree_section(doc, "## 0.", "## 1.")
    if not seg:
        errs.append("03: 没有 §0 叙事挂法 —— 种田没根植到世界树的背景上")
        return errs
    for a, b in [("**地**", "断面"), ("**种子**", "赃物"), ("**作物**", "愈伤组织"), ("30 分钟", "季")]:
        if not same_line(seg, a, b):
            errs.append(f"03 §0: 「{a} ↔ {b}」这一行没了 —— 四样对应少一条")
    if "不治疗树" not in seg:
        errs.append("03 §0: 少了「种田不治疗树」这条红线 —— 会滑成 00 §5 判过的治愈长线")
    if not same_line(seg, "防御组织", "弹药"):
        errs.append("03 §0: 没写「弹药 = 树自己的防御组织」—— 硬规则 3.1 又回到只靠利益论证")
    # 袭击的读法要改成感染复发（与"农场被偷"这个旧读法同句对照）
    if not same_line(doc, "感染复发", "农场被偷"):
        errs.append("03 §5: 袭击没改成「感染复发」—— 还是'菜被偷了'的读法")
    return errs


def check_04(doc: str) -> list[str]:
    errs: list[str] = []
    if "生理角色" not in doc:
        errs.append("04 §2: 五层表没有「生理角色」列 —— 地区与生理没接上")
        return errs
    for area, role in AREA_ROLES:
        if not same_line(doc, area, role):
            errs.append(f"04 §2: 「{area}」行没有生理角色「{role}」")
    return errs


def check_ref(doc: str) -> list[str]:
    errs: list[str] = []
    for fact, what in REF_FACTS:
        if fact not in doc:
            errs.append(f"REF: 少了「{fact}」（{what}）—— 数字没了，下一步就会凭印象编")
    if "涂封" not in doc:
        errs.append("REF: 没写「伤口涂封剂无效」—— 这是一条有依据的减法，丢了可惜")
    return errs


def main() -> int:
    d = load()
    r05 = DOC05.read_text(encoding="utf-8")
    r03 = DOC03.read_text(encoding="utf-8")
    r04 = DOC04.read_text(encoding="utf-8")
    rref = DOC_REF.read_text(encoding="utf-8")

    if "--json" in sys.argv:
        print(json.dumps(d, ensure_ascii=False, indent=2))
        return 0

    errs = check_internal(d) + check_05(r05, d) + check_03(r03) + check_04(r04) + check_ref(rref)

    g = d["girdling"]
    w = d["wound"]
    print("── 两条流 ──")
    print(f"上行 {d['two_streams']['xylem']['carries']} · 下行 {d['two_streams']['phloem']['carries']} · "
          f"可独立切断={d['two_streams']['independently_cuttable']}")
    print(f"环剥：韧皮部断={g['phloem_removed']} 木质部完好={g['xylem_intact']} "
          f"根饿死={g['roots_starve']} 叶照绿={g['leaves_stay_hydrated']}")
    print(f"地上部分外观健康 {g['above_looks_healthy']}；断糖存活 {g['seedling_days_without_sugar_to_roots']} 天")
    print("\n── 伤口 ──")
    print(f"会愈合={w['heals']} · {w['process']}")
    print(f"愈伤 {w['callus_starts_weeks'][0]}–{w['callus_starts_weeks'][1]} 周开始；"
          f"小伤 {w['small_wound_growing_seasons'][0]}–{w['small_wound_growing_seasons'][1]} 季；"
          f"大伤 {w['large_wound_years'][0]}–{w['large_wound_years'][1]} 年")
    print(f"\n── 六处翻译 ──")
    for m in d["design_map"]:
        print(f"{m['system']:<12} → {m['physiology']}")
    print()
    if errs:
        for e in errs:
            print("FAIL  " + e)
        return 1
    print("PASS  两条流自洽 + 六处翻译齐全 + 禁令在位 + 03/04 已接上背景")
    return 0


if __name__ == "__main__":
    sys.exit(main())
