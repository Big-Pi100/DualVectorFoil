class_name HealthBar
extends Control

## 血条：只负责把 Player.health_changed 画出来，不做任何数值计算。
##
## 为什么必须有它：在它之前 Player 一直在发 health_changed，但**全项目没有一个订阅者**
## （只有测试里的 TestCombat 打印日志）。玩家挨打唯一的反馈是 0.35s 受击动画，
## 血量是完全不可见的 —— 「会死」这件事没有前兆，只有突然倒下。
##
## 灰盒件：外观是 ColorRect + 现有心形图标（`art/approved/UI/ui_heart_icon_00.png`），
## 没有新增任何美术。等出 `ui/hp_track` / `ui/hp_fill` 再换皮肤，数值层不动。

## 朱红 `#b23a2e`。UI_SKIN 允许的「唯一高饱和色」，用于低血危险提示，面积 ≤3% 屏。
@export var fill_color: Color = Color(0.698, 0.227, 0.180, 1.0)
@export var low_color: Color = Color(0.937, 0.451, 0.353, 1.0)
## 低于这个比例开始心跳（30% = 120 血里剩 36，正好还能挨两下）
@export var low_threshold: float = 0.3
@export var pulse_speed: float = 9.0

@onready var heart: TextureRect = $Heart
@onready var track: ColorRect = $Track
@onready var fill: ColorRect = $Track/Fill

var _player: Node = null
var _ratio: float = 1.0
var _pulse: float = 0.0
var _last_width: float = -1.0

func _ready() -> void:
	_apply()

## 由 TouchHUD.bind_player 转发；也可单独调用。
func bind_player(target_player: Node) -> void:
	if _player != null and _player.has_signal("health_changed") \
			and _player.health_changed.is_connected(_on_health_changed):
		_player.health_changed.disconnect(_on_health_changed)
	_player = target_player
	if _player == null or not _player.has_signal("health_changed"):
		return
	_player.health_changed.connect(_on_health_changed)
	_on_health_changed(float(_player.get("hp")), float(_player.get("max_hp")))

func _on_health_changed(current_hp: float, max_hp: float) -> void:
	_ratio = clampf(current_hp / maxf(max_hp, 1.0), 0.0, 1.0)
	_apply()

func _apply() -> void:
	if fill == null or track == null:
		return
	var full: float = track.size.x
	if is_equal_approx(full, _last_width) and is_equal_approx(fill.size.x, round(full * _ratio)):
		fill.color = low_color if _ratio <= low_threshold else fill_color
		return
	_last_width = full
	# 归零就是 0 宽度：血空了就该看不见，不要留"底线"去暗示还有一点
	fill.size.x = maxf(0.0, round(full * _ratio))
	fill.color = low_color if _ratio <= low_threshold else fill_color

func _process(delta: float) -> void:
	_apply()
	if _ratio <= 0.0:
		# 血空了心还必须亮着 = 自相矛盾。压暗到 1/3，表示"还在，但已经不行了"
		heart.modulate.a = 0.35
		fill.modulate.a = 1.0
		_pulse = 0.0
	elif _ratio <= low_threshold:
		_pulse += delta * pulse_speed
		var k: float = 0.75 + 0.25 * sin(_pulse)
		heart.modulate.a = k
		fill.modulate.a = 0.6 + 0.4 * k
	else:
		heart.modulate.a = 1.0
		fill.modulate.a = 1.0
		_pulse = 0.0
