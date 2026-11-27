"""沸腾线 shader 两帧比对。

    python tests/boil_check.py

判据三条，全过才算 shader 真的在工作：
  1. 两帧有差异（在抖）
  2. 差异是"微动"不是"噪声"：平均通道差小、变化像素占比不爆表
  3. 边缘没有塌陷成黑/透明（UV 夹边界有效）
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
A = ROOT.parent / "shots" / "godot_boil_a.png"
B = ROOT.parent / "shots" / "godot_boil_b.png"

fails = []


def check(label, ok, detail=""):
    print(("  ✓ " if ok else "  ✗ ") + label + ("  " + detail if detail else ""))
    if not ok:
        fails.append(label)


for p in (A, B):
    if not p.exists():
        print(f"缺少 {p}，先跑 tests/boil_shot.gd")
        sys.exit(1)

a = np.asarray(Image.open(A).convert("RGB"), dtype=np.int16)
b = np.asarray(Image.open(B).convert("RGB"), dtype=np.int16)

diff = np.abs(a - b)
per_pixel = diff.max(axis=2)
mask = per_pixel > 2

changed = mask.mean()
mean_diff = diff.mean()

# 判据核心：抖动必须**跟着画面结构走**。
# 手绘"整帧重画"的效果是——有笔触的地方位置偏了 1px（差异明显），
# 大块留白/平涂的地方应该纹丝不动。
# 逐像素噪声恰好相反：连平坦区也在乱跳。所以拿"图像梯度"给像素分类再分别看。
gray = a.mean(axis=2)
gx = np.abs(np.diff(gray, axis=1))[:-1, :]
gy = np.abs(np.diff(gray, axis=0))[:, :-1]
grad = gx + gy
flat = grad < 1.5
edge = grad > 10.0

flat_diff = per_pixel[:-1, :-1][flat].mean() if flat.any() else 0.0
edge_diff = per_pixel[:-1, :-1][edge].mean() if edge.any() else 0.0

print(f"尺寸 {a.shape[1]}x{a.shape[0]}")
print(f"变化像素占比 {changed*100:.2f}%   平均差 {mean_diff:.2f}")
print(f"平坦区占比 {flat.mean()*100:.1f}% 差异 {flat_diff:.2f} | "
      f"边缘区占比 {edge.mean()*100:.1f}% 差异 {edge_diff:.2f}")

check("两帧有差异（shader 在抖）", changed > 0.002, f"{changed*100:.2f}% > 0.2%")
check("平坦区不被搅动（不是噪声）", flat_diff < 1.0, f"{flat_diff:.2f} < 1.0")
check("笔触边缘确实在动", edge_diff > 1.5, f"{edge_diff:.2f} > 1.5")


def border_ok(img):
    """外圈 2px 不能出现整片纯黑/全透明——那是 UV 采到图外的典型症状。"""
    edge = np.concatenate([
        img[0:2].reshape(-1, 3), img[-2:].reshape(-1, 3),
        img[:, 0:2].reshape(-1, 3), img[:, -2:].reshape(-1, 3),
    ])
    pure_black = (edge.sum(axis=1) < 12).mean()
    return pure_black < 0.25, pure_black


ok_a, pb_a = border_ok(a)
ok_b, pb_b = border_ok(b)
check("边缘未塌陷（A 帧）", ok_a, f"纯黑占比 {pb_a*100:.1f}%")
check("边缘未塌陷（B 帧）", ok_b, f"纯黑占比 {pb_b*100:.1f}%")

print("\n结果：PASS" if not fails else f"\n结果：FAIL {len(fails)} 项 -> {fails}")
sys.exit(0 if not fails else 1)
