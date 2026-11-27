extends SceneTree

## Room01 实跳验证（真实物理帧）。
##
## 为什么需要这一层：生成器的可达性 BFS 是**格子级**的，它不知道"撞天花板"、
## 不知道"起跳点有没有助跑距离"。BFS 说能到，玩家可能一头撞死。
##
## 2026-11-27 第五次重写。结构每改一次，坐标就必须跟着改 —— 这条测试的价值
## 全在"用真实物理跳一遍"，坐标写死了才有意义（写活了就变成自己验自己）。
##
##   T0 地面(1776) → 竖井一级(1584)   r33 c43..46
##   T1 1584      → 二级(1392)        r29 c42..45，**往左**
##   T2 1392      → 三级(1200)        r25 c44..47，往右
##   T3 1200      → 四级(1008)        r21 c42..45，**往左**
##   T4 入口厅的之字支线：r29(c22..26) → r25(c16..20)，往左，去不去由你
##
## 每条判据：跳完必须**站在目标台面**上（y 落在 ±6px），且 x 落在该台范围内。
## 掉回地面 / 卡在半空 / 撞墙掉下来，都算 FAIL。
##
## 闸门挡不挡路、扳开关能不能开，不在这个文件里 —— 那是 `test_room01_gate.gd`。

const T: float = 48.0
const ORIGIN_X: float = 16.0

var _fail: int = 0

func _initialize() -> void:
	await _run()

func _check(ok: bool, msg: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + msg)
	if not ok:
		_fail += 1

func _cell_x(c: int) -> float:
	return ORIGIN_X + float(c) * T + T * 0.5

func _run() -> void:
	print("--- Room01 实跳验证（真实物理帧 60Hz）---")
	var ps: PackedScene = load("res://world/rooms/Room01.tscn") as PackedScene
	if ps == null:
		print("  FAIL Room01.tscn 加载失败")
		quit(1)
		return
	var room: Node2D = ps.instantiate() as Node2D
	root.add_child(room)
	await process_frame
	await process_frame

	# 敌人会打断走位，这里只验地形
	var cont: Node = room.get_node_or_null("InvadersContainer")
	if cont != null:
		for c: Node in cont.get_children():
			c.queue_free()
	await process_frame

	var player: CharacterBody2D = room.get_node_or_null("Player") as CharacterBody2D
	if player == null:
		print("  FAIL 场景里没有 Player")
		quit(1)
		return

	# 竖井六级：r33 c43..46 / r29 c42..45 / r25 c44..47 / r21 c42..45 / r17 c44..47 / r13 c42..45
	# 台面 y = 行号 × 48；台左右沿 x = 16 + 列号 × 48
	await _hop(player, "T0 地面(c42) → 竖井一级 r33",
		_cell_x(42), 1776.0, 1584.0, 2080.0, 2272.0, 1)
	await _hop(player, "T1 一级 r33 → 二级 r29（往左）",
		_cell_x(46), 1584.0, 1392.0, 2032.0, 2208.0, -1)
	await _hop(player, "T2 二级 r29 → 三级 r25",
		_cell_x(43), 1392.0, 1200.0, 2128.0, 2304.0, 1)
	await _hop(player, "T3 三级 r25 → 四级 r21（往左）",
		_cell_x(46), 1200.0, 1008.0, 2032.0, 2208.0, -1)
	await _hop(player, "T4 入口厅支线 r29(c23) → r25(c16..20)（往左）",
		_cell_x(23), 1392.0, 1200.0, 784.0, 1024.0, -1)

	print("ROOM01 TRAVERSE: %s" % ("PASS" if _fail == 0 else "FAIL"))
	print("errors: %d" % _fail)
	quit(1 if _fail > 0 else 0)


## 站到 (x, stand_y)，按住 dir 方向 + 起跳，落定后断言落在 expect_y 且 x ∈ [xmin, xmax]。
##
## dir = 1 向右 / -1 向左。左侧支线必须能反向跳 —— 只测向右会漏掉"往左那一下根本跳不过去"。
func _hop(player: CharacterBody2D, name: String, x: float, stand_y: float,
		expect_y: float, xmin: float, xmax: float, dir: int) -> void:
	Input.action_release("move_right")
	Input.action_release("move_left")
	player.global_position = Vector2(x, stand_y - 10.0)
	player.velocity = Vector2.ZERO
	for i: int in range(50):
		await physics_frame
		if player.is_on_floor():
			break
	for i: int in range(8):
		await physics_frame

	# 助跑 10 帧（acceleration 2400 → 0.17s 到满速），起跳后只再按住 20 帧。
	#
	# ❗ 不能「全程按住」：满速 290 × 滞空 0.917s = 266px = 5.5 格，
	# 玩家会直接飞过 5 格宽的台，落到台子右边外。真人不会这么玩 ——
	# 他们在空中会松手。测试必须模拟真人，不能模拟「一路顶死方向键的机器人」。
	var act: String = "move_right" if dir > 0 else "move_left"
	Input.action_press(act)
	for i: int in range(10):
		await physics_frame
	player.velocity.y = player.jump_velocity
	for i: int in range(20):
		await physics_frame
	Input.action_release(act)

	for i: int in range(150):
		await physics_frame
		if i > 12 and player.is_on_floor():
			break
	for i: int in range(12):
		await physics_frame

	var p: Vector2 = player.global_position
	var ok_y: bool = absf(p.y - expect_y) <= 6.0
	var ok_x: bool = p.x >= xmin and p.x <= xmax
	_check(ok_y and ok_x,
		"%s：落点 (%.0f, %.0f)，期望 y=%.0f(±6) x∈[%.0f, %.0f]"
		% [name, p.x, p.y, expect_y, xmin, xmax])
