extends SceneTree
func _initialize() -> void:
	call_deferred("_go")
func _go() -> void:
	var room: Node = (load("res://world/rooms/Room01.tscn") as PackedScene).instantiate()
	root.add_child(room)
	for i in range(8):
		await process_frame
	room.call("_setup_invasion_state")
	for i in range(6):
		await process_frame
	for c: Node in room.get_children():
		var n2: Node2D = c as Node2D
		var pos: String = str(n2.global_position) if n2 != null else "-"
		print("%-22s %-18s %s" % [c.name, c.get_class(), pos])
		# 列出子树里的 Sprite
		var stack: Array[Node] = [c]
		while not stack.is_empty():
			var n: Node = stack.pop_back()
			if n is Sprite2D or n is AnimatedSprite2D:
				print("      sprite: %s visible=%s" % [n.get_path(), str((n as CanvasItem).visible)])
			stack.append_array(n.get_children())
	quit(0)
