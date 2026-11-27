extends SceneTree

func _initialize() -> void:
	var errors: Array[String] = []

	# 1. 输入映射检查
	for action: String in ["move_left", "move_right", "jump", "roll", "attack"]:
		if not InputMap.has_action(action):
			errors.append("InputMap 缺少动作: " + action)

	# 2. 场景加载与节点路径检查
	var packed: PackedScene = load("res://entities/player/Player.tscn")
	if packed == null:
		errors.append("Player.tscn 加载失败")
	else:
		var player: CharacterBody2D = packed.instantiate() as CharacterBody2D
		root.add_child(player)
		for path: String in [
			"Visuals",
			"Visuals/WeaponPivot/SwordRect",
			"Visuals/WeaponPivot/ShieldRect",
			"Visuals/WeaponPivot/Hitbox",
			"Visuals/WeaponPivot/Hitbox/CollisionShape2D",
			"CollisionShape2D",
			"LedgeCheckTop",
			"LedgeCheckBottom",
			"Camera2D",
		]:
			if player.get_node_or_null(path) == null:
				errors.append("节点路径缺失: " + path)
		var shape: CollisionShape2D = player.get_node("CollisionShape2D") as CollisionShape2D
		if shape == null or shape.shape == null:
			errors.append("角色碰撞体未配置 shape")
		var hb: Area2D = player.get_node("Visuals/WeaponPivot/Hitbox") as Area2D
		if hb == null or not hb.has_method("activate"):
			errors.append("Hitbox 脚本未挂载或 activate 缺失")
		# 判定/防御体必须位于朝向侧（局部 +X），不能在人物背后
		var shield: ColorRect = player.get_node("Visuals/WeaponPivot/ShieldRect") as ColorRect
		if shield != null and shield.offset_left <= 0.0:
			errors.append("格挡盾牌 ShieldRect 应位于身前（offset_left > 0），实际 %.1f" % shield.offset_left)
		var sword_shape: CollisionShape2D = player.get_node("Visuals/WeaponPivot/Hitbox/CollisionShape2D") as CollisionShape2D
		if sword_shape != null and sword_shape.position.x <= 0.0:
			errors.append("攻击判定 Hitbox 应位于身前（position.x > 0），实际 %.1f" % sword_shape.position.x)
		print("[OK] Player.tscn 节点树 + 脚本挂载验证完成")

	# 3. Hurtbox 脚本契约检查
	var hurtbox_script: GDScript = load("res://core/components/Hurtbox.gd") as GDScript
	if hurtbox_script == null or not hurtbox_script.can_instantiate():
		errors.append("Hurtbox.gd 无法实例化")
	else:
		var hb_node: Area2D = hurtbox_script.new() as Area2D
		if hb_node == null or not hb_node.has_method("take_damage"):
			errors.append("Hurtbox 缺少 take_damage 方法")
		hb_node.free()

	if errors.is_empty():
		print("[PASS] Phase 1 主角原型 headless 验证全部通过")
	else:
		printerr("[FAIL] 发现问题:")
		for e: String in errors:
			printerr("  - " + e)
	quit(1 if not errors.is_empty() else 0)
