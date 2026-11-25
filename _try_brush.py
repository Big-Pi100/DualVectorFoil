#!/usr/bin/env python3
"""笔刷自检：四条蜡笔物理逐条量。

不出瓦片，先证明"笔"是对的。笔不对，瓦片白搭。
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'art', 'tools'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'art', 'tools'))
import numpy as np
from PIL import Image
from crayon import Crayon, PALETTE

OUT = os.path.join(os.path.dirname(__file__), 'shots')
os.makedirs(OUT, exist_ok=True)

W, H = 320, 240
c = Crayon(W, H, seed=7)

# ① 一笔：看 taper / 手抖 / 颗粒
c.stroke([(20, 30), (300, 34)], 'charcoal', width=3, pressure=0.85)
# ② 低压力：应断续（这是世界层的核心手感）
c.stroke([(20, 60), (300, 60)], 'umber', width=3, pressure=0.30)
# ③ 涂面 coverage=0.9（主角级）
c.fill([(20, 85), (150, 85), (150, 165), (20, 165)], 'cold_grey', coverage=0.92)
# ④ 涂面 coverage=0.55（世界级，要留 30–50% 纸白）
c.fill([(170, 85), (300, 85), (300, 165), (170, 165)], 'grey_blue', coverage=0.55)
# ⑤ 闭合轮廓（主角级）
c.outline([(20, 85), (150, 85), (150, 165), (20, 165)], 'charcoal', width=3, gap=0)
# ⑥ 断续轮廓（世界级）
c.outline([(170, 85), (300, 85), (300, 165), (170, 165)], 'charcoal', width=1.5, gap=0.35)
# ⑦ 排线
c.hatch((20, 180, 120, 45), 'blood', angle=38, spacing=7, width=2, pressure=0.55)
# ⑧ 撒点
c.speck(90, 'ochre', (170, 180, 130, 45), rmin=0.5, rmax=1.4)

c.on_paper().resize((W * 3, H * 3), Image.NEAREST).save(os.path.join(OUT, 'brush_test.png'))

# ── 量化：世界层 vs 主角层的纸白占比 ──
img = np.asarray(c.image(), np.float32)
a = img[..., 3] / 255.0
for name, rect in (('主角级 fill cov=.92', (20, 85, 150, 165)),
                   ('世界级 fill cov=.55', (170, 85, 300, 165))):
    x0, y0, x1, y1 = rect
    sub = a[y0:y1, x0:x1]
    print(f'{name}: 覆盖 {sub.mean()*100:5.1f}%  纸白 {(1-sub.mean())*100:5.1f}%')
print('→ shots/brush_test.png')
