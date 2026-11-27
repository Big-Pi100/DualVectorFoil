class_name Hitbox
extends Area2D
## 攻击判定框 —— 激活后在一段时间内检测重叠的 Hurtbox，每次激活**每个目标只结算一次**。
##
## 为什么不用 `CollisionShape2D.disabled` 开关（那份 GDD 的写法）：
##   在物理查询里改 disabled 必须走 `set_deferred`，而 deferred 是**帧末**生效。
##   同帧内"开→等 0.12s→关"的 await 里如果被切场景/节点释放，
##   恢复调用会打到已释放的节点上。这里改成**计时器变量 + monitoring 常开**，
##   没有 deferred，也没有 await。
##
## 为什么不用 await 计时（那份 GDD 的写法）：
##   翻滚/攻击中断、死亡、切房间时，await 回来的那一行会继续执行，
##   把已经变化的状态改回旧值。状态推进一律放在 `_physics_process` 里。

## 一次激活的判定时长（秒）。web 版前摇 0.09 + 判定约 0.12
@export var active_time := 0.12
@export var damage := 10.0
## 击退：x 会按命中方向取号，y 通常为负（向上弹）
@export var knockback := Vector2(220.0, -120.0)
@export var hitstop_time := 0.045

## 朝向：1 = 向右，-1 = 向左。挥砍时由使用者设置
var direction := 1.0

var _left := 0.0
var _hit_ids: Dictionary = {}

signal hit_landed(hurtbox: Hurtbox)


func _physics_process(delta: float) -> void:
	if _left <= 0.0:
		return
	_left -= delta
	for area in get_overlapping_areas():
		if not (area is Hurtbox):
			continue
		var id := area.get_instance_id()
		if _hit_ids.has(id):
			continue
		_hit_ids[id] = true
		_strike(area as Hurtbox)


## 开始一次判定。`duration < 0` 用导出的 active_time。
func activate(duration: float = -1.0) -> void:
	_left = active_time if duration < 0.0 else duration
	_hit_ids.clear()


func is_active() -> bool:
	return _left > 0.0


func _strike(target: Hurtbox) -> void:
	var dir := direction
	# 目标几乎正上/正下时方向无意义，退回当前朝向
	if absf(target.global_position.x - global_position.x) > 0.5:
		dir = signf(target.global_position.x - global_position.x)
	var kb := Vector2(knockback.x * dir, knockback.y)
	# 先定格再通知：take_hit 是同步 emit，受击回调里要能查到自己已被顿帧。
	# 顿帧加在**被打的那个实体**（Hurtbox 的父节点）上，不是全局。
	Hitstop.apply(target.get_parent() as Node, hitstop_time)
	target.take_hit(damage, kb, global_position)
	hit_landed.emit(target)
