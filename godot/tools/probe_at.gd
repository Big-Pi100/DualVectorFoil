extends SceneTree

## 一次性诊断：`at=` 玩家视角截图为什么只有背板色。
##
## 判据不是"看起来黑"，而是把「相机在哪、相机周围有没有几何、几何节点是否 visible」
## 三个事实分别打出来。任何一个为假，就是根因所在。
##
## 用法：
##   ... --headless --path godot --script res://tools/probe_at.gd -- 7100 4656

const SCENE := "res://world/level/Level01.tscn"

func _initialize() -> void:
	var args: PackedStringArray = OS.get_cmdline_user_args()
	print("ARGS: ", args)
	var tx: float = float(args[0]) if args.size() > 0 else 7100.0
	var ty: float = float(args[1]) if args.size() > 1 else 4656.0

	var ps: PackedScene = load(SCENE) as PackedScene
	if ps == null:
		print("加载失败")
		quit(2)
		return
	var scene: Node = ps.instantiate()
	root.add_child(scene)
	await process_frame
	await physics_frame

	var p: Node2D = scene.get_node_or_null("Player") as Node2D
	if p == null:
		print("没有 Player")
		quit(2)
		return
	print("玩家出生: ", p.global_position)
	p.global_position = Vector2(tx, ty)
	await process_frame
	await physics_frame
	for i: int in range(60):
		await physics_frame
	print("传送后 60 帧: ", p.global_position, "  on_floor=", p.is_on_floor())

	var cam: Camera2D = p.get_node_or_null("Camera2D") as Camera2D
	if cam == null:
		print("玩家身上没有 Camera2D")
		quit(2)
		return
	print("cam.global=", cam.global_position, " offset=", cam.offset,
		" zoom=", cam.zoom, " current=", cam.is_current(),
		" smoothing=", cam.position_smoothing_enabled)
	print("cam.limit L/T/R/B = ", cam.limit_left, "/", cam.limit_top,
		"/", cam.limit_right, "/", cam.limit_bottom)
	var center: Vector2 = cam.get_screen_center_position()
	print("屏幕中心（世界）= ", center)
	print("canvas_transform = ", root.get_canvas_transform())

	var terrain: Node2D = scene.get_node_or_null("Terrain") as Node2D
	print("Terrain visible=", terrain.visible, " z=", terrain.z_index,
		" global=", terrain.global_position, " scale=", terrain.scale)
	var blocks: Node = scene.get_node_or_null("Terrain/Blocks")
	var l2d: int = 0
	var vis: int = 0
	var near: int = 0
	var nearest: float = 1e20
	var nearest_name: String = ""
	for c: Node in blocks.get_children():
		if not (c is Line2D):
			continue
		l2d += 1
		var l: Line2D = c as Line2D
		if not l.visible:
			continue
		vis += 1
		for pt: Vector2 in l.points:
			var w: Vector2 = l.to_global(pt)
			var d: float = w.distance_to(center)
			if d < nearest:
				nearest = d
				nearest_name = "%s%s" % [l.name, str(w)]
			if absf(w.x - center.x) < 700.0 and absf(w.y - center.y) < 420.0:
				near += 1
				break
	print("Blocks 下 Line2D: %d 条，visible %d 条，落在屏幕范围内的 %d 条" % [l2d, vis, near])
	print("离相机最近的顶点: %s  距离 %.0f px" % [nearest_name, nearest])

	var pv: Node = scene.get_node_or_null("Terrain/PlatformVisuals")
	if pv != null:
		print("PlatformVisuals 子节点 %d 个，visible=%s" % [pv.get_child_count(), pv.visible])

	# 世界尺寸：背板只画到哪儿
	var bd: Node = scene.get_node_or_null("Terrain/WireBackdrop")
	if bd is ColorRect:
		var cr: ColorRect = bd as ColorRect
		print("WireBackdrop rect = ", cr.position, " size=", cr.size, " color=", cr.color)
	quit(0)
