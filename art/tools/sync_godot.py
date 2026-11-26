#!/usr/bin/env python3
"""art/approved/  →  godot/assets/art/  的只读镜像同步。

为什么是「复制」不是「软链」
----------------------------
Godot 只能从 `res://`（= `godot/`）里读资源。软链在 Windows 上要开发者模式，
在导出包里还会断。所以 `godot/assets/art/` 是一份**逐字节副本**，
方向永远是 `art/approved/` → `godot/assets/art/`，反向永不成立。

单向的好处：`art/approved/` 是唯一真源（art/README §1 定的），
Godot 侧就算被手改，`--check` 也能一眼抓出来。

    python art/tools/sync_godot.py           # 同步
    python art/tools/sync_godot.py --check   # 只比对，有漂移就 exit 1
    python art/tools/sync_godot.py --prune   # 同步并删掉镜像里真源没有的文件

`--prune` 默认关闭：删文件是不可逆的，要人手敲。

每次同步都会重写 `godot/assets/art/SYNC_STAMP.txt`，记录源 commit、时间、
文件数与总字节。Godot 侧看到 STAMP 里的 commit 和 `git rev-parse HEAD` 对不上，
就说明美术重出了但没 sync —— 这是给「忘了同步」留的捕手。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "art" / "approved"
DST = ROOT / "godot" / "assets" / "art"
STAMP = DST / "SYNC_STAMP.txt"

# 只同步这两类，别的（.json 之外的临时文件）不碰
WANT_SUFFIX = {".png", ".json"}


def _sha(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _rel_files(base: Path) -> dict[str, Path]:
    out: dict[str, Path] = {}
    for p in sorted(base.rglob("*")):
        if p.is_file() and p.suffix.lower() in WANT_SUFFIX:
            out[p.relative_to(base).as_posix()] = p
    return out


def _git_rev() -> str:
    try:
        return subprocess.run(
            ["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except Exception:
        return "unknown"


def _wrap_png(p: Path) -> list[str]:
    """PNG 本身合法、且真有 alpha 通道 —— 两条都要，缺一条就是错资产。"""
    errs: list[str] = []
    if p.suffix.lower() != ".png":
        return errs
    with p.open("rb") as f:
        head = f.read(8)
    if head != b"\x89PNG\r\n\x1a\n":
        errs.append(f"{p.name}: 不是 PNG")
        return errs
    try:
        from PIL import Image
    except ImportError:
        return errs          # 没装 PIL 就跳过深度检查，不阻断同步
    with Image.open(p) as im:
        if im.mode not in ("RGBA", "LA", "PA"):
            errs.append(f"{p.name}: mode={im.mode}，没有 alpha 通道")
    return errs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只比对不写")
    ap.add_argument("--prune", action="store_true", help="删除镜像中真源已没有的文件")
    args = ap.parse_args()

    if not SRC.is_dir():
        print(f"[sync] 真源不存在：{SRC}", file=sys.stderr)
        return 2

    src = _rel_files(SRC)
    dst = _rel_files(DST) if DST.is_dir() else {}

    missing = [k for k in src if k not in dst]
    changed = [k for k in src if k in dst and _sha(src[k]) != _sha(dst[k])]
    extra = [k for k in dst if k not in src and k != "SYNC_STAMP.txt"]

    total_bytes = sum(p.stat().st_size for p in src.values())

    if args.check:
        ok = not (missing or changed or extra)
        print(f"[sync] 真源 {len(src)} 个文件 / {total_bytes/1e6:.1f} MB")
        for label, items in (("缺", missing), ("内容不同", changed), ("镜像多出", extra)):
            if items:
                print(f"[sync] {label} {len(items)}：")
                for k in items[:20]:
                    print(f"       {k}")
                if len(items) > 20:
                    print(f"       … 还有 {len(items) - 20} 个")
        print("[sync] " + ("PASS 镜像与真源一致" if ok else "FAIL 有漂移，跑一次 sync_godot.py"))
        return 0 if ok else 1

    if not missing and not changed and not extra and STAMP.exists():
        print(f"[sync] 已是最新（{len(src)} 个文件）")
        return 0

    DST.mkdir(parents=True, exist_ok=True)
    for k in missing + changed:
        target = DST / k
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src[k], target)
        print(f"[sync] → {k}")

    if args.prune:
        for k in extra:
            (DST / k).unlink()
            print(f"[sync] ✗ 删除镜像多余 {k}")
    elif extra:
        print(f"[sync] 镜像多出 {len(extra)} 个文件（未删，需要时加 --prune）")

    bad: list[str] = []
    for k, p in src.items():
        bad += _wrap_png(p)
    if bad:
        print("[sync] 资产体检发现问题：", file=sys.stderr)
        for b in bad:
            print("       " + b, file=sys.stderr)
        return 1

    STAMP.write_text(
        "art/approved → godot/assets/art 的单向镜像。不要手改本目录。\n"
        f"source_commit = {_git_rev()}\n"
        f"synced_at     = {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"files         = {len(src)}\n"
        f"bytes         = {total_bytes}\n"
        f"manifest      = {json.dumps(sorted(src), ensure_ascii=False)}\n",
        encoding="utf-8",
    )
    print(f"[sync] PASS 同步 {len(missing)} 新增 / {len(changed)} 更新，共 {len(src)} 个文件 "
          f"{total_bytes/1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
