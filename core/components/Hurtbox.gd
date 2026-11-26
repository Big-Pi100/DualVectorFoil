class_name Hurtbox
extends Area2D

## 受击适配组件：供敌人（或任何可受伤实体）挂载。
## Hitbox 调用 take_damage() 后，本组件只负责改血量并发出 damaged 信号，
## 由宿主实体自行监听信号决定击退 / 死亡表现 —— 符合「Signal 解耦」铁律。

signal damaged(amount: float, knockback: Vector2)
signal health_depleted

@export var max_health: float = 30.0

@onready var collision_shape: CollisionShape2D = $CollisionShape2D

var current_health: float = 0.0
var is_invincible: bool = false

func _ready() -> void:
	current_health = max_health
	# Area2D 需开启 monitorable 才能被其他 Area2D 的 area_entered 检测到
	monitorable = true

func take_damage(amount: float, knockback: Vector2) -> void:
	if is_invincible or current_health <= 0.0:
		return
	current_health = maxf(0.0, current_health - amount)
	damaged.emit(amount, knockback)
	if current_health <= 0.0:
		health_depleted.emit()

func reset() -> void:
	current_health = max_health
	is_invincible = false
