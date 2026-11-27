class_name StoryAutoStart
extends Node

## 开篇剧情自动触发器：仅当宿主房间是真实 current_scene（玩家实际进入游戏）时播放。
## headless 测试里房间被 add_child 到 root 但不是 current_scene → 不触发，零污染既有测试。
## 播过一次写 story_flag，之后再进安全屋不重复。

@export var dialogue_id: String = "prologue"
@export var seen_flag: String = "prologue_seen"
@export var trigger_delay: float = 0.35   # 等场景就绪/HUD 绑定完再播

func _ready() -> void:
	call_deferred("_try_start")

func _try_start() -> void:
	var tree := get_tree()
	if tree == null or tree.current_scene == null:
		return
	# 只在宿主房间确实作为主场景运行时触发（测试实例化不算）
	if tree.current_scene != get_parent():
		return
	var ws: Node = tree.root.get_node_or_null("WorldState")
	if ws != null and bool(ws.story_flags.get(seen_flag, false)):
		return
	var director: Node = tree.root.get_node_or_null("StoryDirector")
	if director == null or bool(director.call("is_active")):
		return
	await tree.create_timer(trigger_delay).timeout
	if not is_instance_valid(self):
		return
	director.call("start", dialogue_id)
