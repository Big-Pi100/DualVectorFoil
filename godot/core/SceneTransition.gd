extends CanvasLayer

## 全局转场单例：房间切换 / 死亡送回统一走淡入淡出，避免硬切与场景树销毁时机问题。
## 信号解耦：只对 WorldState.story_flags 写入 spawn marker，不直接引用任何房间节点。

signal transition_midway
signal transition_finished

@export var fade_duration: float = 0.25

@onready var _rect: ColorRect = $ColorRect

var _is_transitioning: bool = false
var _transition_token: int = 0
var _fade_tween: Tween = null

func _ready() -> void:
	layer = 100
	_rect.color = Color(0.08, 0.08, 0.1, 0.0)
	_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_rect.visible = false

## 切场景。force=true 用于死亡送回等必须立即执行的场景（废弃正在进行的转场）。
func change_room(target_scene_path: String, spawn_marker_name: String = "", force: bool = false) -> void:
	if target_scene_path.is_empty():
		push_warning("SceneTransition.change_room: 目标场景路径为空，已忽略")
		return
	if _is_transitioning and not force:
		return

	# token 机制：force 时旧协程在下一个 await 点自检失效并安全退出，
	# 不直接 kill tween 后 await finished（那会永久挂起协程）。
	_transition_token += 1
	var my_token: int = _transition_token
	_is_transitioning = true
	_rect.visible = true

	_kill_fade_tween()
	_fade_tween = create_tween()
	_fade_tween.tween_property(_rect, "color:a", 1.0, fade_duration)
	await _wait_real(fade_duration)
	if my_token != _transition_token:
		return

	if not spawn_marker_name.is_empty():
		WorldState.story_flags["next_spawn_marker"] = spawn_marker_name

	transition_midway.emit()
	var err: Error = get_tree().change_scene_to_file(target_scene_path)
	if err != OK:
		push_error("SceneTransition 加载失败: %s (err=%d)" % [target_scene_path, err])
		_reset()
		return

	# 新场景节点树就绪一帧后再淡入
	await get_tree().process_frame
	if my_token != _transition_token:
		return

	_kill_fade_tween()
	_fade_tween = create_tween()
	_fade_tween.tween_property(_rect, "color:a", 0.0, fade_duration)
	await _wait_real(fade_duration)
	if my_token != _transition_token:
		return

	_reset()
	transition_finished.emit()

func is_transitioning() -> bool:
	return _is_transitioning

## 真实时间等待：不受 hitstop 的 Engine.time_scale 影响，打击顿帧中也能完成转场。
func _wait_real(duration: float) -> void:
	await get_tree().create_timer(duration, true, false, true).timeout

func _kill_fade_tween() -> void:
	if _fade_tween != null and _fade_tween.is_valid():
		_fade_tween.kill()
	_fade_tween = null

func _reset() -> void:
	_kill_fade_tween()
	_rect.visible = false
	_rect.color.a = 0.0
	_is_transitioning = false
