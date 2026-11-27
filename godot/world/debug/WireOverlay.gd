extends Node2D

## 线框稿的实体占位（2026-11-27 第六次）
##
## 解决的问题（白哥原话）：
##   「你把所有贴图都去掉，出单纯的线框设计稿……不然现在贴图素材不全，
##     看起来乱七八糟，反而更麻烦」
##
## 地形已经换成线框了，但角色还是像素小人 —— 一张工程图里浮着几个半成品 sprite，
## 读起来仍然乱。所以角色也换成符号：
##   玩家   —— 青色竖框 + 一条朝向短线
##   地面敌 —— 红色菱形
##   飞行敌 —— 黄色三角
##
## 为什么用 `_draw` 而不是给每个实体挂一个 Polygon2D：
##   敌人是运行时由 `_setup_invasion_state` 生成的，节点还不存在时没法挂子节点；
##   而 `_draw` 每帧按实体**当前位置**画，天然跟着动画、击退、死亡走。
##
## 怎么启用：生成器在 `wireframe=1` 时把本脚本挂成房间根下的 `WireOverlay` 节点。
## 所以开关就是「这个节点在不在」—— 不引入任何运行时属性，
## 切回贴图模式不会在场景里留下一个 `visible=false` 的副作用。
##
## 这一条很重要：判据要能 FAIL。`tests/test_wire_mode.gd` 会断言
## 「房间里没有贴图节点」且「实体 sprite 已被隐藏」，两个方向都能红。

const COL_PLAYER := Color(0.373, 0.839, 0.780, 1.0)
const COL_GROUND := Color(0.898, 0.361, 0.361, 1.0)
const COL_FLYER := Color(0.937, 0.792, 0.290, 1.0)
## 摆件（能力拾取 / 可耕地 / 观景点）：中性灰，不抢玩家的红、敌人的黄。
## 这些不是威胁也不是玩家，图上只需要"这里有东西"。
const COL_PROP := Color(0.545, 0.616, 0.678, 1.0)
## 可交互（拉杆）：米白。橙色已经被平台占用 —— "能站的"和"能扳的"不该同色。
const COL_SWITCH := Color(0.976, 0.949, 0.878, 1.0)
const LINE_W := 2.0

## 玩家碰撞盒：宽 34 / 高 64（`Player.tscn` 的 RectangleShape2D + 原点在脚底）。
const PLAYER_W := 34.0
const PLAYER_H := 64.0

func _ready() -> void:
	# 比角色高一层，线画在角色上面；HUD 是 CanvasLayer，不受影响。
	z_index = 50
	z_as_relative = false

func _process(_delta: float) -> void:
	_blank_all()
	queue_redraw()

## 把角色自己的 sprite 藏掉。**幂等**，而且靠 meta 短路，所以每帧调用不贵。
func _blank_all() -> void:
	var room: Node = get_parent()
	if room == null:
		return
	_blank_one(room.get_node_or_null("Player"))
	var inv: Node = room.get_node_or_null("InvadersContainer")
	if inv != null:
		for c: Node in inv.get_children():
			_blank_one(c)
	# 场景里的静态摆件（能力拾取 / 可耕地 / 观景点）也有 sprite。
	# 它们是"内容"不是"地形"，但在纯几何的图上仍然是一块杂色 ——
	# 藏掉之后在 `_draw` 里给一个小方块，信息没丢，图干净了。
	for c: Node in room.get_children():
		if c.name.begins_with("AbilityPickup") or c.name == "SoilPlot" or c.name == "VistaPoint":
			_blank_one(c)
	# 拉杆的视觉是暖色多边形（棕底座 + 橙柱头），缩略图里读起来像"一个小人"。
	# 它不是贴图，但在纯几何图上同样是一块杂色 —— 藏掉，改画"底座 + 斜杆 + 圆头"。
	# 交互、碰撞、位置全都还在原节点上，动的只有画法。
	var mech: Node = room.get_node_or_null("Mechanisms")
	if mech != null:
		for c: Node in mech.get_children():
			if c.name == "Lever":
				_hide_shapes(c)

func _blank_one(root: Node) -> void:
	if root == null or root.has_meta("_wire_blanked"):
		return
	var stack: Array[Node] = [root]
	var hit: bool = false
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		# 只认像素图：ColorRect / Line2D 是几何视觉，留着（武器的朝向就靠它）
		if n is Sprite2D or n is AnimatedSprite2D:
			(n as CanvasItem).visible = false
			hit = true
		stack.append_array(n.get_children())
	if hit:
		root.set_meta("_wire_blanked", true)

## 藏掉一个节点下所有**几何视觉**（由脚本画出来的多边形/色块），但保留 Label。
## 用于拉杆：它的形状该由本 overlay 重新画，提示文字要留着。
func _hide_shapes(root: Node) -> void:
	if root.has_meta("_wire_shapes_hidden"):
		return
	var touched: bool = false
	var stack: Array[Node] = []
	stack.append_array(root.get_children())
	while not stack.is_empty():
		var c: Node = stack.pop_back()
		if c is Label:
			continue
		if c is Polygon2D or c is ColorRect or c is Line2D:
			(c as CanvasItem).visible = false
			touched = true
		stack.append_array(c.get_children())
	root.set_meta("_wire_shapes_hidden", true)
	if not touched:
		# 视觉是脚本 `_ready` 里建的，可能比本函数晚 —— 清掉标记，下一帧再试。
		root.remove_meta("_wire_shapes_hidden")

func _draw() -> void:
	var room: Node = get_parent()
	if room == null:
		return

	var p: Node2D = room.get_node_or_null("Player") as Node2D
	if p != null:
		var b: Vector2 = to_local(p.global_position)
		# 原点在脚底，框往上长
		draw_rect(Rect2(b + Vector2(-PLAYER_W * 0.5, -PLAYER_H),
			Vector2(PLAYER_W, PLAYER_H)), COL_PLAYER, false, LINE_W)
		var face: float = -1.0 if _face_left(p) else 1.0
		draw_line(b + Vector2(0.0, -PLAYER_H * 0.72),
			b + Vector2(face * PLAYER_W * 0.5, -PLAYER_H * 0.72), COL_PLAYER, LINE_W)

	var inv: Node = room.get_node_or_null("InvadersContainer")
	if inv == null:
		return
	for child: Node in inv.get_children():
		var e: Node2D = child as Node2D
		if e == null or not e.is_inside_tree():
			continue
		var c: Vector2 = to_local(e.global_position)
		if _is_flying(e):
			# 朝上的三角：在剖面图上，尖角方向就是"可以离开地面"
			draw_polyline(PackedVector2Array([
				c + Vector2(0.0, -20.0),
				c + Vector2(18.0, 14.0),
				c + Vector2(-18.0, 14.0),
				c + Vector2(0.0, -20.0),
			]), COL_FLYER, LINE_W, true)
		else:
			draw_polyline(PackedVector2Array([
				c + Vector2(0.0, -22.0),
				c + Vector2(20.0, 0.0),
				c + Vector2(0.0, 22.0),
				c + Vector2(-20.0, 0.0),
				c + Vector2(0.0, -22.0),
			]), COL_GROUND, LINE_W, true)

	# 摆件：小空心方块。它们不带威胁，只需要在图上留一个"这里有东西"的记号。
	for child: Node in room.get_children():
		if not (child.name.begins_with("AbilityPickup")
				or child.name == "SoilPlot" or child.name == "VistaPoint"):
			continue
		var prop: Node2D = child as Node2D
		if prop == null:
			continue
		var q: Vector2 = to_local(prop.global_position)
		draw_rect(Rect2(q + Vector2(-9.0, -9.0), Vector2(18.0, 18.0)),
			COL_PROP, false, LINE_W)

	# 机关拉杆：底座横线 + 斜杆 + 圆头。
	# 米白而不是橙 —— 橙色已经被平台占用了，"能站的"和"能扳的"不该同色。
	var mech: Node = room.get_node_or_null("Mechanisms")
	if mech != null:
		var lever: Node2D = mech.get_node_or_null("Lever") as Node2D
		if lever != null:
			var lp: Vector2 = to_local(lever.global_position)
			# 符号 = 底座小圆 + 斜杆 + 顶端小圆。
			# 试过"两条竖脚"，远看像一个举手的小人 —— 和"这是一个装置"读反了。
			# 底座圆中心离地 7px：再低一点就和地板顶面的描边重合，看不见。
			draw_arc(lp + Vector2(0.0, -7.0), 6.0, 0.0, TAU, 14, COL_SWITCH, LINE_W, true)
			draw_line(lp + Vector2(0.0, -7.0), lp + Vector2(14.0, -28.0), COL_SWITCH, LINE_W)
			draw_arc(lp + Vector2(14.0, -28.0), 5.0, 0.0, TAU, 16, COL_SWITCH, LINE_W, true)

func _face_left(p: Node2D) -> bool:
	var spr: Node = p.get_node_or_null("Visuals/Sprite")
	if spr is Sprite2D:
		return (spr as Sprite2D).flip_h
	return false

## 飞行判定走 AI 的公开方法，不自己读 variant ——
## "是不是飞的"这件事只有一个真相源，散在各处迟早对不上。
func _is_flying(e: Node2D) -> bool:
	var ai: Node = e.get_node_or_null("AI")
	if ai != null and ai.has_method("is_flying"):
		return bool(ai.call("is_flying"))
	return false
