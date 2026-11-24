# 项目地图（≤60 行）

## 主线
照片 → 生图（**只生头**）→ 分层 SVG → 贴**标准身体**（固定资产）→ 成品
约束：全自动、不接受人工标点、身体不重生成。

## 资产在哪

| 要什么 | 路径 |
|---|---|
| 金标准生图（**只有 men_32 / women_44**）| `verify/avatar-test/draws/consistency/men_32/` · `draws/females/women44_v2.png` |
| 原照片（128×128）| `verify/avatar-test/faces/` |
| **头身分离成品（合规）** | `verify/svg-lab/pipeline/assets/{men_32,women_44}_{head,body}_v2.png` |
| 资产审核表 | `verify/svg-lab/ASSET_AUDIT.html` |

## 哪份文档准

| 主题 | 准的文件 |
|---|---|
| **头身方案（最全）** | **`docs/05` §0 + §6.8** |
| 头身连接规格 | `verify/sticker-layered/NECK_JOINT_SPEC.md`（**v2**）|
| 着色规范 | `verify/svg-lab/SHADING_SPEC.md` |
| 状态索引 | `verify/svg-lab/INDEX.md` |

**已废**：`avatar-test/NECK_INTERFACE_SPEC.md`(v1) · `verify/_trash/`(背景不合规的身体)

## 已验证结论（别再推翻）

1. 生图模型 = 最好的特征提取器（胡须/发型/脸型都保留）
2. 矢量化保真够：64 色 vs 原图头部差 8.21%
3. 分层不牺牲保真：差 8.61%（+0.4pp）
4. SVG 删组即露下层 → 不需要 inpaint
5. 眼睛不能重画（瞳孔会侵占眼白）
6. 只改嘴最安全
7. 头身切法：头到下巴（**沿轮廓**），身体 = 脖子段 + 肩线以下
8. 实测：women_44 脖子段 51px／men_32 18px；拼回差异 1.05／0.72

## 当前进度

| 环节 | 状态 |
|---|---|
| 照片 → 生图（头）| ✅ |
| 生图 → 分层 SVG | ✅ |
| 换表情（只改嘴）| ✅ |
| 头身分离（沿轮廓）| ✅ 本轮完成 |
| 头贴身体拼接 | ⏳ 待验证 |
| 一键 pipeline | ❌ |
| Skill 封装 | ❌ |
