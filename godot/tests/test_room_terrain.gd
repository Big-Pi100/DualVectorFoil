extends SceneTree

## 房间地形闸门：验"这是一间房，不是一条平路"。
##
## 背景（2026-11-27）：六间房实测全是"一个 1200×40 矩形 + 两扇同高的门"，
## 也就是一条从左到右的走廊。问题不是美术没做，是**地形从来没被设计过**。
## 所以这套测试守的不是"有没有地板"，而是**有没有空间**：
##
##   1. 结构：Terrain / Solids / Platforms / Doors 齐备
##   2. 分层：可站立面至少 3 个不同高度（一层平地的房间直接红）
##   3. 竖向：门不在同一高度（能证明"出门要爬"这种设计存在）
##   4. 落点：玩家出生后能落到地面上，且没掉出房间
##
## 未迁移到蓝图的房间（只有 Floor）会被跳过并打印，不判失败 ——
## 这样迁移一间就自动覆盖一间，不需要一次性全改。

const ROOM_DIR: String = "res://world/rooms"

var _fail: int = 0

func _initialize() -> void:
	await _run()

func _check(ok: bool, msg: String) -> void:
	if ok:
		print("  ok   %s" % msg)
	else:
		_fail += 1
		print("  FAIL %s" % msg)

func _frames(n: int) -> void:
	for i: int in range(n):
		await process_frame

func _room_scenes() -> Array[String]:
	var out: Array[String] = []
	var dir := DirAccess.open(ROOM_DIR)
	if dir == null:
		return out
	for f: String in dir.get_files():
		if f.begins_with("Room") and f.ends_with(".tscn"):
			out.append("%s/%s" % [ROOM_DIR, f])
	out.sort()
	return out

func _run() -> void:
	print("--- 房间地形结构 + 空间分层 ---")
	var scenes: Array[String] = _room_scenes()
	_check(scenes.size() > 0, "找到房间场景（%d 间）" % scenes.size())

	var migrated: int = 0
	for path: String in scenes:
		var ps: PackedScene = load(path) as PackedScene
		_check(ps != null, "%s 可加载" % path.get_file())
		if ps == null:
			continue
		var room: Node2D = ps.instantiate() as Node2D
		root.add_child(room)
		await _frames(2)
		var terrain: Node2D = room.get_node_or_null("Terrain") as Node2D
		if terrain == null:
			print("  --   %s 仍是旧 Floor 结构，跳过" % path.get_file())
			room.queue_free()
			await _frames(1)
			continue
		migrated += 1
		await _test_terrain(room, terrain, path.get_file())
		room.queue_free()
		await _frames(1)

	_check(migrated > 0, "至少有一间房已迁移到蓝图地形（实际 %d）" % migrated)
	print("ROOM TERRAIN GATE: %s" % ("PASS" if _fail == 0 else "FAIL"))
	print("errors: %d" % _fail)
	quit(1 if _fail > 0 else 0)

func _test_terrain(room: Node2D, terrain: Node2D, label: String) -> void:
	print("--- %s ---" % label)

	var solids: Node = terrain.get_node_or_null("Solids")
	var platforms: Node = terrain.get_node_or_null("Platforms")
	var art: Node = terrain.get_node_or_null("GroundArt")
	# 底色从 2026-11-27 起是**平铺的网格**（Backdrop0_0 / Backdrop1_0 …），
	# 不再是单个 Backdrop 节点：一盏径向光拉伸到 4800px 会变成一整片平灰。
	# 判据跟着改成"存在任意一块底板"，名字前缀不变。
	var backdrop: Node = terrain.get_node_or_null("Backdrop")
	if backdrop == null:
		for ch: Node in terrain.get_children():
			if str(ch.name).begins_with("Backdrop"):
				backdrop = ch
				break
	_check(solids != null and solids.get_child_count() > 0, "%s 有实心碰撞" % label)
	_check(platforms != null, "%s 有单向平台节点" % label)

	# 两种产物、两套要求 —— 但它们证的是**同一件事**：这间房有没有底。
	#
	# 贴图版：地表贴图 + 径向光底色。缺任何一样，空白处露的就是 viewport 的
	#         深灰，房间看起来像浮在虚空里。
	# 线框版（白哥 2026-11-27 要求「把所有贴图都去掉」）：当然不该有贴图，
	#         但**必须有 WireBackdrop 底板** —— 否则同样露 viewport 底色，
	#         只是从"浅灰虚空"变成"深灰虚空"，一样是没做完。
	# 所以不能简单把这两条删掉，要按模式各自成立。
	var wire: bool = room.get_node_or_null("WireOverlay") != null
	if wire:
		var wb: Node = terrain.get_node_or_null("WireBackdrop")
		_check(wb != null, "%s 线框版有底板（WireBackdrop）" % label)
		_check(art == null, "%s 线框版没有地表贴图（实际 %d 块）"
			% [label, art.get_child_count() if art != null else 0])
	else:
		_check(art != null and art.get_child_count() > 0, "%s 有地表贴图（%d 块）"
			% [label, art.get_child_count() if art != null else 0])
		_check(backdrop != null, "%s 有房间底色" % label)

	# 收集所有"可站立面"的高度：实心块顶边 + 平台顶边
	var heights: Dictionary = {}
	if solids != null:
		for c: Node in solids.get_children():
			if c is CollisionShape2D:
				var shape: Shape2D = (c as CollisionShape2D).shape
				if shape is RectangleShape2D:
					var top: float = (c as Node2D).global_position.y - (shape as RectangleShape2D).size.y * 0.5
					heights[int(round(top))] = true
	if platforms != null:
		for c: Node in platforms.get_children():
			if c is CollisionShape2D:
				var shape: Shape2D = (c as CollisionShape2D).shape
				if shape is RectangleShape2D:
					var top: float = (c as Node2D).global_position.y - (shape as RectangleShape2D).size.y * 0.5
					heights[int(round(top))] = true
	var hs: Array = heights.keys()
	hs.sort()
	# 一层平地的房间只会有"天花板顶 0 / 地面顶 624"两个高度，必然是 2。
	# 3 个以上才说明真的做了台阶或平台。
	_check(hs.size() >= 3, "%s 站立面有 %d 个不同高度（≥3 才算有层次）：%s" % [label, hs.size(), str(hs)])

	# 门：必须有。
	# 注意**不要**断言"两扇门必须不同高"—— 那是 Room02「出门要爬台」的个体设计，
	# 不是所有房间的规则。Room01 是教学房、Room03 是死巷，两门同高本来就对。
	# 真正证明"不是一条平路"的是上面的多高度站面。
	var doors: Node = room.get_node_or_null("Doors")
	_check(doors != null and doors.get_child_count() > 0, "%s 有门" % label)
	if doors != null:
		var door_ys: Array = []
		for d: Node in doors.get_children():
			if d is Area2D:
				door_ys.append(int(round((d as Node2D).global_position.y)))
		print("       门的 y：%s" % str(door_ys))

	# 出生点
	var spawn_ok: bool = room.get_node_or_null("SpawnFromLeft") != null or room.get_node_or_null("SpawnFromRight") != null
	_check(spawn_ok, "%s 有出生点" % label)

	# 敌人站位 + 摆件贴地。
	# 这一条防的是**坐标写死**：地形从"一条 600 的平线"变成多层之后，
	# 敌人原来统一生成在 (660+i*90, 568)，摆件全在 y=578 —— 全部悬空。
	# 判据用物理射线，不用数字比对：数字只能证明"我算的和我想的一样"，
	# 射线能证明"这东西在引擎里真的踩得到东西"。
	var markers: Array[Node] = []
	for child: Node in room.get_children():
		if child.name.begins_with("EnemySpawn"):
			markers.append(child)
	if markers.is_empty():
		print("  --   %s 蓝图没有标敌人点（安全屋允许；其他房间应当有）" % label)
	else:
		_check(int(room.get("invader_count")) == markers.size(),
			"%s invader_count(%d) 等于蓝图 E 的个数(%d)"
				% [label, int(room.get("invader_count")), markers.size()])
	for m: Node in markers:
		# 飞行敌人的 marker 就是它的悬停中心，本来就不该有地面在脚下 ——
		# 拿"离地 25px"去卡它，等于要求蝙蝠站在地上。类型从 marker 的 meta 读。
		var variant: int = int(m.get_meta("variant", 0)) if m.has_meta("variant") else 0
		if variant == 2:
			print("  ok   %s %s 是飞行敌人（不要求下方有地面，y=%.0f）"
				% [label, m.name, (m as Node2D).global_position.y])
			continue
		var mp: Vector2 = (m as Node2D).global_position
		var hit: Dictionary = _ground_below(room, mp, 80.0)
		_check(not hit.is_empty(), "%s %s 下方有地面（x=%.0f）" % [label, m.name, mp.x])
		if not hit.is_empty():
			var gap: float = float(hit["position"].y) - mp.y
			# 敌人半高 25px，gap 应当 = 25；放宽到 40 是留给以后改碰撞盒
			_check(gap <= 40.0, "%s %s 离地 %.0fpx（≤40 才算站得住）" % [label, m.name, gap])

	for child: Node in room.get_children():
		if not (child.name.begins_with("SoilPlot") or child.name.begins_with("VistaPoint")):
			continue
		var pp: Vector2 = (child as Node2D).global_position
		var ph: Dictionary = _ground_below(room, pp, 90.0)
		_check(not ph.is_empty(), "%s %s 下方有地面（x=%.0f）" % [label, child.name, pp.x])
		if not ph.is_empty():
			var pgap: float = float(ph["position"].y) - pp.y
			_check(pgap <= 60.0, "%s %s 离地 %.0fpx（≤60 才算贴地）" % [label, child.name, pgap])

	# 玩家落点：实例化后跑真实物理帧，必须落到地面且没掉出房间
	var player: CharacterBody2D = room.get_node_or_null("Player") as CharacterBody2D
	_check(player != null, "%s 有玩家" % label)
	if player != null:
		await _wait_physics(90)
		_check(player.is_on_floor(), "%s 玩家 90 帧内落到地面（当前 y=%.0f）" % [label, player.global_position.y])
		# 不能写死 760：那是一屏时代的房间高度。现在 Room01 有 1920 高，
		# 玩家站在地面 y=1776 是完全正常的，写死就会被判成"掉出房间"。
		var bounds: Rect2 = Rect2(0, 0, 1280, 720)
		if room.has_method("_derive_room_bounds"):
			bounds = room.call("_derive_room_bounds") as Rect2
		var inside: bool = player.global_position.y < bounds.position.y + bounds.size.y \
			and player.global_position.y > bounds.position.y
		_check(inside, "%s 玩家没掉出房间（y=%.0f，房间底 %.0f）"
			% [label, player.global_position.y, bounds.position.y + bounds.size.y])

	# 单向平台必须能"从下面跳穿"。
	# 这是最容易静默失效的一条：collision_layer 写错（平台在层 1）或
	# one_way_collision 没开，玩家会被平台从下方顶头，而场景看起来完全正常。
	if player != null and platforms != null and platforms.get_child_count() > 0:
		# 取**最低**的那块平台（y 最大）。原来取 child(0)，而合并顺序是从上往下，
		# child(0) 是 r10 那块 —— 它下面 192px 已经是走廊地板里面了，
		# 玩家会被塞进实心，测出来是"跳不穿"，其实是站错了地方。
		var p0: Node = null
		for c: Node in platforms.get_children():
			if c is CollisionShape2D:
				if p0 == null or (c as Node2D).global_position.y > (p0 as Node2D).global_position.y:
					p0 = c
		if p0 is CollisionShape2D:
			var sh: Shape2D = (p0 as CollisionShape2D).shape
			if sh is RectangleShape2D:
				var ptop: float = (p0 as Node2D).global_position.y - (sh as RectangleShape2D).size.y * 0.5
				var cx: float = (p0 as Node2D).global_position.x
				player.global_position = Vector2(cx, ptop + 192.0)
				player.velocity = Vector2.ZERO
				await _wait_physics(6)
				player.velocity.y = player.jump_velocity
				await _wait_physics(42)
				_check(player.global_position.y <= ptop + 10.0,
					"%s 能从下方跳穿单向平台（脚 y=%.0f，台面 y=%.0f）"
						% [label, player.global_position.y, ptop])

func _wait_physics(n: int) -> void:
	for i: int in range(n):
		await physics_frame


## 从 from 向下打一条射线，返回命中结果（空字典 = 悬空）。
## mask 3 = 层1（实心）+ 层2（单向平台）—— 站在单向平台上也算站得住。
func _ground_below(room: Node2D, from: Vector2, dist: float) -> Dictionary:
	var space: PhysicsDirectSpaceState2D = room.get_world_2d().direct_space_state
	if space == null:
		return {}
	var q := PhysicsRayQueryParameters2D.create(from, from + Vector2(0.0, dist), 3)
	q.collide_with_areas = false
	return space.intersect_ray(q)
