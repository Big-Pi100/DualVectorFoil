class_name Hurtbox
extends Area2D
## 受击判定框 —— 只负责"我被打了"这个事实，不负责扣血。
##
## 为什么不在这里扣血：同一个受击框会被玩家、陷阱、持续伤害、弹幕等
## 完全不同的来源打中，扣血规则各不相同（无敌帧、护盾、格挡、元素抗性）。
## 受击框只管转发，具体怎么算交给实体自己的 `_on_hurt()`。
##
## 接法：
## ```gdscript
## func _ready() -> void:
##     $Hurtbox.hurt.connect(_on_hurt)
##
## func _on_hurt(amount: float, knockback: Vector2, from: Vector2) -> void:
##     if invuln > 0.0: return
##     hp -= amount
##     velocity = knockback
## ```

signal hurt(amount: float, knockback: Vector2, from: Vector2)

## 关掉之后 hitbox 打上来不会转发（翻滚无敌、出场保护用）
@export var enabled := true: set = _set_enabled


func take_hit(amount: float, knockback: Vector2, from: Vector2) -> void:
	if not enabled:
		return
	hurt.emit(amount, knockback, from)


func _set_enabled(v: bool) -> void:
	enabled = v
	# 关掉时连碰撞体一起关，省得 hitbox 每帧还去遍历它
	set_deferred("monitorable", v)
