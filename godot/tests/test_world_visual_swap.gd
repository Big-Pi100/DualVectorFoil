extends SceneTree

## 地形/道具换装专项：房间草皮装饰 + 花坛土壤 + 长椅凳体贴图接入，
## 且保留所有脚本接口（PlantVisual 仍是 ColorRect、碰撞体/信号不变）。

var _fail: int = 0

func _initialize() -> void:
	await _test_rooms()
	await _test_plot()
	await _test_bench()
	print("WORLD VISUAL GATE: %s" % ("PASS" if _fail == 0 else "FAIL"))
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

func _load_tex(path: String) -> Texture2D:
	return load(path) as Texture2D

func _test_rooms() -> void:
	print("--- 三房间地板草皮装饰 ---")
	var grass: Texture2D = _load_tex("res://art/approved/Terrain/terrain_grass_decor.png")
	_check(grass != null, "草皮装饰纹理加载")
	var scenes: Array[String] = [
		"res://world/rooms/Room01.tscn",
		"res://world/rooms/Room02.tscn",
		"res://world/rooms/SafeHouse.tscn",
	]
	for p: String in scenes:
		var ps: PackedScene = load(p) as PackedScene
		_check(ps != null, "%s 可加载" % p.get_file())
		if ps == null:
			continue
		var room: Node2D = ps.instantiate() as Node2D
		root.add_child(room)
		await _frames(2)
		var floor: Node2D = room.get_node_or_null("Floor") as Node2D
		_check(floor != null and floor.get_node_or_null("CollisionShape2D") != null,
			"%s 地板碰撞体保留" % p.get_file())
		var visual: ColorRect = floor.get_node_or_null("Visual") as ColorRect
		_check(visual != null, "%s 地板底色 ColorRect 保留" % p.get_file())
		var decor_count: int = 0
		var tex_ok: bool = true
		for child: Node in floor.get_children():
			if child is Sprite2D and child.name.begins_with("GrassDecor"):
				decor_count += 1
				if (child as Sprite2D).texture == null:
					tex_ok = false
		_check(decor_count == 4, "%s 草皮装饰 4 块（实际 %d）" % [p.get_file(), decor_count])
		_check(tex_ok, "%s 草皮装饰纹理均非空" % p.get_file())
		room.free()
		await _frames(1)

func _test_plot() -> void:
	print("--- 花坛土壤换装 + 生长接口保留 ---")
	var ps: PackedScene = load("res://world/interactables/SoilPlot.tscn") as PackedScene
	var plot: Node2D = ps.instantiate() as Node2D
	root.add_child(plot)
	await _frames(2)
	var soil: Sprite2D = plot.get_node_or_null("SoilRect") as Sprite2D
	_check(soil != null and soil.texture != null, "土壤换 Sprite2D 且纹理加载")
	var plant: ColorRect = plot.get_node_or_null("PlantVisual") as ColorRect
	_check(plant != null, "PlantVisual 仍是 ColorRect（SoilPlot.gd 生长接口）")
	# 生长阶段接口：模拟 stage 1/2/3，确认 size/position/color 可写
	plant.size = Vector2(12, 12)
	plant.position = Vector2(-6, -18)
	plant.color = Color.LIME_GREEN
	_check(plant.size == Vector2(12, 12) and plant.color == Color.LIME_GREEN,
		"生长阶段 size/position/color 接口可用")
	_check(plot.get_node_or_null("CollisionShape2D") != null, "花坛碰撞体保留")
	plot.free()

func _test_bench() -> void:
	print("--- 长椅凳体换装 ---")
	var ps: PackedScene = load("res://world/interactables/RestBench.tscn") as PackedScene
	var bench: Node2D = ps.instantiate() as Node2D
	root.add_child(bench)
	await _frames(2)
	var body: Sprite2D = bench.get_node_or_null("BenchVisual") as Sprite2D
	_check(body != null and body.texture != null, "凳体换 Sprite2D 且纹理加载")
	var cushion: ColorRect = bench.get_node_or_null("CushionVisual") as ColorRect
	_check(cushion != null, "粉色坐垫识别色保留")
	_check(bench.has_signal("rested"), "rested 信号保留")
	_check(bench.get_node_or_null("CollisionShape2D") != null, "长椅碰撞体保留")
	bench.free()
