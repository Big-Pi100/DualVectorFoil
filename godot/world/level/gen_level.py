#!/usr/bin/env python3
"""关卡拼装器 —— Dead Cells「混合方法」的第 3/4/5/6 步。

    input   world/level/<graph>.graph     关卡图（节点 + tag + 候选模板 + seed）
            world/rooms/blueprints/<t>.txt 手工零件（第 2 步，人做的）
    output  world/rooms/blueprints/<level>.txt   合并后的整关蓝图
            world/level/<level>.layout.json      每间房的 origin / 模板 / 门行

为什么合并成一张蓝图，而不是运行时拼 tscn：

    `gen_room_terrain.gd` 已经把「ASCII → 碰撞 + 门 + 敌人 + 机关」整条链做完了。
    合并成一张图 = 直接复用这条链；而且**内部门自动消失**（只有首尾留 L/R），
    玩家从第一间走到最后一间是连续地形 —— 这才叫「一关」，不是「一串房间」。

    代价是每间房必须共用一个 collision 世界，所以接缝处的地面必须真的对齐。
    这件事不靠肉眼，靠 `--verify` 的门行断言（对不上就退出码 1）。

用法：
    python godot/world/level/gen_level.py level_01
    python godot/world/level/gen_level.py level_01 --verify
"""

from __future__ import annotations

import hashlib
import json
import random
import sys
from pathlib import Path

TILE = 48
SOLID = "#"
PLAT = "="
EMPTY = "."

# tag → (地面敌人数, 飞行敌人数)
# 这是「职能 → 战斗强度」的映射，不是随手写的数：
#   shop 房零敌人 —— 玩家进商店要能安全翻背包，这是 DC 的硬约定；
#   boss 房少而精 —— 前厅留白比堆怪重要（room_05 头部注释也这么写）。
TAG_SPAWNS = {
    "start": (2, 0),
    "combat": (5, 1),
    "shop": (0, 0),
    "treasure": (1, 1),
    "boss": (3, 1),
}

# 敌人之间至少隔几列。2 列 = 96px，比 Invader 碰撞盒(40)宽一点，
# 再密就会叠在一起，玩家分不清自己在打谁。
MIN_SPAWN_GAP = 3


# --------------------------------------------------------------------------
# 蓝图读写
# --------------------------------------------------------------------------


def parse_blueprint(path: Path) -> tuple[dict, list[str]]:
    head: dict[str, str] = {}
    grid: list[str] = []
    body = False
    for raw in path.read_text(encoding="utf-8").splitlines():
        if not body:
            s = raw.strip()
            if s == "---":
                body = True
            elif s and not s.startswith("!") and "=" in s:
                k, v = s.split("=", 1)
                head[k.strip()] = v.strip()
        else:
            if raw.startswith("!"):
                continue
            grid.append(raw.rstrip())
    while grid and not grid[-1].strip():
        grid.pop()
    if not grid:
        raise SystemExit(f"{path.name}: 没有任何地形行")
    width = max(len(r) for r in grid)
    return head, [r.ljust(width, EMPTY) for r in grid]


def find_door(grid: list[str], ch: str) -> tuple[int, int] | None:
    """返回 (col, row)。找不到返回 None。"""
    for r, row in enumerate(grid):
        c = row.find(ch)
        if c >= 0:
            return (c, r)
    return None


def stand_row(grid: list[str], r_door: int, col: int) -> int | None:
    """门格往下第一块实地之上的那一行 —— 玩家真正站的那一行。

    为什么不能直接用门格行：Room02 的 R 门格在 r11，但 r12 是空的、r13 才是地，
    玩家站在 r12。用门格行去对齐，接缝处会差 48px，人卡在门框上。
    """
    for r in range(r_door, len(grid)):
        if grid[r][col] in (SOLID, "G"):
            return r - 1
    return None


# --------------------------------------------------------------------------
# 模板（第 2 步的产物：手工零件 + 一张契约）
# --------------------------------------------------------------------------


class Template:
    """一间手工房间 + 它的门契约。

    2026-11-27 之前只有 L/R 两种门 —— 那是"关卡只能横着排"的根源。
    现在四种门都参与契约，拼装器才有东西可以上下接。

    纵向连接**不需要站面行**：玩家不是"走到"上门，是"掉进"上门。
    所以垂直缝合只要列对齐，比横向少一个约束（横向要行对齐，否则差 48px 的坎）。
    """

    def __init__(self, tid: str, head: dict, grid: list[str]):
        self.id = tid
        self.head = head
        self.grid = grid
        self.rows = len(grid)
        self.cols = len(grid[0])

        self.door_l = find_door(grid, "L")
        self.door_r = find_door(grid, "R")
        self.door_u = find_door(grid, "U")
        self.door_d = find_door(grid, "D")

        self.s_l = stand_row(grid, self.door_l[1], 0) if self.door_l else None
        self.s_r = (
            stand_row(grid, self.door_r[1], self.cols - 1) if self.door_r else None
        )

    # 能不能当「入口」（被上游接进来）
    def has_in(self, link: str | None) -> bool:
        if link == "v":
            return self.door_u is not None
        return self.door_l is not None

    # 能不能当「出口」（接下游）
    def has_out(self, link: str | None) -> bool:
        if link == "v":
            return self.door_d is not None
        return self.door_r is not None

    @property
    def can_be_middle(self) -> bool:
        return self.door_r is not None and self.s_r is not None


# --------------------------------------------------------------------------
# 关卡图（第 3 步）
# --------------------------------------------------------------------------


def parse_graph(path: Path) -> tuple[int, list[dict]]:
    seed = 0
    nodes: list[dict] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("!"):
            continue
        if line.startswith("seed="):
            seed = int(line.split("=", 1)[1])
            continue
        if not line.startswith("node "):
            raise SystemExit(f"看不懂这一行：{raw}")
        parts = line.split()
        node: dict = {
            "id": parts[1], "after": None, "link": "h",
            "branch": False, "repeat": None, "at": None,
        }
        for tok in parts[2:]:
            if "=" not in tok:
                continue
            k, v = tok.split("=", 1)
            if k == "template":
                node["pool"] = [t.strip() for t in v.split(",") if t.strip()]
            elif k == "after":
                # 横向：父的右门 → 子的左门
                node["after"] = v
                node["link"] = "h"
            elif k == "below":
                # 纵向：父的下门 → 子的上门。
                # 支线也走这条路 —— 区别在于它**不接续主链**（见 branch）。
                node["after"] = v
                node["link"] = "v"
            elif k == "branch":
                # 支线：挂在父房间的地板洞下面，走完回到原地，不往下传。
                # 这是「主脊 + 岔路」在关卡图里的最小表达。
                node["branch"] = v not in ("0", "false", "no")
            elif k == "repeat":
                # 「这里放 1~2 个这类房间」—— 具体几个由 seed 决定。
                # 有了它，房间数才不是常数；否则换种子只换零件的长相。
                lo, _, hi = v.partition("-")
                node["repeat"] = (int(lo), int(hi or lo))
            elif k == "at":
                # 支线洞开在父房间的第几列（相对父房间左边界）。
                node["at"] = int(v)
            else:
                node[k] = v
        if "tag" not in node or "pool" not in node:
            raise SystemExit(f"节点 {node['id']} 缺 tag 或 template")
        nodes.append(node)

    ids = [n["id"] for n in nodes]
    if len(set(ids)) != len(ids):
        raise SystemExit("节点 id 重复")
    for n in nodes:
        if n["after"] is not None and n["after"] not in ids:
            raise SystemExit(f"{n['id']} 的 after={n['after']} 不存在")
        if n["branch"] and n["link"] != "v":
            # 横向支线需要第二扇门接回主链，那是"并行路径"，不是"口袋"。
            # 现在只做了口袋，别让图里写出一个拼装器不会的手势。
            raise SystemExit(f"{n['id']}: 支线必须用 below=（当前只支持向下支线）")
        if n["branch"] and n["repeat"]:
            raise SystemExit(f"{n['id']}: 支线不支持 repeat")
    heads = [n for n in nodes if not n["branch"] and n["after"] is None]
    if len(heads) != 1:
        raise SystemExit("关卡图必须正好有一个起点（不写 after 的非支线节点）")
    return seed, nodes


def expand_repeat(seed: int, nodes: list[dict]) -> list[dict]:
    """把 `repeat=1-2` 展开成 1~2 个连续节点，个数由 seed 决定。

    为什么必须在这一步做，而不是在 layout 里临时循环：
    layout 靠**列表顺序**推主链（下一个节点的 link 决定本节点的出口方向）。
    只要展开后的顺序是对的，下游三个函数（layout / merge / emit）都不用知道
    "这里原来是 repeat" —— 变化发生在入口，而不是散落在每一步。
    """
    out: list[dict] = []
    last_of: dict[str, str] = {}
    for n in nodes:
        if not n["repeat"]:
            # 必须拷一份再放进去。下面那趟 rewrite 会就地改 `after`，
            # 直接放原对象的话，`--variety` 连跑多个种子时第二次就拿着
            # 上一次改过的图（seed 7 直接 KeyError: combat_a2，而那个节点
            # 在 seed 7 里根本不该存在）。共享可变状态，一次就够踩。
            out.append(dict(n))
            last_of[n["id"]] = n["id"]
            continue
        lo, hi = n["repeat"]
        rng = node_rng(seed, n["id"] + ":repeat")
        cnt = rng.randint(lo, hi)
        names = [n["id"] if k == 0 else f"{n['id']}{k + 1}" for k in range(cnt)]
        for k, name in enumerate(names):
            m = dict(n)
            m["id"] = name
            m["repeat"] = None
            # 展开出来的第 2、3 间要接在**前一个展开体**后面。
            # 全都继承原始 after 的话，它们会叠在同一个坐标上 ——
            # 我第一次跑就得到两间都在 (26,14) 的 combat_a2，图上看是同一间房。
            if k > 0:
                m["after"] = names[k - 1]
                # 标记：这条 after 是刚手写的，下面那趟"改指向最后一次展开"的
                # 重写必须跳过它 —— 否则 combat_a2 会被改成指向自己。
                m["_chained"] = True
            out.append(m)
        last_of[n["id"]] = names[-1]

    # 后继节点原本写的是 `after=combat_b`；展开后 combat_b 可能有 2 个，
    # 后继必须挂在**最后一个**后面，否则第二段会被甩到关卡末尾。
    for m in out:
        if m.pop("_chained", False):
            continue
        if m["after"] in last_of:
            m["after"] = last_of[m["after"]]
    ids = [m["id"] for m in out]
    if len(set(ids)) != len(ids):
        raise SystemExit("repeat 展开后节点 id 重复")
    return out


def node_rng(seed: int, node_id: str) -> random.Random:
    """每间房一条独立随机流。

    用 crc32 而不是内置 hash：Python 的 str hash 每个进程加盐，
    换个进程跑同一 seed 会抽出不同模板 —— 「同种子可复现」直接作废。
    """
    h = int(hashlib.md5(f"{seed}:{node_id}".encode()).hexdigest()[:8], 16)
    return random.Random(h)


# --------------------------------------------------------------------------
# 第 4/5 步：布局 + 拼接
# --------------------------------------------------------------------------


def layout(seed: int, nodes: list[dict], tpls: dict[str, Template]) -> list[dict]:
    """把节点列表铺成世界坐标。

    两种节点走两条路：

      主链节点  像以前一样一个接一个排（横或竖），**下游怎么接由主链上的下一个决定**。
      支线节点  挂在某个主链房间的地板洞下面，排完之后再摆 —— 它不接续主链，
                所以不能参与「下一个节点的 link 决定本节点出口方向」那套推导。

    接缝（要挖开哪几格）在这里就算好，存到节点上。为什么不留给 punch_seams 现算：
    支线的缝不是一个固定形状 —— 它要从**父房间的可站面下一行**一直挖到口袋的天花板，
    中间隔着父房间两三层厚的地板。这种"挖到哪儿为止"的信息只有 layout 知道。
    """
    chain = [n for n in nodes if not n["branch"]]
    branches = [n for n in nodes if n["branch"]]
    inst: list[dict] = []
    index: dict[str, int] = {}
    last = len(chain) - 1

    for i, node in enumerate(chain):
        rng = node_rng(seed, node["id"])
        pool = [t for t in node["pool"] if t in tpls]
        if not pool:
            raise SystemExit(f"{node['id']}: 候选模板一个都不存在 {node['pool']}")

        # 这间房需要什么门，由**它怎么接上游**和**下游怎么接它**共同决定：
        #   入口方向 = 自己的 link（起点没有上游 → 走 L 门进关卡）
        #   出口方向 = 下一个节点的 link（终点没有下游 → 出口由 open_exit 补）
        link_in = node["link"] if node["after"] else None
        link_out = chain[i + 1]["link"] if i < last else None

        ok = []
        for t in pool:
            tp = tpls[t]
            if not tp.has_in(link_in):
                continue
            if i < last and not tp.has_out(link_out):
                continue
            ok.append(t)
        if not ok:
            raise SystemExit(
                f"{node['id']}: 候选池里没有同时满足"
                f"入口={'L' if link_in != 'v' else 'U'} / "
                f"出口={'R' if link_out != 'v' else 'D' if link_out else '任意'} 的模板"
            )
        tid = rng.choice(ok)
        tpl = tpls[tid]

        if node["after"] is None:
            col, row = 0, 0
            seam = None
        else:
            parent = inst[index[node["after"]]]
            if node["link"] == "v":
                # 纵向：父的下门**列** == 子的上门**列**。
                # 纵向不需要行对齐 —— 人是从上门掉进来的，不是走过去的，
                # 少一个约束就少一处 48px 的坎。
                dc = parent["col"] + parent["tpl"].door_d[0]
                row = parent["row"] + parent["tpl"].rows
                col = dc - tpl.door_u[0]
                seam = {
                    "kind": "v",
                    "col": dc,
                    "half": 1,
                    "rows": [parent["row"] + parent["tpl"].rows - 1, row],
                }
            else:
                # 横向：不重叠并排，门洞由 punch_seams 挖。
                #
                # 早先试过「重叠一列」（child.col = parent.col + cols - 1）—— 画面会变成
                # 一道竖墙，中间只剩 **1 格宽**的缝：玩家碰撞盒 34px，缝 48px，
                # 能过但一直蹭墙，看起来也不像"两间房连通"，像"两堵墙夹一条缝"。
                # 并排 + 事后把两列的洞口都挖开，才是 2 格宽的洞（96px）。
                col = parent["col"] + parent["tpl"].cols
                # 门行对齐用**站面行**，不是门格行（见 stand_row 的注释）。
                row = parent["row"] + parent["tpl"].s_r - tpl.s_l
                seam = {
                    "kind": "h",
                    "stand": parent["row"] + parent["tpl"].s_r,
                    # 两边各算一次，不共用同一个值：共用的话「地面错位」这条断言
                    # 就永远成立，测了个寂寞。分开算，真错位才测得出来。
                    "stand_a": parent["row"] + parent["tpl"].s_r,
                    "stand_b": row + tpl.s_l,
                    "cols": [parent["col"] + parent["tpl"].cols - 1, col],
                }

        index[node["id"]] = len(inst)
        inst.append(
            {
                "id": node["id"],
                "tag": node["tag"],
                "tpl": tpl,
                "template": tid,
                "col": col,
                "row": row,
                "after": node["after"],
                "link": node["link"] if node["after"] else None,
                "branch": False,
                "seam": seam,
                "is_first": i == 0,
                "is_last": i == last,
            }
        )

    # ---- 支线 ----
    # 全部排完主链再摆，因为它们的父节点位置要先定下来。
    for node in branches:
        rng = node_rng(seed, node["id"])
        pool = [t for t in node["pool"] if t in tpls]
        if not pool:
            raise SystemExit(f"{node['id']}: 候选模板一个都不存在 {node['pool']}")
        ok = []
        for t in pool:
            tp = tpls[t]
            if not tp.has_in("v"):
                continue
            # 支线没有出口。带着下门进来的模板会在末端漏一个通向虚空的洞。
            if tp.door_d is not None:
                continue
            ok.append(t)
        if not ok:
            raise SystemExit(
                f"{node['id']}: 支线候选池里没有「上门进、无下门」的模板 {node['pool']}"
            )
        tid = rng.choice(ok)
        tpl = tpls[tid]

        parent = inst[index[node["after"]]]
        pt: Template = parent["tpl"]
        if pt.s_l is None:
            raise SystemExit(f"{node['id']}: 父房间 {parent['id']} 找不到可站面，没法开地板洞")

        at = node["at"]
        if at is None:
            at = pt.cols // 2
        # 洞口列先按父房间的列算，再把整间口袋塞回父房间的横向范围里 ——
        # 让一间房探出邻居身上，下图看着像贴错了。
        col = parent["col"] + at - tpl.door_u[0]
        lo_c = parent["col"]
        hi_c = parent["col"] + pt.cols - tpl.cols
        if hi_c >= lo_c:
            col = max(lo_c, min(hi_c, col))
        dc = col + tpl.door_u[0]

        row = parent["row"] + pt.rows
        # 从父房间**可站面的下一行**挖到口袋天花板。父房间地板可能有两三格厚，
        # 只挖最底下那一行的话，人会踩在剩下的一层实心上，看着是洞，掉不下去。
        top = parent["row"] + pt.s_l + 1
        # 洞宽和主链一样是 3 格。
        #
        # 这里试过挖 5 格（想让"贴着洞沿往外跳"更宽松），生成器当场把整个右半关
        # 判成孤岛：它的可达性模型只认 4 格跳距，5 格的洞等于把主路挖断了。
        # 实测玩家跑跳能过 5 格（0.92s × 290px/s = 267px），但**图纸说不能过**的关卡
        # 迟早会在别的地方咬人 —— 不能靠"玩家其实跳得过去"来兜底。
        seam = {"kind": "v", "col": dc, "half": 1, "rows": list(range(top, row + 1))}

        index[node["id"]] = len(inst)
        inst.append(
            {
                "id": node["id"],
                "tag": node["tag"],
                "tpl": tpl,
                "template": tid,
                "col": col,
                "row": row,
                "after": node["after"],
                "link": "v",
                "branch": True,
                "seam": seam,
                "is_first": False,
                "is_last": False,
            }
        )

    # 整体平移到 0 起点：站面行对齐会让某些房间往上飘。
    min_row = min(it["row"] for it in inst)
    if min_row < 0:
        for it in inst:
            it["row"] -= min_row
            if it["seam"]:
                if it["seam"]["kind"] == "v":
                    it["seam"]["rows"] = [r - min_row for r in it["seam"]["rows"]]
                else:
                    it["seam"]["stand"] -= min_row
                    it["seam"]["stand_a"] -= min_row
                    it["seam"]["stand_b"] -= min_row
    return inst


def merge(inst: list[dict]) -> tuple[dict, int, int]:
    cells: dict[tuple[int, int], str] = {}

    def put(r: int, c: int, ch: str) -> None:
        if ch == EMPTY:
            return
        if cells.get((r, c)) == SOLID:
            return  # 实心优先：接缝处宁可多一堵墙，不可挖穿地板
        cells[(r, c)] = ch

    for it in inst:
        tpl: Template = it["tpl"]
        for rr in range(tpl.rows):
            for cc in range(tpl.cols):
                ch = tpl.grid[rr][cc]
                # 门格只在**露在整关外沿**时保留：
                #   入口门（L/U）只有第一间留着，其余都变成洞；
                #   出口门（R/D）只有最后一间留着，其余都变成洞。
                # 之前只认 L/R，是因为没有上下门 —— 现在 U/D 同样是"被吃掉的接缝"。
                if ch in ("L", "U"):
                    if not it["is_first"]:
                        ch = EMPTY
                elif ch in ("R", "D"):
                    if not it["is_last"]:
                        ch = EMPTY
                elif ch == "P":
                    # 出生点标记 `P` 只属于「它自己那间房」。
                    #
                    # 这条不是洁癖：room_01 内部有一个 P（它作为独立房间时的出生点），
                    # 拼进整关后如果留着，生成器的可达性会把它当成**全关的起点**，
                    # 于是"玩家在 atrium 出生、走不到左上角的 L 门"，整关判 FAIL。
                    # 我实际就是这么被卡了一次：报错「门 (0,26) 不可达」，但其实那扇门好得很。
                    if not it["is_first"]:
                        ch = EMPTY
                elif ch in ("E", "F", "A"):
                    continue  # 敌人 / 能力点在第 6 步按 seed 重洒
                put(it["row"] + rr, it["col"] + cc, ch)

    width = max(it["col"] + it["tpl"].cols for it in inst)
    height = max(it["row"] + it["tpl"].rows for it in inst)
    return cells, width, height


def punch_seams(inst: list[dict], cells: dict, width: int, height: int) -> None:
    """把接缝挖开 —— 形状直接读 layout 算好的 `seam`。

    为什么不是「让两个房间的门格自然对齐就完了」：
    门格在蓝图里只有 1 格（`L` / `R` / `U` / `D`），而 48px 对 34px 的碰撞盒太窄。
    横向门洞是 3 格高（144px）× 2 列宽（96px）；
    纵向门洞是 3 列宽（144px）× 2 行高（96px）—— 一个横向一个纵向，尺寸对调。
    支线例外：它要从父房间的可站面下方一直挖到口袋天花板，行数是变的。

    这个洞口是**拼装产生的**，不属于任何一个模板 —— 所以由拼装器负责开。
    """
    for it in inst:
        seam = it["seam"]
        if not seam:
            continue
        if seam["kind"] == "v":
            half: int = int(seam.get("half", 1))
            for r in seam["rows"]:
                for c in range(seam["col"] - half, seam["col"] + half + 1):
                    if 0 <= r < height and 0 <= c < width:
                        cells.pop((r, c), None)
        else:
            for c in seam["cols"]:
                for r in range(seam["stand"] - 2, seam["stand"] + 1):
                    if 0 <= r < height and 0 <= c < width:
                        cells.pop((r, c), None)


# --------------------------------------------------------------------------
# 第 6 步：内部随机化
# --------------------------------------------------------------------------


def respawn_enemies(seed: int, inst: list[dict], cells: dict, width: int, height: int) -> int:
    def at(r: int, c: int) -> str:
        if r < 0 or r >= height or c < 0 or c >= width:
            return SOLID
        return cells.get((r, c), EMPTY)

    total = 0
    for it in inst:
        tpl: Template = it["tpl"]
        want_ground, want_air = TAG_SPAWNS.get(it["tag"], (2, 0))
        rng = node_rng(seed, it["id"] + ":spawn")

        # 地面：只取房间内部（去掉首尾列，别把怪堵在门口）
        ground: list[tuple[int, int]] = []
        air: list[tuple[int, int]] = []
        for rr in range(1, tpl.rows - 1):
            for cc in range(1, tpl.cols - 1):
                R, C = it["row"] + rr, it["col"] + cc
                if at(R, C) != EMPTY:
                    continue
                below, above = at(R + 1, C), at(R - 1, C)
                if below in (SOLID, PLAT) and above != SOLID:
                    ground.append((R, C))
                if (
                    rr < int(tpl.rows * 0.65)
                    and all(at(R + dr, C + dc) == EMPTY for dr in (-1, 0, 1) for dc in (-1, 0, 1))
                ):
                    air.append((R, C))

        rng.shuffle(ground)
        rng.shuffle(air)

        used: list[int] = []
        placed_ground = 0
        for R, C in ground:
            if placed_ground >= want_ground:
                break
            if any(abs(C - u) < MIN_SPAWN_GAP for u in used):
                continue
            cells[(R, C)] = "E"
            used.append(C)
            placed_ground += 1

        placed_air = 0
        taken_air: list[int] = []
        for R, C in air:
            if placed_air >= want_air:
                break
            if any(abs(C - u) < MIN_SPAWN_GAP for u in taken_air):
                continue
            cells[(R, C)] = "F"
            taken_air.append(C)
            placed_air += 1

        it["spawned"] = (placed_ground, placed_air)
        total += placed_ground + placed_air
    return total


# --------------------------------------------------------------------------
# 输出
# --------------------------------------------------------------------------


def open_exit(inst: list[dict], cells: dict, width: int, height: int) -> None:
    """在最后一间的右边界开一个出口门（`R`）。

    为什么必须有：整关一旦带了机关闸门（`G`），生成器的 `_check_mechanisms`
    要验「门开之后能走到右门」。没有右门，它直接判 FAIL —— 这个校验是对的，
    一条有闸门却没出口的关卡本来就不成立。
    Boss 房在 DC 里也是打完就通往下一关，所以这里不是为了让校验闭嘴，
    是补上本来就该有的东西。
    """
    # 支线可能排在列表末尾（layout 最后才摆它们），所以"最后一间"要显式取主链末尾。
    last = [it for it in inst if not it["branch"]][-1]
    tpl: Template = last["tpl"]
    # 最后一间自带出口门（R 或 D）就不动 —— 它已经通了。
    # 之前这段无条件在右边界写一个 R，遇到带 D 门的垂直终点会多开一扇没用的门。
    if tpl.door_r is not None or tpl.door_d is not None:
        return
    if tpl.s_l is None:
        return
    stand = last["row"] + tpl.s_l
    c = width - 1
    if 0 <= stand < height:
        cells[(stand, c)] = "R"


def emit(out_bp: Path, layout_path: Path, seed: int, inst: list[dict],
         cells: dict, width: int, height: int) -> None:
    chain = " → ".join(f"{it['id']}({it['template']})" for it in inst)
    lines = [
        "! 自动生成，**不要手改**。改 world/level/level_01.graph 或模板后重跑：",
        "!   python godot/world/level/gen_level.py level_01",
        f"! seed = {seed}",
        f"! 布局 = {chain}",
        f"! 尺寸 = {width} × {height} 格 = {width * TILE} × {height * TILE} px",
        "room_id=level_01",
        "scene=res://world/level/Level01.tscn",
        "door_L=res://world/rooms/SafeHouse.tscn|SpawnFromRest|← 休息小屋",
        "door_R=res://world/rooms/SafeHouse.tscn|SpawnFromRest|→ 下一关（占位）",
        "wireframe=1",
        "---",
    ]
    for r in range(height):
        lines.append("".join(cells.get((r, c), EMPTY) for c in range(width)))
    out_bp.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")

    # 接缝记录直接来自 layout 算好的 seam —— 以前这里是"遍历相邻两间"，
    # 支线不在相邻位置，那套推导会漏掉它，测试也就跟着漏掉。
    seams = []
    for it in inst:
        seam = it["seam"]
        if not seam:
            continue
        s = {"from": it["after"], "to": it["id"], "branch": it["branch"]}
        if seam["kind"] == "v":
            s["link"] = "v"
            s["world_col"] = seam["col"]
            s["world_col_a"] = seam["col"]
            s["world_col_b"] = seam["col"]
            s["world_half"] = int(seam.get("half", 1))
            s["world_row_a"] = seam["rows"][0]
            s["world_row_b"] = seam["rows"][-1]
            s["world_rows"] = list(seam["rows"])
        else:
            s["link"] = "h"
            s["stand_row_a"] = seam["stand_a"]
            s["stand_row_b"] = seam["stand_b"]
            s["world_col"] = seam["cols"][1]
            s["world_cols"] = list(seam["cols"])
        seams.append(s)

    doc = {
        "seed": seed,
        "tile": TILE,
        "cols": width,
        "rows": height,
        "px": [width * TILE, height * TILE],
        "rooms": [
            {
                "id": it["id"],
                "tag": it["tag"],
                "template": it["template"],
                "col": it["col"],
                "row": it["row"],
                "cols": it["tpl"].cols,
                "rows": it["tpl"].rows,
                "link": it["link"],
                "branch": it["branch"],
                "door_in": (
                    ("U", it["tpl"].door_u[1]) if it["link"] == "v" and it["tpl"].door_u
                    else ("L", it["tpl"].door_l[1]) if it["tpl"].door_l
                    else None
                ),
                "door_out": (
                    ("D", it["tpl"].door_d[1]) if it["tpl"].door_d
                    else ("R", it["tpl"].door_r[1]) if it["tpl"].door_r
                    else None
                ),
                "after": it["after"],
                "spawned": list(it["spawned"]),
            }
            for it in inst
        ],
        "seams": seams,
    }
    layout_path.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )


# --------------------------------------------------------------------------
# 自检：这些断言必须能 FAIL
# --------------------------------------------------------------------------


def verify(doc: dict) -> list[str]:
    errs: list[str] = []
    for s in doc["seams"]:
        if s["link"] == "v":
            # 纵向缝：两边的门必须落在**同一列**，否则人掉下去撞在墙上。
            if s["world_col_a"] != s["world_col_b"]:
                errs.append(
                    f"竖缝 {s['from']}→{s['to']} 列错位："
                    f"c{s['world_col_a']} vs c{s['world_col_b']}"
                    f"（差 {s['world_col_b'] - s['world_col_a']} 列）"
                )
        else:
            if s["stand_row_a"] != s["stand_row_b"]:
                errs.append(
                    f"接缝 {s['from']}→{s['to']} 地面错位："
                    f"{s['stand_row_a']} vs {s['stand_row_b']}"
                    f"（差 {s['stand_row_b'] - s['stand_row_a']} 行）"
                )
    # 支线必须真的挂在父房间下面，而且整间都在父房间的横向范围里 ——
    # 探出去的那一截会飘在隔壁房间的头顶上，看着像贴错了。
    pos = {r["id"]: r for r in doc["rooms"]}
    for room in doc["rooms"]:
        if not room["branch"]:
            continue
        p = pos.get(room["after"])
        if p is None:
            errs.append(f"支线 {room['id']} 的父房间 {room['after']} 不存在")
            continue
        if room["row"] <= p["row"]:
            errs.append(f"支线 {room['id']} 不在父房间 {p['id']} 下方")
        if room["col"] < p["col"] or room["col"] + room["cols"] > p["col"] + p["cols"]:
            errs.append(
                f"支线 {room['id']} 横向探出父房间："
                f"c{room['col']}..{room['col'] + room['cols'] - 1} vs "
                f"c{p['col']}..{p['col'] + p['cols'] - 1}"
            )
        if room["door_out"] is not None:
            errs.append(f"支线 {room['id']} 带了出口门 —— 支线是死路，门口只会通向虚空")

    for room in doc["rooms"]:
        g, a = room["spawned"]
        if room["tag"] == "shop":
            if g + a != 0:
                errs.append(f"商店房 {room['id']} 出现了 {g + a} 只敌人")
        elif g + a == 0:
            errs.append(f"{room['id']}({room['tag']}) 一只敌人都没放进去")
    return errs


def load(name: str, here: Path, bp_dir: Path) -> tuple[int, list[dict], dict[str, Template]]:
    seed, nodes = parse_graph(here / f"{name}.graph")
    tpls: dict[str, Template] = {}
    for node in nodes:
        for tid in node["pool"]:
            if tid in tpls:
                continue
            path = bp_dir / f"{tid}.txt"
            if not path.exists():
                raise SystemExit(f"模板不存在：{path}")
            head, grid = parse_blueprint(path)
            tpls[tid] = Template(tid, head, grid)
    return seed, nodes, tpls


def build(seed: int, nodes: list[dict], tpls: dict[str, Template]):
    """seed → 布局 → 合并。不写文件，`--variety` 要连跑好几个种子。"""
    nd = expand_repeat(seed, nodes)
    inst = layout(seed, nd, tpls)
    cells, width, height = merge(inst)
    return inst, cells, width, height


def variety(name: str, here: Path, bp_dir: Path) -> int:
    """换种子必须换结构，不只是换零件的长相。

    这是「随机化到底有没有用」的唯一硬证据。2026-11-27 第一次做这件事时，
    四个种子抽出的模板组合不同，但**房间数恒为 7、尺寸恒为 182×15** ——
    那不是随机，那是换皮。所以这条自检必须能 FAIL，不能只打印。

    判据两条，缺一不可：
      1. 房间顺序（模板序列）至少 4 个种子互不相同；
      2. 房间数或总宽至少有两种取值 —— 只换顺序不换规模，玩家感觉还是同一关。
    """
    _, nodes, tpls = load(name, here, bp_dir)
    rows = []
    print(f"{name}: 同一个关卡图，五个种子")
    for s in (1, 7, 42, 2026, 99991):
        inst, _cells, w, h = build(s, nodes, tpls)
        chain = [it for it in inst if not it["branch"]]
        sig = "→".join(it["template"] for it in chain)
        rows.append((s, len(inst), len(chain), w, h, sig))
        print(f"  seed {s:<7} 房间 {len(inst):2d}（主链 {len(chain)}）"
              f"  {w:3d}×{h:3d} 格 = {w * TILE}×{h * TILE} px")
        print(f"           {sig}")

    sigs = {r[5] for r in rows}
    widths = {r[3] for r in rows}
    counts = {r[1] for r in rows}
    print(f"  模板序列 {len(sigs)} 种 / 宽度 {len(widths)} 种 / 房间数 {len(counts)} 种")
    if len(sigs) < 4:
        print(f"  ✗ 五个种子只排出 {len(sigs)} 种房间顺序 —— 随机化不够")
        return 1
    if len(widths) < 2 or len(counts) < 2:
        print("  ✗ 种子只换了顺序，没换规模（房间数与宽度都是常数）")
        return 1
    print("  ✓ 不同种子产出不同结构")
    return 0


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check_only = "--verify" in sys.argv
    name = args[0] if args else "level_01"

    here = Path(__file__).resolve().parent
    godot = here.parents[1]
    bp_dir = godot / "world" / "rooms" / "blueprints"

    if "--variety" in sys.argv:
        return variety(name, here, bp_dir)

    seed, nodes, tpls = load(name, here, bp_dir)

    inst, cells, width, height = build(seed, nodes, tpls)
    punch_seams(inst, cells, width, height)
    open_exit(inst, cells, width, height)
    total = respawn_enemies(seed, inst, cells, width, height)
    emit(bp_dir / f"{name}.txt", here / f"{name}.layout.json", seed, inst, cells, width, height)

    doc = json.loads((here / f"{name}.layout.json").read_text(encoding="utf-8"))
    errs = verify(doc)

    print(f"seed={seed}  {width}×{height} 格 = {width * TILE}×{height * TILE} px")
    for it in inst:
        g, a = it["spawned"]
        mark = "  └支线" if it["branch"] else ""
        print(f"  {it['id']:10s} {it['tag']:8s} {it['template']:12s}"
              f" @ ({it['col']:3d},{it['row']:2d})  敌 {g}+{a}{mark}")
    print(f"  敌人合计 {total}")
    if errs:
        print("\n自检失败：")
        for e in errs:
            print("  ✗ " + e)
        return 1
    print("  自检通过：接缝对齐 / 支线归属 / 商店无怪 / 每间房有战斗")
    if check_only:
        return 0
    print(f"\n写出 {bp_dir / (name + '.txt')}")
    print(f"写出 {here / (name + '.layout.json')}")
    print(f"下一步：godot --headless --path godot --script res://world/tools/gen_room_terrain.gd -- {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
