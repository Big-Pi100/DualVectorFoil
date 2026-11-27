class_name RestBench
extends Area2D

## 休息长椅：更新最近休息点 + 回满血/颜料瓶，并发出 rested 信号。
## 信号解耦：只认「宿主有 full_restore 方法 + interact_requested 信号」的契约，
## 不硬编码 Player 类型路径；后续 P1 存档与战力转化面板直接挂 rested 即可。

signal rested()

@export var room_scene_path: String = "res://world/rooms/SafeHouse.tscn"
@export var rest_spawn_marker: String = "SpawnFromRest"

@onready var prompt_label: Label = $PromptLabel

var _player_in_range: Node2D = null

func _ready() -> void:
	prompt_label.visible = false
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)
	# 存档状态变化（例如 load_game）时无需刷新本节点，休息点由 WorldState 单一持有。

func _on_body_entered(body: Node2D) -> void:
	if not body.has_method("full_restore") or not body.has_signal("interact_requested"):
		return
	_player_in_range = body
	if not body.interact_requested.is_connected(_on_interact):
		body.interact_requested.connect(_on_interact)
	prompt_label.visible = true

func _on_body_exited(body: Node2D) -> void:
	if body != _player_in_range:
		return
	if body.interact_requested.is_connected(_on_interact):
		body.interact_requested.disconnect(_on_interact)
	_player_in_range = null
	prompt_label.visible = false

func _on_interact() -> void:
	if _player_in_range == null or not is_instance_valid(_player_in_range):
		return
	WorldState.set_rest_point(room_scene_path, rest_spawn_marker)
	_player_in_range.call("full_restore")
	prompt_label.text = "休息好了！(U) 再存档"
	rested.emit()
