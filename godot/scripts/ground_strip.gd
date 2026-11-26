extends Node2D
## 底板条 —— 「左端 + 中间×N + 右端」的拼装器。
##
## 为什么是个组件而不是几个 Sprite
## --------------------------------
## 底板是这个游戏里唯一会反复出现的东西：地面、平台、台阶、桥，全是同一条横带。
## 如果每处长什么样靠手摆 Sprite，那「拼接规则」只存在于我的记忆里，
## 下次改宽度就会摆错一格。所以规则写成代码：
##
##     width = cap_w * 2 + mid_w * N        (N ≥ 0)
##     960  = 96 * 2 + 384 * 2              (主地面，正好)
##     384  = 96 * 2 + 384 * 1              (中平台)
##     192  = 96 * 2 + 384 * 0              (小平台 = 两块端点对接)
##
## 三段图的接缝是**逐像素连续**的（由 `art/tools/slice_ground.py` 用镜像构造保证，
## 见 `art/ASSET_RULES.md` §3），所以这里只要按整数宽摆上去，缝就不可能露。
##
## 中间图是**回文**（正着放和翻过来放长得一样），所以 flip 不 flip 都行 ——
## 试过用交替翻转去错开镜像的对称轴，没用，图本身对称。真要打散重复，
## 只能另画一张不对称的可平铺中间图（见 ASSET_RULES §5 已知限制）。
##
## 坐标约定：**节点原点 = 底板左上角**（不是中心）。摆场景时 position 就是「地面线」。
## 子精灵用 centered=false 同理，避免半像素误差累积。

@export var length_px: float = 960.0
@export var left_tex: Texture2D
@export var mid_tex: Texture2D
@export var right_tex: Texture2D

var sections := 0           # 中间段数量，测试里会断言


func _ready() -> void:
	build()


## 幂等：重复调用会先清掉上一次生成的子节点。
func build() -> void:
	for c in get_children():
		if c is Sprite2D:
			c.queue_free()
			remove_child(c)

	if left_tex == null or mid_tex == null or right_tex == null:
		push_error("GroundStrip 缺贴图：left/mid/right 三个都要给")
		return

	var cap_w := left_tex.get_width()
	var mid_w := mid_tex.get_width()
	var span := int(round(length_px)) - cap_w * 2
	if span < 0:
		push_error("GroundStrip 长度 %.0f 小于两个端点 %d" % [length_px, cap_w * 2])
		return
	sections = int(round(float(span) / float(mid_w)))
	if sections * mid_w != span:
		# 不自动拉伸：拉伸过的接缝不再逐像素连续，等于把规则废掉
		push_warning("GroundStrip 长度 %.0f 不是 %d + %d×N，N 取 %d，右侧会空 %d px"
			% [length_px, cap_w * 2, mid_w, sections, span - sections * mid_w])

	_add(left_tex, 0.0)
	for i in sections:
		_add(mid_tex, float(cap_w + i * mid_w))
	_add(right_tex, length_px - cap_w)


func _add(tex: Texture2D, x: float) -> void:
	var s := Sprite2D.new()
	s.texture = tex
	s.centered = false
	s.position = Vector2(x, 0.0)
	add_child(s)


## 测试用：整条的实际像素宽（末段右缘 - 首段左缘）。
func measured_width() -> float:
	var lo := INF
	var hi := -INF
	for c in get_children():
		if c is Sprite2D:
			lo = minf(lo, c.position.x)
			hi = maxf(hi, c.position.x + c.texture.get_width())
	return hi - lo if hi > -INF else 0.0
