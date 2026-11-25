# docs/history · 历史报告（只读）

这里是从根目录归档的过程报告与修订史。**只读，不再更新**，追根因时才翻。

## 关于截图断链

2026-11-25 做了一轮废弃清理：被否决的方案截图、开发过程截图、临时调试图
（`shots/01~29_*.png`、`shots/style2..style5/`、`shots/_crop_*`、`shots/_dbg_*` 等）
已从仓库删除，因此下面的历史报告里图片链接会失效。

**这是有意的**：报告留的是**结论和判定依据的文字**，不是图。要取回某张图：

```bash
git log --diff-filter=D --oneline -- shots/01_hall.png   # 找删除它的提交
git show <sha>^:shots/01_hall.png > /tmp/01_hall.png     # 从上一版取出
```

## 当前有效证据图在哪

- `shots/` —— 现行版本的验收截图（`scene_hall.png`、`scene_tower.png`、`ui_*`、`keymap_touch.png` 等）
- `art/tiles/_ref/` —— 风格基准与判定实验图，**入库保存**
