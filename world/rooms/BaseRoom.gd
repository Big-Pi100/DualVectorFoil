class_name BaseRoom
extends Node2D

## 箱庭房间基础控制器：出生点定位 → 通知步数/入侵判定 → 入侵状态与净化演出。
## 信号解耦：入侵状态变化由 WorldState 广播，本控制器只读并驱动视觉/敌人。

@export var room_id: String = "room_01"
@export var invader_count: int = 3
@export var purify_tween_duration: float = 0.85
@export var purify_radius: float = 1.8
@export var is_safe_house: bool = false
@export var default_rest_marker: String = "SpawnFromRest"

const INVADER_SCENE: PackedScene = preload("res://world/enemies/Invader.tscn")

@onready var player: Player = $Player
@onready var filter_rect: ColorRect = $PostProcessLayer/DesaturateRect
@onready var invaders_container: Node2D = $InvadersContainer

var _purify_tween: Tween = null

func _ready() -> void:
	# 1. 定位主角到对应入口 Marker2D（相对当前场景根的直接子节点）
	var spawn_name: String = str(WorldState.story_flags.get("next_spawn_marker", ""))
	if spawn_name != "" and has_node(spawn_name):
		var marker: Node = get_node(spawn_name)
		if marker is Marker2D:
			player.global_position = (marker as Marker2D).global_position
	WorldState.story_flags.erase("next_spawn_marker")

	# 2. 通知全局状态机推进探索步数与入侵判定
	WorldState.notify_room_entered(room_id)

	# 3. 按入侵状态布置场景
	_setup_invasion_state()

	# 4. 绑定玩家死亡信号 → 零惩罚送回最近休息点
	_bind_player_signals()

func _bind_player_signals() -> void:
	if player == null:
		return
	if not player.respawn_requested.is_connected(_on_player_respawn_requested):
		player.respawn_requested.connect(_on_player_respawn_requested)

func _on_player_respawn_requested() -> void:
	if player == null:
		return
	# 安全屋内倒下：原地挪回休息点 Marker，不重新加载场景（无黑屏）。
	if is_safe_house and has_node(default_rest_marker):
		var local_marker: Node = get_node(default_rest_marker)
		if local_marker is Marker2D:
			player.global_position = (local_marker as Marker2D).global_position
		return

	var target_path: String = WorldState.last_rest_scene_path
	if target_path.is_empty():
		push_warning("BaseRoom: 最近休息点为空，无法送回玩家")
		return
	# force=true：死亡送回是必须执行的转场，即使当前正在转场也要抢占。
	SceneTransition.change_room(target_path, WorldState.last_rest_spawn_marker, true)

func _setup_invasion_state() -> void:
	_clear_invaders()
	var is_invaded: bool = WorldState.invaded_rooms.has(room_id)
	var mat: ShaderMaterial = filter_rect.material as ShaderMaterial

	if is_invaded:
		if mat != null:
			mat.set_shader_parameter("desaturate_amount", 1.0)
			mat.set_shader_parameter("wipe_radius", 0.0)
		invaders_container.visible = true
		for i: int in range(invader_count):
			_spawn_invader(i)
	else:
		if mat != null:
			mat.set_shader_parameter("desaturate_amount", 0.0)
			mat.set_shader_parameter("wipe_radius", 0.0)
		# 只隐藏容器，绝不 queue_free 容器本身 —— 否则二次入侵时引用已释放节点会崩
		invaders_container.visible = false

func _clear_invaders() -> void:
	# 同步从场景树移除，保证 get_child_count() 立即归零
	for child: Node in invaders_container.get_children():
		invaders_container.remove_child(child)
		child.queue_free()

func _spawn_invader(index: int) -> void:
	var invader: Area2D = INVADER_SCENE.instantiate() as Area2D
	invader.name = "Invader%d" % index
	invader.position = Vector2(660.0 + index * 90.0, 568.0)
	invaders_container.add_child(invader)
	# 视觉变体按索引循环分配（0=史莱姆 1=尖刺球 2=蝙蝠），纯贴图不影响血量/信号契约。
	var visual: Node = invader.get_node_or_null("Visual")
	if visual != null and visual.has_method("set_variant"):
		visual.call("set_variant", index % 3)
	if invader.has_signal("health_depleted"):
		invader.connect("health_depleted", _on_invader_defeated.bind(invader))

func _on_invader_defeated(invader: Area2D) -> void:
	# queue_free 在帧末才生效，call_deferred 检查时计数仍含将死节点。
	# 改为同步 remove_child，让存活计数立即准确，再同步判定是否清场。
	if is_instance_valid(invader) and invader.get_parent() == invaders_container:
		invaders_container.remove_child(invader)
		invader.queue_free()
	_check_all_invaders_defeated()

func _check_all_invaders_defeated() -> void:
	if not is_instance_valid(invaders_container):
		return
	if invaders_container.get_child_count() > 0:
		return
	if not WorldState.invaded_rooms.has(room_id):
		return

	_play_purify_wipe()
	WorldState.purify_room(room_id)

func _play_purify_wipe() -> void:
	var mat: ShaderMaterial = filter_rect.material as ShaderMaterial
	if mat == null:
		return
	if _purify_tween != null and _purify_tween.is_valid():
		_purify_tween.kill()

	# 彩色波纹从主角当前屏幕位置扩散（canvas transform → 屏幕 UV）
	var screen_pos: Vector2 = get_viewport().get_canvas_transform() * player.global_position
	var viewport_size: Vector2 = get_viewport_rect().size
	var uv: Vector2 = Vector2(
		clampf(screen_pos.x / viewport_size.x, 0.0, 1.0),
		clampf(screen_pos.y / viewport_size.y, 0.0, 1.0)
	)
	mat.set_shader_parameter("wipe_center", uv)
	mat.set_shader_parameter("wipe_radius", 0.0)

	_purify_tween = create_tween()
	_purify_tween.tween_property(mat, "shader_parameter/wipe_radius", purify_radius, purify_tween_duration).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	_purify_tween.tween_callback(func() -> void:
		mat.set_shader_parameter("desaturate_amount", 0.0)
	)
