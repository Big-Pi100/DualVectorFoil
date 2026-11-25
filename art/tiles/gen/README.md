# art/tiles/gen — 瓦片生图素材板（源头）

这里放的是**生图原图和它的全部切片**，不是游戏用的那 6 张。
游戏用的是上一层的 `art/tiles/wall_0..5.png`。

## 为什么留全量 16 块

`wall_0..5` 是从这 16 块里**挑**出来的（贪心最大最小距离，挑差异最大的 6 个），
不是前 6 个。想换一组，直接重挑，不用重新生图 —— 一次 5–10 credits，别浪费。

```bash
# 重挑 6 块（换掉 wall_0..5）
python - <<'EOF'
import glob, re, shutil
import numpy as np
from PIL import Image
files = sorted([p for p in glob.glob('art/tiles/gen/wallB_*.png') if re.search(r'wallB_\d+\.png$', p)],
               key=lambda p: int(re.search(r'wallB_(\d+)\.png$', p).group(1)))
arrs = []
for p in files:
    a = np.asarray(Image.open(p).convert('RGBA')).astype(np.float32)
    al = a[:, :, 3:4] / 255.0
    gray = a[:, :, :3].mean(axis=2, keepdims=True)
    arrs.append(np.concatenate([al, gray * al / 255.0], axis=2).ravel())
n = len(arrs)
D = np.array([[np.abs(arrs[i] - arrs[j]).mean() for j in range(n)] for i in range(n)])
sel = [int(np.argmin(D.sum(axis=1)))]
while len(sel) < 6:
    cand = sorted(((min(D[k, s] for s in sel), k) for k in range(n) if k not in sel), reverse=True)
    sel.append(cand[0][1])
for i, s in enumerate(sel):
    shutil.copy(files[s], f'art/tiles/wall_{i}.png')
print('选中', sel)
EOF
python build.py && node test.js
```

## 文件

| 文件 | 是什么 |
|---|---|
| `wall_sheet_v1_cobblestone.png` | 第 1 版素材板。**反例**：提示词写了 "rounded"，出来是鹅卵石，颜色偏黄绿。留作对照 |
| `wall_sheet_v2_blocky.png` | 第 2 版，**成**。词改成 BLOCKY / NEARLY RECTANGULAR / NOT round / STRICTLY NO green |
| `wallB_0..15.png` | 从 v2 切出来的 16 块 54×48 单砖 |
| `wallB_sheet.png` | 切片位置可视化（红框 = 每块包围盒）。**切片出错先看这张** |

## 怎么重出

配方逐字在 `../../ART_PIPELINE.md §4.5`，规范在 `../../STYLE_LOCK.md §L11`。
命令：

```bash
python art/tools/tile_from_gen.py art/tiles/gen/<新素材板>.png art/tiles/gen/wallC \
       --tw 54 --th 48 --preview shots/gen_tile_tilingC.png
```

**判据是平铺预览，不是单块。** 单块好看没用，缝宽不一就是不能用。
