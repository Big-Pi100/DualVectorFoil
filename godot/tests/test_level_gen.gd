extends SceneTree

## 拼装关（Level01）的生成质量：**图对不对、缝通不通、人走不走得过去**。
##
## 这是 Dead Cells「混合方法」落地后的第一道闸。它不看图，只跑数：
##
##   L1  layout.json 存在，且房间数 = 关卡图节点数
##   L2  每条接缝两侧的**站面行**相同（差一行就是 48px 的坎）
##   L3  蓝图里 L/R 只在最左/最右 —— 内部还有门就等于「一串房间」不是「一关」
##   L4  每条接缝的 2 列 × 3 行门洞是空的（挖缝真的挖了）
##   L5  地面对称：每间房内至少 1 个敌人，商店房 0 个
##   L6  敌人 marker 总数 = layout 里 spawned 之和
##   L7  **机器人从出生点一路向右走到最后一间**（不瞬移、不放水、不拆地形）
##
## L7 是最贵的一条，也是唯一能回答「这关能不能玩」的。前六条全绿而 L7 红，
## 说明图纸好看但走不通 —— 这正是「重叠一列」那一版的状态。

const SCENE_PATH: String = "res://world/level/Level01.tscn"
const BP_PATH: String = "res://world/rooms/blueprints/level_01.txt"
const LAYOUT_PATH: String = "res://world/level/level_01.layout.json"
const TILE: int = 48
const MAX_SECONDS: float = 150.0

var _fail: int = 0
var _bp: Array = []

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
	print("--- Level01 拼装质量 ---")
	var doc: Dictionary = _load_layout()
	if doc.is_empty():
		_check(false, "L1 读不到 %s" % LAYOUT_PATH)
		_quit()
		return

	var rooms: Array = doc.get("rooms", [])
	var seams: Array = doc.get("seams", [])
	_check(rooms.size() >= 2, "L1 房间数 %d ≥ 2" % rooms.size())
	# 终点从布局宽度算，不写死：模板池一加宽（room_01 是 100 格），
	# 写死的 8450 会让机器人在半路就"达标"，L7 变成永远绿的空断言。
	var goal_x: float = float(int((doc.get("px", [1280, 720]) as Array)[0])) - 320.0

	# L2 接缝对齐
	#
	# 横向缝验**行**（站面高度差一行就是 48px 的坎）；
	# 纵向缝验**列**（门列错一格，人掉下去直接撞墙）。
	# 之前只有一种缝，所以这里只有一种断言 —— 加了上下门之后必须分判，
	# 否则纵向缝的 stand_row_a 是 null，GDScript 会把 null 当 0，永远是绿的。
	var bad: int = 0
	for s: Dictionary in seams:
		if str(s.get("link", "h")) == "v":
			if int(s["world_col_a"]) != int(s["world_col_b"]):
				print("    竖缝 %s→%s 差 %d 列" % [s["from"], s["to"],
					int(s["world_col_b"]) - int(s["world_col_a"])])
				bad += 1
		else:
			if int(s["stand_row_a"]) != int(s["stand_row_b"]):
				print("    接缝 %s→%s 差 %d 行" % [s["from"], s["to"],
					int(s["stand_row_b"]) - int(s["stand_row_a"])])
				bad += 1
	_check(bad == 0, "L2 所有接缝对齐（横缝看行 / 竖缝看列，不一致 %d 条）" % bad)

	var rows: Array = _load_blueprint()
	_bp = rows
	_check(rows.size() > 0, "L3 蓝图可读（%d 行）" % rows.size())
	if rows.size() > 0:
		var cols: int = (rows[0] as String).length()
		var bad_doors: int = 0
		for r: int in range(rows.size()):
			var line: String = rows[r]
			for c: int in range(line.length()):
				var ch: String = line[c]
				if (ch == "L" or ch == "R") and c != 0 and c != cols - 1:
					bad_doors += 1
		_check(bad_doors == 0, "L3 内部门数为 0（实有 %d）" % bad_doors)

		# L4 门洞是空的
		#
		# 横缝挖 2 列 × 3 行、竖缝挖 3 列 × 2 行；**支线例外** ——
		# 它要从父房间的可站面下方一直挖到口袋天花板，行数是变的。
		# 这里只认 `world_rows`（拼装器算出来的真实行表），不再假设"就两行"。
		# 早先按两行验，支线那种三行深的洞会在第一行就通过，中间两行堵没堵根本不知道。
		var blocked: int = 0
		for s: Dictionary in seams:
			if str(s.get("link", "h")) == "v":
				var dc: int = int(s["world_col_a"])
				var half: int = int(s.get("world_half", 1))
				var vrows: Array = s.get("world_rows", [int(s["world_row_a"]), int(s["world_row_b"])])
				for r: int in vrows:
					for c: int in range(dc - half, dc + half + 1):
						if r < 0 or r >= rows.size() or c < 0 or c >= cols:
							blocked += 1
							continue
						if (rows[r] as String)[c] != ".":
							blocked += 1
			else:
				var stand: int = int(s["stand_row_a"])
				var c0: int = int(s["world_col"]) - 1   # 父房间最后一列
				var c1: int = int(s["world_col"])       # 子房间第 0 列
				for c: int in [c0, c1]:
					for r: int in range(stand - 2, stand + 1):
						if r < 0 or r >= rows.size() or c < 0 or c >= cols:
							blocked += 1
							continue
						if (rows[r] as String)[c] != ".":
							blocked += 1
		_check(blocked == 0, "L4 所有门洞都是空的（横 2×3 / 竖 3×N，堵了 %d 格）" % blocked)

	# L5 敌人分布
	var empty_rooms: Array[String] = []
	var shop_hit: int = 0
	var want_total: int = 0
	for room: Dictionary in rooms:
		var spawned: Array = room.get("spawned", [0, 0])
		var n: int = int(spawned[0]) + int(spawned[1])
		want_total += n
		if str(room["tag"]) == "shop" and n > 0:
			shop_hit += n
		elif str(room["tag"]) != "shop" and n == 0:
			empty_rooms.append(str(room["id"]))
	_check(shop_hit == 0, "L5 商店房没有敌人（实有 %d）" % shop_hit)
	_check(empty_rooms.is_empty(), "L5 非商店房都有战斗（空的：%s）" % str(empty_rooms))

	var scene: Node2D = (load(SCENE_PATH) as PackedScene).instantiate() as Node2D
	if scene == null:
		_check(false, "L6 加载 %s 失败" % SCENE_PATH)
		_quit()
		return
	root.add_child(scene)
	await process_frame
	await physics_frame

	var markers: int = 0
	for ch: Node in scene.get_children():
		if ch.name.begins_with("EnemySpawn"):
			markers += 1
	_check(markers == want_total, "L6 敌人 marker %d = 布局里的 %d" % [markers, want_total])

	# 静态断言跑完就停 —— L7 是整关实走，几十秒起步，调拼装时不必每次等它。
	if OS.get_cmdline_user_args().has("nowalk"):
		print("  --   跳过 L7（nowalk）")
		scene.queue_free()
		await process_frame
		_quit()
		return

	# L7 机器人走通
	for c: Node in scene.get_node("InvadersContainer").get_children():
		c.queue_free()
	for d: Node in scene.get_node("Doors").get_children():
		d.set("monitoring", false)
	await _frames(4)

	var p: CharacterBody2D = scene.get_node("Player") as CharacterBody2D
	if p == null:
		_check(false, "L7 场景缺 Player")
		_quit()
		return

	var start_x: float = p.global_position.x
	var f: int = 0

	# 垂直段：先把机器人送到第一个竖缝的入口。
	#
	# 为什么不能一路 _march 到底：竖井里的楼板缺口是**左右交错**的
	# （r5 缺口在 c9、r9 缺口在 c7、r13 在 c8、r17 在 c12……），
	# 只会向右走的机器人走到楼板右端就撞墙，而缺口在它左边。
	# 这不是关卡坏了，是"机器人只会一个方向"——真人是会往回走的。
	var v_seams: Array[float] = []
	for s: Dictionary in seams:
		# 支线的缝也是竖缝，但它不是"往下走"的通道 —— 混进来会让 `_descend`
		# 把机器人往口袋里带，然后竖井测试变成在测口袋。只取主链上的竖缝。
		if str(s.get("link", "h")) == "v" and not bool(s.get("branch", false)):
			v_seams.append(float(int(s["world_col_a"]) * TILE))

	if v_seams.size() > 0:
		var drop_x: float = v_seams[0]
		f += await _march(p, drop_x + TILE * 0.5, int(60.0 * 60.0))
		print("  进入竖井（x=%.0f，机器人 x=%.0f y=%.0f）" % [
			drop_x, p.global_position.x, p.global_position.y])
		f += await _descend(p, int(60.0 * 60.0))
		print("  竖井到底（x=%.0f y=%.0f）" % [p.global_position.x, p.global_position.y])

	# L7a 带闸门的关：关着必须过不去。不测这条，闸门就退化成装饰。
	var gate: Node = scene.get_node_or_null("Mechanisms/Gate")
	if gate != null:
		var gx: float = (gate as Node2D).global_position.x
		f += await _march(p, gx + 300.0, int(45.0 * 60.0))
		var stop_x: float = p.global_position.x
		_check(stop_x < gx + 100.0,
			"L7a 闸门关着时过不去（停在 x=%.0f，门在 %.0f）" % [stop_x, gx])
		gate.call("open")
		await _frames(10)
		print("  闸门已开，继续")

	# 支线（梯台竖井）：单独一段定点测试。
	#
	# 为什么不靠主链行军时"顺路掉进去"：洞只有 5 格宽，而一次跳跃能过 4.8 格 ——
	# 机器人前面刚跳完（塔出口附近），一蹦就越过去了，实测就是这样。
	# 而**跳过支线本来就是合法玩法**（它是可选的），所以不能把"必须掉进去"
	# 写成主链的判据。改成：把人放到洞口左边，用"只走不跳"走进去，
	# 这样测的是"洞能进 + 进去能出"，而不是"玩家会不会踩"。
	var branches: Array = []
	for s: Dictionary in seams:
		if bool(s.get("branch", false)):
			branches.append(s)
	if branches.is_empty():
		print("  --   本关没有支线，跳过 L8")
	else:
		var b: Dictionary = branches[0]
		var hole_c: int = int(b["world_col"])
		# 玩家节点的 origin 在**脚下**（实测站在 r96 的地面上时 y == 4656 == r97 的上沿）。
		# 所以父房间地面的高度就是 world_rows[0] 那一行的上沿，不要再减半身高 ——
		# 之前减了 32，判据永远差一格，爬出来了也判失败。
		var hole_y: float = float(int((b["world_rows"] as Array)[0])) * float(TILE)
		# 站到洞口左边三格、父房间地面上，然后只走不跳
		p.global_position = Vector2(float(hole_c - 3) * float(TILE), hole_y - 8.0)
		p.set("velocity", Vector2.ZERO)
		await _frames(8)
		f += await _walk_plain(p, float(hole_c + 3) * float(TILE), 240)
		var in_pit: bool = p.global_position.y > hole_y + float(TILE) * 1.5
		_check(in_pit, "L8 走进了支线（y=%.0f，父房间地面 %.0f）" % [p.global_position.y, hole_y])
		if in_pit:
			var cf: int = await _climb(p, float(hole_c) * float(TILE), hole_y, int(30.0 * 60.0))
			f += cf
			await _frames(12)
			_check(p.is_on_floor() and p.global_position.y <= hole_y + 12.0,
				"L8 从支线爬了出来（y=%.0f / 目标 ≤ %.0f，%.1fs）" % [
					p.global_position.y, hole_y + 12.0, float(cf) / 60.0])

	f += await _march(p, goal_x, int(MAX_SECONDS * 60.0))
	var secs: float = float(f) / 60.0
	var reached: float = p.global_position.x
	print("  机器人：x %.0f → %.0f，用时 %.1fs" % [start_x, reached, secs])
	_check(reached >= goal_x, "L7 走到最后一间（x=%.0f / 目标 %.0f）" % [reached, goal_x])
	_check(_p_alive(p), "L7 全程没死")
	p.set("is_dead", false)
	scene.queue_free()
	await process_frame
	_quit()

## 在竖井里往下走：**左右扫**，撞墙就反向，掉到"落地不动"为止。
##
## 为什么必须有这一段：塔的每一层楼板只有一个 2 格宽的缺口，
## 而缺口是左右交错的。只会往右走的机器人走到楼板尽头就贴墙站住，
## 缺口就在它左边两格 —— 它一辈子也过不去。
## 真人是会折返的，所以机器人在竖井里也必须会折返。
func _descend(p: CharacterBody2D, max_frames: int) -> int:
	var dir: int = 1
	var f: int = 0
	var last_x: float = p.global_position.x
	var last_y: float = p.global_position.y
	var stalled: int = 0
	var no_fall: int = 0
	var y_mark: float = p.global_position.y
	var flips: int = 0
	while _p_alive(p) and f < max_frames:
		Input.action_press("move_right" if dir > 0 else "move_left")
		if absf(p.global_position.x - last_x) < 0.6:
			stalled += 1
		else:
			stalled = 0
			last_x = p.global_position.x
		# 撞墙 -> 反向。连续撞两次同一个方向说明真的没路了，继续反向。
		if stalled > 15:
			# 释放的是**旧方向**的键。写成新方向就变成"两个键都按着"，
			# 输入互相抵消，人原地不动 —— 然后 15 帧后再次反向，无限抖。
			# 这一行我写错过一次，表现是"反向 11 次仍在原地"。
			var old_dir: int = dir
			dir = -dir
			flips += 1
			stalled = 0
			Input.action_release("move_right" if old_dir > 0 else "move_left")
		# 「到底」的判据是**高度不再刷新**，不是"站着不动"：
		# 楼板横穿一趟要 2 秒多，用"不动 1.5 秒"会把还在找缺口的人误判成落地。
		# 屏幕坐标 y 向下增大：**掉下去 y 变大**。
		# 判据必须是 "y 没变大"，写成 >= 会把每一次下落都算成"没掉"。
		if p.global_position.y <= y_mark + 2.0:
			no_fall += 1
		else:
			no_fall = 0
			y_mark = p.global_position.y
		if no_fall > 300:   # 5 秒没有新高度 = 真的到底了
			break
		# 竖井里**不许跳**。跳 4 格远、2 格高的弧线正好能跃过 2 格宽的楼板缺口 ——
		# 机器人一跳就从缺口上飞过去，然后在楼板上继续撞墙。下落只能靠走。
		last_y = p.global_position.y
		# 关掉自动抓边：这是给玩家的手感辅助，会在下落时把角色粘在楼板边缘上。
		# 验证"结构通不通"不该受它影响 —— 否则机器人会在塔里反复抓边原地上蹿下跳。
		p.set("_ledge_assist_used", true)
		await physics_frame
		f += 1
	Input.action_release("move_right")
	Input.action_release("move_left")
	Input.action_release("jump")
	var cc: int = int(p.global_position.x / float(TILE))
	var rr: int = int(p.global_position.y / float(TILE))
	print("    竖井：%d 帧，反向 %d 次，落点 (%d,%d)" % [f, flips, cc, rr])
	for y: int in range(rr - 2, rr + 3):
		if y >= 0 and y < _bp.size():
			print("      r%d |%s|" % [y, (_bp[y] as String).substr(maxi(cc - 8, 0), 17)])
	return f

## 一路向右。卡住 10 帧就跳；连续卡满 give_up 帧就提前收工（撞闸门、撞墙都靠这个退出）。
func _march(p: CharacterBody2D, target_x: float, max_frames: int, give_up: int = 240) -> int:
	var stalled: int = 0
	var last_x: float = p.global_position.x
	var jump_hold: int = 0
	var f: int = 0
	Input.action_press("move_right")
	while _p_alive(p) and p.global_position.x < target_x and f < max_frames:
		if absf(p.global_position.x - last_x) < 1.0:
			stalled += 1
		else:
			stalled = 0
			last_x = p.global_position.x
		if stalled > give_up:
			print("    _march 卡在 x=%.0f y=%.0f（%d 帧没动）" % [
				p.global_position.x, p.global_position.y, stalled])
			break
		if stalled > 10 and (p.is_on_floor() or jump_hold == 0):
			Input.action_press("jump")
			jump_hold = 6
		if jump_hold > 0:
			jump_hold -= 1
			if jump_hold == 0:
				Input.action_release("jump")
		p.set("_ledge_assist_used", true)
		await physics_frame
		f += 1
	Input.action_release("move_right")
	Input.action_release("jump")
	return f

## 只走不跳。用来走进支线的地板洞 —— 会跳的人一蹦就过去了，反而测不到洞。
func _walk_plain(p: CharacterBody2D, target_x: float, max_frames: int) -> int:
	Input.action_press("move_right")
	var f: int = 0
	while _p_alive(p) and f < max_frames and p.global_position.x < target_x:
		p.set("_ledge_assist_used", true)
		await physics_frame
		f += 1
	Input.action_release("move_right")
	return f

## 从支线竖井里爬出来：见地就跳 + 撞顶换向。
##
## 为什么这一版能成而前两版不能：**几何变了，不是策略变聪明了**。
## 前两版的顶层台在洞口下方 6 格，单跳只有 4.25 格 —— 物理上就出不来，
## 换什么策略都白搭（实测换了 58 次向仍卡在第二级）。
## 现在顶层台就在洞口里，往外跳有 60px 余量，290px/s 移动速度够挪出一格。
##
## 判据仍然只认"高度刷新"和"掉下去"两件事，不看具体坐标 ——
## 写死坐标等于把答案抄进测试。
func _climb(p: CharacterBody2D, exit_x: float, exit_y: float, max_frames: int) -> int:
	var f: int = 0
	var hold: int = 0
	var dir: int = 1
	var stand_y: float = p.global_position.y
	var since: int = 0
	var flips: int = 0
	while _p_alive(p) and f < max_frames:
		Input.action_release("move_right")
		Input.action_release("move_left")
		if absf(exit_x - p.global_position.x) > 24.0:
			Input.action_press("move_right" if dir > 0 else "move_left")
		else:
			# 已经走到洞口正下方：不再横移（再走就是台外），只跳
			Input.action_press("move_right" if dir > 0 else "move_left")
		pass
		if p.is_on_floor() and hold == 0:
			hold = 8            # 按住 8 帧再松：按一帧就松跳不高
		if hold > 0:
			Input.action_press("jump")
			hold -= 1
			if hold == 0:
				Input.action_release("jump")
		# 井里是封闭的，自动抓边会把人在平台边粘住 —— 结构验证里关掉。
		p.set("_ledge_assist_used", true)
		await physics_frame
		f += 1
		if p.is_on_floor():
			if p.global_position.y < stand_y - 2.0:
				stand_y = p.global_position.y     # 上了一级
				since = 0
			elif p.global_position.y > stand_y + 40.0:
				stand_y = p.global_position.y     # 掉了一级
				since = 0
			else:
				since += 1
		if since > 60:
			# 1 秒没有新的落脚高度：这个方向没路，换一边
			dir = -dir
			flips += 1
			since = 0
		# 必须**落地**才算出去。只判高度会在半空中就退出（vy≈-500），
		# 人继续往上飘、再落回来时还在洞上方，又掉回井里 —— 实测就是这么复发的。
		if p.is_on_floor() and p.global_position.y <= exit_y + 10.0:
			break
	Input.action_release("move_right")
	Input.action_release("move_left")
	Input.action_release("jump")
	print("    支线爬升：%d 帧，换向 %d 次，终点 (%.0f, %.0f)（目标 y ≤ %.0f）" % [
		f, flips, p.global_position.x, p.global_position.y, exit_y + 10.0])
	return f

func _p_alive(p: CharacterBody2D) -> bool:
	var d: Variant = p.get("is_dead")
	return not (d != null and bool(d))

func _load_layout() -> Dictionary:
	var f: FileAccess = FileAccess.open(LAYOUT_PATH, FileAccess.READ)
	if f == null:
		return {}
	var txt: String = f.get_as_text()
	f.close()
	var parsed: Variant = JSON.parse_string(txt)
	return parsed if parsed is Dictionary else {}

func _load_blueprint() -> Array:
	var f: FileAccess = FileAccess.open(BP_PATH, FileAccess.READ)
	if f == null:
		return []
	var out: Array = []
	var body: bool = false
	while not f.eof_reached():
		var line: String = f.get_line()
		if not body:
			if line.strip_edges() == "---":
				body = true
			continue
		if line.strip_edges() != "":
			out.append(line)
	f.close()
	return out

func _quit() -> void:
	print("LEVEL GEN: %s" % ("PASS" if _fail == 0 else "FAIL"))
	print("errors: %d" % _fail)
	quit(1 if _fail > 0 else 0)
