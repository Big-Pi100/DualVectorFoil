extends CanvasLayer

## 入场教学：第一次进这间房时出现一次，几秒后自己淡出。
##
## 为什么要有：Room01 是玩家见到的第一个房间，但之前**没有任何操作提示** ——
## 没玩过的人进来只知道能左右走，不知道空格跳、J 砍。
##
## 为什么是一次性的而不是常驻：常驻提示会变成噪音；而且玩家已经学会了还留在屏幕上，
## 等于承认「这间房没教会他」。用 `WorldState.story_flags` 记一次，随存档走。
##
## 为什么只有一行字、不弹窗：这间房要教的是三个动作，不是规则。
## 拦住玩家的从来不是「不知道规则」，是「不知道按哪个键」。

@export var body_text: String = "A / D  移动　·　空格  跳　·　J  攻击"
@export var hold_seconds: float = 4.2
@export var flag_key: String = "tutorial_room01_seen"

var _panel: PanelContainer = null

func _ready() -> void:
	if get_node_or_null("/root/WorldState") == null:
		queue_free()
		return
	if WorldState.story_flags.has(flag_key):
		queue_free()
		return
	WorldState.story_flags[flag_key] = true
	_build()

func _build() -> void:
	var root := Control.new()
	root.name = "RootControl"
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	_panel = PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.97, 0.94, 0.87, 0.92)
	style.border_color = Color(0.45, 0.35, 0.25, 0.45)
	style.set_border_width_all(2)
	style.set_corner_radius_all(12)
	style.content_margin_left = 28.0
	style.content_margin_right = 28.0
	style.content_margin_top = 14.0
	style.content_margin_bottom = 14.0
	_panel.add_theme_stylebox_override("panel", style)
	_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_panel)

	var lbl := Label.new()
	lbl.name = "Text"
	lbl.text = body_text
	lbl.add_theme_font_size_override("font_size", 22)
	lbl.add_theme_color_override("font_color", Color(0.28, 0.21, 0.15, 1.0))
	lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_panel.add_child(lbl)

	# 等一帧拿到真实尺寸，再按视口底部居中对齐
	await get_tree().process_frame
	if not is_instance_valid(_panel):
		return
	var vp: Vector2 = get_viewport().get_visible_rect().size
	_panel.position = Vector2(
		(vp.x - _panel.size.x) * 0.5,
		vp.y - _panel.size.y - 104.0
	)
	_panel.modulate.a = 0.0
	var tw: Tween = create_tween()
	tw.tween_property(_panel, "modulate:a", 1.0, 0.35)
	await tw.finished
	if not is_instance_valid(_panel):
		return
	await get_tree().create_timer(hold_seconds).timeout
	if not is_instance_valid(_panel):
		return
	var out: Tween = create_tween()
	out.tween_property(_panel, "modulate:a", 0.0, 0.55)
	out.tween_callback(queue_free)
