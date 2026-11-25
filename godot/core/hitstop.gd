class_name Hitstop
extends RefCounted
## 局部顿帧（hitstop）—— 命中瞬间让**被打的那个实体**停一下，不是让全世界变慢。
##
## 为什么不用 `Engine.time_scale`（那份 GDD 的写法）：
##   1. 它是**全局**的。顿帧期间 UI、粒子、相机平滑、BGM 计时器全被拖慢，
##      玩家感到的是"卡了一帧"，不是"打中了"。
##   2. 两个 hitbox 同时命中会互相打架：A 的 await 结束时把 time_scale 设回 1.0，
##      B 还在等 → B 的顿帧被提前掐断。命中越多，顿帧越不可靠。
##   3. 它的恢复依赖 `create_timer(..., ignore_time_scale=true)` 这个 4 参数重载，
##      写成 3 参数就会永远停在 0.05 倍速——这类 bug 只在多段攻击时才暴露。
##
## 这里用**截止时间戳**：
##   - 静态表，key 是 `instance_id`（不是 Node 引用，节点释放了也不会泄漏）
##   - 不需要每帧 tick，`frozen()` 被问到时才判断过期
##   - 用 `Time.get_ticks_msec()`（真实时间），不受任何时间缩放影响
##
## 用法：实体在 `_physics_process` 第一行 `if Hitstop.frozen(self): return`，
## 位置就冻住了；动画/粒子照常播——这正是"顿一下"该有的观感。

## instance_id -> 解冻的绝对毫秒
static var _until_ms: Dictionary = {}

## 单次顿帧上限。传进来 3 秒那种肯定是写错了，截断掉免得实体卡死。
const MAX_DURATION := 0.30


static func apply(node: Node, duration: float) -> void:
	if node == null or not is_instance_valid(node):
		return
	var d := clampf(duration, 0.0, MAX_DURATION)
	if d <= 0.0:
		return
	var id := node.get_instance_id()
	var until := Time.get_ticks_msec() + int(d * 1000.0)
	# 取最长，不叠加：连续命中只延长，不会因为两次 45ms 变成 90ms
	if until > int(_until_ms.get(id, 0)):
		_until_ms[id] = until


static func frozen(node: Node) -> bool:
	if node == null or not is_instance_valid(node):
		return false
	var id := node.get_instance_id()
	var until: int = _until_ms.get(id, 0)
	if until == 0:
		return false
	if Time.get_ticks_msec() >= until:
		_until_ms.erase(id)
		return false
	return true


## 剩余冻结秒数，测试和调试用
static func remaining(node: Node) -> float:
	var until: int = _until_ms.get(node.get_instance_id(), 0)
	if until == 0:
		return 0.0
	return maxf(0.0, (until - Time.get_ticks_msec()) / 1000.0)


static func clear() -> void:
	_until_ms.clear()
