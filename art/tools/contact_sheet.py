#!/usr/bin/env python3
"""生成「资产盘点选件表」——一张能点选的 HTML，不靠文字描述做取舍。

为什么要有这个：44 张资产的文件名（`terrain_stone_block_200` vs `terrain_stone_pillar_200`）
对人没有信息量，只有把图摆出来、标上「现在接没接、多大、什么角色」，才谈得上「决定用哪些」。
所以这张表的**唯一输出**是给人看的，判据都不在这里（判据在 `asset_rules_check.py`
和 `slice_ground.py`）。两者不要互相替代：

    规则脚本回答「这张图合格吗」    本脚本回答「这张图长什么样、要不要」

卡片是**服务端直出**的，不靠 JS 现场拼 DOM —— 预览环境禁用脚本时仍然能看。
JS 只负责三件小事：记住勾选、按状态筛选、复制结果。
缩略图全部 base64 内嵌，单文件、离线可开、发给别人不会裂图。

用法：
    python art/tools/contact_sheet.py            # 生成 art/reports/ASSET_SHEET.html
    python art/tools/contact_sheet.py --open     # 顺手用默认浏览器打开
"""

from __future__ import annotations

import argparse
import base64
import html
import io
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
APPROVED = ROOT / "art" / "approved"
MANIFEST = APPROVED / "manifest.json"
OUT = ROOT / "art" / "reports" / "ASSET_SHEET.html"

TILE = 48
THUMB = 200          # 缩略图长边上限（px）。够看清笔触，又不至于把 HTML 撑到几 MB

# ── role：与 asset_rules_check.py 同一套口径，别在这里另立一套 ────────────
OVERRIDE = {"ground_left": "tile_cap", "ground_right": "tile_cap", "ground_mid": "tile_mid"}
BY_DIR = {"Characters": "sprite", "Enemies": "sprite", "Terrain": "prop",
          "Effects": "fx", "Items": "item", "UI": "ui"}

# ── 状态 ─────────────────────────────────────────────────────────────
# 「现在用不到」≠「该弃」。2026-11-26 白哥的决定：除石凳全留，
# 因为「用不到只是现在，不代表一直用不到」——尤其地图要做 X/Y 双轴之后，
# 原先被判「进不了关卡」的立体件，在纵向房里有重新出场的可能。
#
# 2026-11-27 更正：连石凳也不是弃件了。那天并入的完整 Godot 工程里
# `RestBench.tscn` 就拿它当凳体，`RestBench.gd` 是活玩法（更新休息点 + 回满血）。
# 所以现在 **S_DROP 是 0 张** —— 这个状态保留，用来标以后真该淘汰的东西。
S_WIRED = "wired"        # 已接入
S_READY = "ready"        # 现在就有玩法钩子，可直接接线
S_SPARE = "spare"        # 留库备用：暂时没用，但保留
S_DROP = "drop"          # 弃用（当前 0 张；保留这个状态位以待后用）

LABEL = {S_WIRED: "已接入", S_READY: "可接线", S_SPARE: "留库备用", S_DROP: "弃用"}
CATNAME = {"Characters": "角色", "Enemies": "敌人", "Items": "道具",
           "Effects": "特效", "Terrain": "地形", "UI": "界面"}
CATORDER = ["Characters", "Enemies", "Items", "Effects", "Terrain", "UI"]

DECISION = {
    # ── 角色 ─────────────────────────────────────────────────────
    "player_side_00_sprite":   (S_READY, "横版站立"),
    "player_run_00_sprite":    (S_READY, "跑"),
    "player_jump_00_sprite":   (S_READY, "起跳，暂时兼作下落帧"),
    "player_back_00_sprite":   (S_READY, "后跃（朝镜头反面弹开）"),
    "player_attack_00_sprite": (S_READY, "攻击，暂时兼作施法帧"),
    "player_hurt_00_sprite":   (S_READY, "受击"),
    "player_climb_00_sprite":  (S_READY, "攀爬。纵向房一上就要用（梯子 / 藤蔓）"),
    "player_idle_00_sprite":   (S_READY, "正面站姿。过场 / UI 立绘"),
    "origami_bird_idle_00":    (S_SPARE, "折纸鸟。主体 119×104，比蝙蝠 sprite 大一圈，飞行敌的备用件"),

    # ── 敌人 ─────────────────────────────────────────────────────
    "enemy_slime_idle_00_sprite": (S_READY, "对应 GDD 的「纸团」：直线滚撞、撞墙散开"),
    "enemy_bat_idle_00_sprite":   (S_SPARE, "飞行敌备用。48 高，细节空间比鸟小"),
    "enemy_spike_idle_00_sprite": (S_SPARE, "刺球。GDD 的折痕体是另一个形态，但刺球本身可以做独立敌种"),

    # ── 道具 ─────────────────────────────────────────────────────
    "item_star_sprite":  (S_READY, "48×48。投掷物形态未定，星是最省事的候选"),
    "item_key_00":       (S_SPARE, "玩法里暂无钥匙门。留库，城堡题材很容易长出门锁"),
    "item_lantern_00":   (S_SPARE, "暂无照明玩法。留库，可做纵向房的光源装饰"),

    # ── 特效 ─────────────────────────────────────────────────────
    "fx_hit_00":       (S_READY, "命中反馈，战斗必需"),
    "fx_jump_puff_00": (S_READY, "起跳扬尘，手感件"),
    "fx_harvest_00":   (S_READY, "采收。种植是核心循环，必需"),
    "fx_purify_00":    (S_SPARE, "「净化」暂不对应四技能之一。留库"),

    # ── 地形 ─────────────────────────────────────────────────────
    "ground_left":    (S_READY, "底板左端 96×144。纵向房也能当台边缘用"),
    "ground_mid":     (S_READY, "底板中段 384×144，回文，可无限拼"),
    "ground_right":   (S_READY, "底板右端 96×144"),
    "terrain_grass_top":       (S_SPARE, "三段底板的源。必须留；运行时一张不读"),
    # 2026-11-27 晚：这四个曾被改成 S_WIRED（理由写着"灯塔塔身/风车"），那是把
    # **占位** 写成了 **已接入** —— 场景里确实在用，但用的方式是拿立方石/石柱拼出
    # 灯塔、书堆、风车。判定跟着代码走，而不是代码跟着判定走。
    # 现在恢复 11-26 的原判：石块弃用（2.5D 顶面 + 200 宽非 48 网格，只能单件当背景岩体，
    # 不能拼地标）；石柱留库（单件撑顶仍合法，但风车待专用图）。
    # 三处占位用法登记在 asset_rules_check.py 的 PROP_PLACEHOLDER，跑一次就红。
    "terrain_stone_block":     (S_DROP, "立方石 200×165。2.5D 顶面朝观众、宽 200 非 48 整数倍，"
                                        "只能单件当背景岩体；曾拿它拼灯塔/书堆，已判占位待换"),
    "terrain_stone_block_200": (S_DROP, "从上张缩出的平台件，同样带 2.5D 顶面。弃用"),
    "terrain_stone_pillar":    (S_SPARE, "石柱 200×323。竖向房单件撑顶可用；"
                                         "Room03 风车是占位，专用图到位前不算已接入"),
    "terrain_stone_pillar_200": (S_SPARE, "石柱缩件。同上，风车叶片是占位"),
    "terrain_stone_bench":     (S_READY, "休息长凳的凳体。2026-11-27 更正：曾被判「唯一弃件」"
                                       "（依据是「横向房被撤、纵向房用不上」），但同日并入的完整工程里"
                                       "RestBench.tscn 正拿它当凳体、RestBench.gd 是活玩法（更新休息点"
                                       "+ 回满血）。判定已过时，改回可接线"),
    "terrain_grass_decor":     (S_WIRED, "草皮点缀 / SoilPlot 土块（Room01-05、SafeHouse）"),

    # ── UI ───────────────────────────────────────────────────────
    "ui_hud_frame_00":  (S_SPARE, "HUD 现在是纯代码绘制。换图的话这张要做九宫格"),
    "ui_heart_icon_00": (S_SPARE, "血量图标。等 HUD 定稿"),
    "ui_button_base_00": (S_SPARE, "按钮底。手机触屏按钮用得上"),
}

# 1024 母版：状态跟随它的运行时派生件，避免「sprite 弃了、母版还留着」
MASTER_OF = {
    "player_idle_00": "player_idle_00_sprite",
    "player_side_00": "player_side_00_sprite",
    "player_run_00": "player_run_00_sprite",
    "player_back_00": "player_back_00_sprite",
    "player_jump_00": "player_jump_00_sprite",
    "player_attack_00": "player_attack_00_sprite",
    "player_hurt_00": "player_hurt_00_sprite",
    "player_climb_00": "player_climb_00_sprite",
    "enemy_slime_idle_00": "enemy_slime_idle_00_sprite",
    "enemy_bat_idle_00": "enemy_bat_idle_00_sprite",
    "enemy_spike_idle_00": "enemy_spike_idle_00_sprite",
    "item_star_00": "item_star_sprite",
}


def role_of(key: str, entry: dict) -> str:
    return OVERRIDE.get(key) or entry.get("role") or BY_DIR.get(entry.get("category", ""), "?")


def wired_names() -> set[str]:
    """从场景 / 脚本里反查「现在真被引用」的文件名，不硬编码。

    硬编码的坏处是：改了 ANIM 表这里不会跟着变，表上就开始撒谎。
    """
    names: set[str] = set()
    files = list((ROOT / "godot" / "scenes").glob("*.tscn")) + \
            list((ROOT / "godot" / "scripts").glob("*.gd"))
    for path in files:
        text = path.read_text(encoding="utf-8")
        for chunk in text.split("assets/art/"):
            if ".png" not in chunk:
                continue
            # 先截到 .png 为止，再取最后一段 —— 直接 rsplit 会把行尾的引号和注释一起吃进去
            name = chunk.split(".png")[0].rsplit("/", 1)[-1]
            if name and " " not in name:
                names.add(name)
    return names


def thumb_b64(path: Path) -> tuple[str, tuple[int, int], tuple[int, int]]:
    """裁到主体（留 8% 边）。340² 帧框里主体常只占 1/3，不裁看不清画的是啥。"""
    im = Image.open(path).convert("RGBA")
    size = im.size
    bb = im.split()[3].getbbox()
    if bb:
        pad_x = int((bb[2] - bb[0]) * 0.08) + 2
        pad_y = int((bb[3] - bb[1]) * 0.08) + 2
        box = (max(0, bb[0] - pad_x), max(0, bb[1] - pad_y),
               min(size[0], bb[2] + pad_x), min(size[1], bb[3] + pad_y))
        subj = (bb[2] - bb[0], bb[3] - bb[1])
    else:
        box, subj = (0, 0, *size), size
    im = im.crop(box)
    im.thumbnail((THUMB, THUMB), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode(), size, subj


def collect() -> list[dict]:
    data: dict = json.loads(MANIFEST.read_text(encoding="utf-8"))
    wired = wired_names()
    cards: list[dict] = []

    for key, entry in data.items():
        rel = Path(entry["approved"]).relative_to("art/approved").as_posix()
        path = APPROVED / rel
        role = role_of(key, entry)
        b64, size, subj = thumb_b64(path)

        if key in DECISION:
            status, why = DECISION[key]
        elif key in MASTER_OF and MASTER_OF[key] in DECISION:
            # 母版永远只是「留库」——它不进运行时，跟着派生件一起留下就够了
            status = S_SPARE
            why = f"1024 母版，源件；派生件 {MASTER_OF[key]} → {LABEL[DECISION[MASTER_OF[key]][0]]}"
        else:
            status, why = S_SPARE, "1024 母版 / 源图，不直接进渲染"

        if path.stem in wired:      # 以代码里的实际引用为准，压过上面的判断
            status, why = S_WIRED, "已在 Godot 场景或状态表里被引用"

        cards.append({"key": key, "role": role, "status": status, "why": why,
                      "size": f"{size[0]}×{size[1]}", "subj": f"{subj[0]}×{subj[1]}",
                      "kb": max(1, path.stat().st_size // 1024), "b64": b64,
                      "cat": entry.get("category", "")})

    cards.sort(key=lambda c: (CATORDER.index(c["cat"]) if c["cat"] in CATORDER else 9, c["key"]))
    return cards


def card_html(c: dict) -> str:
    checked = "" if c["status"] == S_DROP else " checked"
    return f"""    <article class="card" data-status="{c['status']}" data-key="{html.escape(c['key'])}">
      <div class="stage"><img src="data:image/png;base64,{c['b64']}" alt="{html.escape(c['key'])}" loading="lazy"></div>
      <div class="body">
        <div class="name">{html.escape(c['key'])}</div>
        <div class="meta">{c['role']} · 画布 {c['size']} · 主体 {c['subj']} · {c['kb']}KB</div>
        <div class="st">● {LABEL[c['status']]}</div>
        <div class="why">{html.escape(c['why'])}</div>
        <label class="pick"><input type="checkbox" data-k="{html.escape(c['key'])}"{checked}><span class="t-on">保留这张</span><span class="t-off">✕ 不保留</span></label>
      </div>
    </article>"""


def render(cards: list[dict]) -> str:
    counts: dict[str, int] = {}
    for c in cards:
        counts[c["status"]] = counts.get(c["status"], 0) + 1

    sections = []
    for cat in CATORDER + [""]:
        group = [c for c in cards if c["cat"] == cat]
        if not group:
            continue
        title = CATNAME.get(cat, "其他")
        sections.append(f'  <h2>{title} · {len(group)} 张</h2>\n  <div class="grid">\n'
                        + "\n".join(card_html(c) for c in group) + "\n  </div>")
    body = "\n".join(sections)

    chips = "".join(
        f'<button class="chip" data-filter="{s}"><i class="dot {s}"></i>{LABEL[s]} '
        f'<b>{counts.get(s, 0)}</b></button>'
        for s in (S_WIRED, S_READY, S_SPARE, S_DROP))

    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>资产盘点 · 选件表（44 张）</title>
<style>
  :root {{
    --paper:#f7f3e8; --ink:#2b2722; --muted:#7c7366; --line:#dcd3bf; --card:#fffdf6;
    --wired:#2f7d4f; --ready:#2b6cb0; --spare:#8a8175; --drop:#b03a2e;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--paper); color:var(--ink);
    font:14px/1.6 "PingFang SC","Microsoft YaHei",-apple-system,sans-serif; }}
  header {{ position:sticky; top:0; z-index:9; background:rgba(247,243,232,.96);
    border-bottom:1px solid var(--line); padding:13px 24px 9px; backdrop-filter:blur(6px); }}
  h1 {{ font-size:16.5px; margin:0 0 7px; letter-spacing:.02em; }}
  h1 small {{ font-weight:400; color:var(--muted); font-size:12px; margin-left:8px; }}
  .bar {{ display:flex; flex-wrap:wrap; gap:7px; align-items:center; }}
  .chip {{ border:1px solid var(--line); background:var(--card); border-radius:999px;
    padding:4px 11px; cursor:pointer; font-size:12.5px; color:var(--ink); }}
  .chip b {{ font-variant-numeric:tabular-nums; }}
  .chip[aria-pressed="true"] {{ background:var(--ink); color:var(--paper); border-color:var(--ink); }}
  .chip[aria-pressed="true"] .dot {{ box-shadow:0 0 0 2px var(--paper); }}
  .btn {{ border:1px solid var(--line); background:var(--card); border-radius:7px;
    padding:5px 12px; cursor:pointer; font-size:12.5px; }}
  .btn:hover {{ border-color:var(--ink); }}
  .dot {{ display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; }}
  .dot.wired {{ background:var(--wired); }} .dot.ready {{ background:var(--ready); }}
  .dot.spare {{ background:var(--spare); }} .dot.drop {{ background:var(--drop); }}
  .legend {{ color:var(--muted); font-size:11.5px; margin-top:7px; line-height:1.7; }}
  main {{ padding:10px 24px 90px; }}
  h2 {{ font-size:12.5px; letter-spacing:.16em; color:var(--muted); font-weight:600;
    margin:24px 0 10px; padding-bottom:6px; border-bottom:1px solid var(--line); }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(198px,1fr)); gap:13px; }}
  .card {{ background:var(--card); border:1px solid var(--line); border-left:3px solid var(--line);
    border-radius:10px; overflow:hidden; display:flex; flex-direction:column; }}
  /* 未勾选**不做灰度**：这张表的用途就是看画，压暗/去色等于把判断依据拿掉。
     用左侧红边 + 勾选项文字表达「不保留」，图始终是原色。 */
  .card.off {{ background:#f2ece0; border-left-color:var(--drop); }}
  .card.off .name {{ text-decoration:line-through; color:#8a8175; }}
  .card.hide {{ display:none; }}
  .t-off {{ display:none; color:var(--drop); font-weight:600; }}
  .card.off .t-on {{ display:none; }}
  .card.off .t-off {{ display:inline; }}
  .stage {{ height:168px; display:flex; align-items:center; justify-content:center;
    background:
      linear-gradient(45deg,#e9e2d0 25%,transparent 25%,transparent 75%,#e9e2d0 75%),
      linear-gradient(45deg,#e9e2d0 25%,#f3eedf 25%,#f3eedf 75%,#e9e2d0 75%);
    background-size:16px 16px; background-position:0 0,8px 8px; }}
  .stage img {{ max-width:92%; max-height:92%; }}
  .body {{ padding:9px 11px 10px; display:flex; flex-direction:column; gap:3px; flex:1; }}
  .name {{ font-size:12.5px; font-weight:600; word-break:break-all; line-height:1.35; }}
  .meta {{ font-size:10.5px; color:var(--muted); font-variant-numeric:tabular-nums; }}
  .why {{ font-size:11.5px; color:#5c5449; line-height:1.45; margin-top:1px; flex:1; }}
  .st {{ font-size:11px; font-weight:700; }}
  .card[data-status="wired"] .st {{ color:var(--wired); }}
  .card[data-status="ready"] .st {{ color:var(--ready); }}
  .card[data-status="spare"] .st {{ color:var(--spare); }}
  .card[data-status="drop"] .st {{ color:var(--drop); }}
  label.pick {{ display:flex; align-items:center; gap:6px; margin-top:7px; font-size:11.5px;
    color:var(--muted); cursor:pointer; border-top:1px dashed var(--line); padding-top:7px; }}
  label.pick input {{ accent-color:var(--wired); }}
  #result {{ position:fixed; right:18px; bottom:18px; width:340px; max-height:46vh; overflow:auto;
    background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px;
    font:11.5px/1.5 ui-monospace,Consolas,monospace; white-space:pre-wrap; display:none;
    box-shadow:0 8px 24px rgba(0,0,0,.1); }}
  .note {{ font-size:12px; color:#6b6153; background:#efe8d6; border-radius:8px;
    padding:8px 12px; margin:12px 0 0; }}
</style></head>
<body>
<header>
  <h1>资产盘点 · 选件表 <small>44 张 · 勾选 = 留下 · 默认按 2026-11-26 的决定：除石凳全留</small></h1>
  <div class="bar">
    <button class="chip" data-filter="all" aria-pressed="true">全部 <b>{len(cards)}</b></button>
    {chips}
    <span style="flex:1"></span>
    <button class="btn" id="reset">按建议重置</button>
    <button class="btn" id="copy">复制结果</button>
  </div>
  <div class="legend">
    尺寸都是<b>原始像素</b>，不是显示尺寸。角色统一 340² 帧框（主体高 251 → 显示 128）；
    敌人 sprite 128²（主体高 48 = 1 TILE）；底板高 144 = 3 TILE。
    缩略图已裁到主体，框里留白看不到 —— 但摆位锚点算的是帧框，不是主体。<br>
    <b>这张表只覆盖 X 轴资产。</b>地图要做 X/Y 双轴（恶魔城式纵向房），纵向件
    （侧壁 / 阶梯 / 梯子 / 顶棚 / 附着平台）<b>目前一张都没有</b>，清单见
    <code>art/ASSET_RULES.md §5</code>。
  </div>
</header>
<main>
{body}
  <p class="note">旧产线还在盘上占 63 MB：<code>art/hero</code> 51 PNG / 45 MB、
    <code>art/tiles</code> 46 / 15 MB、<code>art/bg</code> 2 / 3.4 MB。Godot 已一张不读，
    纯历史证据 —— 这个不在这张表里逐张列，要不要整目录清掉你一句话。</p>
</main>
<pre id="result"></pre>
<script>
const KEY = "asset-sheet-v1";
let saved = {{}};
try {{ saved = JSON.parse(localStorage.getItem(KEY) || "{{}}"); }} catch (e) {{ saved = {{}}; }}

const boxes = [...document.querySelectorAll("input[data-k]")];
boxes.forEach(b => {{
  if (saved[b.dataset.k] !== undefined) b.checked = saved[b.dataset.k];
  paint(b);
}});

function paint(b) {{
  b.closest(".card").classList.toggle("off", !b.checked);
}}
function persist() {{
  boxes.forEach(b => saved[b.dataset.k] = b.checked);
  try {{ localStorage.setItem(KEY, JSON.stringify(saved)); }} catch (e) {{}}
}}
function report() {{
  const keep = [], drop = [];
  boxes.forEach(b => (b.checked ? keep : drop).push(b.dataset.k));
  return "留下 " + keep.length + " / " + boxes.length + "\\n\\n—— 保留 ——\\n"
    + keep.join("\\n") + "\\n\\n—— 不要 ——\\n" + (drop.join("\\n") || "（无）");
}}
document.addEventListener("change", e => {{
  if (e.target.matches("input[data-k]")) {{ paint(e.target); persist(); }}
}});

document.querySelectorAll(".chip").forEach(ch => ch.onclick = () => {{
  const f = ch.dataset.filter;
  document.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", x === ch));
  document.querySelectorAll(".card").forEach(card => {{
    card.classList.toggle("hide", f !== "all" && card.dataset.status !== f);
  }});
  document.querySelectorAll("h2").forEach(h => h.style.display = f === "all" ? "" : "none");
  window.scrollTo({{ top: 0, behavior: "instant" }});
}});

document.getElementById("reset").onclick = () => {{
  try {{ localStorage.removeItem(KEY); }} catch (e) {{}}
  location.reload();
}};
document.getElementById("copy").onclick = async () => {{
  const box = document.getElementById("result");
  box.style.display = "block";
  const text = report();
  box.textContent = text;
  try {{ await navigator.clipboard.writeText(text); box.textContent = text + "\\n\\n（已复制）"; }}
  catch (e) {{ box.textContent = text + "\\n\\n（复制失败，手动选中上面文字）"; }}
}};
</script>
</body></html>"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--open", action="store_true")
    args = ap.parse_args()
    cards = collect()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(render(cards), encoding="utf-8")
    print(f"[sheet] 写出 {OUT.relative_to(ROOT)}  ({OUT.stat().st_size // 1024} KB, {len(cards)} 张)")
    if args.open:
        import webbrowser
        webbrowser.open(OUT.as_uri())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
