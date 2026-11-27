class_name Lever
extends Area2D

## 机关拉杆：房间内的空间谜题开关。
##
## 为什么需要它（README/AGENTS 之外的设计依据）：
##   《死亡细胞》被囚者的牢房里有一样东西叫**机关门** —— 门打不开，
##   门上方是一个 3~4 层的独立竖井，最顶层有开关，扳下去门才开。
##   这是 Dead Cells 在**单个房间内部**唯一的"解谜"结构，也是它跟
##   "一条走廊 + 几个平台"最本质的区别：房间会**拒绝**你，直到你理解它。
##
##   连续两版房间被否（"太简单""没有任何迷宫解密的乐趣"）之后才意识到：
##   我一直在调几何，但房间从来没有"不让你过"的地方。
##
## 契约沿用 AbilityPickup / RestBench 那一条：只认「有 interact_requested 信号的
## body」，不硬编码 Player 类型（AGENTS.md：跨模块一律 Signal）。
##
## 视觉是纯几何：底座 + 立柱 + 拉杆。拉杆被扳动时从左上转到右上，
## 同时抬起一点 —— 让"我做了某件事"有一个当场可见的结果。

signal pulled

const PROMPT_IDLE: String = "[U] 扳动机关"
const PROMPT_DONE: String = "机关已启动"

const COL_BASE: Color = Color(0.22, 0.19, 0.17, 1.0)
const COL_POST: Color = Color(0.50, 0.40, 0.28, 1.0)
const COL_ARM: Color = Color(0.82, 0.70, 0.50, 1.0)
const COL_KNOB: Color = Color(0.86, 0.55, 0.22, 1.0)
const COL_GLOW: Color = Color(0.95, 0.74, 0.28, 0.16)

## 立柱高度。48 = 一格，玩家站上去时杆头大致在胸口高度。
const POST_H: float = 60.0
const HIT_W: float = 108.0
const HIT_H: float = 132.0

var _used: bool = false
var _player: Node2D = null
var _label: Label = null
var _arm: Node2D = null

func _ready() -> void:
	_build_collision()
	_build_visual()
	_build_label()
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)

func _build_collision() -> void:
	var shape := CollisionShape2D.new()
	shape.name = "Hit"
	var rect := RectangleShape2D.new()
	rect.size = Vector2(HIT_W, HIT_H)
	shape.shape = rect
	# 原点在杆脚（脚下），碰撞盒整体往上抬半个高度
	shape.position = Vector2(0.0, -HIT_H * 0.5)
	add_child(shape)

func _build_visual() -> void:
	var glow := Polygon2D.new()
	glow.name = "Glow"
	glow.color = COL_GLOW
	glow.polygon = PackedVector2Array([
		Vector2(-46, -POST_H - 18), Vector2(0, -POST_H - 34),
		Vector2(46, -POST_H - 18), Vector2(46, 0), Vector2(-46, 0),
	])
	glow.z_index = -2
	add_child(glow)

	var base := Polygon2D.new()
	base.name = "Base"
	base.color = COL_BASE
	base.polygon = PackedVector2Array([
		Vector2(-26, -14), Vector2(26, -14), Vector2(20, 0), Vector2(-20, 0),
	])
	add_child(base)

	var post := Polygon2D.new()
	post.name = "Post"
	post.color = COL_POST
	post.polygon = PackedVector2Array([
		Vector2(-7, -POST_H), Vector2(7, -POST_H), Vector2(9, -10), Vector2(-9, -10),
	])
	add_child(post)

	# 拉杆本体挂在一个可旋转的 Node2D 上，扳动 = 改 rotation
	_arm = Node2D.new()
	_arm.name = "ArmPivot"
	_arm.position = Vector2(0.0, -POST_H + 8.0)
	_arm.rotation = -0.62
	add_child(_arm)

	var arm := Polygon2D.new()
	arm.name = "Arm"
	arm.color = COL_ARM
	arm.polygon = PackedVector2Array([
		Vector2(-5, 6), Vector2(5, 6), Vector2(5, -34), Vector2(-5, -34),
	])
	_arm.add_child(arm)

	var knob := Polygon2D.new()
	knob.name = "Knob"
	knob.color = COL_KNOB
	var pts := PackedVector2Array()
	for i: int in range(10):
		var a: float = TAU * float(i) / 10.0
		pts.append(Vector2(cos(a), sin(a)) * 10.0 + Vector2(0.0, -34.0))
	knob.polygon = pts
	_arm.add_child(knob)

func _build_label() -> void:
	_label = Label.new()
	_label.name = "PromptLabel"
	_label.visible = false
	_label.offset_left = -150.0
	_label.offset_top = -POST_H - 96.0
	_label.offset_right = 150.0
	_label.offset_bottom = -POST_H - 62.0
	_label.add_theme_color_override("font_color", Color(0.35, 0.2, 0.1, 1.0))
	_label.add_theme_color_override("font_outline_color", Color(0.96, 0.92, 0.82, 1.0))
	_label.add_theme_constant_override("outline_size", 6)
	_label.add_theme_font_size_override("font_size", 20)
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.text = PROMPT_IDLE
	_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_label)

func _on_body_entered(body: Node2D) -> void:
	if not body.has_signal("interact_requested"):
		return
	_player = body
	if not body.interact_requested.is_connected(_on_interact):
		body.interact_requested.connect(_on_interact)
	_label.text = PROMPT_DONE if _used else PROMPT_IDLE
	_label.visible = true

func _on_body_exited(body: Node2D) -> void:
	if body != _player:
		return
	if body.interact_requested.is_connected(_on_interact):
		body.interact_requested.disconnect(_on_interact)
	_player = null
	_label.visible = false

func _on_interact() -> void:
	if _used:
		return
	_used = true
	# 拉杆"扳下去"：rotate 到 +0.62，同时整体下沉一点 ——
	# 只转动不动的话，视觉上像"晃了一下"，不像"到位了"。
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(_arm, "rotation", 0.62, 0.18).set_ease(Tween.EASE_OUT)
	tw.tween_property(_arm, "position:y", -POST_H + 12.0, 0.18)
	_label.text = PROMPT_DONE
	pulled.emit()
