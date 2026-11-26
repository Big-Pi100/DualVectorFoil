extends SceneTree

## E04 渲染能力探测：确认 headless 下能否渲染并保存截图。
## 运行：Godot_v4.4.1-stable_win64_console.exe --headless --path <项目根> --script res://tests/test_e04_render_capability.gd

func _initialize() -> void:
	call_deferred("_probe")

func _probe() -> void:
	print("[E04-PROBE] rendering driver: ", ProjectSettings.get_setting("rendering/renderer/rendering_method", "unknown"))
	var path := ProjectSettings.globalize_path("res://art/experiments/E04_GodotScale/assets/E02_player_0.png")
	var img_src: Image = Image.load_from_file(path)
	if img_src == null or img_src.is_empty():
		print("[E04-PROBE][FAIL] cannot load asset")
		quit(1)
		return
	var tex: Texture2D = ImageTexture.create_from_image(img_src)
	print("[E04-PROBE] asset loaded: ", tex.get_width(), "x", tex.get_height())

	var sprite := Sprite2D.new()
	sprite.texture = tex
	var sub := SubViewport.new()
	sub.size = Vector2i(256, 256)
	sub.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	sub.add_child(sprite)
	sprite.position = Vector2(128, 128)
	sprite.scale = Vector2(0.2, 0.2)
	root.add_child(sub)
	await process_frame
	await process_frame
	var img: Image = sub.get_texture().get_image()
	var px: Color = img.get_pixel(128, 128)
	print("[E04-PROBE] center pixel: ", px)
	var nonblank: int = 0
	for y in range(0, 256, 8):
		for x in range(0, 256, 8):
			if img.get_pixel(x, y).a > 0.01:
				nonblank += 1
	print("[E04-PROBE] nonblank sampled pixels: ", nonblank)
	var err: int = img.save_png("res://art/experiments/E04_GodotScale/probe_render.png")
	print("[E04-PROBE] save_png err=", err)
	quit(0 if nonblank > 0 and err == OK else 1)
