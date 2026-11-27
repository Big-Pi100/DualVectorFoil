extends SceneTree

## Room01 机关门：**这间房到底会不会拒绝你**。
##
## 为什么单独一个文件：这是这间房第一次出现"玩家过不去"的结构。
## 判据必须能证明三件互相独立的事：
##
##   G1 闸门存在，而且是满高的（12 格）—— 不是一段矮墙
##   G2 不扳开关就过不去（按死方向键也过不去）
##   G3 扳开关当场开门（碰撞立刻失效，不等动画）
##   G4 开门后能走过去
##
## 缺 G2 就是"布景"，缺 G3 就是"动画演完了人还在原地"，缺 G4 就是"开了也没用"。
## 生成器的 `_check_mechanisms` 是格子级证明，这里是**真实物理**证明 ——
## 两者不重复：格子级不知道碰撞体有没有真的撤掉。

const ROOM_PATH: String = "res://world/rooms/Room01.tscn"
const GATE_X: float = 3088.0        # c64 左边沿 = 16 + 64*48
const FLAT_Y: float = 1776.0        # 地面 r37 顶面
const LEVER_X: float = 2728.0       # c56 中心 = 16 + 56*48 + 24
const UPPER_Y: float = 624.0        # 上层走廊的地面（r13 顶面 = 13*48）

var _fail: int = 0
var _root: Node = null

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	_root = Node.new()
	root.add_child(_root)
	await _run_cases()
	_root.queue_free()
	print("ROOM01 GATE: %s" % ("PASS" if _fail == 0 else "FAIL"))
	print("errors: %d" % _fail)
	quit(1 if _fail > 0 else 0)

func _check(ok: bool, msg: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + msg)
	if not ok:
		_fail += 1

func _frames(n: int) -> void:
	for i: int in range(n):
		await physics_frame

func _run_cases() -> void:
	print("--- Room01 机关门 ---")
	var ws: Node = root.get_node_or_null("WorldState")
	if ws != null:
		ws.call("reset_state")

	var room: Node2D = (load(ROOM_PATH) as PackedScene).instantiate() as Node2D
	_root.add_child(room)
	await process_frame
	await physics_frame

	# 敌人会打断走位；门会切场景 —— 这个用例只验闸门本身
	for c: Node in room.get_node("InvadersContainer").get_children():
		c.queue_free()
	var doors: Node = room.get_node_or_null("Doors")
	if doors != null:
		for d: Node in doors.get_children():
			d.set("monitoring", false)
	await _frames(2)

	var mech: Node = room.get_node_or_null("Mechanisms")
	_check(mech != null, "房间里有 Mechanisms 节点")
	if mech == null:
		room.queue_free()
		return
	var gate: Node = mech.get_node_or_null("Gate")
	var lever: Node = mech.get_node_or_null("Lever")
	_check(gate != null, "有闸门 Gate")
	_check(lever != null, "有拉杆 Lever")
	if gate == null or lever == null:
		room.queue_free()
		return

	# ---- G1 满高 ----
	var cells: int = int(gate.get("cells"))
	_check(cells == 11, "闸门有 %d 格高（期望 11 —— 矮一格就能被跳过）" % cells)

	var p: CharacterBody2D = room.get_node("Player") as CharacterBody2D

	# ---- G5 状态可见：锁灯 ----
	# 判据不是"有没有灯"这种外观问题，而是"玩家能不能**看出来**这扇门是锁着的"。
	# 没有它，玩家唯一的线索是撞上去不动 —— 在平台游戏里撞墙是中性的，
	# 分不清"锁着的门"和"走到头了"。
	var lamp: Polygon2D = gate.get_node_or_null("LockLamp") as Polygon2D
	_check(lamp != null, "门中央有锁灯 LockLamp")
	if lamp != null:
		_check(lamp.color.r > lamp.color.g,
			"门关着时锁灯是红的 RGB(%.2f,%.2f,%.2f)" % [lamp.color.r, lamp.color.g, lamp.color.b])

	# ---- G2 门关着，按死方向键也过不去 ----
	p.global_position = Vector2(GATE_X - 240.0, FLAT_Y - 10.0)   # 东厅地面上
	p.velocity = Vector2.ZERO
	await _frames(20)
	Input.action_press("move_right")
	var best_x: float = p.global_position.x
	for i: int in range(150):
		# 被墙挡住就跳一下 —— 真人也会这么试。跳也过不去才算真挡住。
		if p.is_on_floor() and absf(p.velocity.x) < 5.0 and i > 20 and i % 40 == 0:
			Input.action_press("jump")
			await _frames(3)
			Input.action_release("jump")
		await physics_frame
		best_x = maxf(best_x, p.global_position.x)
	Input.action_release("move_right")
	Input.action_release("jump")
	await _frames(4)
	_check(best_x < GATE_X - 12.0,
		"门关着时最远只到 x=%.0f（闸门在 %.0f）—— 真的过不去" % [best_x, GATE_X])

	# ---- G3 扳开关，碰撞立刻撤 ----
	# 把玩家放到上层走廊、拉杆脚下（c56 中心），等 Area2D 认出他
	p.global_position = Vector2(LEVER_X, UPPER_Y - 10.0)
	p.velocity = Vector2.ZERO
	await _frames(20)
	p.call("request_interact")
	await _frames(4)
	var opened: bool = bool(gate.get("_open"))
	_check(opened, "扳动拉杆后闸门进入开启状态")
	var live_shapes: int = 0
	for c: Node in gate.get_children():
		if c is CollisionShape2D and not (c as CollisionShape2D).disabled:
			live_shapes += 1
	_check(live_shapes == 0, "闸门的碰撞体已全部撤掉（还剩 %d 个）" % live_shapes)
	if lamp != null:
		_check(lamp.color.g > lamp.color.r, "开门后锁灯转绿 —— 状态在门上，不只在碰撞里")

	# ---- G4 开门后走得过去 ----
	p.global_position = Vector2(GATE_X - 240.0, FLAT_Y - 10.0)   # 东厅地面上
	p.velocity = Vector2.ZERO
	await _frames(20)
	Input.action_press("move_right")
	await _frames(90)
	Input.action_release("move_right")
	await _frames(4)
	_check(p.global_position.x > GATE_X + 60.0,
		"开门后走到了 x=%.0f（闸门在 %.0f）—— 门真的开了"
		% [p.global_position.x, GATE_X])

	# ---- G6 核心动线：上层走廊 → 下坠井 → 东厅 → 穿门 ----
	# 这是这一版真正设计的那条路 ——「上去的路和下来的路不是同一条」：
	# 玩家从竖井爬上来、在 c56 扳开关，然后往右走两步掉进 c59 的下坠井，
	# 落回东厅地面，再穿过已经升起的闸门。
	# G4 只证了"门开着能从地面走过去"，证不了这条闭环真的走得通。
	p.global_position = Vector2(16.0 + 58.0 * 48.0 + 24.0, UPPER_Y - 10.0)   # 上层走廊 c58
	p.velocity = Vector2.ZERO
	await _frames(20)
	Input.action_press("move_right")
	await _frames(200)
	Input.action_release("move_right")
	await _frames(12)
	_check(p.global_position.x > GATE_X + 40.0 and p.global_position.y > 1500.0,
		"从上层走廊走下坠井、穿过闸门，落在 (%.0f, %.0f)"
		% [p.global_position.x, p.global_position.y])

	room.queue_free()
	await process_frame
