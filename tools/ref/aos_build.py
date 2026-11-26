#!/usr/bin/env python3
"""《晓月圆舞曲》完整资料库 —— 构建器与校验器。

一个源出三份产物：
    docs/ref/aos/aos_enemies.json    ← 从 raw 解析（生成物，勿手改）
    docs/ref/aos/REF_AOS_COMPLETE.md ← 表格块由本脚本填充，正文手写
    docs/ref/aos/aos_atlas.html      ← 整页生成

数据链：
    tools/ref/_src/aos_enemies_raw.txt  →  aos_enemies.json  →  MD / HTML

为什么留 raw：WebFetch 抓回来的行是被模型转述过的，不是原始 HTML。把转述结果
原样留档，才分得清「这个 120 是我抄错了」还是「源页面就写 120」。删掉 raw 就
等于删掉了唯一证据。

用法：
    python tools/ref/aos_build.py            # 生成 JSON + MD 表格 + HTML
    python tools/ref/aos_build.py --check    # 只校验，不写盘
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "docs" / "ref"
AOS = REF / "aos"
RAW = ROOT / "tools" / "ref" / "_src" / "aos_enemies_raw.txt"
SOULS_JSON = REF / "aos_souls.json"
ENEMIES_JSON = AOS / "aos_enemies.json"
AREAS_JSON = AOS / "aos_areas.json"
BOSSES_JSON = AOS / "aos_bosses.json"
SYSTEMS_JSON = AOS / "aos_systems.json"
EQUIP_JSON = AOS / "aos_equipment.json"
MAP_AREA_JSON = AOS / "aos_map_area.json"
MD = AOS / "REF_AOS_COMPLETE.md"
HTML = AOS / "aos_atlas.html"

SOUL_TYPE = {"red": "bullet", "blue": "guardian", "yellow": "enchanted", "ability": "ability"}
SOUL_CN = {"bullet": "红魂", "guardian": "蓝魂", "enchanted": "黄魂", "ability": "银魂"}

# 魂名对不上时的已知例外：敌人表和魂表拼法不同，不是数据错误。
# Quezlcoatl 是源页面的错拼，魂表写的是正确的 Quetzalcoatl。
SOUL_ALIAS = {"Quezlcoatl": "Quetzalcoatl"}

# 敌人表里 soul 字段为空的 BOSS —— 源页面没写，不是「没有魂」。
# 实际有没有魂以魂表为准（见 build() 里的 boss_soul 回填）。
BOSS_SOUL_FALLBACK = {
    "Headhunter": ("enchanted", "Headhunter"),
    "Death": ("guardian", "Death"),
    "Legion": ("bullet", "Legion"),
    "Balore": ("bullet", "Balore"),
}

AREA_SHORT = {
    "castle_corridor": "荒城回廊",
}


def die(msgs: list[str]) -> None:
    print("✗ 校验失败：", file=sys.stderr)
    for m in msgs:
        print("   ", m, file=sys.stderr)
    raise SystemExit(1)


# ── 1. 解析 raw ────────────────────────────────────────────────────────────

def parse_raw() -> list[dict]:
    rows: list[dict] = []
    for ln, line in enumerate(RAW.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        f = line.split("|")
        if len(f) != 10:
            die([f"raw 第 {ln} 行字段数 {len(f)} ≠ 10：{line[:60]}"])
        seg, name, hp, exp, stype, sname, srar, weak, drops, loc = f

        areas, truncated = [], False
        for part in (x.strip() for x in loc.split(",")):
            if part.endswith("…"):
                truncated = True
                part = part[:-1].strip()
            if part and part != "-":
                areas.append(part)

        rows.append({
            "seg": int(seg),
            "name": name,
            "hp": int(hp),
            "exp": int(exp),
            "soul_type": SOUL_TYPE.get(stype),
            "soul_name": None if sname == "-" else sname,
            "soul_rarity": None if srar == "-" else int(srar),
            "weak": [] if weak == "-" else [w.strip() for w in weak.split(",")],
            "drops": [] if drops == "-" else [d.strip() for d in drops.split(",")],
            "areas_en": areas,
            "areas_truncated": truncated,
        })
    return rows


# ── 2. 校验 + 组装 ─────────────────────────────────────────────────────────

def build() -> tuple[dict, list[str]]:
    rows = parse_raw()
    bad: list[str] = []

    seen: dict[str, int] = {}
    for r in rows:
        if r["name"] in seen:
            seen[r["name"]] += 1
        else:
            seen[r["name"]] = 1
    dup = {k: v for k, v in seen.items() if v > 1}
    if dup:
        bad.append(f"raw 里有重复敌人名（源页面 80/81 号重复）应已去重，仍有：{dup}")

    enemies = []
    for r in rows:
        if r["name"] in {e["name"] for e in enemies}:
            continue
        if r["hp"] <= 0:
            bad.append(f"{r['name']} HP 非正：{r['hp']}")
        if r["exp"] < 0:
            bad.append(f"{r['name']} EXP 为负：{r['exp']}")
        enemies.append(r)

    areas = json.loads(AREAS_JSON.read_text(encoding="utf-8"))["areas"]
    by_en = {a["en"]: a for a in areas}

    # 区域名必须能映射到 areas.json，否则聚合会静默丢数据。
    # 注意：这里只记错误、不立即退出 —— 后面的聚合必须能容忍这个「坏名字」，
    # 否则校验器自己会抛 KeyError，用户看到的是一串 traceback 而不是哪条数据错了。
    # 校验器的第一职责是「说人话地报错」，不是正确。
    for e in enemies:
        for a in e["areas_en"]:
            if a not in by_en:
                bad.append(f"敌人 {e['name']} 的区域「{a}」不在 aos_areas.json 里")

    # 每个区域至少要有 1 个敌人 —— 除非区域表自己声明了数据缺口。
    # 不做成硬失败的理由：源页面的 location 字段确实把地下墓地的敌人并进了
    # 地下水域（Legion / Flame Demon 在 Fandom 都记在 Cemetery）。这是源数据的
    # 分组口径问题，不是我们抄漏。硬报错只会逼人去「补一个假敌人」把测试刷绿。
    pool: dict[str, list[str]] = {a["id"]: [] for a in areas}
    for e in enemies:
        for a in e["areas_en"]:
            if a not in by_en:      # 已在上面记过错误，这里跳过，别让校验器崩掉
                continue
            pool[by_en[a]["id"]].append(e["name"])
    for a in areas:
        aid = a["id"]
        if not pool[aid] and not a.get("enemy_data_gap"):
            bad.append(f"区域 {aid} 在敌人表里一个敌人都没有，"
                       f"且没有 enemy_data_gap 说明 —— 要么补数据，要么写明为什么空")

    # 魂交叉引用：敌人掉的魂必须能在 aos_souls.json 里找到
    souls = json.loads(SOULS_JSON.read_text(encoding="utf-8"))["souls"]
    soul_en = {s["en"] for s in souls}
    soul_cn = {s["cn"] for s in souls}
    orphan = []
    for e in enemies:
        sn = e["soul_name"]
        if not sn:
            continue
        probe = SOUL_ALIAS.get(sn, sn)
        if probe not in soul_en and probe not in soul_cn:
            orphan.append((e["name"], sn))
    # 孤儿不直接判失败 —— 先作为冲突报告出来，人确认后再决定是加 alias 还是改数据
    if orphan:
        bad.append(f"以下 {len(orphan)} 条敌人魂名在魂表里找不到（先确认再决定加 alias 还是修数据）："
                   + "、".join(f"{a}→{b}" for a, b in orphan))

    # BOSS 源页面 soul 为空时，用魂表回填
    for e in enemies:
        if e["soul_name"] is None and e["name"] in BOSS_SOUL_FALLBACK:
            t, n = BOSS_SOUL_FALLBACK[e["name"]]
            e["soul_type"], e["soul_name"] = t, n
            e["soul_note"] = "源页面 BOSS 段未填魂字段，按魂表回填"

    # ── BOSS 与装备的断言 ──
    #
    # 这一组断言的共同目标：文档里写的「中位数 2 招」「8/11 个非单体」
    # 必须是**从这里算出来的**。如果只在正文写死一句话，数据一改就悄悄过期。
    bosses = json.loads(BOSSES_JSON.read_text(encoding="utf-8"))
    legend = bosses["meta"]["hurtbox_legend"]

    for b in bosses["bosses"]:
        # 受击面类型必须全部在 legend 里有定义，否则读表的人不知道这个词什么意思
        for t in [x.strip() for x in b["hurtbox"]["type"].split("+")]:
            if t not in legend:
                bad.append(f"BOSS {b['name']} 的受击面类型「{t}」没有在 meta.hurtbox_legend 里定义")
        if not b["moves"]:
            bad.append(f"BOSS {b['name']} 一招都没有 —— 招式表不能空")
        for m in b["moves"]:
            for f in ("name", "counter"):
                if not m.get(f):
                    bad.append(f"BOSS {b['name']} 的招式缺「{f}」字段：{m}")
        if b["hp"] is None and not b.get("hp_split"):
            bad.append(f"BOSS {b['name']} 的 hp 为空，且没有 hp_split 说明为什么")

    # 招式数中位数：正文里写了「中位数 2」，这里算一遍对上才让过
    #
    # 但中位数对单点改动不敏感 —— 反向验证时删掉一个 BOSS 的一招，
    # 中位数仍然是 2，断言照样通过。所以统计量不能当唯一守卫，
    # 真正的守卫得是「设计不变量」：哪些性质一旦被破坏，这份参照物就不能用了。
    import statistics
    mv = sorted(len(b["moves"]) for b in bosses["bosses"])
    med = statistics.median(mv)
    if f"中位数 {med:g}" not in " ".join(bosses["pacing"]["numbers"]):
        bad.append(f"BOSS 招式数中位数实算为 {med:g}，但 pacing.numbers 里没有写对")

    # 设计不变量 1：AoS 里没有「一招 BOSS」。2 招是下界
    thin = [b["name"] for b in bosses["bosses"] if len(b["moves"]) < 2]
    if thin:
        bad.append(f"以下 BOSS 少于 2 招，与「没有单一技能 BOSS」这条参照不符：{thin}")

    # 设计不变量 2：至少有一个 BOSS 招数上到 5+（说明它确实会用「多阶段多行为」压轴）
    if not any(len(b["moves"]) >= 5 for b in bosses["bosses"]):
        bad.append("没有任何 BOSS 的招式数达到 5 —— 最终 BOSS 的复杂度数据可能被抹平了")

    # 设计不变量 3：非单体受击面必须过半，否则「受击面是主要变量」这个结论不成立
    n_single_ = sum(1 for b in bosses["bosses"] if b["hurtbox"]["type"] == "single")
    if n_single_ * 2 >= len(bosses["bosses"]):
        bad.append(f"单体受击面的 BOSS 有 {n_single_} 个，已过半 —— "
                   f"「受击面是 AoS 的主要变化维度」这个结论不再成立，正文需要重写")

    # 非单体受击面的个数，同样要在 pacing.numbers 里对上
    n_single = sum(1 for b in bosses["bosses"] if b["hurtbox"]["type"] == "single")
    n_all = len(bosses["bosses"])
    if f"{n_all - n_single}/{n_all}" not in " ".join(bosses["pacing"]["numbers"]):
        bad.append(f"非单体受击面实算为 {n_all - n_single}/{n_all}，"
                   f"但 pacing.numbers 里没有这个数")

    eq = json.loads(EQUIP_JSON.read_text(encoding="utf-8"))
    w, ar, ac = eq["weapons"], eq["armor"], eq["accessories"]
    for key, real in (("weapons", len(w)), ("armor", len(ar)), ("accessories", len(ac))):
        if eq["meta"]["counts"][key] != real:
            bad.append(f"装备 {key} 实有 {real} 件，meta.counts 写的是 "
                       f"{eq['meta']['counts'][key]}")
    names = [x["name"] for x in w]
    if len(names) != len(set(names)):
        bad.append("武器表有重名条目")
    lo, hi = min(x["atk"] for x in w), max(x["atk"] for x in w)
    if f"{lo}（竹刀）" not in eq["meta"]["data_quality"]["atk_range"]:
        bad.append(f"武器 ATK 下限实算 {lo}，与 meta.data_quality.atk_range 不符")
    if f"→ {hi}" not in eq["meta"]["data_quality"]["atk_range"]:
        bad.append(f"武器 ATK 上限实算 {hi}，与 meta.data_quality.atk_range 不符")

    doc = {
        "meta": {
            "game": "Castlevania: Aria of Sorrow",
            "purpose": "敌人表的参照物。用于回答：一个区域的敌人强度分布、经验效率、魂与装备怎么分布。",
            "count": len(enemies),
            "source": "pixelguides.org/castlevania-aria-of-sorrow/enemies（2026-11-26 抓取，原始行见 tools/ref/_src/aos_enemies_raw.txt）",
            "id_note": "本表主键是 name，不是编号。源页面的编号在 29 号之后与游戏内图鉴编号错开，且 80/81 号重复，不可用作主键。",
            "truncated_note": "areas_en 末尾的 … 是源页面自身的截断标记，用 areas_truncated 单独记录 —— 按区域聚合时不能把它当成「完整列表」。",
            "soul_type_note": "red/blue/yellow/ability 已映射为 bullet/guardian/enchanted/ability，与 aos_souls.json 一致。",
        },
        "enemies": enemies,
        "area_pool": {k: sorted(v) for k, v in pool.items()},
    }
    return doc, bad


# ── 3. 数值公式回代 ────────────────────────────────────────────────────────

def seg_sum(segments: list[list[int]], level: int) -> int:
    """按「升到 L=lo 起每级 +step，到 L=hi 为止」累加到 level。

    段 [lo, hi, step] 的第 lo 级就已经吃到 step（因为 L1 是起点本身不加，
    所以首段从 2 开始）。这一点搞错会让每一级都差 1 —— 上一版就栽在这。
    """
    total = 0
    for lo, hi, step in segments:
        if level < lo:
            break
        total += (min(level, hi) - lo + 1) * step
    return total


def verify_formulas(sysdoc: dict) -> list[str]:
    """三重交叉，任何一条不过都算失败。

    ① 端点：从 L1 按分段累加到 L99，必须命中源表给的 L99 终值
    ② 检查点：L1/10/20/30/60 五个自洽点逐格比对
    ③ ATT ≡ STR 逐点成立
    """
    bad: list[str] = []
    segs = {f["stat"]: f.get("segments") for f in sysdoc["formulas"]}
    cp = sysdoc["checkpoints"]
    lv = cp["levels"]

    for stat in ("str", "con"):
        got = sysdoc["level_1"][stat] + seg_sum(segs[stat], 99)
        want = sysdoc["level_99"][stat]
        if got != want:
            bad.append(f"{stat} 分段累加到 L99 得 {got}，源表终值 {want}")

    for i, L in enumerate(lv):
        calc = {
            "hp": 320 + 12 * (L - 1),
            "lck": 9 + (L - 1),
            "str": sysdoc["level_1"]["str"] + seg_sum(segs["str"], L),
            "con": sysdoc["level_1"]["con"] + seg_sum(segs["con"], L),
        }
        for stat, got in calc.items():
            if got != cp[stat][i]:
                bad.append(f"{stat} 在 L{L} 算出 {got}，检查点 {cp[stat][i]}")
        if cp["att"][i] != cp["str"][i]:
            bad.append(f"ATT 在 L{L} 是 {cp['att'][i]}，但 STR 是 {cp['str'][i]} —— ATT≡STR 不成立")
    return bad


# ── 4. 生成 Markdown 表格块 ────────────────────────────────────────────────

def table(rows: list[str], head: str, sep: str) -> list[str]:
    return [head, sep] + rows


def render_tables(doc: dict) -> str:
    areas = json.loads(AREAS_JSON.read_text(encoding="utf-8"))["areas"]
    bosses = json.loads(BOSSES_JSON.read_text(encoding="utf-8"))
    sysobj = json.loads(SYSTEMS_JSON.read_text(encoding="utf-8"))
    enemies = doc["enemies"]
    by_name = {e["name"]: e for e in enemies}
    pool = doc["area_pool"]

    out = ["<!-- TABLES:START -->",
           "> 本节全部由 `tools/ref/aos_build.py` 生成，勿手改。改数据请改 JSON 或 raw。", ""]

    # A. 区域 × 敌人池
    out.append("### 附 A · 13 个区域\n")
    rows = []
    for a in areas:
        names = pool.get(a["id"], [])
        boss = "、".join(a["boss"]) or "—"
        entry = a["gate"]["entry"]
        rows.append(f"| {a['cn']} | {a['en']} | {a['role']} | {boss} | {entry} | **{len(names)}** |")
    out += table(rows,
                 "| 区域 | 英文 | 定位 | BOSS | 进入门槛 | 敌人种数 |",
                 "|---|---|---|---|---|---|")
    out.append("")

    # B. BOSS
    out.append("### 附 B · 11 个强制 BOSS\n")
    area_cn = {a["id"]: a["cn"] for a in areas}
    rows = []
    for b in bosses["bosses"]:
        hp = "—" if b["hp"] is None else f"{b['hp']:,}"
        rows.append(
            f"| {b['order']} | {b['cn']} | {b['name']} | {area_cn.get(b['area'], b['area'])} | {hp} | "
            f"{b['exp'] if b['exp'] else '—'} | {'、'.join(b['weak']) or '—'} | {b['soul'] or '—'} |")
    out += table(rows,
                 "| # | BOSS | 英文 | 区域 | HP | EXP | 弱点 | 给的魂 |",
                 "|---|---|---|---|---|---|---|---|")
    out.append("")
    out.append("**非强制精英**\n")
    rows = [f"| {e['cn']} | {e['name']} | {area_cn.get(e['area'], e['area'])} | {e['note']} |" for e in bosses["elites"]]
    out += table(rows, "| 精英 | 英文 | 区域 | 说明 |", "|---|---|---|---|")
    out.append("")

    # C. 按区域列敌人（紧凑，名字带 HP）
    out.append("### 附 C · 每个区域有哪些敌人\n")
    out.append("> 括号里是 HP。带 `…` 的敌人表示它还在别的区域出现，但源页面把列表截断了 —— "
               "所以「本区敌人」是**下界**，不是全部。\n")
    for a in areas:
        names = pool.get(a["id"], [])
        if not names:
            continue
        names = sorted(names, key=lambda n: by_name[n]["hp"])
        items = "、".join(f"{n}（{by_name[n]['hp']}）" for n in names)
        out.append(f"**{a['cn']}（{len(names)}）** {items}\n")

    # D. 数值检查点
    out.append("### 附 D · 成长检查点（不是逐级表）\n")
    out.append("> 源站的 1–99 逐级表有多处错位（L14/15 的 INT 回落、L44/45 的 CON 单级 +9、"
               "L67 的 HP 掉位），所以**不给逐级表**，只给「公式 + 五个自洽点 + 端点」。\n")
    cp = sysobj["checkpoints"]
    rows = []
    for i, L in enumerate(cp["levels"]):
        rows.append(f"| {L} | {cp['hp'][i]} | {cp['mp'][i]} | {cp['att'][i]} | "
                    f"{cp['def'][i]} | {cp['str'][i]} | {cp['con'][i]} | {cp['lck'][i]} |")
    out += table(rows,
                 "| 等级 | HP | MP | ATT | DEF | STR | CON | LCK |",
                 "|---|---|---|---|---|---|---|---|")
    out.append("")
    out.append(f"> L99 端点（源表给）：HP {sysobj['level_99']['hp']} · "
               f"MP {sysobj['level_99']['mp']} · STR {sysobj['level_99']['str']} · "
               f"CON {sysobj['level_99']['con']} · INT {sysobj['level_99']['int']} · "
               f"LCK {sysobj['level_99']['lck']} · 总经验 {sysobj['level_99']['total_exp']:,}\n")
    out.append("> **公式**：`HP = 320 + 12×(L−1)`；`LCK = 9 + (L−1)`；"
               "`STR` 分段 +1/+2/+3/+2/+1（10→198）；`CON` 分段 +1/+2/+3/+2/+1（12→170）；"
               "`ATT ≡ STR`。分段累加到 L99 与端点完全吻合，这是两个独立来源互证的结果。\n")

    # E. BOSS 招式与受击面
    #
    # 这张表是本轮最重要的产物。AoS 的 BOSS 招式数只有 2–3 招，
    # 真正让每场不一样的是「你打哪里」—— 受击面。所以招式列只写「怎么躲」，
    # 受击面列才是重点。
    out.append("### 附 E · 11 个 BOSS 的招式与受击面\n")
    legend = bosses["meta"]["hurtbox_legend"]
    out.append("> 受击面的九种类型见 `aos_bosses.json` 的 `meta.hurtbox_legend`。"
               "缩写：`single` 单体 / `directional` 方向性 / `part_immune` 部位免疫 / "
               "`threat_split` 威胁与受击分离 / `shell_core` 壳与核 / `multi_part` 多部位选一 / "
               "`decoy` 假目标 / `form_swap` 形态切换 / `threshold_end` 阈值终止。\n")
    rows = []
    for b in bosses["bosses"]:
        # 招式压成一行：名字（怎么躲）。table 里不写前摇，前摇太长，放到 JSON
        mv = "<br>".join(f"{m['name']}：{m['counter']}" for m in b["moves"])
        rows.append(
            f"| {b['order']} | {b['cn']} | **{len(b['moves'])}** | {b['phases']} | "
            f"`{b['hurtbox']['type']}` | {mv} |")
    out += table(rows,
                 "| # | BOSS | 招 | 阶段 | 受击面 | 招式与应对 |",
                 "|---|---|---|---|---|---|")
    out.append("")

    # E2. 受击面统计 —— 这张小表是「BOSS 复杂度来自哪里」的量化答案
    out.append("**受击面分布**\n")
    from collections import Counter
    cnt = Counter(b["hurtbox"]["type"] for b in bosses["bosses"])
    rows = []
    for t, n in cnt.most_common():
        names = "、".join(b["cn"] for b in bosses["bosses"] if b["hurtbox"]["type"] == t)
        # 组合类型（如 multi_part + decoy）没有单条说明，拆开逐条取
        why = "；".join(legend.get(x.strip(), "") for x in t.split("+") if legend.get(x.strip()))
        rows.append(f"| `{t}` | **{n}** | {names} | {why} |")
    out += table(rows, "| 受击面 | 个数 | 是谁 | 判据 |", "|---|---|---|---|")
    out.append("")
    n_single = cnt.get("single", 0)
    n_all = len(bosses["bosses"])
    out.append(f"> **{n_all - n_single}/{n_all} 个 BOSS 的受击面不是「全身一个判定」。**"
               f"而招式数的中位数是 2。这两条放在一起就是本文件的核心结论："
               f"AoS 用「打哪里」制造变化，不用「多几招」。\n")

    # F. 装备分布
    out.append("### 附 F · 104 件装备的数值分布\n")
    eq = json.loads(EQUIP_JSON.read_text(encoding="utf-8"))
    w, ar, ac = eq["weapons"], eq["armor"], eq["accessories"]
    rows = []
    for cat in ["剑斧锤", "短刀", "矛与刺剑", "拳套", "枪与特殊"]:
        g = [x for x in w if x["cat"] == cat]
        if not g:
            continue
        atks = sorted(x["atk"] for x in g)
        rows.append(f"| 武器 · {cat} | {len(g)} | {atks[0]}–{atks[-1]} | {atks[len(atks)//2]} | "
                    f"{sum(1 for x in g if x.get('element'))} 件带属性 |")
    defs = sorted(x["def"] for x in ar)
    rows.append(f"| 防具 | {len(ar)} | {defs[0]}–{defs[-1]} | {defs[len(defs)//2]} | "
                f"{sum(1 for x in ar if x.get('bonus'))} 件带属性加成 |")
    ads = sorted(x["def"] for x in ac)
    rows.append(f"| 饰品 | {len(ac)} | {ads[0]}–{ads[-1]} | {ads[len(ads)//2]} | "
                f"{sum(1 for x in ac if x.get('bonus'))} 件带特殊效果 |")
    out += table(rows, "| 类别 | 件数 | 数值范围 | 中位数 | 附加 |", "|---|---|---|---|---|")
    out.append("")
    top = sorted([x for x in w if not x.get("hard_only")], key=lambda x: -x["atk"])[:8]
    out.append("**普通模式 ATK 前 8**（困难模式专属不参与排序）\n")
    rows = [f"| {x['cn']} | {x['name']} | {x['atk']} | {'、'.join(x['element']) or '—'} | "
            f"{x['range']} | {'/'.join(x.get('bonus') or []) or '—'} | {x['found']} |" for x in top]
    out += table(rows, "| 武器 | 英文 | ATK | 属性 | 范围 | 加成 | 获取 |",
                 "|---|---|---|---|---|---|---|")
    out.append("")
    _top = sorted([x for x in w if not x.get("hard_only")], key=lambda x: -x["atk"])[:16]
    _src = [weapon_src(x) for x in _top]
    _shop = sum(1 for x in w if weapon_src(x) == "商店")
    out.append(f"> ATK 从 {min(x['atk'] for x in w)}（竹刀）到 {max(x['atk'] for x in w)}"
               f"（死神镰刀，困难模式）；普通模式上限 "
               f"{max(x['atk'] for x in w if not x.get('hard_only'))}（王者之剑，Boss Rush 奖励）。"
               f"**买得到的最强武器只有 92（阿斯卡隆）** —— 剩下的 28 点差距全部要靠探索和挑战换。\n")
    out.append(f"> 分布上更直白：**强的前 16 件里只有 {_src.count('商店')} 件能买**，"
               f"{_src.count('探索')} 件靠探索拾取、{_src.count('掉落')} 件靠敌人掉落、"
               f"{_src.count('Boss Rush')} 件靠 Boss Rush。"
               f"全 59 件里也只有 {_shop} 件进商店 —— **商店只负责「不掉队」，不负责「变强」**。"
               f"这是探索型数值设计的通用做法：把最强的装备放在「走过去」而不是「买得到」后面。\n")

    # G. 13 区面积实测
    # 表格本身不手写：数字全部来自 aos_measure.py 量出的 aos_map_area.json。
    # 手抄一遍就等于埋一个「文档与实测不一致」的坑。
    out.append("### 附 G · 13 区实际面积（逐张图实测）\n")
    ma = json.loads(MAP_AREA_JSON.read_text(encoding="utf-8"))
    rows = []
    for aid, r in sorted(ma["areas"].items(), key=lambda kv: -kv[1]["screens"]):
        share = r["screens"] / ma["totals"]["screens_all_13"] * 100
        rows.append(f"| {r['cn']} | **{r['screens']:g}** | {r['cells']:g} | "
                    f"{r['extent'][0]:g}×{r['extent'][1]:g} | {r['fill']*100:.0f}% | {share:.1f}% |")
    rows.append(f"| **合计** | **{ma['totals']['screens_all_13']:g}** | "
                f"**{ma['totals']['cells_all_13']:g}** | — | — | 100% |")
    out += table(rows,
                 "| 区域 | 面积（屏） | 地图格 | 外接（屏） | 填充率 | 占比 |",
                 "|---|---|---|---|---|---|")
    out.append("")
    t = ma["totals"]
    out.append(f"> 一屏 = 240×160 场景像素；一格 = 256×256（游戏的地图计量单位）。"
               f"计进地图 RATE 的是 12 区 {t['screens_rated_12']:g} 屏 / "
               f"{t['cells_rated_12']:g} 格 —— 混沌领域不进百分比。"
               f"**两条独立测量互相印证**：逐区 13 张图合计与全城堡整图（{t['whole_map_screens']:g} 屏）"
               f"相差 {t['area_sum_vs_whole_pct']}%。"
               f"填充率 = 面积 ÷ 外接，低于 30% 说明这个区是「长廊套房间」，不是方块。\n")

    out.append("<!-- TABLES:END -->")
    return "\n".join(out)


# ── 5. HTML ────────────────────────────────────────────────────────────────

CSS = """<style>
:root{--ink:#2b2620;--sub:#6b6153;--line:#cfc6b2;--bg:#f7f3e8;--card:#fffdf5;
      --red:#b03a2e;--blue:#3f6b8a;--yellow:#8a7a3a;--gray:#5c5a55;--green:#4a7a52}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
     font:14px/1.6 "PingFang SC","Microsoft YaHei",system-ui,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:28px 22px 64px}
h1{font-size:22px;margin:0 0 4px;letter-spacing:.5px}
.sub{color:var(--sub);font-size:12.5px;margin-bottom:22px}
h2{font-size:15px;margin:34px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:13px;margin:18px 0 8px;color:var(--sub);font-weight:600}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:4px;
      padding:10px 14px;min-width:104px}
.stat b{display:block;font-size:21px;line-height:1.2}
.stat span{font-size:11px;color:var(--sub)}
table{border-collapse:collapse;width:100%;font-size:12px;background:var(--card)}
th,td{border:1px solid var(--line);padding:4px 7px;text-align:left;vertical-align:top}
th{background:#f0ead9;font-weight:600;position:sticky;top:0;z-index:1}
tbody tr:nth-child(even){background:#faf6ea}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.tag{display:inline-block;padding:0 5px;border-radius:2px;font-size:10.5px;
     border:1px solid;line-height:15px;white-space:nowrap}
.tag.r{color:var(--red);border-color:#e0b3ad;background:#fbf0ee}
.tag.b{color:var(--blue);border-color:#b3c8d6;background:#eef3f6}
.tag.y{color:#7a6a2a;border-color:#ddd0a0;background:#f8f3e0}
.tag.g{color:var(--gray);border-color:#c9c6bf;background:#f2f1ee}
.tag.n{color:#9a907e;border-color:#ddd6c6;background:#f8f5ec}
.note{background:var(--card);border-left:3px solid #c9b98c;padding:9px 12px;
      margin:11px 0;font-size:12.5px}
.note b{color:#8a6a2f}
.warn{border-left-color:#b03a2e}.warn b{color:#b03a2e}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.cards3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
@media(max-width:860px){.grid2,.cards3{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:11px 13px}
.card h4{margin:0 0 5px;font-size:13px}
.card h4 span{font-size:10.5px;font-weight:400;color:#9a907e;margin-left:6px}
.card .r{font-size:12px;color:var(--sub);margin-bottom:7px;padding-bottom:6px;
         border-bottom:1px dashed #e3dcc9}
.card dl{margin:0;font-size:11.5px;color:var(--sub)}
.card dt{float:left;width:34px;color:#9a907e}
.card dd{margin:0 0 2px 34px}
.ctl{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
.ctl button{font:inherit;font-size:12px;padding:4px 11px;border:1px solid var(--line);
     background:var(--card);color:var(--ink);border-radius:3px;cursor:pointer}
.ctl button.on{background:var(--ink);color:#f7f3e8;border-color:var(--ink)}
.scroll{max-height:600px;overflow:auto;border:1px solid var(--line)}
.scroll table{border:0}.scroll th,.scroll td{border-left:0;border-right:0}
code{background:#efe9d8;padding:0 3px;border-radius:2px;font-size:11.5px}
.legend{font-size:11px;color:var(--sub);margin-top:6px}
svg text{font-family:"PingFang SC","Microsoft YaHei",sans-serif}
</style>"""


def esc(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def md_bold(s: str) -> str:
    """HTML 输出专用：数据里为了让 Markdown 表格加粗而写的 **x**，
    直接塞进 HTML 会把星号原样显示出来。这里统一转成 <b>。
    只在 HTML 侧用，Markdown 侧保留原文。"""
    import re
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", esc(s))


def scatter(enemies: list[dict]) -> str:
    """HP × EXP 散点。对数横轴，因为 HP 从 1 到 9999。"""
    W, H = 1080, 400
    L, R, T, B = 62, 18, 16, 40
    import math
    hps = [e["hp"] for e in enemies if e["hp"] > 0]
    exps = [e["exp"] for e in enemies if e["exp"] > 0]
    lx0, lx1 = math.log10(min(hps)), math.log10(max(hps))
    ly0, ly1 = math.log10(min(exps)), math.log10(max(exps))

    def px(hp):
        return L + (math.log10(hp) - lx0) / (lx1 - lx0) * (W - L - R)

    def py(ex):
        return H - B - (math.log10(ex) - ly0) / (ly1 - ly0) * (H - T - B)

    col = {"bullet": "var(--red)", "guardian": "var(--blue)",
           "enchanted": "var(--yellow)", "ability": "var(--gray)", None: "#c9c6bf"}
    dots = []
    for e in enemies:
        if e["hp"] <= 0 or e["exp"] <= 0:
            continue
        r = 3.4 if e["hp"] < 500 else 5.0
        dots.append(
            f'<circle cx="{px(e["hp"]):.1f}" cy="{py(e["exp"]):.1f}" r="{r}" '
            f'fill="{col[e["soul_type"]]}" fill-opacity=".62" stroke="#fffdf5" stroke-width=".7">'
            f'<title>{esc(e["name"])}  HP {e["hp"]} / EXP {e["exp"]}</title></circle>')

    # 网格与刻度
    ticks = []
    for dec in range(-1, 5):
        v = 10 ** dec
        if v < min(hps) or v > max(hps):
            continue
        x = px(v)
        ticks.append(f'<line x1="{x:.1f}" y1="{T}" x2="{x:.1f}" y2="{H-B}" stroke="#e3dcc9"/>')
        ticks.append(f'<text x="{x:.1f}" y="{H-B+15}" font-size="10" fill="#6b6153" '
                     f'text-anchor="middle">{v if v<1000 else str(v//1000)+"k"}</text>')
    for dec in range(0, 5):
        v = 10 ** dec
        if v < min(exps) or v > max(exps):
            continue
        y = py(v)
        ticks.append(f'<line x1="{L}" y1="{y:.1f}" x2="{W-R}" y2="{y:.1f}" stroke="#e3dcc9"/>')
        ticks.append(f'<text x="{L-8}" y="{y+3.5:.1f}" font-size="10" fill="#6b6153" '
                     f'text-anchor="end">{v if v<1000 else str(v//1000)+"k"}</text>')

    # 经验效率参考线：EXP/HP = 0.5 与 2
    ref = []
    for ratio, lab in ((0.5, "EXP/HP = 0.5"), (2.0, "EXP/HP = 2")):
        pts = []
        for i in range(60):
            hp = 10 ** (lx0 + (lx1 - lx0) * i / 59)
            ex = hp * ratio
            if ly0 <= math.log10(ex) <= ly1:
                pts.append(f'{px(hp):.1f},{py(ex):.1f}')
        if pts:
            ref.append(f'<polyline points="{" ".join(pts)}" fill="none" stroke="#b9ac8f" '
                       f'stroke-width="1" stroke-dasharray="4 4"/>')
            ref.append(f'<text x="{px(10**lx1)-4:.1f}" y="{py(10**lx1*ratio)-6:.1f}" '
                       f'font-size="9.5" fill="#9a907e" text-anchor="end">{lab}</text>')

    return (f'<svg viewBox="0 0 {W} {H}" width="100%" style="height:auto">'
            + "".join(ticks) + "".join(ref) + "".join(dots)
            + f'<text x="{L}" y="{H-8}" font-size="10.5" fill="#6b6153">HP（对数）</text>'
            + f'<text x="{W-R}" y="{T+10}" font-size="10.5" fill="#6b6153" text-anchor="end">EXP（对数）</text>'
            + "</svg>")


def curve(sysdoc: dict) -> str:
    """1–99 级成长曲线。用公式算，不用源表逐级值（那份表有错位）。

    每条线各自归一化到 0–100%，比的是「形状」—— 谁先加速、谁先见顶。
    """
    segs = {f["stat"]: f.get("segments") for f in sysdoc["formulas"]}
    lv = list(range(1, 100))
    series = [
        ("HP",  [320 + 12 * (L - 1) for L in lv], "var(--red)"),
        ("STR", [10 + seg_sum(segs["str"], L) for L in lv], "var(--blue)"),
        ("CON", [12 + seg_sum(segs["con"], L) for L in lv], "var(--green)"),
        ("LCK", [9 + (L - 1) for L in lv], "var(--yellow)"),
    ]
    W, H = 1080, 320
    L, R, T, B = 52, 118, 16, 34
    x0, x1 = lv[0], lv[-1]
    px = lambda L_: L + (L_ - x0) / (x1 - x0) * (W - L - R)
    parts = []
    for name, vals, color in series:
        lo, hi = min(vals), max(vals)
        py = lambda v: H - B - (v - lo) / (hi - lo) * (H - T - B)
        pts = " ".join(f"{px(l):.1f},{py(v):.1f}" for l, v in zip(lv, vals))
        parts.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2"/>')
        parts.append(f'<circle cx="{px(x1):.1f}" cy="{py(vals[-1]):.1f}" r="3" fill="{color}"/>')
        off = series.index((name, vals, color)) * 15 + 7  # 全部向下排，避免最高那条出界
        parts.append(f'<text x="{px(x1)+8:.1f}" y="{py(vals[-1])+3.5+off:.1f}" font-size="11" '
                     f'fill="{color}">{name} {vals[-1]}</text>')
    grid = []
    for L_ in (1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99):
        grid.append(f'<line x1="{px(L_):.1f}" y1="{T}" x2="{px(L_):.1f}" y2="{H-B}" stroke="#e3dcc9"/>')
        grid.append(f'<text x="{px(L_):.1f}" y="{H-B+15}" font-size="10" fill="#6b6153" '
                    f'text-anchor="middle">L{L_}</text>')
    return (f'<svg viewBox="0 0 {W} {H}" width="100%" style="height:auto">'
            + "".join(grid) + "".join(parts)
            + f'<text x="{L}" y="{H-6}" font-size="10.5" fill="#6b6153">等级（每条线各自归一化，比的是形状不是绝对值）</text>'
            + "</svg>")


def hbars(bosses: dict) -> str:
    """受击面分布的横条图。

    这里不用饼图：受击面只有 9 类而样本只有 11 个，
    饼图会把「1 个」画成一小块看不出差别，横条至少能对齐比较。
    """
    from collections import Counter
    cnt = Counter(b["hurtbox"]["type"] for b in bosses["bosses"])
    items = cnt.most_common()
    W, rowh, pad = 780, 30, 8
    H = len(items) * rowh + 22
    label_w, num_w = 210, 46
    bar_max = W - label_w - num_w
    mx = max(n for _, n in items)
    parts = []
    for i, (t, n) in enumerate(items):
        y = pad + i * rowh
        # single 用灰色（它是「没有变化」的基线），其余用红
        color = "var(--gray)" if t == "single" else "var(--red)"
        w = max(6, bar_max * n / mx)
        parts.append(f'<text x="0" y="{y+14}" font-size="11.5" fill="#2b2620">{esc(t)}</text>')
        parts.append(f'<rect x="{label_w}" y="{y+3}" width="{w:.1f}" height="{rowh-10}" '
                     f'fill="{color}" opacity="0.75" rx="2"/>')
        parts.append(f'<text x="{label_w+w+7:.1f}" y="{y+14}" font-size="11.5" '
                     f'fill="#2b2620">{n}</text>')
    return (f'<svg viewBox="0 0 {W} {H}" width="100%" style="height:auto">'
            + "".join(parts)
            + f'<text x="0" y="{H-4}" font-size="10.5" fill="#6b6153">'
              f'灰色 = 全身一个判定（没有变化）；红 = 受击面本身就是机制</text></svg>')


WEAPON_SRC_COLOR = {"Boss Rush": "var(--yellow)", "商店": "var(--gray)",
                    "掉落": "var(--blue)", "探索": "var(--red)"}


def weapon_src(x: dict) -> str:
    """一件武器的主获取方式。

    顺序有讲究：一件武器可能同时「能在某处捡到」和「某个敌人会掉」。
    主获取方式才算来源，所以「掉落」只在**开头**时才算掉落；
    出现在后半句（「…；掉落：某某」）说明那是副产物。
    """
    f = x.get("found") or ""
    if "Boss Rush" in f:
        return "Boss Rush"
    if "商店" in f:
        return "商店"
    if f.startswith("掉落"):
        return "掉落"
    return "探索"


def atk_bars(eq: dict, top_n: int = 16) -> str:
    """武器 ATK 阶梯。按来源着色，回答「多出的那 28 点 ATK 从哪来」。"""
    ws = [x for x in eq["weapons"] if not x.get("hard_only")]
    ws = sorted(ws, key=lambda x: -x["atk"])[:top_n]


    W, rowh, pad = 820, 26, 6
    H = len(ws) * rowh + 40
    label_w, num_w = 205, 96
    bar_max = W - label_w - num_w
    mx = max(x["atk"] for x in eq["weapons"])
    parts = []
    for i, x in enumerate(ws):
        y = pad + i * rowh
        s = weapon_src(x)
        color = WEAPON_SRC_COLOR[s]
        w = max(4, bar_max * x["atk"] / mx)
        parts.append(f'<text x="0" y="{y+12}" font-size="11" fill="#2b2620">'
                     f'{esc(x["cn"])}</text>')
        parts.append(f'<rect x="{label_w}" y="{y+2}" width="{w:.1f}" height="{rowh-9}" '
                     f'fill="{color}" opacity="0.72" rx="2"/>')
        parts.append(f'<text x="{label_w+w+7:.1f}" y="{y+12}" font-size="11" '
                     f'fill="#2b2620">{x["atk"]}</text>')
        parts.append(f'<text x="{W-num_w}" y="{y+12}" font-size="10.5" fill="#9a907e">{s}</text>')
    leg = ('<text x="0" y="%d" font-size="10.5" fill="#6b6153">'
           '红 探索拾取 · 蓝 敌人掉落 · 灰 商店 · 黄 Boss Rush 奖励</text>' % (H - 4))
    return (f'<svg viewBox="0 0 {W} {H}" width="100%" style="height:auto">'
            + "".join(parts) + leg + "</svg>")



def area_bars(ma: dict, areas: list[dict]) -> str:
    """13 区面积条形图。

    用「面积当量（屏）」而不是「外接尺寸」：外接尺寸会被 L 形/十字形虚胖
    （地下水域外接 35×22 屏，实际只有 204 屏，填充率 26%）。
    条形后面缀的百分比是同区填充率 —— 它告诉你这个区是「块」还是「廊」。
    """
    rows = sorted(ma["areas"].items(), key=lambda kv: -kv[1]["screens"])
    cn = {a["id"]: a for a in areas}
    W, rowh, pad = 860, 26, 6
    H = len(rows) * rowh + 42
    label_w, num_w = 190, 186
    # 末尾还要写「204.1 屏」，最长那条的标签不能顶到右列去
    bar_max = W - label_w - num_w - 80
    mx = rows[0][1]["screens"]
    parts = []
    for i, (aid, r) in enumerate(rows):
        y = pad + i * rowh
        a = cn.get(aid, {})
        w = max(4, bar_max * r["screens"] / mx)
        # 计 RATE 的区用红，混沌领域用灰（它不进百分比）
        color = "var(--gray)" if aid == "chaotic_realm" else "var(--red)"
        parts.append(f'<text x="0" y="{y+12}" font-size="11" fill="#2b2620">'
                     f'{esc(r["cn"])}</text>')
        parts.append(f'<rect x="{label_w}" y="{y+2}" width="{w:.1f}" height="{rowh-9}" '
                     f'fill="{color}" opacity="0.72" rx="2"/>')
        parts.append(f'<text x="{label_w+w+7:.1f}" y="{y+12}" font-size="11" '
                     f'fill="#2b2620">{r["screens"]:g} 屏</text>')
        parts.append(f'<text x="{W-num_w}" y="{y+12}" font-size="10.5" fill="#9a907e">'
                     f'{r["extent"][0]:g}×{r["extent"][1]:g} · {r["fill"]*100:.0f}%</text>')
    leg = ('<text x="0" y="%d" font-size="10.5" fill="#6b6153">'
           '红 = 计进地图 RATE 的 12 区；灰 = 混沌领域（不进百分比）。'
           '右侧「填」是填充率：越低越像长廊，越高越像块</text>' % (H - 4))
    return (f'<svg viewBox="0 0 {W} {H}" width="100%" style="height:auto">'
            + "".join(parts) + leg + "</svg>")


def render_html(doc: dict) -> str:
    areas = json.loads(AREAS_JSON.read_text(encoding="utf-8"))["areas"]
    bosses = json.loads(BOSSES_JSON.read_text(encoding="utf-8"))
    sysdoc = json.loads(SYSTEMS_JSON.read_text(encoding="utf-8"))
    enemies = doc["enemies"]
    by_name = {e["name"]: e for e in enemies}
    pool = doc["area_pool"]
    area_cn = {a["en"]: a["cn"] for a in areas}
    area_cn.update({a["id"]: a["cn"] for a in areas})  # BOSS 的 area 字段是 id 不是 en

    n_by_type = {}
    for e in enemies:
        n_by_type[e["soul_type"]] = n_by_type.get(e["soul_type"], 0) + 1

    stats = "".join(
        f'<div class="stat"><b>{v}</b><span>{k}</span></div>' for k, v in [
            (f"{len(enemies)}", "敌人（去重后）"),
            ("13", "区域"),
            ("11", "强制 BOSS"),
            (f"{n_by_type.get('bullet',0)}", "掉红魂"),
            (f"{n_by_type.get('guardian',0)}", "掉蓝魂"),
            (f"{n_by_type.get('enchanted',0)}", "掉黄魂"),
            (f"{n_by_type.get('ability',0)}", "敌人掉银魂（共 6 个，其余靠拾取）"),
        ])

    MA = json.loads(MAP_AREA_JSON.read_text(encoding="utf-8"))
    rowh = MA["areas"]
    cards = []
    for a in areas:
        names = pool.get(a["id"], [])
        cards.append(
            f'<div class="card"><h4>{a["cn"]}<span>{a["en"]}</span></h4>'
            f'<div class="r">{a["role"]}</div>'
            f'<dl><dt>BOSS</dt><dd>{"、".join(a["boss"]) or "—"}</dd>'
            f'<dt>进门</dt><dd>{a["gate"]["entry"]}</dd>'
            f'<dt>走完</dt><dd>{a["gate"]["full"]}</dd>'
            f'<dt>规模</dt><dd>{rowh.get(a["id"], {}).get("screens", "—")} 屏'
            f' / {rowh.get(a["id"], {}).get("cells", "—")} 格</dd>'
            f'<dt>敌人</dt><dd>{len(names)} 种' 
            + (f'（{a["enemy_data_gap"][:14]}…）' if not names and a.get('enemy_data_gap') else '') 
            + '</dd></dl></div>')

    rows = []
    for e in sorted(enemies, key=lambda x: (-x["hp"], x["name"])):
        t = e["soul_type"]
        tag = f'<span class="tag { {"bullet":"r","guardian":"b","enchanted":"y","ability":"g"}.get(t,"n") }">{SOUL_CN.get(t,"无魂")}</span>' if t else '<span class="tag n">无魂</span>'
        loc = "、".join(area_cn.get(x, x) for x in e["areas_en"]) + ("…" if e["areas_truncated"] else "")
        rows.append(
            f'<tr data-t="{t or "none"}" data-a="{",".join(e["areas_en"])}">'
            f'<td>{esc(e["name"])}</td><td>{tag}</td>'
            f'<td class="num">{e["hp"]}</td><td class="num">{e["exp"]}</td>'
            f'<td>{esc(e["soul_name"] or "—")}</td>'
            f'<td class="num">{e["soul_rarity"] if e["soul_rarity"] else "—"}</td>'
            f'<td>{esc("、".join(e["weak"]) or "—")}</td>'
            f'<td>{esc("、".join(e["drops"]) or "—")}</td>'
            f'<td>{loc}</td></tr>')

    brow = []
    for b in bosses["bosses"]:
        brow.append(
            f'<tr><td class="num">{b["order"]}</td><td>{b["cn"]}<br><span style="color:#9a907e;font-size:11px">'
            f'{b["name"]}</span></td><td>{area_cn.get(b["area"], b["area"])}</td>'
            f'<td class="num">{b["hp"] if b["hp"] is not None else "—"}</td>'
            f'<td class="num">{b["exp"] or "—"}</td>'
            f'<td class="num">{len(b["moves"])}</td>'
            f'<td><code style="font-size:10.5px">{b["hurtbox"]["type"]}</code></td>'
            f'<td>{esc("、".join(b["weak"]) or "—")}</td>'
            f'<td style="font-size:11.5px">{md_bold(b["role"])}</td></tr>')

    # BOSS 卡片：每张卡的重点是「招式怎么躲」和「打哪里」
    bcards = []
    for b in bosses["bosses"]:
        mv = "".join(
            f'<div style="margin:0 0 4px"><b style="font-weight:600">{md_bold(m["name"])}</b>'
            f'<span style="color:#9a907e"> · {md_bold(m["tell"])}</span><br>'
            f'<span style="color:var(--red)">→</span> {md_bold(m["counter"])}</div>'
            for m in b["moves"])
        bcards.append(
            f'<div class="card"><h4>{b["order"]}. {b["cn"]}'
            f'<span>{len(b["moves"])} 招 / {b["phases"]} 阶段</span></h4>'
            f'<div class="r"><code style="font-size:10.5px">{b["hurtbox"]["type"]}</code> · '
            f'{md_bold(b["hurtbox"]["detail"])}</div>'
            f'<div style="font-size:11.5px;color:var(--sub)">{mv}</div>'
            f'<div style="margin-top:6px;padding-top:5px;border-top:1px dashed #e3dcc9;'
            f'font-size:11px;color:#8a6a2f">教什么：{md_bold(b["teaches"])}</div></div>')

    area_btn = "".join(f'<button data-f="{a["en"]}">{a["cn"]}</button>' for a in areas)
    ab_area = area_bars(MA, areas)
    hb = hbars(bosses)
    _eq = json.loads(EQUIP_JSON.read_text(encoding="utf-8"))
    ab = atk_bars(_eq)
    _top = sorted([x for x in _eq["weapons"] if not x.get("hard_only")],
                  key=lambda x: -x["atk"])[:16]
    _src = [weapon_src(x) for x in _top]
    n_shop, n_explore, n_drop = _src.count("商店"), _src.count("探索"), _src.count("掉落")
    return f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>《晓月圆舞曲》完整资料总览</title>{CSS}</head><body><div class="wrap">

<h1>《恶魔城：晓月圆舞曲》完整资料总览</h1>
<div class="sub">{len(enemies)} 个敌人 · 13 个区域 · 11 个强制 BOSS · 1–99 级公式与检查点 ·
数据源 pixelguides / StrategyWiki / GameFAQs · 生成于 <code>tools/ref/aos_build.py</code>，勿手改</div>

<div class="stats">{stats}</div>

<div class="note warn"><b>先看这条：</b>源页面的敌人编号在 29 号之后与游戏内图鉴编号错开，
80/81 号还是同一个敌人。所以本表<b>不用编号做主键，用名字</b>。看到「编号 79 是死人十字军」
这种说法，先问是哪套编号。</div>

<h2>1. 敌人的强度与经验分布</h2>
<p style="font-size:12.5px;color:var(--sub);margin:0 0 8px">
横轴 HP（对数）、纵轴 EXP（对数）。虚线是「经验效率」等值线 —— 落在上面表示
「血少经验多」，是刷级点；落在下面表示「血多经验少」，是硬骨头。
</p>
{scatter(enemies)}
<div class="legend">
<span class="tag r">红魂</span> <span class="tag b">蓝魂</span>
<span class="tag y">黄魂</span> <span class="tag g">银魂</span>
<span class="tag n">无魂</span>
</div>

<h2>2. 等级成长</h2>
<p style="font-size:12.5px;color:var(--sub);margin:0 0 8px">
HP 是完美线性（320 + 12×(L−1)）；LCK 也是纯直线；STR / CON 是五段折线，斜率在
+1 / +2 / +3 / +2 / +1 之间切换，但**整条线仍然接近直线** —— 归一化后几乎看不出弯。
这是全图最要紧的一点：<b>《晓月》的等级成长没有指数段</b>。它的爽感不来自「升级越来越快」，
而来自「换了一件装备，战力突然跳一档」。
</p>
{curve(sysdoc)}

<h2>3. 13 个区域</h2>
<div class="cards3">{"".join(cards)}</div>

<h3>3.1 每个区实际多大（实测）</h3>
<p style="font-size:12.5px;color:var(--sub);margin:0 0 8px">
《晓月》不按「房间」计量，它按<b>地图格</b>：一格 = 场景 256×256 px，走进去就点亮，
RATE 就是点亮格数的占比。所以这里量的是<b>面积当量</b>（一屏 = 240×160 px），
而不是房间数 —— 房间大小在 1–4 屏之间浮动，跨游戏硬比房间数会把「大小不同」误读成「数量不同」。
13 区合计 <b>{MA["totals"]["screens_all_13"]:g} 屏</b>（计 RATE 的 12 区 {MA["totals"]["screens_rated_12"]:g} 屏），
折合 <b>{MA["totals"]["cells_rated_12"]:g} 个地图格</b>。
</p>
{ab_area}

<h2>4. 11 个强制 BOSS：招式少，受击面变</h2>
<p style="font-size:12.5px;color:var(--sub);margin:0 0 8px">
招式数的中位数是 <b>2</b>。前七个 BOSS 里六个只有 2–3 招。
但 11 个里有 <b>8 个</b>的受击面不是「全身一个判定」——
AoS 用「你打哪里、你站哪里」制造难度，不用「它多几招」。
巴洛尔最极端：身体不伤人、拳头打不掉血，于是最安全的位置在砸下来的拳头正下方。
</p>
<div class="scroll"><table>
<thead><tr><th>#</th><th>BOSS</th><th>区域</th><th>HP</th><th>EXP</th><th>招</th><th>受击面</th><th>弱点</th><th>它在这条流程里干什么</th></tr></thead>
<tbody>{"".join(brow)}</tbody></table></div>

<h3>4.1 每场战斗：打哪里，怎么躲</h3>
<div class="cards3">{"".join(bcards)}</div>

<h3>4.2 受击面分布</h3>
{hb}

<h2>5. 武器的数值阶梯</h2>
<p style="font-size:12.5px;color:var(--sub);margin:0 0 8px">
59 件武器的 ATK 分布。买得到的最强只有 <b>92</b>（阿斯卡隆，12000 G），
剩下的 28 点差距全部靠探索、掉落和 Boss Rush 换 —— 这是「探索」在数值上的定价。
**强的前 16 件里，{n_shop} 件能买、{n_explore} 件靠探索、{n_drop} 件靠掉落。**
</p>
{ab}

<h2>6. 全敌人表（{len(enemies)} 条，可按魂类型或区域筛）</h2>
<div class="ctl">
  <button class="on" data-f="all">全部</button>
  <button data-f="bullet">红魂</button>
  <button data-f="guardian">蓝魂</button>
  <button data-f="enchanted">黄魂</button>
  <button data-f="ability">银魂</button>
  <button data-f="none">无魂</button>
</div>
<div class="ctl" style="margin-top:-4px">{area_btn}</div>
<div class="scroll"><table id="all">
<thead><tr><th>敌人</th><th>魂</th><th>HP</th><th>EXP</th><th>魂名</th><th>稀有度</th><th>弱点</th><th>掉落</th><th>区域</th></tr></thead>
<tbody>{"".join(rows)}</tbody></table></div>
<div class="legend">稀有度 = 约每 N 次击杀掉 1 次（1/N）。区域列末尾的 … 表示源页面截断了列表。</div>

<script>
(function(){{
  var t='all', a='all';
  function apply(){{
    document.querySelectorAll('#all tbody tr').forEach(function(tr){{
      var okT = (t==='all' || tr.dataset.t===t);
      var okA = (a==='all' || (tr.dataset.a||'').split(',').indexOf(a)>=0);
      tr.style.display = (okT && okA) ? '' : 'none';
    }});
  }}
  document.querySelectorAll('.ctl button').forEach(function(b){{
    b.onclick = function(){{
      var f=b.dataset.f;
      if(f && f!=='all' && ['bullet','guardian','enchanted','ability','none'].indexOf(f)>=0){{
        t = (t===f)?'all':f;
        b.parentNode.querySelectorAll('button').forEach(function(x){{x.classList.remove('on')}});
        if(t!=='all') b.classList.add('on'); else b.parentNode.querySelector('button').classList.add('on');
      }} else if(f&&f!=='all'){{
        a = (a===f)?'all':f;
        b.parentNode.querySelectorAll('button').forEach(function(x){{x.classList.remove('on')}});
        if(a!=='all') b.classList.add('on');
      }} else {{
        t='all'; a='all';
        document.querySelectorAll('.ctl button').forEach(function(x){{x.classList.remove('on')}});
        b.classList.add('on');
      }}
      apply();
    }};
  }});
}})();
</script>

</div></body></html>
"""


# ── main ──────────────────────────────────────────────────────────────────

def main() -> int:
    doc, bad = build()
    sysobj = json.loads(SYSTEMS_JSON.read_text(encoding="utf-8"))
    bad += verify_formulas(sysobj)

    # BOSS 引用的区域必须存在；BOSS 名必须在敌人表里（或在魂表里，如 Galamoth
    # 只在魂表出现 —— 源敌人表漏收了这个精英）
    areas_ids = {a["id"] for a in json.loads(AREAS_JSON.read_text(encoding="utf-8"))["areas"]}
    bosses = json.loads(BOSSES_JSON.read_text(encoding="utf-8"))
    names = {e["name"] for e in doc["enemies"]}
    soul_names = {s["en"] for s in json.loads(SOULS_JSON.read_text(encoding="utf-8"))["souls"]}
    for b in bosses["bosses"] + bosses["elites"]:
        if b["area"] not in areas_ids:
            bad.append(f"BOSS {b['name']} 的区域 id「{b['area']}」不存在")
        probe = "Belmont" if b["name"] == "Julius Belmont" else b["name"].split(" ")[0]
        if not (b["name"] in names or probe in names or b["name"] in soul_names):
            bad.append(f"BOSS {b['name']} 在敌人表和魂表里都找不到")

    # 面积实测：区域集合必须一一对应，总数必须等于逐项之和
    ma = json.loads(MAP_AREA_JSON.read_text(encoding="utf-8"))
    if set(ma["areas"]) != areas_ids:
        bad.append(f"aos_map_area.json 的区域集合与 aos_areas.json 不一致："
                   f"多 {set(ma['areas']) - areas_ids}，缺 {areas_ids - set(ma['areas'])}")
    s_all = sum(r["screens"] for r in ma["areas"].values())
    if abs(s_all - ma["totals"]["screens_all_13"]) > 0.5:
        bad.append(f"面积合计对不上：逐项和 {s_all:g} vs 记录 {ma['totals']['screens_all_13']:g}")

    # §3.8 是手写的，里面引了四个实测数。手写数字是最容易烂的地方（附 G 是生成的，
    # 会自己更新，所以只查 §3.8 那一段，别让生成表把断言糊过去）。
    if MD.exists():
        md = MD.read_text(encoding="utf-8")
        if "### 3.8" in md and "## 4." in md:
            sec = md.split("### 3.8")[1].split("## 4.")[0]
            t = ma["totals"]
            lines = sec.splitlines()
            def has(*needles: str) -> bool:
                """同一行里同时出现这些片段才算数。
                只查「文中出现过 1210.8」是不够的 —— 这个数在 §3.8 里出现两次，
                改错一处另一处还能把断言糊过去（反向验证时踩过）。"""
                return any(all(n in ln for n in needles) for ln in lines)
            for needles, what in [
                (("逐区", f"{t['screens_all_13']:.1f} 屏"), "A 路（逐区）面积"),
                (("整图", f"{t['whole_map_screens']:.1f} 屏"), "B 路（整图）面积"),
                (("混沌领域", f"{t['cells_rated_12']:.0f} 格"), "地图格数"),
                (("中位数", "83.3 屏"), "单区面积中位数"),
            ]:
                if not has(*needles):
                    bad.append(f"§3.8 的{what}对不上实测（同一行应同时出现 {'、'.join(needles)}）")

    if bad:
        die(bad)

    if "--check" in sys.argv:
        print(f"✓ 资料库一致：{len(doc['enemies'])} 敌人 / 13 区域 / "
              f"{len(bosses['bosses'])} BOSS / 公式端点+五点回代全通过 / 魂名交叉引用全对上 / "
              f"面积 {ma['totals']['screens_all_13']:g} 屏")
        return 0

    ENEMIES_JSON.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    block = render_tables(doc)
    if MD.exists():
        src = MD.read_text(encoding="utf-8")
        if "<!-- TABLES:START -->" in src:
            head = src.split("<!-- TABLES:START -->")[0]
            tail = src.split("<!-- TABLES:END -->")[-1]
            src = head + block + tail
        else:
            src = src.rstrip() + "\n\n" + block + "\n"
        MD.write_text(src, encoding="utf-8")
    else:
        MD.write_text(block + "\n", encoding="utf-8")

    HTML.write_text(render_html(doc), encoding="utf-8")
    print(f"✓ 生成 {ENEMIES_JSON.name}（{len(doc['enemies'])} 条）/ "
          f"{MD.name} / {HTML.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
