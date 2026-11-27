class_name VistaZone
extends Area2D

## 风景眺望点（GDD 3.2）：玩家在悬崖/地标处驻足，镜头平滑拉远、HUD 淡出，
## 展现绘本全景。通信一律走 WorldState 事件总线，与 Camera/HUD 零直接引用。
## 零挫败原则：不锁玩家输入——一旦移动/跳跃立即退出眺望，恢复常态。

signal vista_activated()
signal vista_deactivated()

@export_group("眺望表现")
@export var vista_title: String = "眺望风景"  ## 提示标签，供场景布置与后续 UI 使用
@export var vista_anim: String = "back"       ## 眺望时角色帧：back（看画页深处）/ side（看侧方风景）
@export var target_zoom: float = 0.72         ## 拉远目标（<1 为拉远）
@export var zoom_duration: float = 1.1
@export var hud_fade_duration: float = 0.35

@export_group("驻足判定")
@export var dwell_time: float = 0.45           ## 区域内静止多久触发眺望
@export var still_speed_threshold: float = 18.0 ## 判定「静止」的速度上限（px/s）
@export var exit_speed_threshold: float = 40.0  ## 眺望中超过该速度立即退出（留滞回区间防抖）

var _player: Player = null
var _dwell: float = 0.0
var _active: bool = false

func _ready() -> void:
	monitoring = true
	monitorable = false
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)

func _on_body_entered(body: Node2D) -> void:
	if body is Player:
		_player = body as Player
		_dwell = 0.0

func _on_body_exited(body: Node2D) -> void:
	if body == _player:
		_deactivate()
		_player = null

func _physics_process(delta: float) -> void:
	if _player == null or not is_instance_valid(_player):
		return

	var speed: float = _player.velocity.length()
	if not _active:
		# 必须站在地面上且静止才算「驻足」；空中/移动不累计
		if _player.is_on_floor() and speed <= still_speed_threshold:
			_dwell += delta
			if _dwell >= dwell_time:
				_activate()
		else:
			_dwell = 0.0
	else:
		# 眺望中不剥夺操作：一动就恢复（退出阈值高于进入阈值，避免边缘抖动）
		if not _player.is_on_floor() or speed > exit_speed_threshold:
			_deactivate()

func _activate() -> void:
	if _active:
		return
	_active = true
	vista_activated.emit()
	_broadcast(true)

func _deactivate() -> void:
	if not _active:
		return
	_active = false
	_dwell = 0.0
	vista_deactivated.emit()
	_broadcast(false)

## 运行时查找 Autoload：--script 模式下全局类编译早于 Autoload 标识符注入，
## 直接写 WorldState.xxx 会让本脚本编译失败（场景退化为裸 Area2D）。
func _broadcast(active: bool) -> void:
	var tree: SceneTree = get_tree()
	if tree == null:
		return
	var ws: Node = tree.root.get_node_or_null("WorldState")
	if ws != null:
		ws.call("set_vista_mode", active, target_zoom, zoom_duration, hud_fade_duration, vista_anim)

func _exit_tree() -> void:
	# 切场景兜底：否则镜头永久拉远 / HUD 永久隐藏。
	_deactivate()
