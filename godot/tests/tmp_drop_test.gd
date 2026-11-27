extends SceneTree

## 临时诊断：玩家站在单向平台上，按 ↓ 到底能不能下穿。
## 战斗机器人卡在"平台上有敌人、敌人正下方"，怀疑 drop-through 没触发。

func _initialize() -> void:
	await _run()

func _run() -> void:
	var ps: PackedScene = load("res://world/rooms/Room01.tscn") as PackedScene
	var room: Node2D = ps.instantiate() as Node2D
	root.add_child(room)
	await process_frame
	# 清掉敌人，只测地形
	var cont: Node = room.get_node_or_null("InvadersContainer")
	if cont != null:
		for c: Node in cont.get_children():
			c.queue_free()
	await process_frame

	var p: CharacterBody2D = room.get_node_or_null("Player") as CharacterBody2D
	# 中台 A：c4..c13，顶面 y=480
	p.global_position = Vector2(400.0, 460.0)
	p.velocity = Vector2.ZERO
	for i: int in range(50):
		await physics_frame
	print("落地：y=%.1f on_floor=%s layer_mask=%d"
		% [p.global_position.y, str(p.is_on_floor()), p.collision_mask])
	print("  slide_collisions=%d  on_one_way=%s"
		% [p.get_slide_collision_count(), str(p.call("_is_standing_on_one_way_platform"))])
	for i: int in range(p.get_slide_collision_count()):
		var col: KinematicCollision2D = p.get_slide_collision(i)
		var cobj: Object = col.get_collider()
		print("    #%d normal=%s collider=%s layer=%s"
			% [i, str(col.get_normal()), cobj.get_class() if cobj != null else "null",
				str((cobj as CollisionObject2D).collision_layer) if cobj is CollisionObject2D else "-"])

	Input.action_press("move_down")
	for i: int in range(6):
		await physics_frame
		print("  f%d y=%.1f dropping=%s on_floor=%s"
			% [i, p.global_position.y, str(p.get("_is_dropping_through")), str(p.is_on_floor())])
	Input.action_release("move_down")

	for i: int in range(40):
		await physics_frame
	print("按 ↓ 之后：y=%.1f（480=还在台上，624=已落到地面）" % p.global_position.y)
	quit(0)
