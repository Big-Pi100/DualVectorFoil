extends SceneTree

## 敌人换装专项：3 种变体正式资产加载 + Hurtbox 契约 + 入侵清怪闭环。
## 用 await process_frame 让场景走真实帧（@onready / viewport / Hurtbox 血量就绪），
## 不用手动 trigger _ready 的 hack，避免 headless 假象。

var _fail: int = 0
var _root: Node = null

func _initialize() -> void:
	_root = Node.new()
	root.add_child(_root)
	await _test_variants()
	await _test_invader_scene_contract()
	await _test_battlefield_loop()
	_root.queue_free()
	print("ENEMY VISUAL GATE: %s" % ("PASS" if _fail == 0 else "FAIL"))
	print("errors: %d" % _fail)
	quit(1 if _fail > 0 else 0)

func _frames(count: int) -> void:
	for i: int in range(count):
		await process_frame

func _check(ok: bool, msg: String) -> void:
	if not ok:
		_fail += 1
		print("  FAIL %s" % msg)
	else:
		print("  ok   %s" % msg)

func _test_variants() -> void:
	print("--- 3 种敌人变体纹理 ---")
	var scene: PackedScene = load("res://world/enemies/Invader.tscn") as PackedScene
	_check(scene != null, "Invader.tscn 可加载")
	if scene == null:
		return
	var seen: Array = []
	for i: int in range(3):
		var inv: Node2D = scene.instantiate() as Node2D
		_root.add_child(inv)
		await _frames(1)
		var visual: Sprite2D = inv.get_node_or_null("Visual") as Sprite2D
		_check(visual != null, "变体%d Visual 是 Sprite2D" % i)
		if visual == null:
			continue
		visual.call("set_variant", i)
		var tex: Texture2D = visual.texture
		_check(tex != null, "变体%d 纹理非空" % i)
		if tex != null:
			_check(tex.get_width() == 128 and tex.get_height() == 128,
				"变体%d 标准帧 128x128（实际 %dx%d）" % [i, tex.get_width(), tex.get_height()])
			seen.append(tex.resource_path)
		inv.free()
	var unique: Dictionary = {}
	for p: String in seen:
		unique[p] = true
	_check(unique.size() == 3, "3 变体纹理互不相同（实际 %d）" % unique.size())

func _test_invader_scene_contract() -> void:
	print("--- Hurtbox 信号契约 ---")
	var scene: PackedScene = load("res://world/enemies/Invader.tscn") as PackedScene
	var inv: Node2D = scene.instantiate() as Node2D
	_root.add_child(inv)
	await _frames(1)
	_check(inv.has_signal("health_depleted"), "health_depleted 信号保留")
	_check(inv.has_method("take_damage"), "take_damage 接口保留")
	_check(inv.get_node_or_null("CollisionShape2D") != null, "碰撞体保留（40x50）")
	inv.free()

func _test_battlefield_loop() -> void:
	print("--- 入侵→清怪闭环回归 ---")
	var ws: Node = root.get_node_or_null("WorldState")
	_check(ws != null, "WorldState 自动加载存在")
	if ws == null:
		return
	ws.call("reset_state")
	var scene: PackedScene = load("res://world/rooms/Room01.tscn") as PackedScene
	var room: Node2D = scene.instantiate() as Node2D
	_root.add_child(room)
	await _frames(3) # 走真实帧：@onready 引用 + viewport + Hurtbox 血量就绪
	var invaders: Node2D = room.get_node("InvadersContainer") as Node2D
	ws.invaded_rooms.append("room_01")
	room.call("_setup_invasion_state")
	await _frames(1)
	_check(invaders.get_child_count() == 3, "入侵生成 3 只怪")
	var tex_ok: bool = true
	for child: Node in invaders.get_children():
		var vis: Sprite2D = child.get_node_or_null("Visual") as Sprite2D
		if vis == null or vis.texture == null:
			tex_ok = false
	_check(tex_ok, "3 只生成怪的贴图均已加载")
	for child in invaders.get_children():
		child.call("take_damage", 999.0, Vector2.ZERO)
	await _frames(3)
	_check(invaders.get_child_count() == 0, "清怪后容器归零（同步 remove_child）")
	_check(not ws.invaded_rooms.has("room_01"), "清空后自动净化房间")
	room.free()
