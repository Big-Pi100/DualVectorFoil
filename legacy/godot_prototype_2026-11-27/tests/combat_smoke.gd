extends SceneTree
## 战斗组件 + 存档 冒烟测试
##
##     godot --headless --path godot --script res://tests/combat_smoke.gd
##
## 验四件事：
##   1. 一次挥砍只结算一次伤害（同一次激活不会每帧重复打）
##   2. 击退方向按目标相对位置取号，不是写死的
##   3. 命中后**只有被打的那个实体**被顿帧，且不会泄漏成永久冻结
##   4. WorldState 存档往返不丢字段，同一房间来回走不涨步数

var frames := 0
var fail := 0
var hits: Array[Dictionary] = []

var dummy: Node2D
var hurt: Hurtbox
var atk: Hitbox


func _initialize() -> void:
	# ── 被打的一方：dummy 身上挂 Hurtbox ──
	dummy = Node2D.new()
	dummy.name = "Dummy"
	dummy.position = Vector2(270, 300)
	root.add_child(dummy)

	hurt = Hurtbox.new()
	hurt.name = "Hurtbox"
	var hs := CollisionShape2D.new()
	var hshape := RectangleShape2D.new()
	hshape.size = Vector2(40, 40)
	hs.shape = hshape
	hurt.add_child(hs)
	hurt.collision_layer = 1 << 3
	hurt.collision_mask = 0
	dummy.add_child(hurt)
	hurt.hurt.connect(_on_hurt)

	# ── 打人的一方：独立放，靠重叠检测 ──
	atk = Hitbox.new()
	atk.name = "Hitbox"
	var cs_atk := CollisionShape2D.new()
	var ashape := RectangleShape2D.new()
	ashape.size = Vector2(60, 60)
	cs_atk.shape = ashape
	atk.add_child(cs_atk)
	atk.collision_layer = 1 << 4
	atk.collision_mask = 1 << 3
	atk.position = Vector2(300, 300)
	atk.damage = 12.0
	root.add_child(atk)

	print("[combat] 就绪：dummy x=270，hitbox x=300（重叠 30 < 50）")
	_test_world_state()


func _on_hurt(amount: float, kb: Vector2, from: Vector2) -> void:
	hits.append({"amount": amount, "kb": kb, "from": from})
	# 顿帧必须在回调里查 —— 45ms 后早就过期了
	if not Hitstop.frozen(dummy):
		print("[FAIL] 命中后目标没有被顿帧")
		fail += 1
	if Hitstop.frozen(atk):
		print("[FAIL] 攻击方也被顿帧了（应该是局部的）")
		fail += 1


func _physics_process(_delta: float) -> bool:
	frames += 1

	# 等两帧让 Area2D 建立重叠关系
	if frames == 5:
		atk.direction = 1.0
		atk.activate()
		print("[combat] 第一次挥砍 activate(0.12s)")

	if frames == 40:
		_check("一次挥砍只结算一次", hits.size(), 1)
		if hits.size() == 1:
			var kb: Vector2 = hits[0]["kb"]
			_check("伤害值透传", int(hits[0]["amount"]), 12)
			if kb.x >= 0.0:
				print("[FAIL] 目标在左侧，击退 x 应为负，实际 %.1f" % kb.x); fail += 1
			else:
				print("[combat] 击退 = (%.1f, %.1f) 方向正确" % [kb.x, kb.y])
		# 顿帧过期后必须解冻，不能永久冻住
		if Hitstop.frozen(dummy):
			print("[FAIL] 顿帧没过期，dummy 被永久冻结"); fail += 1
		else:
			print("[combat] 顿帧已过期，dummy 恢复")

	if frames == 45:
		# 反向：把 dummy 挪到右侧，击退应变成正
		dummy.position = Vector2(330, 300)
		print("[combat] dummy 移到右侧 x=330，第二次挥砍")

	if frames == 50:
		atk.activate()

	if frames == 85:
		_check("第二次挥砍可再命中", hits.size(), 2)
		if hits.size() == 2 and float(hits[1]["kb"].x) <= 0.0:
			print("[FAIL] 目标在右侧，击退 x 应为正，实际 %.1f" % hits[1]["kb"].x); fail += 1

	if frames == 90:
		hurt.enabled = false
		print("[combat] 关掉 Hurtbox.enabled，第三次挥砍")

	if frames == 95:
		atk.activate()

	if frames == 130:
		_check("Hurtbox 关闭后不再转发", hits.size(), 2)
		print("[combat] 结果：%s" % ("PASS" if fail == 0 else "FAIL %d" % fail))
		return true

	return false


func _check(label: String, got: int, want: int) -> void:
	if got != want:
		print("[FAIL] %s：期望 %d，实际 %d" % [label, want, got])
		fail += 1
	else:
		print("[combat] %s = %d ✓" % [label, got])


func _test_world_state() -> void:
	var ws: Node = load("res://core/world_state.gd").new()
	root.add_child(ws)

	ws.travel_to("hall")
	ws.travel_to("hall")        # 同一房间来回不算一步
	ws.travel_to("tower")
	_check("房间切换步数（同房间不计）", ws.steps, 2)
	_check("已访问房间去重", ws.visited.size(), 2)

	ws.set_flag("met_bird", true)
	ws.unlock("double_jump")
	if not ws.has_flag("met_bird") or not ws.has_ability("double_jump"):
		print("[FAIL] flag / ability 读写不一致"); fail += 1

	var path := "user://_test_save.json"
	if not ws.save_game(path):
		print("[FAIL] 存档写入失败"); fail += 1
		return

	var ws2: Node = load("res://core/world_state.gd").new()
	root.add_child(ws2)
	if not ws2.load_game(path):
		print("[FAIL] 存档读取失败"); fail += 1
	else:
		_check("存档往返 steps", ws2.steps, 2)
		_check("存档往返 visited", ws2.visited.size(), 2)
		if ws2.current_room != "tower":
			print("[FAIL] current_room 丢了：%s" % ws2.current_room); fail += 1
		if not ws2.has_flag("met_bird") or not ws2.has_ability("double_jump"):
			print("[FAIL] flags/unlocked 往返丢失"); fail += 1
		else:
			print("[worldstate] 存档往返字段完整 ✓")

	# 坏档必须被拒绝，不能静默当新游戏
	var bad := FileAccess.open(path, FileAccess.WRITE)
	bad.store_string("{ this is not json")
	bad.close()
	var ws3: Node = load("res://core/world_state.gd").new()
	root.add_child(ws3)
	if ws3.load_game(path):
		print("[FAIL] 坏档居然读取成功了"); fail += 1
	else:
		print("[worldstate] 坏档被拒绝 ✓")

	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
