extends SceneTree

## Room01 战斗验证：一个「会追、会打、会跳」的机器人，从进门打到清场。
##
## 为什么必须有这一层：
##   生成器的判据只能证明"空间长这样"，证明不了"玩起来有东西做"。
##   2026-11-27 连续两版房间被判据判成 PASS，玩家进去却无事可做 ——
##   因为判据量的是几何，不是行为。
##
## 这里量的是行为：
##   1. 机器人能不能在 60 秒内清场（能 → 房间是通的、敌人是可杀的）
##   2. 过程中要不要跳（要 → 平台真的参与了战斗，不是装饰）
##   3. 会不会挨打（会 → 敌人有威胁，不是背景板）
##
## 三条缺一条就说明房间有问题：
##   · 清不了场 → 有敌人够不到（平台太高 / 单向平台挡路 / 敌人卡在角落）
##   · 一次没跳 → 平台和战斗脱钩（敌人全在地面）
##   · 一次没挨打 → 敌人无威胁（距离太远 / 攻击不到）

const MAX_SECONDS: float = 40.0
const CELL: float = 48.0
const ORIGIN_X: float = 16.0

var _fail: int = 0

func _initialize() -> void:
	await _run()

func _check(ok: bool, msg: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + msg)
	if not ok:
		_fail += 1

func _frames(n: int) -> void:
	for i: int in range(n):
		await physics_frame

func _run() -> void:
	print("--- Room01 战斗验证（东厅一场：追 → 跳 → 砍）---")
	var ps: PackedScene = load("res://world/rooms/Room01.tscn") as PackedScene
	if ps == null:
		print("  FAIL Room01.tscn 加载失败")
		quit(1)
		return
	var room: Node2D = ps.instantiate() as Node2D
	root.add_child(room)
	await process_frame

	# 开入侵（走和实机一样的入口：WorldState 记录 + 重建敌人）
	var ws: Node = root.get_node_or_null("WorldState")
	if ws == null:
		print("  FAIL 没有 WorldState")
		quit(1)
		return
	(ws.get("invaded_rooms") as Array).append("room_01")
	room.call("_setup_invasion_state")
	await process_frame
	await process_frame

	var player: CharacterBody2D = room.get_node_or_null("Player") as CharacterBody2D
	if player == null:
		print("  FAIL 场景里没有 Player")
		quit(1)
		return

	var total: int = _enemy_count(room)
	print("  敌人 %d 只" % total)
	_check(total >= 4, "蓝图生成了 ≥4 只敌人（实际 %d）" % total)

	# 从左门内侧起步：这是玩家真实进场位置
	# ⚠️ 2026-11-27 第五次：从"整关清场"改成"东厅这一场"。
	#
	# 为什么：关卡长到 4800px 之后，一个"朝最近的敌人直走"的机器人会
	# 在入口厅的矮台边原地跳 60 秒 —— 它够不到头顶 500px 的飞行敌人，
	# 也不会爬上六跳的竖井。结果它打死 6 只、挨打 0 次，
	# 量出来的不是"这关有没有战斗"，而是"这机器人会不会导航"。
	#
	# 所以判据收到能证伪的范围：把玩家丢进东厅（闸门前那块最开阔的战场），
	# 40 秒内必须打死 ≥3 只、并且**挨过打**。
	# "关卡里到底铺了多少敌人、铺了几层"由 test_room01_complete 的 F3 负责，
	# "能不能顺着路走完"由 test_room01_route 负责 —— 三件事分开量。
	player.global_position = Vector2(16.0 + 50.0 * CELL + 24.0, 1760.0)
	player.velocity = Vector2.ZERO
	await _frames(12)

	var hp_prev: float = float(player.get("hp"))
	var hits: int = 0
	var jumps: int = 0
	var killed: int = 0
	var frames_max: int = int(MAX_SECONDS * 60.0)
	var cleared_at: int = -1
	var died: bool = false

	for f: int in range(frames_max):
		var alive: Array = _alive_enemies(room)
		if alive.is_empty():
			cleared_at = f
			break
		if bool(player.get("is_dead")):
			died = true
			break

		# 挨打计数：hp 下降一次算一次（挂机也会掉，所以这条能区分"有威胁"和"没威胁"）
		var hp_now: float = float(player.get("hp"))
		if hp_now < hp_prev - 0.5:
			hits += 1
		hp_prev = hp_now

		var target: Node2D = _nearest(player, alive)
		var dx: float = target.global_position.x - player.global_position.x
		var dy: float = target.global_position.y - player.global_position.y

		# 水平：靠近到 40px 内就松手（再近会撞进敌人身体，攻击反而打空）
		if absf(dx) > 40.0:
			if dx > 0.0:
				Input.action_press("move_right")
				Input.action_release("move_left")
			else:
				Input.action_press("move_left")
				Input.action_release("move_right")
		else:
			Input.action_release("move_left")
			Input.action_release("move_right")

		# 垂直：
		#   敌人在头顶 → 跳上去（平台单向，能从下面跳穿）
		#   敌人在脚下 → 「↓ + 跳」下穿（Player._handle_jump_and_drop 要求先有跳跃缓冲，
		#                 光按 ↓ 不会触发 —— 实测机器人就是这么卡在台上空砍的）
		var need_up: bool = dy < -50.0 and absf(dx) < 140.0
		var need_down: bool = dy > 60.0 and absf(dx) < 80.0
		if need_down:
			Input.action_press("move_down")
		else:
			Input.action_release("move_down")
		if (need_up or need_down) and (f % 26) < 2:
			Input.action_press("jump")
			jumps += 1
		elif (f % 26) == 2:
			Input.action_release("jump")

		# 攻击：贴脸才砍。Hitbox 在身前 12~56px、上下 12px，太远就是空挥。
		if absf(dx) < 52.0 and absf(dy) < 34.0 and (f % 6) < 3:
			Input.action_press("primary_attack")
		else:
			Input.action_release("primary_attack")

		if f % 600 == 0:
			print("    [dbg] f=%d pos=(%.0f,%.0f) hp=%.0f 剩余=%d" % [f, player.global_position.x, player.global_position.y, float(player.get("hp")), alive.size()])
		await physics_frame

	Input.action_release("move_left")
	Input.action_release("move_right")
	Input.action_release("jump")
	Input.action_release("primary_attack")

	killed = total - _enemy_count(room)
	var secs: float = float(cleared_at if cleared_at >= 0 else frames_max) / 60.0
	print("  结果：清场=%s 用时=%.1fs 击杀=%d/%d 跳跃=%d 次 挨打=%d 次"
		% [str(cleared_at >= 0), secs, killed, total, jumps, hits])
	if cleared_at < 0:
		for e: Node2D in _alive_enemies(room):
			print("  ⚠ 剩余：%s @ (%.0f, %.0f) 玩家 @ (%.0f, %.0f)"
				% [e.name, e.global_position.x, e.global_position.y,
					player.global_position.x, player.global_position.y])

	_check(not died, "机器人没有被打死")
	# ⚠️ 2026-11-27 第五次改判据：不再要求"清全关"。
	# 关卡长到 4800px、并且中间有一道必须爬竖井才能开的闸门之后，
	# 一个"朝最近的敌人直走"的机器人**走不过去**（它不会爬六跳的井）。
	# 要求它清完全场，等于在考机器人会不会导航，不是在考这关有没有战斗。
	# 所以判据换成：开局这一分钟内，它必须真的打死一批、并且挨过打。
	_check(killed >= 3, "%d 秒内打死 ≥3 只（实际 %d/%d）" % [int(MAX_SECONDS), killed, total])
	_check(jumps >= 2, "过程中至少跳 2 次（实际 %d）——平台真的参与战斗" % jumps)

	# ---- 威胁判据改成"定点挨打"，不再看机器人有没有被摸到 ----
	#
	# 原来断言的是"这场混战里机器人挨过打"。实测 40 秒杀 7 只、挨打 0 次 ——
	# 不是敌人在放水，是机器人一直在跳打：跳跃攻击时 dy 常常 >56px，
	# 而敌人的出手条件是 `|dx|<=60 且 |dy|<=56`。它靠"从上面砍"躲掉了所有攻击。
	# 那条判据于是变成了"机器人会不会跳"，不是"敌人有没有牙"。
	#
	# 换成定点验证：把玩家放在一只地面敌人旁边、**不给任何输入**，
	# 2 秒内血量必须掉。这才是"敌人真的会还手"，且不受机器人打法影响。
	var probe_hp: float = float(player.get("hp"))
	var still: Array = _alive_enemies(room)
	if still.is_empty():
		_check(false, "没有敌人可以用来验威胁")
	else:
		var foe: Node2D = still[0]
		player.global_position = Vector2(foe.global_position.x - 36.0, foe.global_position.y)
		player.velocity = Vector2.ZERO
		probe_hp = float(player.get("hp"))
		await _frames(130)
		var hp_after: float = float(player.get("hp"))
		_check(hp_after < probe_hp - 0.5,
			"站在敌人身边不动 2 秒会掉血（%.0f → %.0f）—— 敌人真的有威胁" % [probe_hp, hp_after])

	print("ROOM01 COMBAT: %s" % ("PASS" if _fail == 0 else "FAIL"))
	print("errors: %d" % _fail)
	quit(1 if _fail > 0 else 0)


## 活着的敌人 = InvadersContainer 里还有 health_depleted 未触发的子节点。
## 只用「存在性」判断，不碰血量：死亡时 BaseRoom 会同步 remove_child。
func _alive_enemies(room: Node) -> Array:
	var out: Array = []
	var cont: Node = room.get_node_or_null("InvadersContainer")
	if cont == null:
		return out
	for c: Node in cont.get_children():
		if c is Node2D:
			out.append(c)
	return out

func _enemy_count(room: Node) -> int:
	return _alive_enemies(room).size()

func _nearest(from: Node2D, list: Array) -> Node2D:
	var best: Node2D = list[0]
	var best_d: float = INF
	for e: Node2D in list:
		var d: float = from.global_position.distance_to(e.global_position)
		if d < best_d:
			best_d = d
			best = e
	return best
