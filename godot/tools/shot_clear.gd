extends SceneTree

## 清场后实拍：紫月褪色 + 门开 + 横幅。
## 用法：--script res://tools/shot_clear.gd [额外帧数]
const OUT := "res://art/out/room/shot_room01_clear.png"

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	await process_frame
	root.get_node("/root/WorldState").call("reset_state")
	var room: Node2D = (load("res://world/rooms/Room01.tscn") as PackedScene).instantiate()
	root.add_child(room)
	for i: int in range(20):
		await process_frame
	for c: Node in room.get_node("InvadersContainer").get_children():
		c.call("take_damage", 999.0, Vector2.ZERO)
	for i: int in range(90):   # 1.5s：净化 0.85 + 横幅淡入
		await process_frame
	await RenderingServer.frame_post_draw
	var img: Image = root.get_texture().get_image()
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://art/out/room"))
	var err: int = img.save_png(ProjectSettings.globalize_path(OUT))
	print("SHOT clear → %s (%d)" % [OUT, err])
	quit(0)
