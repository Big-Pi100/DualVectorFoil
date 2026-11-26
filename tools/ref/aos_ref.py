#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""《晓月圆舞曲》魂/道具参照表 —— 从 aos_souls.json 生成 Markdown 表格与 HTML。

用法：
    python tools/ref/aos_ref.py            # 重新生成 MD 表格块 + HTML
    python tools/ref/aos_ref.py --check    # 只校验，不写盘（CI / 提交前跑）

为什么要一个生成器而不是手抄：
    120 个魂要同时出现在 JSON（给代码读）、MD（给人读）、HTML（给眼睛看）。
    手抄三份必然漂移。这里只认 JSON 一个源，另两份是产物。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "docs" / "ref" / "aos_souls.json"
MD = ROOT / "docs" / "ref" / "REF_ARIA_OF_SORROW.md"
HTML = ROOT / "docs" / "ref" / "aos_souls.html"

BEGIN = "<!-- TABLES:BEGIN -->"
END = "<!-- TABLES:END -->"

CN_AREA = {}

# 获取渠道的中文名。放在模块级，是因为 f-string 里没法写字典字面量查询 ——
# 写成 `{{"a":"b"}}["a"]` 会被当成「转义的花括号 + 字面文本」，直接打印出源码。
SRC_CN = {"drop": "敌人掉落", "boss": "Boss 获得", "pedestal": "固定拾取",
          "room": "进房获得", "story": "剧情获得", "scene": "场景获得"}
ABILITY_ORDER = ["Grave Keeper", "Skeleton Blaze", "Malphas",
                 "Kicker Skeleton", "Hippogryph", "Galamoth"]

# ── 第二把尺子：战斗角色（《重生细胞》体系）──────────────────────────────
#
# 四类魂回答的是「这个技能怎么收费」（按次 / 按秒 / 免费 / 永久），
# 角色回答的是「它在战斗里顶哪个位置」（贴脸 / 远打 / 挡 / 摆 / 强 / 挂 / 走）。
# 两把尺子正交，不互相替代：一个技能既有层，也有角色。
#
# 判据不看效果文本里的动词，看「玩家要付出什么代价才用得上它」：
ROLE_ORDER = ["melee", "ranged", "defense", "deploy", "power", "passive", "mobility"]
ROLE_CN = {"melee": "近战", "ranged": "远程", "defense": "防御", "deploy": "放置",
           "power": "强化", "passive": "被动", "mobility": "位移"}
ROLE_SLOT = {"melee": "武器", "ranged": "武器", "defense": "武器",
             "deploy": "技能", "power": "技能", "passive": "被动", "mobility": "符文"}
ROLE_TAG = {"melee": "r", "ranged": "r", "defense": "b", "deploy": "b",
            "power": "y", "passive": "g", "mobility": "g"}


def load() -> dict:
    d = json.loads(SRC.read_text(encoding="utf-8"))
    CN_AREA.update(d["meta"]["areas_cn"])
    return d


def area_cn(names: list[str]) -> str:
    return "、".join(CN_AREA.get(n, n) for n in names)


# ── 分类：黄魂 35 个按「有没有机制」分五档，全部要落位，不许有漏网 ──────────
IMMUNITY = {"Ectoplasm", "Poison Worm", "Gargoyle"}
ECON_SUSTAIN = {"Giant Worm", "Wooden Golem", "Arc Demon", "Mimic",
                "Succubus", "Flesh Golem", "Tsuchinoko", "Erinys"}
RULE = {"Zombie", "Peeping Eye", "Zombie Officer", "Dead Warrior",
        "Iron Golem", "Lubicant", "Basilisk", "Headhunter"}
TRAVERSAL = {"Undine", "Skula"}


def yellow_bucket(s: dict) -> str:
    if s["en"] in IMMUNITY:
        return "免疫"
    if s["en"] in ECON_SUSTAIN:
        return "续航/经济"
    if s["en"] in RULE:
        return "规则改写"
    if s["en"] in TRAVERSAL:
        return "通行"
    if re.search(r"(STR|CON|INT|LCK)\s*\+\d", s["effect"]):
        return "纯数值"
    return "未分类"


def checks(d: dict, verify_md: bool = True) -> list[str]:
    bad: list[str] = []
    souls = d["souls"]

    # 1. 总数与四类配比 —— 这是全篇所有推论的地基，错了整篇作废
    n = len(souls)
    if n != 120:
        bad.append(f"魂总数 {n} ≠ 120")
    for t, want in d["meta"]["by_type"].items():
        got = sum(1 for s in souls if s["type"] == t)
        if got != want:
            bad.append(f"{t} {got} ≠ 声明的 {want}")

    # 2. 类型必须都是四类之一
    legal = set(d["meta"]["types"])
    for s in souls:
        if s["type"] not in legal:
            bad.append(f"{s['en']} 类型非法 {s['type']}")

    # 3. 红/蓝必须写 MP；黄/银必须是免费（null）
    for s in souls:
        if s["type"] in ("bullet", "guardian"):
            if not isinstance(s["cost"], int):
                bad.append(f"{s['en']} 缺 MP 消耗")
        elif s["cost"] is not None:
            bad.append(f"{s['en']} 是 {s['type']}，不该有 MP 消耗")

    # 4. 黄魂必须全部落到某个桶里 —— 漏一个就说明分类表过期了
    if sum(1 for s in souls if s["type"] == "enchanted") != 35:
        bad.append("黄魂不是 35 个")
    for s in souls:
        if s["type"] == "enchanted" and yellow_bucket(s) == "未分类":
            bad.append(f"黄魂 {s['en']} 没有归类")

    # 5. 能力魂必须是 6 个，且「确定获取」的占多数 —— 这是 §2 的核心论据
    ab = [s for s in souls if s["type"] == "ability"]
    if len(ab) != 6:
        bad.append(f"能力魂 {len(ab)} 个 ≠ 6")
    rng = [s for s in ab if s["source"] == "drop"]
    if len(rng) != 1:
        bad.append(f"靠掉落的能力魂 {len(rng)} 个，数据说应该是 1 个")

    # 6. 名称唯一（同名魂会让 HTML 筛选器出重）
    seen = set()
    for s in souls:
        if s["en"] in seen:
            bad.append(f"重名 {s['en']}")
        seen.add(s["en"])

    # 7. 每条魂必须落进一个战斗角色，且 meta 声明的计数与实际一致
    legal_role = set(ROLE_ORDER)
    for s in souls:
        if s.get("role") not in legal_role:
            bad.append(f"{s['en']} 的战斗角色非法/缺失：{s.get('role')!r}")
    for r in ROLE_ORDER:
        got = sum(1 for s in souls if s.get("role") == r)
        want = d["meta"]["by_role"].get(r)
        if got != want:
            bad.append(f"角色 {r} {got} ≠ 声明的 {want}")

    # 8. 角色必须与层自洽：黄魂只能是 passive，银魂只能是 mobility
    #
    # 这不是审美，是 §1.8 全部推论的支点 —— 一旦有黄魂混进 deploy，
    # 「被动 35 个」就不再等价于「35 个不用按的」，后面所有配比论证全部作废。
    # 反过来，银魂跑进战斗角色，等于把「位移能力零消耗」这条规范从数据里抹掉。
    for s in souls:
        if s["type"] == "enchanted" and s.get("role") != "passive":
            bad.append(f"黄魂 {s['en']} 的角色是 {s.get('role')}，应为 passive")
        if s["type"] == "ability" and s.get("role") != "mobility":
            bad.append(f"银魂 {s['en']} 的角色是 {s.get('role')}，应为 mobility")

    # 9. Markdown 表格块必须和 JSON 生成的结果**逐行一致**
    #
    # 一开始只比行数，反向验证时删掉一列就抓不到 —— 行数没变，内容变了。
    # 表格块是纯生成物（「勿手改」），所以正确的不变量不是「行数对」，是「整块相同」。
    #
    # 只在 --check 下比：生成模式的目的就是把 MD 重写成新结果，
    # 拿旧 MD 去拦新数据，会让生成器永远自举不起来（改了 JSON 就再也写不进去）。
    if verify_md and MD.exists():
        text = MD.read_text(encoding="utf-8")
        if BEGIN in text and END in text:
            block = text.split(BEGIN, 1)[1].split(END, 1)[0].strip()
            want = md_tables(d).strip()
            if block and block != want:
                got_lines, want_lines = block.splitlines(), want.splitlines()
                hint = ""
                if len(got_lines) != len(want_lines):
                    hint = f"（{len(got_lines)} 行 vs {len(want_lines)} 行）"
                else:
                    for i, (a, b) in enumerate(zip(got_lines, want_lines)):
                        if a != b:
                            hint = f"（第 {i + 1} 行起不同）"
                            break
                bad.append(f"MD 表格块与 JSON 不一致{hint} —— 跑 python tools/ref/aos_ref.py")

    # 10. §1.8 的分布表是**手写**的（要带解读，没法整块生成），所以必须逐格核对。
    #     生成物靠「整块相同」守，手写物靠「逐格相同」守 —— 两种守法的错误不同：
    #     前者防格式漂移，后者防数字被人顺手改错。
    if verify_md and MD.exists():
        t = MD.read_text(encoding="utf-8")
        types = ("bullet", "guardian", "enchanted", "ability")
        for r in ROLE_ORDER:
            want = [sum(1 for s in souls if s.get("role") == r and s["type"] == ty)
                    for ty in types]
            m = re.search(rf"^\| {ROLE_CN[r]} \| ([0-9—]+) \| ([0-9—]+) \| "
                          rf"([0-9—]+) \| ([0-9—]+) \| ([0-9]+) \|\s*$", t, re.M)
            if not m:
                bad.append(f"§1.8 分布表找不到「{ROLE_CN[r]}」这一行")
                continue
            got = [0 if c == "—" else int(c) for c in m.groups()[:4]]
            if got != want:
                bad.append(f"§1.8 分布表「{ROLE_CN[r]}」写的是 {got}，数据是 {want}")
            if int(m.group(5)) != sum(want):
                bad.append(f"§1.8 分布表「{ROLE_CN[r]}」合计 {m.group(5)} ≠ {sum(want)}")

        # 对比表里最要命的两个数：近战 10/18%、远程 37/67% —— J1 全靠它们
        melee = sum(1 for s in souls if s.get("role") == "melee")
        ranged_red = sum(1 for s in souls if s.get("role") == "ranged" and s["type"] == "bullet")
        for sig, where in (
            (f"{melee} 个 · 红魂 55 的 **{melee / 55 * 100:.0f}%**", "近战"),
            (f"{ranged_red} 个 · **{ranged_red / 55 * 100:.0f}%**", "远程"),
        ):
            if sig not in t:
                bad.append(f"§1.8 对比表的「{where}」一格与数据不符（应含 `{sig}`）")
    return bad


# ── Markdown ────────────────────────────────────────────────────────────
def md_tables(d: dict) -> str:
    souls = d["souls"]
    out: list[str] = []
    out.append("> 由 `tools/ref/aos_ref.py` 从 `aos_souls.json` 生成，勿手改。\n")

    def table(rows: list[str], head: str, sep: str) -> None:
        out.append(head)
        out.append(sep)
        out.extend(rows)
        out.append("")

    # 红魂：按 MP 从便宜到贵 —— 设计时看的是成本阶梯，不是怪物编号
    red = sorted((s for s in souls if s["type"] == "bullet"),
                 key=lambda s: (s["cost"], s["en"]))
    rows = []
    for s in red:
        p = "—" if s["power"] is None else s["power"]
        r = "—" if s["rarity"] is None else s["rarity"]
        no = "—" if s["no"] is None else s["no"]
        rows.append(f"| {no} | {s['cn']} | {ROLE_CN[s['role']]} | {s['cost']} | {p} | {r} | {area_cn(s['area'])} | {s['effect']} |")
    out.append(f"**红魂 55 个（按 MP 升序）**\n")
    table(rows,
          "| # | 魂 | 角色 | MP | 威力 | 稀有度 | 区域 | 效果 |",
          "|---|---|---|---|---|---|---|---|")

    blue = sorted((s for s in souls if s["type"] == "guardian"),
                  key=lambda s: (s["cost"], s["en"]))
    rows = []
    for s in blue:
        p = "—" if s["power"] is None else s["power"]
        r = "—" if s["rarity"] is None else s["rarity"]
        no = "—" if s["no"] is None else s["no"]
        rows.append(f"| {no} | {s['cn']} | {ROLE_CN[s['role']]} | {s['cost']}/s | {p} | {r} | {area_cn(s['area'])} | {s['effect']} |")
    out.append(f"**蓝魂 24 个（按每秒 MP 升序）**\n")
    table(rows,
          "| # | 魂 | 角色 | MP/秒 | 威力 | 稀有度 | 区域 | 效果 |",
          "|---|---|---|---|---|---|---|---|")

    yel = sorted((s for s in souls if s["type"] == "enchanted"),
                 key=lambda s: (999 if s["rarity"] is None else s["rarity"], s["en"]))
    rows = []
    for s in yel:
        r = "—" if s["rarity"] is None else s["rarity"]
        rows.append(f"| {s['cn']} | {yellow_bucket(s)} | {r} | {area_cn(s['area'])} | {s['effect']} |")
    out.append(f"**黄魂 35 个（按稀有度升序，最易掉的在前）**\n")
    table(rows,
          "| 魂 | 类别 | 稀有度 | 区域 | 效果 |",
          "|---|---|---|---|---|")

    ab = [s for s in souls if s["type"] == "ability"]
    ab.sort(key=lambda s: ABILITY_ORDER.index(s["en"]) if s["en"] in ABILITY_ORDER else 99)
    rows = []
    for s in ab:
        rows.append(f"| {s['cn']} | **{SRC_CN.get(s['source'], s['source'])}** | "
                    f"{area_cn(s['area'])} | {s['effect']} |")
    out.append("**银魂 6 个（按获得顺序）**\n")
    table(rows, "| 魂 | 获取 | 区域 | 效果 |", "|---|---|---|---|")
    return "\n".join(out)


# ── HTML ────────────────────────────────────────────────────────────────
CSS = """
:root{--ink:#2b2620;--sub:#6b6153;--line:#cfc6b2;--bg:#f7f3e8;--card:#fffdf5;
      --red:#b03a2e;--blue:#3f6b8a;--yellow:#8a7a3a;--gray:#5c5a55}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
     font:14px/1.6 "PingFang SC","Microsoft YaHei",system-ui,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:28px 22px 64px}
h1{font-size:22px;margin:0 0 4px;letter-spacing:.5px}
.sub{color:var(--sub);font-size:12.5px;margin-bottom:22px}
h2{font-size:15px;margin:32px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:13px;margin:18px 0 8px;color:var(--sub);font-weight:600}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:4px;
      padding:10px 14px;min-width:106px}
.stat b{display:block;font-size:21px;line-height:1.2}
.stat span{font-size:11px;color:var(--sub)}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
@media(max-width:820px){.cards{grid-template-columns:1fr 1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:12px 13px;
      border-top:3px solid var(--line)}
.card.r{border-top-color:var(--red)}.card.b{border-top-color:var(--blue)}
.card.y{border-top-color:var(--yellow)}.card.g{border-top-color:var(--gray)}
.card h4{margin:0 0 6px;font-size:13.5px}
.card h4 .slot{font-size:10px;font-weight:400;color:#9a907e;margin-left:6px}
.card .n{font-size:26px;font-weight:700;line-height:1}
.card dl{margin:8px 0 0;font-size:11.5px;color:var(--sub)}
.card dt{float:left;width:42px;color:#9a907e}
.card dd{margin:0 0 2px 42px}
.bars{margin-top:6px}
.bar{display:flex;align-items:center;gap:10px;margin:5px 0;font-size:12px}
.bar .lab{width:96px;flex:none;color:var(--sub)}
.bar .track{display:block;flex:1;height:15px;background:#eee7d6;border-radius:2px;overflow:hidden}
.bar .fill{display:block;height:100%}
.bar .v{width:56px;flex:none;text-align:right;font-variant-numeric:tabular-nums}
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
.note{background:var(--card);border-left:3px solid #c9b98c;padding:9px 12px;
      margin:11px 0;font-size:12.5px}
.note b{color:#8a6a2f}
.warn{border-left-color:#b03a2e}
.warn b{color:#b03a2e}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:820px){.grid2{grid-template-columns:1fr}}
.ctl{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
.ctl button{font:inherit;font-size:12px;padding:4px 11px;border:1px solid var(--line);
     background:var(--card);color:var(--ink);border-radius:3px;cursor:pointer}
.ctl button.on{background:var(--ink);color:#f7f3e8;border-color:var(--ink)}
.scroll{max-height:560px;overflow:auto;border:1px solid var(--line)}
.scroll table{border:0}
.scroll th,.scroll td{border-left:0;border-right:0}
code{background:#efe9d8;padding:0 3px;border-radius:2px;font-size:11.5px}
.legend{font-size:11px;color:var(--sub);margin-top:6px}
"""


def build_html(d: dict) -> str:
    souls = d["souls"]
    m = d["meta"]
    red = [s for s in souls if s["type"] == "bullet"]
    blue = [s for s in souls if s["type"] == "guardian"]
    yel = [s for s in souls if s["type"] == "enchanted"]
    ab = [s for s in souls if s["type"] == "ability"]

    # 黄魂分桶统计
    buckets: dict[str, int] = {}
    for s in yel:
        k = yellow_bucket(s)
        buckets[k] = buckets.get(k, 0) + 1

    # 红魂效率：power / cost
    eff = [(s, s["power"] / s["cost"]) for s in red if s.get("power")]
    eff.sort(key=lambda t: -t[1])
    best3, worst3 = eff[:3], eff[-3:]

    # ── 散点图（成本 vs 威力，双对数）──
    #
    # 用线性轴试过：成本 5–150、威力 16–285，但 90% 的魂都挤在 cost<50 / power<80 的
    # 左下角，画布 80% 是空的，看不出任何规律。改成双对数后，等效率线变成斜率为 1 的直线，
    # 「越贵效率越低」这件事一眼就能看出来。
    import math
    W, H, PL, PB = 580, 320, 54, 38
    c_lo, c_hi = 4.0, 170.0
    p_lo, p_hi = 14.0, 330.0

    def lx(c): return PL + (math.log(c) - math.log(c_lo)) / (math.log(c_hi) - math.log(c_lo)) * (W - PL - 14)
    def ly(p): return H - PB - (math.log(p) - math.log(p_lo)) / (math.log(p_hi) - math.log(p_lo)) * (H - PB - 16)

    dots = []
    for s in red:
        if not s.get("power"):
            continue
        e = s["power"] / s["cost"]
        col = "#3f6b52" if e >= 2.2 else ("#b7791f" if e >= 1.4 else "#b03a2e")
        dots.append(
            f'<circle cx="{lx(s["cost"]):.1f}" cy="{ly(s["power"]):.1f}" r="4.4" '
            f'fill="{col}" fill-opacity=".85" stroke="#fffdf5" stroke-width=".8">'
            f'<title>{s["cn"]} · {s["cost"]}MP · 威力{s["power"]} · '
            f'效率{e:.2f}</title></circle>')

    # 等效率线：power = k * cost → 双对数下是直线
    ref = []
    for k, lab in ((1.0, "效率 1.0"), (2.0, "2.0"), (4.0, "4.0")):
        pts = []
        for c in (c_lo, c_hi):
            p = k * c
            if p_lo <= p <= p_hi:
                pts.append((lx(c), ly(p)))
            elif p > p_hi:            # 超出上界，回推交叉点
                cc = p_hi / k
                if c_lo <= cc <= c_hi:
                    pts.append((lx(cc), ly(p_hi)))
            elif p < p_lo:
                cc = p_lo / k
                if c_lo <= cc <= c_hi:
                    pts.append((lx(cc), ly(p_lo)))
        if len(pts) >= 2:
            (x1, y1), (x2, y2) = pts[0], pts[-1]
            ref.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                       f'stroke="#d8cba8" stroke-width="1" stroke-dasharray="5 4"/>')
            ref.append(f'<text x="{x2-3:.1f}" y="{y2-5:.1f}" font-size="9" fill="#b8a97e" '
                       f'text-anchor="end">{lab}</text>')

    xticks = [5, 10, 20, 50, 100, 150]
    yticks = [16, 25, 40, 64, 100, 160, 250]
    gx = "".join(
        f'<line x1="{PL}" y1="{ly(p):.1f}" x2="{W-14}" y2="{ly(p):.1f}" stroke="#ece5d6"/>'
        f'<text x="{PL-8}" y="{ly(p)+3.5:.1f}" text-anchor="end" font-size="10" '
        f'fill="#9a907e">{p}</text>' for p in yticks)
    gy = "".join(
        f'<line x1="{lx(c):.1f}" y1="16" x2="{lx(c):.1f}" y2="{H-PB}" stroke="#ece5d6"/>'
        f'<text x="{lx(c):.1f}" y="{H-PB+15}" text-anchor="middle" font-size="10" '
        f'fill="#9a907e">{c}</text>' for c in xticks)

    # 标签避让：左下角 5–8MP 那三个点挨得太近，直接标会叠成一团，
    # 改成一句注释 + 只标彼此分得开的 6 个。
    labels = []
    for s in red:
        if s["en"] not in ("Red Minotaur", "Balore", "Bomber Armor", "Mandragora",
                           "Axe Armor", "Flame Demon"):
            continue
        x, y = lx(s["cost"]), ly(s["power"])
        # 靠右边界的改用右对齐，否则文字会顶出画布
        if x > W - 96:
            labels.append(f'<text x="{x-9:.1f}" y="{y+3.5:.1f}" font-size="9.5" '
                          f'fill="#6b6153" text-anchor="end">{s["cn"]}</text>')
        else:
            labels.append(f'<text x="{x+8:.1f}" y="{y-6:.1f}" font-size="9.5" '
                          f'fill="#6b6153">{s["cn"]}</text>')
    # 左下角密集区：一句话放到左上角空白处，避免压住数据点
    labels.append(
        f'<text x="{lx(5.4):.1f}" y="{ly(230):.1f}" font-size="9.5" fill="#3f6b52">'
        f'蝙蝠 / 屠夫 / 骷髅</text>')
    labels.append(
        f'<text x="{lx(5.4):.1f}" y="{ly(178):.1f}" font-size="9" fill="#6b8a6f">'
        f'5–8MP，效率 3.5–4.4（最划算）</text>')

    scatter = f'''<svg viewBox="0 0 {W} {H}" width="100%" style="max-width:{W}px">
  <rect x="{PL}" y="16" width="{W-PL-14}" height="{H-PB-16}" fill="#fffdf5" stroke="#cfc6b2"/>
  {gx}{gy}{''.join(ref)}{''.join(dots)}{''.join(labels)}
  <text x="{(PL+W)/2:.0f}" y="{H-6}" text-anchor="middle" font-size="10.5" fill="#9a907e">MP 消耗（单次，对数轴）</text>
  <text x="13" y="{(16+H-PB)/2:.0f}" font-size="10.5" fill="#9a907e"
        transform="rotate(-90 13 {(16+H-PB)/2:.0f})" text-anchor="middle">威力（对数轴）</text>
</svg>'''

    # ── 类型卡片 ──
    def card(cls: str, t: str, n: int) -> str:
        c = m["types"][t]
        return (f'<div class="card {cls}"><h4>{c["cn"]}</h4><div class="n">{n}</div>'
                f'<dl><dt>输入</dt><dd>{c["input"]}</dd>'
                f'<dt>成本</dt><dd>{c["cost"]}</dd>'
                f'<dt>持续</dt><dd>{c["persist"]}</dd></dl></div>')

    # ── 配比条 ──
    def bar(lab: str, v: int, tot: int, col: str) -> str:
        pct = v / tot * 100
        return (f'<div class="bar"><span class="lab">{lab}</span>'
                f'<span class="track"><span class="fill" style="width:{pct:.1f}%;'
                f'background:{col}"></span></span>'
                f'<span class="v">{v} · {pct:.0f}%</span></div>')

    bars = (bar("红魂 输出", len(red), 120, "var(--red)")
            + bar("蓝魂 持续", len(blue), 120, "var(--blue)")
            + bar("黄魂 被动", len(yel), 120, "var(--yellow)")
            + bar("银魂 能力门", len(ab), 120, "var(--gray)"))

    # ── 第二把尺子：战斗角色 ──
    role_n = {r: sum(1 for s in souls if s.get("role") == r) for r in ROLE_ORDER}
    role_low = {r: sorted((s for s in souls if s.get("role") == r),
                          key=lambda s: (999 if s["cost"] is None else s["cost"], s["en"]))[:3]
                for r in ROLE_ORDER}

    def rcard(r: str) -> str:
        return (f'<div class="card {ROLE_TAG[r]}"><h4>{ROLE_CN[r]}'
                f'<span class="slot">{ROLE_SLOT[r]}位</span></h4>'
                f'<div class="n">{role_n[r]}</div>'
                f'<dl><dt>判据</dt><dd>{m["roles"][r]["judge"]}</dd>'
                f'<dt>最易得</dt><dd>{"、".join(s["cn"] for s in role_low[r])}</dd></dl></div>')

    cross_rows = ""
    for r in ROLE_ORDER:
        n = [sum(1 for s in souls if s.get("role") == r and s["type"] == t)
             for t in ("bullet", "guardian", "enchanted", "ability")]
        cross_rows += (f'<tr><td><b>{ROLE_CN[r]}</b></td><td>{ROLE_SLOT[r]}</td>'
                       + "".join(f'<td class="num">{"—" if v == 0 else v}</td>' for v in n)
                       + f'<td class="num"><b>{sum(n)}</b></td>'
                       + f'<td class="num">{sum(n) / 120 * 100:.0f}%</td></tr>')



    ybars = "".join(
        bar(k, buckets.get(k, 0), len(yel),
            {"纯数值": "#b8ab84", "续航/经济": "#8a7a3a", "规则改写": "#3f6b52",
             "免疫": "#6b8a9a", "通行": "#4a6b8a"}.get(k, "#999"))
        for k in ("纯数值", "续航/经济", "规则改写", "免疫", "通行"))

    # ── 稀有度梯子 ──
    rar = sorted([s for s in souls if s.get("rarity")],
                 key=lambda s: -s["rarity"])
    rar_rows = "".join(
        f'<tr><td class="num">{s["rarity"]}</td><td>{s["cn"]}</td>'
        f'<td><span class="tag { {"bullet":"r","guardian":"b","enchanted":"y","ability":"g"}[s["type"]] }">'
        f'{ {"bullet":"红","guardian":"蓝","enchanted":"黄","ability":"银"}[s["type"]] }</span></td>'
        f'<td>{s["effect"]}</td></tr>'
        for s in rar[:12])

    # ── 全表 ──
    rows = []
    for s in sorted(souls, key=lambda s: (["bullet", "guardian", "enchanted", "ability"].index(s["type"]),
                                          999 if s["cost"] is None else s["cost"], s["en"])):
        tag = {"bullet": ("r", "红"), "guardian": ("b", "蓝"),
               "enchanted": ("y", "黄"), "ability": ("g", "银")}[s["type"]]
        p = "—" if s["power"] is None else s["power"]
        if s["type"] == "guardian":
            cost = f'{s["cost"]}/s'
        elif s["type"] in ("enchanted", "ability"):
            cost = "免费"
        else:
            cost = s["cost"]
        r = "—" if s["rarity"] is None else s["rarity"]
        src = SRC_CN.get(s["source"], s["source"])
        rows.append(
            f'<tr data-t="{s["type"]}" data-r="{s["role"]}">'
            f'<td><span class="tag {tag[0]}">{tag[1]}</span></td>'
            f'<td>{s["cn"]}</td><td>{ROLE_CN[s["role"]]}</td>'
            f'<td class="num">{cost}</td><td class="num">{p}</td>'
            f'<td class="num">{r}</td><td>{src}</td><td>{area_cn(s["area"])}</td>'
            f'<td>{s["effect"]}</td></tr>')

    html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>《晓月圆舞曲》魂系统参照表</title>
<style>{CSS}</style></head><body><div class="wrap">

<h1>《恶魔城：晓月圆舞曲》魂系统参照表</h1>
<div class="sub">120 个魂 · 4 个成本层 · 7 个战斗角色 · 数据源：StrategyWiki / pixelguides / GameFAQs ·
生成于 <code>tools/ref/aos_ref.py</code>，勿手改本文件</div>

<div class="stats">
  <div class="stat"><b>120</b><span>魂总数</span></div>
  <div class="stat"><b>55</b><span>红魂（输出）</span></div>
  <div class="stat"><b>24</b><span>蓝魂（持续）</span></div>
  <div class="stat"><b>35</b><span>黄魂（被动）</span></div>
  <div class="stat"><b>6</b><span>银魂（能力门）</span></div>
  <div class="stat"><b>138</b><span>道具总数</span></div>
</div>

<h2>1. 四类魂 = 四种成本模型，不是四种属性</h2>
<div class="cards">
  {card("r", "bullet", len(red))}
  {card("b", "guardian", len(blue))}
  {card("y", "enchanted", len(yel))}
  {card("g", "ability", len(ab))}
</div>
<div class="note"><b>这张卡片是本篇最该抄的一层。</b>
分类的判据不是「火/冰/雷」，而是<strong>成本怎么收、效果持续多久</strong>。
四个类型各自绑定一个输入通道和一个付费方式，所以玩家不用记「这个技能算什么属性」，
只需要记「按哪个键、扣不扣蓝」。<br>
推论：<strong>位移能力必须落在免费层</strong> —— 6 个银魂全部零消耗。
我们「折叠 / 生长 不消耗任何资源」不是风格选择，是这一类游戏的硬约束。</div>

<h2>2. 数量配比：输出 55、被动 35、持续 24、能力门 6</h2>
<div class="bars">{bars}</div>
<div class="note warn"><b>能力门只占 5%。</b>
120 个魂里只有 6 个决定「能不能过去」，其余 114 个都是「怎么打」「打得多舒服」。
而我们的 4 个技能里，2 个是硬门（折叠锁高度、生长锁距离）——<strong>门占了 50%</strong>。
这不是错，但它说明：我们的地图结构远比战斗花样丰富。
想让地图密度兑现，缺的不是第 5 个技能，是<strong>投掷的弹药变体</strong>。</div>

<h2>3. 换一把尺子：按《重生细胞》的战斗角色重切</h2>
<div class="note">上一节的四类是按<strong>怎么收费</strong>切的，回答「按哪个键、扣不扣蓝」。
这一节按<strong>在战斗里顶哪个位置</strong>切，回答「我的配装缺哪个角」。
两把尺子正交：同一个魂既有层，也有角色，谁也不能替代谁。</div>
<div class="cards">{"".join(rcard(r) for r in ROLE_ORDER)}</div>
<div class="grid2">
<div class="scroll"><table>
<thead><tr><th>角色</th><th>格</th><th>红</th><th>蓝</th><th>黄</th><th>银</th><th>合计</th><th>占120</th></tr></thead>
<tbody>{cross_rows}</tbody></table></div>
<div>
<table>
<thead><tr><th>类</th><th>重生细胞</th><th>晓月</th></tr></thead>
<tbody>
<tr><td><b>近战</b></td><td>59 件 · 武器 110 的 <b>54%</b></td><td>10 个 · 红魂 55 的 <b>18%</b></td></tr>
<tr><td><b>远程</b></td><td>37 件 · 34%</td><td>37 个 · <b>67%</b></td></tr>
<tr><td><b>防御</b></td><td>14 面盾 · 13%</td><td><b>红魂里 0 个</b>（3 个防御全在蓝魂）</td></tr>
<tr><td><b>放置</b></td><td>13 座炮塔 / 陷阱</td><td>16 个（红魂 6 + 蓝魂 10）</td></tr>
<tr><td><b>被动</b></td><td>52 条变异</td><td>35 个</td></tr>
</tbody></table>
<div class="legend">「重生细胞」一列的分母是武器 110 / 技能 54 / 变异 52。
手雷 11 与力量技能 30 不列进来 —— 它们是「技能槽里的即时爆发」，
硬塞进「放置」会让这张表变成自说自话。</div>
</div>
</div>
<div class="note warn"><b>一句话：晓月是远程游戏，重生细胞是近战游戏。</b>
它的红魂槽 55 个里 37 个是远程，近战只有 10 个，防御是 <b>0</b> ——
盾全在蓝魂，而蓝魂是「按住扣蓝」的持续位，不是「举起来挡一下」的武器位。
所以晓月打起来是「站桩扔 + 后退」，不是「读招、格挡、反击」。</div>
<div class="note"><b>真正的差异不在数量，在槽位。</b>
重生细胞是 <b>2 武器 + 2 技能 + 3 变异</b>，且武器格内三类<b>互斥</b> ——
带盾就不能带弓，取舍才产生 build。<br>
晓月是 <b>1 红 + 1 蓝 + 1 黄</b>，红魂槽里拳和箭同一个槽、不分类别，
玩家只需要选「最强的那一个」。<b>55 个红魂，最优解只有一个。</b></div>

<h2>4. 贵 ≠ 强：MP 成本买的是爆发，不是效率</h2>
{scatter}
<div class="legend">虚线 = 等效率线（威力 ÷ MP = 1.0 / 2.0 / 4.0）；点在线上方表示比该效率更划算。
绿点效率 ≥2.2，金点 1.4–2.2，红点 &lt;1.4。双对数轴：等效率线在图上就是斜率为 1 的直线。</div>
<div class="note">最省 MP 的三个反而是效率最高的：
{"、".join(f'{s["cn"]} {s["power"]}/{s["cost"]}MP = {s["power"]/s["cost"]:.1f}' for s, _ in best3)}；
而最贵的三个是
{"、".join(f'{s["cn"]} {s["power"]}/{s["cost"]}MP = {s["power"]/s["cost"]:.1f}' for s, _ in worst3)}。<br>
<strong>高成本买的是「一个动作打出更多伤害」，不是「更划算」。</strong>
所以早期技能永远不会被后期淘汰 —— 它们只是变成了「省蓝的那一手」。
如果我们给弹药分档，轴必须是<strong>单发爆发 vs 每发效率</strong>，绝不能用「越后越强」。</div>

<h2>5. 黄魂 35 个：一半是纯数值，这不是偷懒</h2>
<div class="bars">{ybars}</div>
<div class="note">14 个纯数值 + 3 个免疫 = <strong>正好一半是「不需要理解」的填充</strong>。
剩下 18 个才有机制（续航/经济 8、规则改写 8、通行 2）。<br>
这是有意的配比：<strong>纯数值让收集有密度，机制型让收集有价值。</strong>
反过来做（每个被动都给机制）会让 35 个被动变成 35 条规则要记，玩家会全部无视。</div>

<h2>6. 稀有度：约每 N 次击杀掉 1 次</h2>
<div class="grid2">
<div class="scroll"><table>
<thead><tr><th>1/N</th><th>魂</th><th>类</th><th>效果</th></tr></thead>
<tbody>{rar_rows}</tbody></table></div>
<div>
<div class="note"><b>最稀有的全是「便利型」。</b>
石像鬼（免疫石化）180、骨柱 180、丧尸 180、灵质（免疫诅咒）150、
偷窥眼（看穿可破坏墙）120、厄里倪斯（经验 ×1.2）120 ——
<strong>越难刷的越不影响通关</strong>。这是有意为之：让「刷不到」不构成阻塞。</div>
<div class="note"><b>必拿的魂被故意做成高概率。</b>
真结局需要炎魔（红）+ 巨蝙蝠（蓝）+ 魅魔（黄），
稀有度分别是 <strong>3 / 场景获得 / 5</strong>。<br>
对照：需要刷的《月下》道具动辄 1/64，这里必修内容一律 1/3–1/5。
<strong>「必修」和「稀有」在数据上是互斥的。</strong></div>
</div>
</div>

<h2>7. 能力门：6 个里 5 个是确定获取</h2>
<div class="scroll"><table>
<thead><tr><th>魂</th><th>获取</th><th>区域</th><th>效果</th></tr></thead>
<tbody>{"".join(
    f'<tr><td>{s["cn"]}</td><td><b>{SRC_CN[s["source"]]}</b></td>'
    f'<td>{area_cn(s["area"])}</td><td>{s["effect"]}</td></tr>'
    for s in sorted(ab, key=lambda s: ABILITY_ORDER.index(s["en"])))}
</tbody></table></div>
<div class="note warn"><b>唯一靠掉落的银魂，恰好是不锁路的那个。</b>
踢腿骷髅（二段跳中飞踢）是战斗招式，不打开任何区域，稀有度 2。其余 5 个
（后撤步 / 滑铲 / 二段跳 / 超高跳 / 时间视觉）<strong>全部是固定拾取或进房获得</strong>。<br>
<strong>结论写死：能力门不能挂在随机掉落上。</strong> 我们「技能放死路末端、确定性给予」
的设计在这条上有先例支撑，可以当依据用，不用再讨论。</div>

<h2>8. 全 120 魂（可筛选）</h2>
<div class="ctl">
  <button class="on" data-m="t" data-v="all">全部 120</button>
  <button data-m="t" data-v="bullet">红 55</button>
  <button data-m="t" data-v="guardian">蓝 24</button>
  <button data-m="t" data-v="enchanted">黄 35</button>
  <button data-m="t" data-v="ability">银 6</button>
</div>
<div class="ctl">
  <button data-m="r" data-v="melee">近战 {role_n["melee"]}</button>
  <button data-m="r" data-v="ranged">远程 {role_n["ranged"]}</button>
  <button data-m="r" data-v="defense">防御 {role_n["defense"]}</button>
  <button data-m="r" data-v="deploy">放置 {role_n["deploy"]}</button>
  <button data-m="r" data-v="power">强化 {role_n["power"]}</button>
  <button data-m="r" data-v="passive">被动 {role_n["passive"]}</button>
  <button data-m="r" data-v="mobility">位移 {role_n["mobility"]}</button>
</div>
<div class="scroll"><table id="all">
<thead><tr><th>类</th><th>魂</th><th>角色</th><th>消耗</th><th>威力</th><th>稀有度</th><th>来源</th><th>区域</th><th>效果</th></tr></thead>
<tbody>{"".join(rows)}</tbody></table></div>

<script>
document.querySelectorAll('.ctl button').forEach(function(b){{
  b.onclick = function(){{
    document.querySelectorAll('.ctl button').forEach(function(x){{x.classList.remove('on')}});
    b.classList.add('on');
    var v = b.dataset.v, m = b.dataset.m;
    document.querySelectorAll('#all tbody tr').forEach(function(tr){{
      tr.style.display = (v === 'all' || tr.dataset[m] === v) ? '' : 'none';
    }});
  }};
}});
</script>
</div></body></html>'''
    return html


def main() -> int:
    d = load()
    check_only = "--check" in sys.argv
    bad = checks(d, verify_md=check_only)
    if bad:
        print("✗ 校验失败：")
        for b in bad:
            print("   ", b)
        return 1

    if check_only:
        print(f"✓ 参照表一致：120 魂 / 55·24·35·6 / "
              f"角色 {'·'.join(str(sum(1 for s in d['souls'] if s['role'] == r)) for r in ROLE_ORDER)}"
              f" / MD 表格与 JSON 同步")
        return 0

    # 重写 MD 表格块
    text = MD.read_text(encoding="utf-8")
    if BEGIN not in text or END not in text:
        print(f"✗ {MD.name} 缺 {BEGIN} / {END} 标记")
        return 1
    head, rest = text.split(BEGIN, 1)
    _, tail = rest.split(END, 1)
    MD.write_text(head + BEGIN + "\n" + md_tables(d) + "\n" + END + tail, encoding="utf-8")

    html = build_html(d)
    # 防「f-string 转义写错，把字典字面量当文本打印出来」——这个 bug 真发生过一次，
    # 屏幕上显示的是 {"drop":"敌人掉落"}["drop"]，肉眼要滑到第 6 节才看得见。
    if '{"' in html:
        print("✗ HTML 里出现疑似未转义的字面量（形如 {\"...\"}），检查 f-string 花括号")
        return 1
    HTML.write_text(html, encoding="utf-8")
    print(f"✓ 已生成 {MD.name} 表格块 + {HTML.name}（{HTML.stat().st_size/1024:.0f} KB）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
