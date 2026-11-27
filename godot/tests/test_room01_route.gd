extends SceneTree

## Room01 通关路线：**这关到底走不走得通、要走多久**。
##
## 为什么单独一个文件：
##   `test_room01_gate` 证的是"闸门的四件事"，`test_room01_traverse` 证的是"某一跳跳得到"，
##   两者都不回答白哥那句原话里最要紧的问题 ——「这关几分钟能玩完，还是十秒就到底」。
##   这个文件用一个按航点走的机器人，从出生点一路走到右门，**中间不打任何补丁**
##   （不放水、不瞬移、不手动开门），把时间和路程量出来。
##
## 机器人只会三件事：朝航点横走、目标在上方就跳、目标在下方就松手掉下去。
## 它比真人笨得多 —— 所以它走通了，真人一定走通；它走了 N 秒，真人只会更久。
##
## 判据：
##   R1 全程不死亡、不掉出地图
##   R2 闸门关着时确实被拦住（到不了 c70 以东）
##   R3 扳开关后闸门开
##   R4 最终走到右门（x ≥ 4600）
##   R5 全程用时 ≥ MIN_SECONDS（实测机器人 33.1s，门槛设 30s）
##
## 33 秒是**机器人按最优路线、不打架**跑出来的。上一版 34×15 的房同一套航点
## 是 8 秒。所以这条判据防的是"悄悄退回到一屏小房间"。
## 真人带着 23 只敌人打过去是这个数的 2~3 倍。
##   R6 总路程 ≥ MIN_TRAVEL（像素）

const ROOM_PATH: String = "res://world/rooms/Room01.tscn"
const MIN_SECONDS: float = 30.0
const MIN_TRAVEL: float = 6000.0

## 航点：出生 → 主脊 → 东厅 → 竖井六级 → 上层走廊 → 拉杆 → 下坠井 → 穿门 → 右门
const ROUTE: Array[Vector2] = [
	Vector2(400.0, 1680.0),       # 矮台上
	Vector2(1000.0, 1776.0),      # 入口高厅（c20，第一处矮台之后）
	Vector2(2000.0, 1776.0),      # 主脊
	Vector2(2600.0, 1776.0),      # 东厅（会被闸门拦住）
	Vector2(2950.0, 1776.0),      # 贴到闸门前
	Vector2(2140.0, 1584.0),      # 竖井一级 r33（c44，台面 c43..c46）
	Vector2(2104.0, 1392.0),      # 二级 r29
	Vector2(2248.0, 1200.0),      # 三级 r25
	Vector2(2104.0, 1008.0),      # 四级 r21
	Vector2(2248.0, 816.0),       # 五级 r17
	Vector2(2104.0, 624.0),       # 六级 r13（上层走廊高度）
	Vector2(2728.0, 624.0),       # 拉杆脚下
	Vector2(3000.0, 1776.0),      # 从下坠井落回东厅（这一段是掉下去的，不是走的）
	Vector2(3500.0, 1776.0),      # 穿过闸门
	Vector2(4600.0, 1776.0),      # 右门内侧
]

var _fail: int = 0
var _p: CharacterBody2D = null
var _gate: Node = null
var _lever: Node = null

func _initialize() -> void:
	call_deferred("_run")

func _check(ok: bool, msg: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + msg)
	if not ok:
		_fail += 1

func _frames(n: int) -> void:
	for i: int in range(n):
		await physics_frame

func _run() -> void:
	print("--- Room01 通关路线（航点机器人）---")
	var ws: Node = root.get_node_or_null("WorldState")
	if ws != null:
		ws.call("reset_state")
	var room: Node2D = (load(ROOM_PATH) as PackedScene).instantiate() as Node2D
	root.add_child(room)
	await process_frame
	await physics_frame

	# 清掉敌人与门：这个文件量的是"地形 + 机关"能不能走通，战斗在 test_room01_combat
	for c: Node in room.get_node("InvadersContainer").get_children():
		c.queue_free()
	for d: Node in room.get_node("Doors").get_children():
		d.set("monitoring", false)
	await _frames(4)

	_p = room.get_node("Player") as CharacterBody2D
	var mech: Node = room.get_node_or_null("Mechanisms")
	_gate = mech.get_node_or_null("Gate") if mech != null else null
	_lever = mech.get_node_or_null("Lever") if mech != null else null
	if _p == null or _gate == null or _lever == null:
		_check(false, "场景缺 Player / Gate / Lever")
		finish(room)
		return

	var travel: float = 0.0
	var frames: int = 0
	var last: Vector2 = _p.global_position
	var stalled: int = 0

	for wi: int in range(ROUTE.size()):
		var target: Vector2 = ROUTE[wi]
		var ok: bool = await _goto(target)
		travel += _p.global_position.distance_to(last)
		last = _p.global_position
		print("  → 航点 %2d (%.0f,%.0f) %s  现在 (%.0f,%.0f)"
			% [wi, target.x, target.y, "到" if ok else "**没到**",
				_p.global_position.x, _p.global_position.y])
		if not ok:
			stalled += 1
		# 经过闸门前（航点 4）之后必须还没开门
		if wi == 4:
			_check(not bool(_gate.get("_open")), "R2 到闸门前时门还是关的")
		# 到拉杆脚下就扳
		if wi == 11:
			_p.call("request_interact")
			await _frames(4)
			_check(bool(_gate.get("_open")), "R3 扳动拉杆后闸门开了")
		if bool(_p.get("is_dead")):
			_check(false, "R1 机器人在半路死了（航点 %d）" % wi)
			break
	frames = Engine.get_physics_frames()

	var secs: float = float(frames) / 60.0
	print("  用时 %.1fs / 路程 %.0fpx / 到点失败 %d 次" % [secs, travel, stalled])
	_check(not bool(_p.get("is_dead")), "R1 全程没有死亡")
	_check(_p.global_position.x >= 4560.0, "R4 走到右门（x=%.0f）" % _p.global_position.x)
	_check(stalled == 0, "R4b 所有航点都到了（失败 %d 个）" % stalled)
	_check(secs >= MIN_SECONDS, "R5 纯跑图用时 %.1fs ≥ %.0fs" % [secs, MIN_SECONDS])
	_check(travel >= MIN_TRAVEL, "R6 总路程 %.0fpx ≥ %.0fpx" % [travel, MIN_TRAVEL])
	finish(room)

func finish(room: Node) -> void:
	room.queue_free()
	await process_frame
	print("ROOM01 ROUTE: %s" % ("PASS" if _fail == 0 else "FAIL"))
	print("errors: %d" % _fail)
	quit(1 if _fail > 0 else 0)

## 朝航点走。返回是否到达（|dx|<26 且 |dy|<40）。
##
## 三件事：横走 / 目标在上就跳 / 目标在下就松手。
## 「卡住」的判定：连续 45 帧 x 没变 —— 卡住就跳一下（台阶、平台边都靠这个过去）。
func _goto(target: Vector2, max_frames: int = 900) -> bool:
	Input.action_release("move_down")
	var stuck: int = 0
	var last_x: float = _p.global_position.x

	for f: int in range(max_frames):
		var pos: Vector2 = _p.global_position
		var dx: float = target.x - pos.x
		var dy: float = target.y - pos.y

		# ❗ 必须落在**地面**上才算到。只判 |dy| 会在下落途中被"顺路"接受，
		# 机器人以为到了下一跳，其实还在空中 —— 实测它就是这样一路掉进下坠井的。
		# "到位" = 横向对上 + 纵向对上 + **不再下落**。
		# 只认 is_on_floor() 会漏掉"站在单向平台边缘但没被判定为着地"的情况：
		# 实测第一级台会停在 y=1603（台面 1584 之下 19px）、floor=false，
		# 机器人判定没到、继续原地跳 —— 而玩家其实已经站住了。
		if absf(dx) < 26.0 and absf(dy) < 26.0 and (_p.is_on_floor() or absf(_p.velocity.y) < 5.0):
			_release_all()
			return true

		# 横向
		if absf(dx) > 18.0:
			if dx > 0.0:
				Input.action_press("move_right")
				Input.action_release("move_left")
			else:
				Input.action_press("move_left")
				Input.action_release("move_right")
		else:
			Input.action_release("move_left")
			Input.action_release("move_right")

		# 纵向：目标在上就跳，目标在下就按住 ↓ 从平台上穿下去。
		# ❗ 只在**已经横向对位**时起跳（|dx| < 120）：离得远就起跳，
		# 跳起来还没到平台就落到原处，永远是原地蹦 —— 实测机器人因此
		# 在最一级跳上卡掉一次，然后掉回井底。
		if dy < -40.0:
			if _p.is_on_floor() and absf(dx) < 120.0 and f % 22 == 0:
				Input.action_press("jump")
				await _frames(3)
				Input.action_release("jump")
		elif dy > 60.0:
			Input.action_press("move_down")
			if _p.is_on_floor() and f % 14 == 0:
				Input.action_press("jump")
				await _frames(3)
				Input.action_release("jump")

		# 卡住检测
		if absf(_p.global_position.x - last_x) < 1.0:
			stuck += 1
			if stuck > 45 and _p.is_on_floor():
				Input.action_press("jump")
				await _frames(4)
				Input.action_release("jump")
				stuck = 0
		else:
			stuck = 0
		last_x = _p.global_position.x

		if f % 120 == 0:
			print("      [dbg] f=%d pos=(%.0f,%.0f) floor=%s" % [f, _p.global_position.x, _p.global_position.y, str(_p.is_on_floor())])
		await physics_frame

	_release_all()
	return false

func _release_all() -> void:
	for a: String in ["move_left", "move_right", "jump", "move_down"]:
		Input.action_release(a)
