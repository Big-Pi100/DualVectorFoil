extends CanvasLayer
## 试手感用的调试面板：显示当前预设的关键数值 + 本次跳跃最高点。
##
## 只在 main.tscn 里挂。切换预设按 F1 / F2（由 player.gd 处理）。
## 文字用英文：Godot 默认字体不含中文字形，写中文会变成方块。

@onready var _label: Label = $Panel/Label

var _player: Node = null


func _ready() -> void:
	_player = get_parent().get_node_or_null("Player")


func _process(_delta: float) -> void:
	if _player == null or not is_instance_valid(_player):
		return
	_label.text = _player.hud_text()
