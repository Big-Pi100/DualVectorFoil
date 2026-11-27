class_name SwitchGate
extends StaticBody2D

## 机关门（闸门）：挡在房间必经之路上的铁栅，只有扳动房间里的拉杆才会升起。
##
## 设计依据：《死亡细胞》被囚者的牢房必有一个「机关门」——
##   门无法打破；门上方是 3~4 层平台的独立竖井；最顶层有开关；
##   扳下开关，门才开。
##
## 它在这间房里的作用不是"延迟玩家"，而是**让房间拒绝你**：
##   地面走到这里就断了，出口就在四十步之外，你就是过不去 ——
##   除非你想明白"往上爬、找到开关、再下来"。
##   这是"走廊"和"地方"的分界线。
##
## 契约：
##   · 几何与碰撞全部由本脚本在 `_ready` 里建（生成器只负责给位置和格数），
##     因为它们没有美术依赖，也不需要进蓝图以外的地方。
##   · `open()` 幂等 —— 重复扳同一个开关不会出问题。
##   · 开门 = 碰撞当场失效 + 栅栏向上抽走。碰撞**立刻**失效而不是等动画：
##     玩家扳完开关可能马上就往下跳，等他 0.5 秒会以为"没开"。

signal opened

## 门有几格高（蓝图里连续 G 的个数），由生成器写入。
@export var cells: int = 12
## 门有几格宽，默认 1 格（48px）。
@export var width_cells: int = 1

const TILE: float = 48.0

const COL_FRAME: Color = Color(0.16, 0.15, 0.16, 1.0)
const COL_BAR: Color = Color(0.34, 0.33, 0.35, 1.0)
const COL_HILITE: Color = Color(0.52, 0.50, 0.52, 1.0)
const COL_GLOW: Color = Color(0.36, 0.62, 0.86, 0.22)
## 门中央那颗锁灯：红 = 锁着，绿 = 已开。
## 为什么需要它：没有灯的时候，"过不去"要靠玩家**撞上去不动**才知道，
## 而撞墙在平台游戏里是个中性动作 —— 玩家分不清这是"锁着的门"还是"关卡到头了"。
const COL_LOCKED: Color = Color(0.86, 0.28, 0.22, 1.0)
const COL_UNLOCKED: Color = Color(0.36, 0.78, 0.42, 1.0)

var _open: bool = false
var _visual: Node2D = null
var _lamp: Polygon2D = null
var _lamp_tween: Tween = null

func _ready() -> void:
	_build_collision()
	_build_visual()

func height_px() -> float:
	return float(cells) * TILE

func width_px() -> float:
	return float(width_cells) * TILE

func _build_collision() -> void:
	# 一格一个 CollisionShape：纵向太长时单个盒子和"被抽走"的视觉对不上，
	# 逐格也能让"只开一半"这种后续需求不用重写。
	for i: int in range(cells):
		var shape := CollisionShape2D.new()
		shape.name = "Shape%d" % i
		var rect := RectangleShape2D.new()
		rect.size = Vector2(width_px(), TILE)
		shape.shape = rect
		shape.position = Vector2(width_px() * 0.5, float(i) * TILE + TILE * 0.5)
		add_child(shape)

func _build_visual() -> void:
	_visual = Node2D.new()
	_visual.name = "Visual"
	add_child(_visual)

	var w: float = width_px()
	var h: float = height_px()

	# 门缝透出来的冷光：让它在暖色房间里一眼是"人造物"而不是墙
	var glow := Polygon2D.new()
	glow.name = "Glow"
	glow.color = COL_GLOW
	glow.polygon = PackedVector2Array([
		Vector2(-10, 0), Vector2(w + 10, 0), Vector2(w + 10, h), Vector2(-10, h),
	])
	glow.z_index = -1
	_visual.add_child(glow)

	# 背板：暗色实心，挡住后面的背景 —— 否则栅栏缝里能看到远处，
	# 玩家会以为"可以从缝里钻过去"
	var back := Polygon2D.new()
	back.name = "BackPanel"
	back.color = COL_FRAME
	back.polygon = PackedVector2Array([
		Vector2(0, 0), Vector2(w, 0), Vector2(w, h), Vector2(0, h),
	])
	_visual.add_child(back)

	# 竖栅：3 根
	var bar_w: float = w / 4.0
	for i: int in range(3):
		var x: float = bar_w * float(i + 1) - bar_w * 0.16
		var bar := Polygon2D.new()
		bar.name = "Bar%d" % i
		bar.color = COL_BAR
		bar.polygon = PackedVector2Array([
			Vector2(x, 0), Vector2(x + bar_w * 0.32, 0),
			Vector2(x + bar_w * 0.32, h), Vector2(x, h),
		])
		_visual.add_child(bar)

	# 横箍：每 2 格一道，读作"铁闸"而不是"竖条"
	var r: int = 0
	while r < cells:
		var y: float = float(r) * TILE + TILE * 0.5
		var band := Polygon2D.new()
		band.name = "Band%d" % r
		band.color = COL_HILITE
		band.polygon = PackedVector2Array([
			Vector2(-4, y - 5), Vector2(w + 4, y - 5),
			Vector2(w + 4, y + 5), Vector2(-4, y + 5),
		])
		_visual.add_child(band)
		r += 2

	# 锁灯：**不挂在 _visual 上** —— 栅栏抽走后灯要留在原地变绿。
	# 否则"门开了"的唯一反馈是"东西不见了"，玩家会以为自己看花了眼。
	var s: float = 18.0
	_lamp = Polygon2D.new()
	_lamp.name = "LockLamp"
	_lamp.color = COL_LOCKED
	_lamp.polygon = PackedVector2Array([
		Vector2(-s * 0.5, -s * 0.5), Vector2(s * 0.5, -s * 0.5),
		Vector2(s * 0.5, s * 0.5), Vector2(-s * 0.5, s * 0.5),
	])
	_lamp.position = Vector2(w * 0.5, h * 0.5)
	_lamp.z_index = 2
	add_child(_lamp)
	# 呼吸：锁着的门是"活的机关"，不是装饰墙。纯静态红点会被当成配色。
	_lamp_tween = create_tween().set_loops()
	_lamp_tween.tween_property(_lamp, "modulate:a", 0.42, 0.75)
	_lamp_tween.tween_property(_lamp, "modulate:a", 1.0, 0.75)

func open() -> void:
	if _open:
		return
	_open = true
	# 碰撞先撤：玩家扳完开关会马上往下跳，读不到"门已开"就白等
	for c: Node in get_children():
		if c is CollisionShape2D:
			(c as CollisionShape2D).set_deferred("disabled", true)
	if _lamp_tween != null and _lamp_tween.is_valid():
		_lamp_tween.kill()
	if _lamp != null and is_instance_valid(_lamp):
		_lamp.color = COL_UNLOCKED
		_lamp.modulate.a = 1.0
		var lt := create_tween()
		lt.tween_interval(0.35)
		lt.tween_property(_lamp, "modulate:a", 0.0, 0.45)
	if _visual != null and is_instance_valid(_visual):
		var tw := create_tween()
		tw.tween_property(_visual, "position:y", -height_px(), 0.5) \
			.set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_QUAD)
		tw.tween_callback(func() -> void: _visual.visible = false)
	opened.emit()
