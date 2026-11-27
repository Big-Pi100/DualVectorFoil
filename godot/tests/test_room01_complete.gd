extends SceneTree

## 12 · 一间房的完整实现：闸门。
##
## 判据来自 docs/gdd/12_单房完整实现.md §2 的 90 秒时间线，只覆盖 Room01。
## 每一条都对应「玩家能感知到的一件事」，不是「代码里有个变量」：
##
##   F0  新存档进门有敌人（之前是空房，实测 0 只）
##   F0  清过之后不再入侵（已清的房不复活）
##   F1  不跳走不到右门（跳跃不是装饰）
##   F1  三段台阶每段单跳接得上（不是只有 BFS 说能过）
##   F3  两只敌人不在同一高度（空间参与战斗）
##   F4  清场前右门锁、左门不锁；清场后右门开
##   F2  首次进房有操作提示，第二次没有
##
## 用真实场景 + 真实 Player，不 mock：这件事横跨 BaseRoom / RoomDoor / WorldState。

const ROOM_PATH: String = "res://world/rooms/Room01.tscn"
const FLAT_Y: float = 1776.0     # 地面站定的 y（脚底）= r37 顶面
const STEP1_Y: float = 1584.0    # 竖井一级 r33
const STEP2_Y: float = 1392.0    # 二级 r29
const STEP3_Y: float = 1200.0    # 三级 r25

var _fail: int = 0
var _root: Node = null

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	_root = Node.new()
	root.add_child(_root)
	await _test_f0_enemies_on_fresh_save()
	await _test_f0_purified_not_reinvaded()
	await _test_f3_enemies_on_two_levels()
	await _test_f4_door_lock_cycle()
	await _test_f1_cleared_but_gate_blocks()
	await _test_f1_three_step_jumps()
	await _test_f2_tutorial_once()
	_root.queue_free()
	print("ROOM01 COMPLETE: %s" % ("PASS" if _fail == 0 else "FAIL"))
	print("errors: %d" % _fail)
	quit(1 if _fail > 0 else 0)

func _check(ok: bool, msg: String) -> void:
	if ok:
		print("  ok   %s" % msg)
	else:
		print("  FAIL %s" % msg)
		_fail += 1

func _ws() -> Node:
	return root.get_node("/root/WorldState")

func _f(v: Variant) -> float:
	var out: float = v
	return out

func _frames(n: int) -> void:
	for i: int in range(n):
		await physics_frame

func _load_room() -> Node2D:
	var room: Node2D = (load(ROOM_PATH) as PackedScene).instantiate() as Node2D
	_root.add_child(room)
	await process_frame
	await physics_frame
	return room

## 关掉门，避免测试中途被切走场景（走路类用例必须用）
func _disable_doors(room: Node2D) -> void:
	var doors: Node = room.get_node_or_null("Doors")
	if doors == null:
		return
	for d: Node in doors.get_children():
		d.set("monitoring", false)

# ---------------------------------------------------------------------------

func _test_f0_enemies_on_fresh_save() -> void:
	print("--- F0 新存档进门有敌人 ---")
	_ws().call("reset_state")
	var room: Node2D = await _load_room()
	var n: int = room.get_node("InvadersContainer").get_child_count()
	_check(n >= 1, "全新存档进 Room01 敌人 %d 只（≥1）" % n)
	_check(room.get_node("InvadersContainer").visible, "敌人容器可见")
	room.queue_free()
	await process_frame

func _test_f0_purified_not_reinvaded() -> void:
	print("--- F0 清过之后不再入侵 ---")
	_ws().call("reset_state")
	var room: Node2D = await _load_room()
	for c: Node in room.get_node("InvadersContainer").get_children():
		c.call("take_damage", 999.0, Vector2.ZERO)
	await _frames(6)
	_check(_ws().get("purified_rooms").has("room_01"), "清场后记入 purified_rooms")
	room.queue_free()
	await process_frame
	var room2: Node2D = await _load_room()
	var n: int = room2.get_node("InvadersContainer").get_child_count()
	_check(n == 0, "再进这间房敌人 %d 只（应为 0，已清的房不复活）" % n)
	room2.queue_free()
	await process_frame

func _test_f3_enemies_on_two_levels() -> void:
	print("--- F3 二十三只敌人 / 多个高度带 + 空中 ---")
	_ws().call("reset_state")
	var room: Node2D = await _load_room()
	var ys: Array[float] = []
	var flyers: int = 0
	for child: Node in room.get_children():
		if child.name.begins_with("EnemySpawn"):
			ys.append((child as Node2D).global_position.y)
			if child.has_meta("variant") and int(child.get_meta("variant")) == 2:
				flyers += 1
	_check(ys.size() == 23, "蓝图里有 23 个敌人点（实际 %d）" % ys.size())
	_check(flyers >= 2, "其中至少 2 只飞行（实际 %d）—— 玩家不能只待在地面平面" % flyers)
	# 按 96px 分桶数高度带：408（空中）和 455（中台）差 47px，属于同一个"头顶"带。
	# 用它来量"玩家要处理几个高度"是诚实的；按像素精确值会把 47px 也算一层。
	var buckets: Dictionary = {}
	for y: float in ys:
		buckets[int(floor(y / 96.0))] = true
	_check(buckets.size() >= 2, "敌人分布在 %d 个高度带（≥2）" % buckets.size())
	room.queue_free()
	await process_frame

func _test_f4_door_lock_cycle() -> void:
	print("--- F4 清场前锁门 / 清场后开门 ---")
	_ws().call("reset_state")
	var room: Node2D = await _load_room()
	var exit_door: Node = null
	var home_door: Node = null
	for d: Node in room.get_node("Doors").get_children():
		if str(d.get("target_scene_path")).ends_with("SafeHouse.tscn"):
			home_door = d
		else:
			exit_door = d
	_check(exit_door != null, "有往前走的出口门")
	_check(home_door != null, "有回安全屋的门")
	if exit_door == null or home_door == null:
		room.queue_free()
		return
	_check(exit_door.get("locked") == true, "被占时出口门锁着")
	_check(home_door.get("locked") != true, "被占时回安全屋的门不锁（死亡送回不能被拦）")

	for c: Node in room.get_node("InvadersContainer").get_children():
		c.call("take_damage", 999.0, Vector2.ZERO)
	await _frames(6)
	_check(exit_door.get("locked") != true, "清场后出口门开了")

	# 横幅：光波是气氛、门开是功能，但玩家说不出"我做成了什么"。
	# 一句「入口厅 · 清空」是这间房唯一的结论句。
	var banner: Node = room.get_node_or_null("StatusBanner")
	_check(banner != null, "房间挂了清场横幅")
	if banner != null:
		var text_node: Node = banner.get_node_or_null("RootControl/Panel/Text")
		var shown: String = String(text_node.text) if text_node != null else ""
		_check(shown.contains("清空"), "横幅写出了结论：'%s'" % shown)
	room.queue_free()
	await process_frame

## 2026-11-27 第五次改写。
##
## 旧判据是「按住右 + 偶尔跳，能走到右门」。第四版之后这句话**不再成立，也不该成立**：
## 这间房的设计就是"地面走不通，必须上竖井扳开关"。
##
## 换成的判据量的是更关键的一件事：**清场之后，出口门解锁了，但人还是过不去**。
## 这两个"过不去"必须分开 —— 否则玩家会以为"门开了怎么还走不了"是 bug。
## 真正拦住他的不是那把锁，是那道闸门。
func _test_f1_cleared_but_gate_blocks() -> void:
	print("--- F1 清场后出口解锁，但闸门still挡路 ---")
	_ws().call("reset_state")
	var room: Node2D = await _load_room()
	_disable_doors(room)
	for c: Node in room.get_node("InvadersContainer").get_children():
		c.queue_free()
	await _frames(2)
	# 等 BaseRoom 判定清场、给出口门解锁
	await _frames(10)
	var gates: Node = room.get_node_or_null("Mechanisms/Gate")
	_check(gates != null, "场景里有闸门")

	var p: CharacterBody2D = room.get_node("Player") as CharacterBody2D
	# 从东厅地面起步（闸门左侧最近的一段地面 c49..c63）
	p.global_position = Vector2(16.0 + 50.0 * 48.0 + 24.0, FLAT_Y - 10.0)
	p.velocity = Vector2.ZERO
	await _frames(16)

	Input.action_press("move_right")
	var best_x: float = p.global_position.x
	for i: int in range(360):   # 6 秒
		if p.is_on_floor() and absf(p.velocity.x) < 5.0 and i > 20 and i % 40 == 0:
			Input.action_press("jump")
			await _frames(3)
			Input.action_release("jump")
		await physics_frame
		best_x = maxf(best_x, p.global_position.x)
	Input.action_release("move_right")
	Input.action_release("jump")
	await _frames(4)

	# 闸门 c64 左边沿 = 16 + 64*48 = 3088
	_check(best_x < 3076.0,
		"按死方向键 6 秒最远只到 x=%.0f（闸门 3088）—— 出口解锁不等于走得到" % best_x)
	room.queue_free()
	await process_frame

func _test_f1_three_step_jumps() -> void:
	print("--- F1 竖井三跳接得上 ---")
	_ws().call("reset_state")
	var room: Node2D = await _load_room()
	_disable_doors(room)
	for c: Node in room.get_node("InvadersContainer").get_children():
		c.queue_free()
	await _frames(2)
	var p: Node2D = room.get_node("Player")
	# 新结构（2026-11-27 第五版 · 整关尺度）：竖井六级，这里只验最低三跳，
	# 高处的三跳在 test_room01_traverse 里逐级验。
	#   r33 c43..46 → 台面 1584
	#   r29 c42..45 → 台面 1392
	#   r25 c44..47 → 台面 1200
	var cases: Array = [
		{"from": Vector2(16.0 + 42.0 * 48.0 + 24.0, FLAT_Y), "want": 1584.0, "name": "地面(c42)→竖井一级"},
		{"from": Vector2(16.0 + 46.0 * 48.0 + 24.0, 1584.0), "want": 1392.0, "name": "一级(c46)→二级（往左）", "dir": -1},
		{"from": Vector2(16.0 + 43.0 * 48.0 + 24.0, 1392.0), "want": 1200.0, "name": "二级(c43)→三级"},
	]
	for c: Dictionary in cases:
		var r: Dictionary = await _jump_right(p, c["from"], int(c.get("dir", 1)))
		_check(absf(_f(r["y"]) - float(c["want"])) < 8.0,
			"%s：落点 y=%.0f（期望 %.0f）" % [c["name"], _f(r["y"]), float(c["want"])])
	room.queue_free()
	await process_frame

## 站定 → 助跑 → 按住右 + 跳一次 → 空中松手 → 等落地
##
## 不能全程按住右：满速 290 × 滞空 0.917s = 5.5 格，会直接飞过 5 格宽的台。
## 真人会在空中松手，测试也得这么打。
func _jump_right(p: Node2D, at: Vector2, dir: int = 1) -> Dictionary:
	var act: String = "move_right" if dir > 0 else "move_left"
	p.global_position = at
	await _frames(20)
	Input.action_press(act)
	for i: int in range(10):
		await physics_frame
	Input.action_press("jump")
	await _frames(3)
	Input.action_release("jump")
	for i: int in range(20):
		await physics_frame
	Input.action_release(act)
	for i: int in range(120):
		await physics_frame
		var v: Vector2 = p.get("velocity")
		if i > 20 and absf(v.y) < 1.0 and p.call("is_on_floor") == true:
			break
	await _frames(2)
	return {"y": p.global_position.y, "x": p.global_position.x}

func _test_f2_tutorial_once() -> void:
	print("--- F2 操作提示只出现一次 ---")
	_ws().call("reset_state")
	var room: Node2D = await _load_room()
	await _frames(4)
	var hint: Node = room.get_node_or_null("TutorialHint")
	_check(hint != null and is_instance_valid(hint), "首次进房有操作提示节点")
	var text_node: Node = null
	if hint != null and is_instance_valid(hint):
		text_node = hint.get_node_or_null("RootControl")
	_check(text_node != null, "提示内容已构建（RootControl 存在）")
	room.queue_free()
	await process_frame

	var room2: Node2D = await _load_room()
	await _frames(4)
	var hint2: Node = room2.get_node_or_null("TutorialHint")
	var gone: bool = hint2 == null or not is_instance_valid(hint2)
	_check(gone, "第二次进房不再显示提示（%s）" % ("节点已释放" if gone else "还在"))
	room2.queue_free()
	await process_frame
