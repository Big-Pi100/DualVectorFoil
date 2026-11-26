class_name StoryTrigger
extends Area2D

## 剧情触发点（Area2D）：靠近 + 玩家互动键 → 请求 Play 一段对话。
## 与 RestBench 同构的契约：只认宿主「有 interact_requested 信号」，不硬编码 Player 路径。
## 一次性剧情：播过后由 StoryDirector 写 story_flag，可在 _ready 隐藏本体。

signal dialogue_requested(dialogue_id: String)

@export var dialogue_id: String = "origami_bird"
@export var one_shot_flag: String = ""        # 非空时：该 flag 为真则不再触发
@export var prompt_text: String = "交谈"
@export var start_title: String = "start"

@onready var prompt_label: Label = $PromptLabel

var _player_in_range: Node2D = null

func _ready() -> void:
	prompt_label.visible = false
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)
	var flag_check: Node = get_tree().root.get_node_or_null("WorldState")
	if one_shot_flag != "" and flag_check != null:
		if bool(flag_check.story_flags.get(one_shot_flag, false)):
			visible = false

func _on_body_entered(body: Node2D) -> void:
	if not body.has_signal("interact_requested") or not body.has_method("request_interact"):
		return
	_player_in_range = body
	if not body.interact_requested.is_connected(_on_interact):
		body.interact_requested.connect(_on_interact)
	prompt_label.visible = true
	prompt_label.text = prompt_text

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
	var director: Node = get_tree().root.get_node_or_null("StoryDirector")
	if director == null or bool(director.call("is_active")):
		return
	# 自包含启动（与 RestBench 直调 full_restore 同惯例），并广播信号供其它系统监听
	dialogue_requested.emit(dialogue_id)
	if not start_title.is_empty():
		director.call("start", dialogue_id, start_title)
	else:
		director.call("start", dialogue_id)
	var flag_check: Node = get_tree().root.get_node_or_null("WorldState")
	if one_shot_flag != "" and flag_check != null:
		flag_check.story_flags[one_shot_flag] = true
		visible = false
