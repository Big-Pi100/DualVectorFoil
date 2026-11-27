class_name Hitbox
extends Area2D

## 攻击判定组件：仅负责「命中瞬间」的检测与派发，不关心命中对象是谁。
## 命中对象只需实现 take_damage(amount, knockback) 方法契约即可（鸭子类型解耦）。

@export var damage: float = 10.0
@export var knockback_force: Vector2 = Vector2(220.0, -120.0)
@export var hitstop_duration: float = 0.045 # 《重生细胞》式打击顿帧时长

@onready var collision_shape: CollisionShape2D = $CollisionShape2D

var _hitstop_token: int = 0 # 防止多次命中时多个顿帧协程互相踩踏 time_scale

func _ready() -> void:
	# 默认关闭判定，仅在挥砍瞬间开启
	collision_shape.disabled = true
	area_entered.connect(_on_area_entered)

func activate(duration: float = 0.12) -> void:
	collision_shape.set_deferred("disabled", false)
	await get_tree().create_timer(duration).timeout
	collision_shape.set_deferred("disabled", true)

func _on_area_entered(area: Area2D) -> void:
	if not area.has_method("take_damage"):
		return
	# 命中方向：由命中框与目标相对位置决定（命中框位于朝向侧），保证击退方向正确
	var dir: float = sign(global_position.x - area.global_position.x) * -1.0
	if dir == 0.0:
		dir = 1.0
	var final_knockback := Vector2(knockback_force.x * dir, knockback_force.y)
	area.take_damage(damage, final_knockback)
	_trigger_hitstop()

func _trigger_hitstop() -> void:
	# 极短暂的全局时间减速，营造清爽的蜡笔碰撞打击感
	# 使用 token：只有最新一次命中负责恢复 time_scale，避免多次命中提前恢复
	_hitstop_token += 1
	var my_token: int = _hitstop_token
	Engine.time_scale = 0.05
	# 第 4 参数 ignore_time_scale=true：真实时间计时，不受自身减速影响
	await get_tree().create_timer(hitstop_duration, true, false, true).timeout
	if my_token == _hitstop_token:
		Engine.time_scale = 1.0

func _exit_tree() -> void:
	# 场景卸载时兜底恢复，防止 time_scale 卡在 0.05
	if _hitstop_token > 0:
		Engine.time_scale = 1.0
