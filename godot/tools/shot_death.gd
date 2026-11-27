extends SceneTree

## 血条/死亡实拍（不能加 --headless，headless 没有 viewport）。
##   ... --path godot --script res://tools/shot_death.gd -- Room01
##
## 连拍三张：满血 / 半血（低血心跳）/ 倒地定格。
## 产物：art/out/room/shot_hud_<mode>.png

const OUT_DIR := "res://art/out/room"

func _initialize() -> void:
	var args: PackedStringArray = OS.get_cmdline_user_args()
	var room_name: String = args[0] if args.size() > 0 else "Room01"
	var scene: Node = (load("res://world/rooms/%s.tscn" % room_name) as PackedScene).instantiate()
	root.add_child(scene)
	await process_frame

	var player: Node = scene.get_node_or_null("Player")
	if player == null:
		push_error("找不到 Player")
		quit(2)
		return

	for i: int in range(40):
		await process_frame
	await _shot("full")

	player.call("take_damage", float(player.get("max_hp")) * 0.62)
	for i: int in range(10):
		await process_frame
	await _shot("low")

	player.call("take_damage", 9999.0)
	for i: int in range(14):
		await process_frame
	await _shot("dead")

	quit(0)

func _shot(tag: String) -> void:
	await RenderingServer.frame_post_draw
	var img: Image = root.get_texture().get_image()
	if img == null:
		push_error("取图为空")
		return
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUT_DIR))
	var out := ProjectSettings.globalize_path("%s/shot_hud_%s.png" % [OUT_DIR, tag])
	print("saved %s (err=%d)" % [out, img.save_png(out)])
