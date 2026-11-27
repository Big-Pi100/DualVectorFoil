# 参考拆解：五款类银河恶魔城，我们还没用上的七个维度

> 起于白哥给的四条核心要点（地图结构 / 能力与地图互动 / 引导感 / 小而完整 Demo）
> 与五款参照物。**这份回答的是「除了那四条，还有什么」** —— 四条是骨架，
> 但骨架不决定水准；决定水准的是下面这些别的东西。
>
> 规矩和 `REF_ROOM_DESIGN.md` 一样：每条先写**别人怎么做的**，标出处；
> 再写**对我们的意思**，标明是事实还是我的判断。不和 04 冲突的悄悄写，
> 冲突的集中到 §10，一次性摆出来。

| # | 维度 | 主参照 | 我们的现状 |
|---|---|---|---|
| 1 | 引导：锁与钥匙用同一个视觉元素 | Hollow Knight | 折叠门/生长门**没有专属视觉符号** |
| 2 | 地图是**赚来的**，不是给的 | Hollow Knight | 01 把「看地图」列进循环，但系统没设计 |
| 3 | 知识锁：不开新能力也能开旧门 | HK / 类银通行分类 | 只有两个能力锁，没有知识锁的概念 |
| 4 | 一个能力 = 四个动词 | Ori 的 Bash | 折叠只锁高度，生长只锁立面，都不进战斗 |
| 5 | 没有 Boss 的高潮 | Ori 的三段逃脱 | Boss 卡在美术缺口（04 §9） |
| 6 | 存档点间距就是难度曲线 | HK 长椅 / Ori Soul Link | R6 是唯一暗房，间距没定过目标 |
| 7 | 完成度必须看得见 | Ender Magnolia / PoP | 「清区变田」只在场景里，图上没有 |

---

## 1. 引导：不要「注意引导」，要「同一个东西在锁和钥匙上各出现一次」

白哥第 3 点给的是方向（环境细节、灯光、敌人分布、地标建筑）。方向对，但落到
48 间房里，需要的是**可复用的具体手法**，否则每间房都要重新想一遍。

HK 用了四种，都不靠 UI 文字：

### 1.1 锁和钥匙共用同一个视觉元素

深渊有一道具生命血才能开的门，门周围是**蓝色蝶形花**。同一种花也长在
「生命血茧」旁边（玩家补充生命血的资源点）和 Joni's Repose（给「Joni's Blessing」
护符的房间）。门上还亮着 **15 盏灯**，缺几个就是几盏没亮。

> The door in the Abyss is surrounded by blue butterfly-like flowers. These flowers are also
> placed around the "Lifeblood Cocoons" as well as in "Joni's Repose" where the charm
> "Joni's Blessing" is acquired. This shows that these elements should be used to pass the door.
> 15 "Lifeblood Masks" in total are needed to pass this lock. The player can see how many are
> missing by counting the lights glowing up at the door.
> —— HSLU《Metroidvania Analysis》p.11 前后

**这是最省成本的一条**：不要写任何说明文字，只要让「开锁的东西」和「钥匙的来源」
长得一样。玩家见过花 → 见到花门 → 自己就懂了。

### 1.2 能力符号跨区域复用

> By setting an object, associated with a skill in an alien environment the player can be
> given a hint to use that ability there. In "Hollow Knight" … by setting a small crystal in
> other areas than the "Crystal Peak" the player is told to use the "Crystal Heart" ability there.
> —— 同上

一块小水晶出现在别的地方 = 「这里能用冲刺」。**符号先于能力出现**，玩家拿到能力后
回头才认出那是什么 —— 这正是白哥第 2 点要的「重新发现」，但它靠的是美术摆位，
不是系统。

### 1.3 用一条已知的旧路当对照，让新路自己显出来

打完第一个 Boss，玩家不会立刻拿到能力。前方是一个岔路：一条被**火把点亮**，
一条通回已经走过的区域。

> By following these lights, they then end up at the "Snail Shaman", from whom the key
> is granted. … By only giving the player an already known area as an option furthers the
> feeling that this path should be taken to proceed.
> —— 同上

注意这一条的手法是**二分对照**，不是"把新路点亮"那么简单：它同时给了
「旧路（我知道那儿有什么）」和「新路（有火，不知道通向哪）」，玩家自己会选新路。

### 1.4 地图符号只说「这里有挑战」，不说「怎么打」

Cornifer 卖的第一张地图上，Boss 房间就已经画好了符号。玩家可以直接去，也可以先绕。

> This suggests that a challenge is located there. The player can then decide to go there
> directly or to avoid it and explore the rest of the surroundings first. … It does not force
> the player to go there but shows how to proceed to finish the game.

后期三个幽灵给出目标时，地图上直接出现 4 个新符号（幽灵肉身所在地），
**而且这些符号能显示在还没买到地图的区域上** —— 例外地穿透了「地图要买」的规则，
因为那是主线终点。

### 对我们的意思

`04 §4` 现在只规定了折叠门的**形状**（台阶 4.5–6.5 格）和生长门的**形状**
（无落脚点立面 > 7 格），没规定**长什么样**。结果是玩家看到一面墙，不知道
"这是我的能力不够，还是我走错路"。

可执行的一条（我的判断，成本最低）：**给两个门各一个专属符号，并且在能力来源处
先出现一次**。例如折叠门 = 某种向内折的闩纹；生长门的立面 = 某种向上缠绕的藤纹，
而玩家拿「生长」的那间房墙上长满同样的藤。这样符号先于能力出现，拿到后会自己想起来。

---

## 2. 地图不是 UI，是**赚来的**

这条最容易漏，因为它不像"设计"，像"系统"。但 HK 整个探索节奏有一半靠它。

**三件套，缺一件地图就是坏的**（`hollowknightinteractivemap.com` 的拆解）：

| 件 | 获取 | 价格 | 作用 |
|---|---|---|---|
| **区域地图** | 在该区域内找 Cornifer 买（找不到就打完区 Boss 后去 Dirtmouth 找 Iselda 买，贵一档） | 30–150 Geo | 只画出 Cornifer 事先勘过的那部分 |
| **羽毛笔** | Iselda，一次性 | 120 Geo | **没有它，买来的图永远不更新** |
| **长椅** | 世界里的固定点 | 免费 | **只有坐下休息时才把探索写进地图** |

价格关系是固定的：Cornifer 价 = Iselda 价 × 0.75（30/40、60/80、90/120、112/150、150/200）。
这个折扣本身就是引导 —— 鼓励你**进区域就先买**，因为买了立刻能看到区域大致形状。

三件套之外还有三样，都不白给：

- **Wayward Compass**（220 Geo，占 1 个护符槽）：才在地图上显示你在哪。
  没有它就是"能读图，但位置要自己从房间形状推"。攻略站的说法：泪城那种规整网格没事，
  Deepnest 和 Crystal Peak 那种"每间房长得一样"的地方就是折磨。
- **4 种图钉**（各 6 枚，100/100/210/100 Geo）：玩家自己标。
- **隐藏房间不上图。**

**为什么地图只在长椅更新** —— 这是整套设计里最狠的一刀：

> The game tracks your exploration continuously but only commits it to the map when you sit
> on a bench. … it makes benches a resource, makes deep expeditions feel risky, and makes
> areas like Deepnest genuinely disorienting because the benches are far apart.
> —— 同上

也就是说：**地图的滞后量，就是这段路的危险感**。长椅近的地方，地图几乎实时；
长椅远的地方，你走了十分钟，图上还是空白。

顺带两条：**死亡不丢地图进度**（否则探索惩罚叠加死亡惩罚，太重）；
Cornifer 会**一路撒纸屑 + 哼歌，歌声能穿墙** —— 地图商人自己就是引导。

### 对我们的意思

`01 §3` 已经把「看地图 / 规划」当成核心循环的一个环（理由写的是「手机没小地图会迷路」），
但 `04` 全篇没有地图系统。**这是 GDD 里一个被承认、却没被设计的环。**

不能照搬的部分很清楚：HK 的地图三件套是建立在 40 小时体量 + 长椅稀疏的前提上的。
我们一局 25 分钟（`04 §6`），"先找商人买图"会吃掉教学时间。

可执行的一条（我的判断）：**地图即时绘制（探索过就记下），但"我在哪"不默认给**。
理由——小屏上"位置要靠房间形状推"是纯折磨（HK 自己都把这条做成了占槽的护符），
而"地图要买"在小体量里退化成跑腿。**留一件事让玩家挣：把区域内的岔路标出来**。
这与 §1.4 的"符号只说这里有挑战"是同一件事的两面。

---

## 3. 知识锁：不开新能力，也能开旧门

类银玩家社区把锁分两类（`大电玩`/vgover 的分类，和 `gamemechanicshoard` 的
soft gate / hard gate 是同一件事的两种说法）：

| | 定义 | HK 的例子 |
|---|---|---|
| **能力锁**（hard gate） | 没有某个能力，**物理上过不去** | 台子太高，没二段跳过不去 |
| **知识锁**（soft gate） | 能力已经够，但你**不知道能这么用** | 台子太高，但旁边有怪，踩怪跳上去；或起跳 + 下劈把自己弹更高 |

> 还是这个例子，游戏设计师在这个台子旁边设置了一个怪，你把它打死踩在它的身上
> 就可以跳过去。或者，你可以起跳加下劈方式增加自己的跳跃高度进而抵达台子上，
> **这是空洞骑士中常见的知识锁类型**。
> —— vgover《2025 下半类银游戏推荐》

**为什么这条对小体量特别重要**：知识锁不花美术、不花系统、不花新能力，**只花摆位**。
同一套资产，换个摆法就多一条路。

而且它补的是白哥第 2 点里没说的那一半 —— 第 2 点说的是"用**新能力**重新发现旧区域"，
知识锁说的是"用**新理解**重新发现旧区域"。后者不需要玩家等一个能力发放点，
在 25 分钟的一局里更现实。

### 对我们的意思

`04 §8` 有一条硬约束「每屏至少一个可见落脚点」，这和知识锁不冲突（知识锁是
"看得见但够不到"，不是"看不见"）。

**但手机触屏是硬差异。** "起跳 + 下劈"要求两次输入在几十毫秒内衔接，触屏精度
比手柄差一档。可执行的一条（我的判断）：**知识锁只用"位置关系"和"时机"，
不用"连续精确输入"**。例如——把投掷物打在墙上弹回来踩上去（一次输入 + 等），
而不是下劈连跳（两次输入 + 精度）。

---

## 4. 一个能力，四个动词

Ori 的 Bash 是全类型的教科书：按住键 → **时间减速** → 出现瞄准矢量 →
松开后 Ori 朝选定方向飞出去，被借力的那个东西**朝反方向弹开**。

它同时是四件事：

| 用法 | 具体 | 谁设计的 |
|---|---|---|
| 位移 | 从灯笼/敌人/投射物借力弹射 | 能力本身 |
| 破障 | 把投射物反向打进木栅栏 | 能力本身 |
| 战斗 | 把敌人的弹反打回去 | 能力本身 |
| 解谜 | 空中唯一能改变方向的手段 | 关卡设计用它 |

最狠的是第四项，因为它把两类挑战合并了：

> Bash becomes something closer to a reverse grappling hook — the only way across certain
> gaps is to find an enemy projectile in exactly the right position and use it as a launch
> platform, turning what looks like a combat encounter into the actual solution to a jumping
> puzzle. This dual identity is the cleverest thing in the whole ability set, because it means
> **combat encounters and platforming puzzles stop being separate categories of challenge**.
> —— asidehouse《Ori and the Blind Forest: The Metroidvania as a Watercolour》

注意它还带一个**免费的教学机制**：按住时时间减速。玩家可以慢慢瞄准，
所以"用敌人当跳板"这种高难动作不会变成操作考试。

### 对我们的意思

`04 §4` 的两个门是**一个能力对一个维度**：折叠只管高度，生长只管立面高度。
两者都不进战斗，也都不改变敌人的用法。

这是当前设计里最明显的一处"能力只当钥匙用"。`gamemechanicshoard` 对这件事的说法是：

> 锁的设置若过于生硬或缺乏前期铺垫，会丧失"一把钥匙开多把锁"的立体感，
> **沦为单调且机械的线性开关**。

可执行的一条（我的判断，但要先算账）：**生长先动，折叠后动**。生长是"持续攀升"，
它天然能对着**垂直面上的敌人**用（比如把藤蔓钉进墙里的同时把敌人串住）。
折叠是"一次跳跃"，要让它进战斗就得改跳跃攻击判定，牵连 `FEAT_TABLE` 的全部实测值 ——
**改它就是改尺子**，和角色占屏比那件事一样，得单独裁决。

---

## 5. 没有 Boss 的高潮

Ori 三部曲的"关卡高潮"不是 Boss，是**环境逃脱**：

| 段落 | 触发 | 玩法 |
|---|---|---|
| Ginso Tree | 净化树心 | 树内开始涨水，在洪水追上之前一路向上 |
| Forlorn Ruins | 风之元素失衡 | 整座废墟开始坍塌 |
| Mount Horu | 终盘 | 岩浆上涨 |

> Boss-Free "Climactic Environmental Escapes": Replaces traditional boss fights with
> heart-pounding, continuous precision platforming escape gauntlets (Ginso Tree rising water,
> Forlorn Ruins wind collapse, Mount Horu lava rush) synchronized to dynamic orchestral music.

它们能做得那么难而玩家不弃，靠的是配套的存档机制（下一节）。

### 对我们的意思

`04 §9` 有一条待定：「Boss 战形态 —— 卡在美术缺口」。

**逃脱段不需要新 Boss 美术。** 它需要的是：① 一条持续上升的死亡线
② 换一段音乐 ③ 复用现有平台/底板资产 ④ 一个"这一屏必须往上"的强制镜头。
这四样都不在新资产清单里（`art/ASSET_RULES §8` 的缺口是**垂直房的侧壁/顶口/墙根**，
而逃脱段可以就在已有的横廊里做"涨水追人"，不用竖井）。

这是一个**用机制绕开美术缺口**的方案，比"等 Boss 图"现实。

代价必须说清：逃脱段的重试成本直接决定它的难度上限。而我们只有一个暗房 R6
（`04 §7`），如果逃脱段放在 R8 之前，玩家每次失败都要重走 —— 这一段必须配
"段内检查点"，否则手机玩家会当场退出。

---

## 6. 存档点间距就是难度曲线

HK 的长椅不只是存档点，它是**一个点干四件事**：存档、回满血、换护符、刷地图。
结果就是攻略站的第一条建议变成了：

> **Find the bench in a new area before doing anything else.** It is the checkpoint, the
> heal, the charm swap and the map update all at once. If you're exploring a confusing
> region, do short loops back to the bench rather than one long push.
> —— hollowknightinteractivemap.com

而长椅的**稀疏程度**是直接拿来调情绪的：Deepnest 长椅远，所以那里是整作最恐怖的一段。

Ori 走的是另一条路：**固定存档点（Spirit Well）+ 花能量的自建存档（Soul Link）**。

> Instead of traditional static save rooms, players spend Energy Cells to create their own
> manual save checkpoints anywhere in the world at will, balancing checkpoint safety against
> offensive energy reserves.

同一个能量池既用来开强力攻击、开门，也用来存档。**"我现在存不存"是一个真实的取舍**，
而不是"走到点就自动存"。

### 对我们的意思

`04 §7` 写的是「从 R6 到 Boss 只隔一间 R7，最坏情况（R7 死）重走 1 房，和原来一样，
所以不补第二个」—— 这是**用"和原来一样"当理由，不是用目标值当理由**。
"重走 1 房"到底合不合适，从来没有对标过。

可执行的一条（我的判断）：先定一个数 —— **单次重走 ≤ 90 秒**（一房 1.5 分钟的净战斗，
重走不含战斗，所以 90 秒偏宽松）。这个数一旦定下来，`04 §7` 的"1 个暗房"就从
"暂按 1 个记"变成"算出来是 1 个"。

---

## 7. 完成度必须看得见

这条来自一个**续作修正前作**的案例，比单向夸奖有用。

《终焉之莉莉》的地图是减分的：

> 地图只支持大区域之间的展示，不支持每个区域内具体的地形地貌。这类做法虽然在其他
> "银河城"游戏里不算罕见，本意是增加探索的未知性。但由于《莉莉》的地图设计略显稚嫩，
> 导致单个区域内的地形地貌过于复杂，**老手都容易迷路**，叠加收集要素后让很多玩家非常痛苦。
> —— 游戏之家《〈终焉之马格诺利亚〉：惊喜的不只是音乐》

《玛格诺利亚》改了两处：

1. **大地图显示具体地形细节**（不再是只显示大区块）
2. **保留"全收集后区域变色"** —— 蓝 = 还没收集完，该去哪儿"摩擦地皮"一目了然

第三方评测还提到一处：**房间在地图上整体显示为蓝色**，方便判断哪里还没走完。

另一个参照是《波斯王子：失落王冠》的**记忆碎片**（Memory Shards）：玩家可以
截下当前画面钉在地图上，作为"这里有个我过不去的东西"的自定义标记。
制作人给的动机很直接：

> 其实就是想要指引玩家，在游戏测试时，让玩家了解**游戏的指引其实要花很多时间**，
> 所以为了要专注在指引上面，就有了这种发想。
> —— 巴哈姆特/雅虎 制作人专访

注意这句话的分量：**他们做记忆碎片，是因为测试发现"做引导"太贵**。
这是把引导成本转移给玩家的思路。

### 对我们的意思

我们已经有"清区变田"（`04 §2.1` 的两态）—— 但那只是**场景里**的信号，
玩家站在那块地上才知道。**地图上没有任何东西告诉他"西翼那三间我清完了没有"。**

可执行的一条（我的判断）：**把"清区"直接映射成地图颜色**。两态的颜色正好是现成的
（堵塞态青灰 / 清完态暖彩），地图上用同一对颜色，玩家的区域进度和场景状态
是同一套色。这比另造一套 UI 便宜，也不用新资产。

---

## 8. 门控密度：世界是"空间"，还是"一串障碍"

这是唯一一条**反面**参照，也是白哥清单里最该拿来当警示的。

《波斯王子：失落王冠》的评测原话：

> 这个想法很好，也很合理，但在实践中，**它更像是萨尔贡必须跳过的一系列障碍**，
> 才能到达他的最终目的地。
> —— Gamereactor 评测

同一篇访谈里，制作人被问到哪个区域最难设计，回答是"需要用到**洞察能力**的关卡"和
"三个萨尔贡出现去解谜的地图"。也就是说：**门做得越精巧，越容易把世界切成一段段关卡。**

`gamemechanicshoard` 把这件事的失败模式写得很准：

> Pitfall: **gates players cannot remember the location of.**

门的三个设计决策（原文）：

| 决策 | 问题 |
|---|---|
| **gate legibility** | 玩家必须认出"这是个门"，并在之后想起它 —— **每种门需要专属视觉语言** |
| soft gate vs hard gate | 难度门还是能力门 |
| **backtracking friction** | **快速旅行放哪儿，就是节奏设计** |

《死亡细胞》从反方向做了同一件事：它的分支**不是难度梯度，是风格差异**
（上下两条路怪物和地形不同、强度相当），而且后期的更新明确以"消除最优路线"为目标：

> It's just part of an overall attempt to **remove optimal routes from the game, to encourage
> exploring** and keep you on your dead toes.
> —— Rock Paper Shotgun，Corrupted Update 报道

同一个更新里还加了一个符文 **Explorer's Instinct**：当地图探索到很大比例时，
**直接把剩下的地图揭开** —— 专门解决"最后几步走廊瞎转"的挫败。

### 对我们的意思

我们的门密度**极低**：整作只有折叠、生长两个（`04 §4`），加上投掷打碎的可选捷径
（`04 §4.2` 明确禁止把投掷做成主线锁）。对照 PoP 的"一连串障碍"，这是优势，不是缺陷。

但 `04 §5` 有 **12 个独立环**，环的意义完全取决于一件事：**走环的另一边，是不是比原路返回近。**
如果环只是"绕远一圈回到原地"，它就从"捷径"退化成"装饰"。

可执行的一条（我的判断）：给每个环算一次 **`绕行距离 / 原路返回距离`**，
> 1 的环要么砍掉，要么改造。这个能直接加进 `build_world.py` 的 `check()`，
和现有的 11 条硬规则同一个位置。

---

## 9. Demo 的最小完整：HK 的 beta 只给了**一个**能力

白哥第 4 点说"两三个能力"，值得拿实际数据校一下。

HK 的 Kickstarter beta（2015）覆盖两个区域：**Forgotten Crossroads + Greenpath**，
加一个 Boss（False Knight）。Team Cherry 自己的说法是 beta 比原计划大得多：

> The Beta is going to cover a lot more ground than we'd originally planned.
> It's bursting with Bosses, secrets and bugs to meet.
> —— Team Cherry 官方博客《The Green Path》

在 Day of the Devs 展会上，**有一位玩家打赢了 False Knight**，官方专门写了一句：

> One attendee even managed to overcome the False Knight. **A huge feat** given all the
> bustle on the show floor.

也就是说：HK 的 demo 里，**打赢第一个 Boss 就已经是需要被记录的成就**。

对照我们：MVP 是根 10 房 + R8 Boss + 投掷（`04 §7`）。**只有 1 个能力，和 HK beta 一样。**
白哥要的"两三个能力"其实比 HK 的 beta 还高。

**所以"最小完整"的判据不是能力数量，是能不能演完一次认知改变。**
HK beta 成立是因为它含一个完整的"我过不去 → 我拿到东西 → 我回去了"：
Greenpath 里有需要 Mothwing Cloak（冲刺）才能过的口，而冲刺在 Crossroads 深处。
一条闭环，两个区域，一个能力，一个 Boss —— 这就是能拿去做 demo 的全部。

### 对我们的意思

如果要在不扩产能的前提下满足第 4 点，多出来的第 2 个能力应该**复用已有的门**
（比如再加一个"破"锁横向的软墙），而不是新开一条枝 —— `04 §5` 现在三处技
能枝末端（钟顶 / 实验底 / 矿坑）都在根系之外，MVP 进不去。

---

## 10. 一条必须先裁决的冲突

白哥第 2 点：

> 技能不只用于战斗，更要让玩家能用新能力**重新发现旧区域的隐藏路径**。

`04 §8` 的房间设计硬约束：

> | 不做"回头才会发现"的隐藏路 | 横版单向推进，回头成本高 |

**这两条正面冲突，且不能两边都对。**

冲突的根源不是谁写错了，是**那条约束的成立前提已经没了**：`04 §8` 写于 V1 时期，
当时地图是"一条 1448×220 格横条，`E−V+1 = 0`，数学上不存在环"（`04 §10.3`），
所以"回头"真的只能原路返回。

但 V3 已经有 **12 个独立环 + 一条 R6→T1 传送**（`04 §10.5`）。在环上，
"回去"不需要原路走 —— 走另一条边就到了。

建议的改法（这是判断，请白哥裁决）：

**把「不做回头的隐藏路」改成「不做回头成本 > 2 房的隐藏路」，并加一条"必须在环上"。**

| 新判据 | 阈值 | 怎么验 |
|---|---|---|
| 隐藏路入口的回访成本 | **≤ 2 房（≈ 3 分钟）** | `build_world.py` 算入口到最近传送/环边的步数 |
| 必须落在环上 | 入口所在房间 `E−V+1` 贡献 > 0 | 同上 |

两条一起，既满足白哥第 2 点，又不违反 `04 §8` 原本想守的东西
（"别让玩家走十分钟回去拿一个东西"）。

---

## 11. 总表

| | 引导 | 地图 | 锁 | 能力用法 | 高潮 | 存档 | 完成度 | 门密度 |
|---|---|---|---|---|---|---|---|---|
| Hollow Knight | 符号复用 + 火把对照 | 三层买、长椅才更新 | 能力锁 + 知识锁 | 冲刺/下劈进战斗 | Boss | 长椅（四点合一） | 地图符号 | 低 |
| Ori | 色彩即通行语言（暖光=可互动） | 无地图，靠光 | 能力锁为主 | **Bash 四用** | **环境逃脱** | Soul Link 自建 | — | 低 |
| Ender Magnolia | 房间整体蓝 | **显示地形 + 全收集变色** | 能力锁 | 同伴招式 | Boss | 休息站 | **区域变色** | 中 |
| PoP: TLC | 记忆碎片（玩家自己标） | 记忆碎片 + 传送 | 能力锁密集 | 一能力多解 | Boss | — | — | **高（反面）** |
| Dead Cells | 无 | Explorer's Instinct 自动揭开 | 符文（永久解锁） | 武器组合 | Boss | — | — | 分支=风格 |
| **我们** | **无专属符号** | **无** | **2 个能力锁** | **各锁一个维度** | Boss（缺美术） | 1 个暗房 | 场景两态 | **低（优势）** |

---

## 12. 出处

- HK 引导四手法（蓝蝶花 / 小水晶 / 火把岔路 / Boss 房符号）：HSLU《Metroidvania Analysis》，https://blog.hslu.ch/games/files/2021/11/Metroidvania_Analysis.pdf
- HK 地图三件套、价格、长椅才更新、Wayward Compass、图钉：https://hollowknightinteractivemap.com/guides/map-and-quill ；价格表交叉核对 Hollow Knight Wiki `Map and Quill`
- HK 攻略站「进新区域先找长椅」：同上
- 能力锁 / 知识锁 分类与下劈例子：https://www.vgover.com/zh-tw/news/206667
- gate legibility / soft vs hard gate / 快速旅行即节奏 / 陷阱：https://gamemechanicshoard.com/mechanic/metroidvania-gating
- Ori Bash 四用与「战斗与解谜不再两类」：https://asidehouse.com/respawn/ori-and-the-blind-forest-the-metroidvania-as-a-watercolour
- Ori 三段环境逃脱、Soul Link 动用能量：https://gamer24h.com/games/ori-and-the-blind-forest/ ；Soul Link 机制细节 https://oriandtheblindforest.fandom.com/wiki/Bash
- Ender Lilies 地图减分 → Magnolia 修正：https://game.ithome.com/archiver/767/213.htm
- Magnolia 房间整体蓝、回溯不烦：https://mzdya.com/tech/shantelle/ender-magnolia-bloom-in-the-mist-review-a-special-metroidvania.html
- PoP:TLC 记忆碎片动机（制作人专访）：https://tw.news.yahoo.com/prince-of-persia-the-lost-crown-interview-093235449.html
- PoP:TLC「一连串障碍」评价：https://www.gamereactor.cn/?p=37643
- Dead Cells「消除最优路线」与 Explorer's Instinct：https://www.rockpapershotgun.com/dead-cells-corrupted-update-is-a-guaranteed-way-to-get-cursed
- Dead Cells 分支=风格差异、卷轴只在地图里：https://ecatest.cdnetworks.com/douban-proxy/review/14357135
- HK beta 覆盖两区 + False Knight；「打赢是 huge feat」：https://www.teamcherry.com.au/blog/the-green-path-a-hollow-knight-tour ；https://www.kickstarter.com/projects/11662585/hollow-knight/posts/1731794
