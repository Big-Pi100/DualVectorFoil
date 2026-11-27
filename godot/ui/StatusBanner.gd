extends CanvasLayer

## 屏幕中上方的一行状态横幅：清场、拾取、区域变化。
##
## 为什么需要：清场的反馈原本只有「0.85s 光波 + 紫月褪色 + 门开」。
## 光波是气氛，门开是功能，但玩家**说不出「我刚刚做成了什么」** ——
## 一句「入口厅 · 清空」把这三件事收束成一个结论。
##
## 为什么不用弹窗：弹窗会打断操作；横幅只是屏幕上多一行字，
## 玩家可以继续走，看或没看都不影响。
##
## 文字由房间给（`BaseRoom.display_name`），横幅不认识任何房间名 ——
## 换一间房不用改这个脚本。

@export var hold_seconds: float = 2.6
@export var fade_in: float = 0.25
@export var fade_out: float = 0.6
@export var font_size: int = 26

var _panel: PanelContainer = null
var _label: Label = null
var _tween: Tween = null

func _ready() -> void:
	var root := Control.new()
	root.name = "RootControl"
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	# 横向铺满、纵向只占屏幕上部一条 —— 子 Label 在其中自动居中。
	# 不按文字宽度算位置：那样必须先等一帧拿 size，清场瞬间调用会丢字。
	_panel = PanelContainer.new()
	_panel.name = "Panel"
	_panel.anchor_left = 0.0
	_panel.anchor_right = 1.0
	_panel.anchor_top = 0.17
	_panel.anchor_bottom = 0.30
	_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_panel.modulate.a = 0.0
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.0, 0.0, 0.0, 0.0)
	_panel.add_theme_stylebox_override("panel", style)
	root.add_child(_panel)

	_label = Label.new()
	_label.name = "Text"
	_label.add_theme_font_size_override("font_size", font_size)
	_label.add_theme_color_override("font_color", Color(0.98, 0.96, 0.90, 1.0))
	_label.add_theme_color_override("font_shadow_color", Color(0.18, 0.14, 0.10, 0.7))
	_label.add_theme_constant_override("shadow_offset_x", 2)
	_label.add_theme_constant_override("shadow_offset_y", 2)
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_panel.add_child(_label)

## 显示一行字。重复调用会替换内容并重新计时。
func show_text(text: String) -> void:
	if _label == null or _panel == null:
		return
	_label.text = text
	if _tween != null and _tween.is_valid():
		_tween.kill()
	_panel.modulate.a = 0.0
	_tween = create_tween()
	_tween.tween_property(_panel, "modulate:a", 1.0, fade_in)
	_tween.tween_interval(hold_seconds)
	_tween.tween_property(_panel, "modulate:a", 0.0, fade_out)
