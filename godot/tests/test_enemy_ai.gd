extends SceneTree

## 敌人 AI 闸门（S0）：巡逻 / 察觉追击 / 起手形变 / 判定只结一次 / 硬直打断起手。
##
## 全用真实物理帧 + 真实射线，不用 mock：
## 敌人是「贴着地形走」的东西，桩掉射线之后测的就是另一套代码了。
## 唯一被替身的是玩家（只保留位置和 take_damage）。

const INVADER: PackedScene = preload("res://world/enemies/Invader.tscn")
const STUB_PLAYER: PackedScene = preload("res://tests/support/stub_player.tscn")

var _fail: int = 0
var _root: Node = null
var _ground: StaticBody2D = null

func _initialize() -> void:
	_root = Node.new()
	root.add_child(_root)
	await _test_contract()
	await _test_patrol()
	await _test_chase()
	await _test_telegraph_and_single_hit()
	await _test_interrupt()
	await _test_ledge_turn()
	await _test_room_integration()
	_root.queue_free()
	print("ENEMY AI GATE: %s" % ("PASS" if _fail == 0 else "FAIL"))
	print("errors: %d" % _fail)
	quit(1 if _fail > 0 else 0)

func _frames(n: int) -> void:
	for i: int in range(n):
		await physics_frame

func _check(ok: bool, msg: String) -> void:
	if not ok:
		_fail += 1
		print("  FAIL %s" % msg)
	else:
		print("  ok   %s" % msg)

## 一整条地面，顶面 y=0，碰撞层 1（world）。
func _make_ground(width: float = 1600.0) -> void:
	_ground = StaticBody2D.new()
	_ground.collision_layer = 1
	_ground.collision_mask = 0
	var cs := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(width, 40)
	cs.shape = rect
	cs.position = Vector2(0, 20)
	_ground.add_child(cs)
	_root.add_child(_ground)

func _spawn_enemy(x: float) -> Node2D:
	var inv: Node2D = INVADER.instantiate() as Node2D
	inv.position = Vector2(x, -25.0)  # 碰撞盒 40x50 → 半高 25，脚正好落在 y=0
	_root.add_child(inv)
	return inv

func _spawn_player(x: float) -> Node2D:
	var p: Node2D = STUB_PLAYER.instantiate() as Node2D
	p.position = Vector2(x, -23.0)
	_root.add_child(p)
	return p

func _ai(inv: Node2D) -> Node:
	return inv.get_node_or_null("AI")


func _test_contract() -> void:
	print("--- 场景契约 ---")
	var inv: Node2D = _spawn_enemy(-600.0)
	await _frames(1)
	var ai: Node = _ai(inv)
	_check(ai != null, "Invader.tscn 挂了 AI 子节点")
	_check(inv.has_method("take_damage"), "根节点仍是 Hurtbox，take_damage 契约没被破坏")
	inv.free()


func _test_patrol() -> void:
	print("--- 巡逻：玩家在察觉半径外 ---")
	_make_ground()
	var inv: Node2D = _spawn_enemy(0.0)
	var p: Node2D = _spawn_player(2000.0)
	await _frames(2)
	var ai: Node = _ai(inv)
	ai.call("set_target", p)
	var x0: float = inv.position.x
	var y0: float = inv.position.y
	await _frames(60)
	var moved: float = absf(inv.position.x - x0)
	_check(String(ai.call("get_state_name")) == "PATROL", "状态是 PATROL（实际 %s）" % ai.call("get_state_name"))
	_check(moved > 30.0, "1 秒内移动了 %.0fpx（>30）" % moved)
	_check(absf(inv.position.y - y0) < 1.0, "贴着地面走，y 没漂（Δ=%.2f）" % (inv.position.y - y0))
	# 巡逻 6 秒应该被 96px 边界挡住并折返，不会走出地面
	await _frames(300)
	_check(absf(inv.position.x) < 120.0, "不会走出巡逻范围（x=%.0f，限 96+ε）" % inv.position.x)
	inv.free()
	p.free()
	_ground.free()


func _test_chase() -> void:
	print("--- 察觉追击：玩家进 320px ---")
	_make_ground()
	var inv: Node2D = _spawn_enemy(0.0)
	var p: Node2D = _spawn_player(240.0)
	await _frames(2)
	var ai: Node = _ai(inv)
	ai.call("set_target", p)
	var d0: float = absf(p.position.x - inv.position.x)
	await _frames(45)
	var d1: float = absf(p.position.x - inv.position.x)
	_check(String(ai.call("get_state_name")) in ["CHASE", "WINDUP", "ACTIVE", "RECOVER"],
		"进入追击链（实际 %s）" % ai.call("get_state_name"))
	_check(d1 < d0 - 20.0, "距离从 %.0f 缩到 %.0f（至少靠近 20px）" % [d0, d1])
	inv.free()
	p.free()
	_ground.free()


func _test_telegraph_and_single_hit() -> void:
	print("--- 起手形变 + 判定只结一次 ---")
	_make_ground()
	var inv: Node2D = _spawn_enemy(0.0)
	var p: Node2D = _spawn_player(40.0)
	await _frames(2)
	var ai: Node = _ai(inv)
	ai.call("set_target", p)
	var visual: Sprite2D = inv.get_node("Visual") as Sprite2D
	var squash_frames: int = 0
	var saw_windup: bool = false
	var saw_active: bool = false
	for i: int in range(90):
		await physics_frame
		var s: String = String(ai.call("get_state_name"))
		if s == "WINDUP":
			saw_windup = true
			if absf(visual.scale.y - 1.0) > 0.12:
				squash_frames += 1
		elif s == "ACTIVE":
			saw_active = true
		if int(p.get("hits")) > 0 and saw_active:
			break
	_check(saw_windup, "出现 WINDUP 状态")
	# 450ms 的起手若只有 1~2 帧形变，肉眼等于没有；这里要求 ≥5 帧（≈83ms）可读。
	_check(squash_frames >= 5, "起手形变可读：%d 帧纵向压扁 >12%%（要求 ≥5）" % squash_frames)
	_check(saw_active, "出现 ACTIVE 状态")
	_check(int(p.get("hits")) == 1, "一次挥击只结算 1 次（实际 %d 次，hp=%.0f）" % [int(p.get("hits")), float(p.get("hp"))])
	_check(float(p.get("hp")) == 102.0, "伤害 18 生效（hp %.0f，期望 102）" % float(p.get("hp")))
	await _frames(40)
	_check(int(p.get("hits")) == 1, "判定窗口结束后没有补刀（仍 %d 次）" % int(p.get("hits")))
	inv.free()
	p.free()
	_ground.free()


func _test_interrupt() -> void:
	print("--- 硬直打断起手 ---")
	_make_ground()
	var inv: Node2D = _spawn_enemy(0.0)
	var p: Node2D = _spawn_player(40.0)
	await _frames(2)
	var ai: Node = _ai(inv)
	ai.call("set_target", p)
	# 等它进 WINDUP
	var entered: bool = false
	for i: int in range(60):
		await physics_frame
		if String(ai.call("get_state_name")) == "WINDUP":
			entered = true
			break
	_check(entered, "先进入 WINDUP")
	inv.call("take_damage", 1.0, Vector2(-120.0, 0.0))
	await _frames(1)
	_check(String(ai.call("get_state_name")) == "HURT",
		"挨打立刻转 HURT（实际 %s）" % ai.call("get_state_name"))
	await _frames(12)  # 硬直 200ms = 12 帧
	_check(int(p.get("hits")) == 0, "起手被打断后没有造成伤害（实际 %d 次）" % int(p.get("hits")))
	inv.free()
	p.free()
	_ground.free()


func _test_ledge_turn() -> void:
	print("--- 悬崖折返：不会走下平台 ---")
	# 只有 400px 宽的台面（-200..200），敌人出生在 150，巡逻半宽 96 必然走到边缘。
	_make_ground(400.0)
	var inv: Node2D = _spawn_enemy(150.0)
	var p: Node2D = _spawn_player(2000.0)
	await _frames(2)
	var ai: Node = _ai(inv)
	ai.call("set_target", p)
	# 关键判据不是"y 有没有变"，而是**每一帧脚下都有地**。
	# 前者在"没有重力"的实现里也永远成立（敌人悬空停住，y 不变）。
	var floating: int = 0
	var max_abs_x: float = 0.0
	for i: int in range(300):
		await physics_frame
		if not _has_ground_under(inv):
			floating += 1
		max_abs_x = maxf(max_abs_x, absf(inv.position.x))
	_check(floating == 0, "5 秒内每帧脚下都有地（悬空 %d 帧）" % floating)
	_check(max_abs_x <= 210.0, "没走出台面边界（最远 |x|=%.0f，台面到 200）" % max_abs_x)
	inv.free()
	p.free()
	_ground.free()


## 敌人脚下 10px 内有没有地。用真实物理空间，不用坐标推算。
func _has_ground_under(inv: Node2D) -> bool:
	var space: PhysicsDirectSpaceState2D = inv.get_world_2d().direct_space_state
	var from: Vector2 = inv.global_position + Vector2(0, 24.0)
	var q: PhysicsRayQueryParameters2D = PhysicsRayQueryParameters2D.create(
		from, from + Vector2.DOWN * 10.0, 3)
	q.collide_with_areas = false
	return not space.intersect_ray(q).is_empty()


## 切片 S0 的验收条件，原样搬进来：
## 「站在房间门口**不按键**，10 秒内被至少 1 只敌人打到」。
## 这条必须在真房间里跑 —— 合成地面只能证明 AI 逻辑对，
## 证明不了敌人和房间里的地形/门/玩家出生点配得起来。
func _test_room_integration() -> void:
	print("--- 真实房间 Room01：站门口不按键 10 秒 ---")
	var ws: Node = root.get_node_or_null("WorldState")
	if ws == null:
		_check(false, "WorldState 自动加载存在")
		return
	ws.call("reset_state")
	var scene: PackedScene = load("res://world/rooms/Room01.tscn") as PackedScene
	_check(scene != null, "Room01.tscn 可加载")
	if scene == null:
		return
	var room: Node2D = scene.instantiate() as Node2D
	_root.add_child(room)
	await _frames(4)

	var player: Node = room.get_node_or_null("Player")
	var marker: Node2D = room.get_node_or_null("SpawnFromLeft") as Node2D
	if player == null or marker == null:
		_check(false, "Room01 有 Player 和 SpawnFromLeft")
		room.free()
		return
	(player as Node2D).global_position = marker.global_position

	# 不能 ws.set("invaded_rooms", [...]) —— 类型化 Array[String] 会静默拒绝，
	# 结果是"入侵没发生"，而测试只会报"没打到人"。原地 append 才生效。
	# 自 12 F0 起 Room01 声明了 invade_on_enter，房间已经自己占过；
	# 无条件 append 会让数组里出现两个 "room_01"，purify 的 erase() 只删一个。
	var invaded: Array = ws.get("invaded_rooms")
	if not invaded.has("room_01"):
		invaded.append("room_01")
	room.call("_setup_invasion_state")
	await _frames(2)
	var invaders: Node = room.get_node_or_null("InvadersContainer")
	_check(invaders != null and invaders.get_child_count() > 0,
		"入侵状态生成了敌人（%d 只）" % (invaders.get_child_count() if invaders != null else -1))

	# 数「血量下降次数」而不是「最终血量」：玩家被打死会满血复活，
	# 只看最终 hp 会把一次真实的挨打读成「没受伤」。
	var hits: int = 0
	var prev_hp: float = float(player.get("hp"))
	var closest: float = 99999.0
	var closest_state: String = "-"
	var first_hit_frame: int = -1
	# ⚠️ 2026-11-27 第五次：不再"按着右键一路小跑"。
	# 关卡长到 4800px 之后，满速 290 的玩家从敌人身边穿过去只要 0.2 秒，
	# 敌人的出手有前摇，根本咬不到 —— 实测 11 秒 0 次挨打。
	# 这不是"敌人不追"，是"追不上一个全速跑的人"，判据失去了意义。
	# 改成把玩家放到第一只地面敌人旁边、不移动：量的是"敌人会不会追上来咬"。
	var foe: Node2D = null
	for c: Node in invaders.get_children():
		var n: Node2D = c as Node2D
		if n != null and absf(n.global_position.y - (player as Node2D).global_position.y) < 200.0:
			foe = n
			break
	if foe != null:
		(player as Node2D).global_position = Vector2(foe.global_position.x - 36.0, foe.global_position.y)
		(player as CharacterBody2D).velocity = Vector2.ZERO
	for i: int in range(660):
		await physics_frame
		var cur: float = float(player.get("hp"))
		if cur < prev_hp - 0.01:
			hits += 1
			if first_hit_frame < 0:
				first_hit_frame = i
		prev_hp = cur
		for c: Node in invaders.get_children():
			var d: float = absf((c as Node2D).global_position.x - (player as Node2D).global_position.x)
			if d < closest:
				closest = d
				var ai: Node = c.get_node_or_null("AI")
				closest_state = String(ai.call("get_state_name")) if ai != null else "-"
		if hits > 0:
			break
	Input.action_release("move_right")
	_check(hits > 0, "推进中 10 秒内被咬到（第 %.1fs 首次挨打，共 %d 次，敌人最近贴到 %.0fpx，当时状态 %s）"
		% [float(first_hit_frame) / 60.0, hits, closest, closest_state])
	room.free()
	ws.call("reset_state")
