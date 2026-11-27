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
DOC02 = GDD / "02_战斗系统.md"
DOC_REF = REF / "REF_TREE_PHYSIOLOGY.md"
JSON_REF = REF / "tree_physiology_refs.json"
ENEMY_DIR = ROOT / "art" / "approved" / "Enemies"
TERRAIN_DIR = ROOT / "art" / "approved" / "Terrain"
ASSET_RULES = ROOT / "art" / "ASSET_RULES.md"
SCENE_TOOL = ROOT / "art" / "tools" / "scene_state.py"

# 八处翻译：系统词 → 生理词（必须同一行出现）
MAPPINGS = [
    ("清完一个区域", "打通一段被堵的管"),
    ("得到一块地", "断面"),
    ("打怪掉种子", "取回"),
    ("种植 → 收成", "愈伤组织"),
    ("守卫军", "免疫细胞"),
    ("袭击", "感染复发"),
    ("两类怪物", "女巫扫帚"),
    ("物资两分", "原住民培育"),
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
    if len(d["design_map"]) != len(MAPPINGS):
        errs.append(f"JSON: design_map 有 {len(d['design_map'])} 条，脚本认的是 {len(MAPPINGS)} 处翻译")

    # ── 第二轮：寄生 / 黑化 / 物资（2026-11-27）
    p, dk, df, ms = d["parasite"], d["darkening"], d["deformity"], d["material_split"]

    # 吸器必须是双向的。单向的话"注入黑暗物质"就没有通道，得另编一套机制
    if "双向" not in p["direction"]:
        errs.append("JSON: 吸器不是双向 —— '注入黑暗物质'失去了物理通道，整条设定要另编")
    # 必须同时接木质部与韧皮部，否则"吸养料"只吸到一半
    if not ("木质部" in p["connects_to"] and "韧皮部" in p["connects_to"]):
        errs.append("JSON: 吸器没同时接木质部与韧皮部 —— 吸养料吸不全")
    # 网络属性：没有它，"感染跨区/复发"就没有依据
    if not p["network"]:
        errs.append("JSON: parasite.network=false —— 感染会跨区、会复发这两条失去依据")

    # 变黑必须有物质机制（黑色素/栓塞），不能是滤镜
    if "黑色素" not in dk["melanin"]:
        errs.append("JSON: darkening 没写黑色素 —— '黑'会变成纯美术，撑不住'黑就是堵'")
    if not ("栓塞" in dk["mechanism"] or "堵" in dk["mechanism"]):
        errs.append("JSON: darkening 机制里没有栓塞/堵塞 —— 黑暗化与运输中断就不是同一件事了")

    # 潜伏期必须长于 0：病先在皮下长几年才冒芽，这条支撑"表面健康其实已感染"
    if df["latency_years"][0] <= 0:
        errs.append("JSON: 女巫扫帚没有潜伏期 —— '看着健康的枝条早已感染'这句失去依据")

    # 物资两分：可种必须可再生，不可种必须不可再生（反过来整个经济就塌）
    if not ms["cultivated"]["renewable"]:
        errs.append("JSON: 战斗物资标成不可再生 —— 种田就没有产出循环了")
    if ms["wild"]["renewable"]:
        errs.append("JSON: 稀有/任务物品标成可再生 —— 主线可以被刷绕过")
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
        errs.append("05 §1.7: 没有「不接数值」的禁令 —— 树会变成第四个系统")
    if not same_line(seg15, "健康度", "不做"):
        errs.append("05 §1.7: 没写「不做健康度进度条」—— 迟早有人加")

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


def check_parasite(r05: str, r03: str, r02: str) -> list[str]:
    """第二轮：怪物本质、黑化、物资两分（2026-11-27 白哥定）。"""
    errs: list[str] = []

    # 1. 05 §1.5 入侵者：四件事必须在位
    seg = tree_section(r05, "### 1.5", "### 1.6")
    if not seg:
        errs.append("05: 找不到 §1.5「入侵者」—— 怪物是什么又变成空白")
        return errs
    for k in ("寄生虫", "黑暗世界树", "双向", "外来物种"):
        if k not in seg:
            errs.append(f"05 §1.5: 少了「{k}」—— 白哥定的怪物本质缺一块")
    if "黑和堵是同一件事" not in seg:
        errs.append("05 §1.5: 少了「黑和堵是同一件事」—— 黑暗化会变成独立于堵塞的第二套设定")
    if "女巫扫帚" not in seg:
        errs.append("05 §1.5: 少了「女巫扫帚」—— 原生物种被改写没有可辨识形态")
    if not same_line(seg, "能不能招安", "只能打"):
        errs.append("05 §1.5: 两类怪的招安分工表没了 —— 分类就不再长出一个选择")

    # 2. 05 §1.6 物资两分
    seg16 = tree_section(r05, "### 1.6", "### 1.7")
    if not seg16:
        errs.append("05: 找不到 §1.6「物资两个来路」")
    else:
        if "不可种" not in seg16:
            errs.append("05 §1.6: 没写「不可种」那一侧 —— 物资又只剩一个来路")
        if not same_line(seg16, "稀有", "永远不能种"):
            errs.append("05 §1.6: 少了「稀有物品永远不能种」这条红线")

    # 3. 03 §0.1 田的主人 + §0.2 物资两分
    seg03 = tree_section(r03, "## 0.", "## 1.")
    if "原住民" not in seg03:
        errs.append("03 §0.1: 没写「田的主人是原住民」—— 主角又变回农夫")
    if "不会这门手艺" not in seg03:
        errs.append("03 §0.1: 没写「主角不会这门手艺」—— '他为什么能种田'又成了漏洞")
    if "永远不能种" not in seg03:
        errs.append("03 §0.2: 没写「稀有物品永远不能种」—— 主线可以被种田刷过去")

    # 4. 旧口径必须清掉：守卫军不是'吸血虫'（外来寄生虫不能招安）
    if "吸血虫" in r03:
        errs.append("03 §6: 仍写着守卫军是「吸血虫」—— 外来寄生虫不能招安，与 05 §1.5 直接矛盾")

    # 5. 02 §5.3 的敌人表必须有「来源」列，且首发全是原生
    seg02 = tree_section(r02, "### 5.3", "### 5.4")
    if seg02:
        # 必须查**表头行**：整段含"来源"不够 —— 表下面那句解释里也有"来源"两个字，
        # 删掉列名照样能糊过去（这条是反向验证抓出来的，别改回去）
        hdr = [ln for ln in seg02.splitlines() if ln.strip().startswith("| 名")]
        if not hdr or "来源" not in hdr[0]:
            errs.append("02 §5.3: 敌人表头没有「来源」列 —— 两类怪只活在叙事文档里")
        else:
            ncol = hdr[0].count("|")
            bad = [ln for ln in seg02.splitlines()
                   if ln.strip().startswith("| **") and ln.count("|") != ncol]
            if bad:
                errs.append(f"02 §5.3: 有 {len(bad)} 行敌人数据列数与表头不一致 —— "
                            "「来源」列被删了但数据没跟着删，表会错位")
        if not same_line(seg02, "**纸团**", "原生"):
            errs.append("02 §5.3: 「纸团」没标「原生」—— 来源列填了也不对")
        n_native = sum(1 for ln in seg02.splitlines()
                       if ln.strip().startswith("| **") and "原生" in ln and "外来" not in ln)
        if n_native < 5:
            errs.append(f"02 §5.3: 只有 {n_native} 个敌人标了「原生」，首发应为 5 个")
    else:
        errs.append("02: 找不到 §5.3「根系 5 种」—— 敌人表被挪走了，来源列无人守")
    return errs


def table_cells(seg: str, header_kw: str) -> tuple[list[str], list[list[str]]]:
    """取一张 markdown 表：返回 (表头单元格, 数据行单元格)。

    为什么不用正则扫全文：本项目已经栽过三次「拿关键词比整段」——
    表下面那句解释文字里也有同样的词，于是删掉列名照样 PASS。
    这里**只从表头行往下取**，越过表头就停，逼断言盯住结构位置。
    """
    lines = seg.splitlines()
    start = next((i for i, l in enumerate(lines)
                  if l.strip().startswith("|") and header_kw in l), None)
    if start is None:
        return [], []
    hdr = [c.strip() for c in lines[start].strip().strip("|").split("|")]
    rows = []
    for l in lines[start + 2:]:            # 跳过表头 + |---| 分隔行
        if not l.strip().startswith("|"):
            break
        rows.append([c.strip() for c in l.strip().strip("|").split("|")])
    return hdr, rows


def check_duo(r05: str, r03: str, r02: str) -> list[str]:
    """第三轮：原住民两态 / 一套造型两套色系（2026-11-27 白哥定）。"""
    errs: list[str] = []

    # 1. 05 §1.5.1 必须在，且白哥两个要点都在
    seg = tree_section(r05, "#### 1.5.1", "## 2.")
    if not seg:
        errs.append("05: 找不到 §1.5.1「原住民一直站在你面前」—— 两套色系没有叙事落点")
    else:
        for k in ("完全同样造型", "两套色系", "原住民一直站在你面前"):
            if k not in seg:
                errs.append(f"05 §1.5.1: 少了「{k}」—— 白哥这条设定缺一块")
        # 白哥给的两个例子必须原样在（换了名字就是换了设定）
        for a, b in (("史莱姆", "小精灵"), ("蝙蝠", "粉翼蝠")):
            if not same_line(seg, a, b):
                errs.append(f"05 §1.5.1: 例子「{a} ↔ {b}」不在了 —— 白哥举的实例被改掉")
        # 断言不能用「换色系」这种泛词：§1.5.1 里"换色系 + 换眼睛"也含它，
        # 删掉真正的约束句照样 PASS（反向验证第一次就抓到了这个）。
        # 必须要求两个特异词同行：「换色」+「轮廓」—— 后者整节只出现在那句约束里。
        if not same_line(seg, "换色", "轮廓"):
            errs.append("05 §1.5.1: 没有一行同时写「换色」和「轮廓」"
                        "—— 约束句被删，读者会以为是换一套模型，美术量翻倍")

    # 2. 05 §5 敌人表：每一行都必须有原住民态
    seg5 = tree_section(r05, "## 5. 敌人", "### 5.1")
    hdr, rows = table_cells(seg5, "原住民态")
    if not hdr:
        errs.append("05 §5: 敌人表没有「原住民态」列 —— 两套色系只活在 §1.5.1 的散文里")
    else:
        ci = next((i for i, h in enumerate(hdr) if "原住民态" in h), -1)
        empty = [r[0] for r in rows if ci >= 0 and (ci >= len(r) or not r[ci].strip("—*- "))]
        if ci < 0:
            errs.append("05 §5: 「原住民态」列名读不出来")
        elif empty:
            errs.append(f"05 §5: {len(empty)} 个敌人没有原住民态（{', '.join(empty)}）"
                        "—— 有暗色没亮色，等于只有一套")
        if len(rows) != 5:
            errs.append(f"05 §5: 敌人表 {len(rows)} 行，首发应为 5")

    # 3. 05 §5.2：外来种必须永远没有 ally
    seg52 = tree_section(r05, "### 5.2", "### 5.3")
    if "永远不给" not in seg52 or "_ally" not in seg52:
        errs.append("05 §5.2: 没写「外来种永远不给 _ally 版」—— 一旦给了'健康的藤'，分类就塌")

    # 4. 03 §6：招安的画面反馈必须是换色，不是变身
    seg6 = tree_section(r03, "## 6. 守卫军", "## 7.")
    if "换色" not in seg6:
        errs.append("03 §6: 招安没写「换色」—— 玩法反馈与资产（两套色）脱节")
    if "变身" in seg6 and "不是变身" not in seg6:
        errs.append("03 §6: 招安写成了「变身」—— 变身要新模型，两套色系就白做了")
    # 招安 ≠ 复原：守军能守不能种。少了这条，下一个读者会问"人都回来了为什么还要我种"，
    # 顺着改就把 30 分钟成熟 + 回访整个循环拆了。
    if not same_line(seg6, "守田", "不能种田"):
        errs.append("03 §6: 没写「守卫军能守田、不能种田」—— 招安≠复原一松，回访循环会被删掉")

    # 5. 02 §5.3：表头必须有物种 / 原住民态，且 5 行都填
    seg02 = tree_section(r02, "### 5.3", "### 5.4")
    hdr2, rows2 = table_cells(seg02, "原住民态")
    if not hdr2:
        errs.append("02 §5.3: 敌人表没有「原住民态」列 —— 战斗章看不到两套色")
    else:
        for col in ("物种", "原住民态"):
            if not any(col in h for h in hdr2):
                errs.append(f"02 §5.3: 表头缺「{col}」列")
        ci = next((i for i, h in enumerate(hdr2) if "原住民态" in h), -1)
        empty = [r[0] for r in rows2 if ci >= 0 and (ci >= len(r) or not r[ci].strip("—*- "))]
        if empty:
            errs.append(f"02 §5.3: {len(empty)} 个敌人没填原住民态（{', '.join(empty)}）")

        # 6. 文档说 5 种，磁盘上就必须有 5 种 × 2 态。
        # 加这条之前，02 写着 5 种而 art/approved/Enemies 只有 3 种，
        # 两边各自都"合法"，谁也不报错 —— 美术欠账就是这么藏住的。
        # 判据必须指向**文件存在**，不是指向文档里有个名字。
        if "资产键" not in "".join(hdr2):
            errs.append("02 §5.3: 表头缺「资产键」列 —— 文档名与文件名没有对应，"
                        "读者只能靠猜 enemy_??_idle_00_sprite 是哪只")
        else:
            ki = next((i for i, h in enumerate(hdr2) if "资产键" in h), -1)
            for r in rows2:
                if ki < 0 or ki >= len(r):
                    continue
                key = r[ki].strip(" `*")
                if not key:
                    errs.append(f"02 §5.3: 「{r[0]}」没填资产键")
                    continue
                for st in ("idle", "ally"):
                    f = ENEMY_DIR / f"enemy_{key}_{st}_00_sprite.png"
                    if not f.exists():
                        errs.append(f"02 §5.3: 「{r[0]}」的 {st} 版资产缺文件（{f.name}）"
                                    "—— 表里写了、磁盘上没有")

    return errs


def check_scene(r04: str, r03: str) -> list[str]:
    """第四轮：场景两态（2026-11-27 白哥定「场景的色系也要这样分类」）。"""
    errs: list[str] = []

    # 1. 04 §2.1 必须在，且两件事都在：alpha 不能动、色温分开
    seg = tree_section(r04, "### 2.1", "## 3.")
    if not seg:
        errs.append("04: 找不到 §2.1「场景两态」—— 地表换色没有落点")
    else:
        if not same_line(seg, "alpha", "逐像素"):
            errs.append("04 §2.1: 没有一行同时写「alpha」和「逐像素」"
                        "—— 瓦片几何一动就出缝，这条是硬约束")
        for k in ("冷像素", "DARK", "ALLY"):
            if k not in seg:
                errs.append(f"04 §2.1: 少了「{k}」")

    # 2. 规范侧的判据必须在（不然就是只有结论没有依据）
    rules = ASSET_RULES.read_text(encoding="utf-8") if ASSET_RULES.exists() else ""
    if "### 3.2" not in rules:
        errs.append("ASSET_RULES: 缺 §3.2 场景两态 —— 判据没有单一真源")
    else:
        for k in ("色温", "材质不糊", "可读性"):
            if k not in tree_section(rules, "### 3.2", "## 4."):
                errs.append(f"ASSET_RULES §3.2: 少了「{k}」判据")

    # 3. 03 必须写明「清区 → 换地色」这条画面开关
    if not same_line(r03, "地面", "色系"):
        errs.append("03: 没有一行同时写「地面」和「色系」"
                    "—— 清区变田在画面上少了一个可见反馈")

    # 4. 磁盘：每个基准件都必须有两态
    #    基准件清单**从工具里取**，不在这里重抄一遍 ——
    #    抄一遍就等于两个真源，加新件时必有一边忘改。
    stems: list[str] = []
    if SCENE_TOOL.exists():
        import importlib.util
        spec = importlib.util.spec_from_file_location("scene_state", SCENE_TOOL)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
            stems = list(mod.BASE_STEMS)
        except Exception as e:  # noqa: BLE001
            errs.append(f"scene_state.py 无法加载：{e}")
    else:
        errs.append("art/tools/scene_state.py 不存在 —— 场景两态没有产线")

    for stem in stems:
        for st in ("dark", "ally"):
            if not (TERRAIN_DIR / f"{stem}_{st}.png").exists():
                errs.append(f"Terrain: 「{stem}」缺 {st} 态 —— "
                            "规范写了两态、磁盘只有一态")

    return errs


def main() -> int:
    d = load()
    r05 = DOC05.read_text(encoding="utf-8")
    r03 = DOC03.read_text(encoding="utf-8")
    r04 = DOC04.read_text(encoding="utf-8")
    r02 = DOC02.read_text(encoding="utf-8")
    rref = DOC_REF.read_text(encoding="utf-8")

    if "--json" in sys.argv:
        print(json.dumps(d, ensure_ascii=False, indent=2))
        return 0

    errs = (check_internal(d) + check_05(r05, d) + check_03(r03) + check_04(r04)
            + check_ref(rref) + check_parasite(r05, r03, r02) + check_duo(r05, r03, r02)
            + check_scene(r04, r03))

    g = d["girdling"]
    w = d["wound"]
    p = d["parasite"]
    ms = d["material_split"]
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
    print(f"\n── 八处翻译 ──")
    for m in d["design_map"]:
        print(f"{m['system']:<12} → {m['physiology']}")
    print(f"\n── 寄生 ──")
    print(f"{p['organ']} · {p['direction']} · 接{p['connects_to']}")
    print(f"可传病毒 {p['viruses_transmitted_between_hosts']} 种 · 成网={p['network']}")
    print(f"黑化机制：{d['darkening']['mechanism'][:40]}…")
    print(f"改写形态：{d['deformity']['name']}（潜伏 {d['deformity']['latency_years'][0]}–"
          f"{d['deformity']['latency_years'][1]} 年）")
    print(f"物资：可种={ms['cultivated']['system_side'][:12]} · "
          f"不可种={ms['wild']['system_side'][:12]}")
    print()
    if errs:
        for e in errs:
            print("FAIL  " + e)
        return 1
    print("PASS  两条流自洽 + 八处翻译 + 寄生/黑化/物资两分 + 两套色系（敌人表每行都有原住民态）"
          " + 禁令在位 + 03/04/02 已接上背景")
    return 0


if __name__ == "__main__":
    sys.exit(main())
