extends SceneTree

## Hitbox → Hurtbox 命中契约测试：验证攻击判定能真实触发 take_damage 与 hitstop。
## 运行：godot --headless --path <项目根> --script res://tests/test_hitbox_contract.gd

var _errors: Array[String] = []

func _initialize() -> void:
	# 1. Hurtbox 血量逻辑
	var hurtbox_script: GDScript = load("res://core/components/Hurtbox.gd")
	var hb: Area2D = hurtbox_script.new()
	var hb_shape := CollisionShape2D.new()
	hb_shape.name = "CollisionShape2D"
	var rect := RectangleShape2D.new()
	rect.size = Vector2(40, 40)
	hb_shape.shape = rect
	hb.add_child(hb_shape)
	root.add_child(hb)
	await physics_frame
	_check(is_equal_approx(hb.get("current_health"), 30.0), "Hurtbox 初始血量应为 30")
	hb.call("take_damage", 10.0, Vector2(100.0, 0.0))
	_check(is_equal_approx(hb.get("current_health"), 20.0), "受击后血量应为 20")
	hb.set("is_invincible", true)
	hb.call("take_damage", 10.0, Vector2(100.0, 0.0))
	_check(is_equal_approx(hb.get("current_health"), 20.0), "无敌时不应扣血")
	hb.set("is_invincible", false)
	hb.call("take_damage", 30.0, Vector2(100.0, 0.0))
	_check(is_equal_approx(hb.get("current_health"), 0.0), "血量应扣至 0 不为负")
	hb.free()

	# 2. Hitbox 真实命中 Hurtbox
	var hitbox_script: GDScript = load("res://core/components/Hitbox.gd")
	var hitbox: Area2D = hitbox_script.new()
	var hb_shape2 := CollisionShape2D.new()
	hb_shape2.name = "CollisionShape2D"
	hb_shape2.shape = rect
	hitbox.add_child(hb_shape2)
	root.add_child(hitbox)
	await physics_frame

	var target: Area2D = hurtbox_script.new()
	var target_shape := CollisionShape2D.new()
	target_shape.name = "CollisionShape2D"
	target_shape.shape = rect
	target.add_child(target_shape)
	target.global_position = Vector2(10, 0)
	root.add_child(target)
	await physics_frame

	var before: float = float(target.get("current_health"))
	# activate 的计时器必须能在 free 前自然结束，否则残留 SceneTreeTimer 造成泄漏警告
	hitbox.call("activate", 0.1)
	for i: int in range(6):
		await physics_frame
	var after: float = float(target.get("current_health"))
	_check(after < before, "命中应扣血：before=%.1f after=%.1f" % [before, after])

	# 3. hitstop 后 time_scale 必须恢复
	# 用物理帧等待而非自建 SceneTreeTimer，避免退出时残留未释放的计时器对象
	for i: int in range(24):
		await physics_frame
	_check(is_equal_approx(Engine.time_scale, 1.0), "hitstop 后 time_scale 应恢复，实际 %.3f" % Engine.time_scale)

	hitbox.free()
	target.free()
	await physics_frame

	if _errors.is_empty():
		print("[PASS] Hitbox→Hurtbox 命中契约测试全部通过")
	else:
		printerr("[FAIL] 命中契约测试失败 %d 项:" % _errors.size())
		for e: String in _errors:
			printerr("  - " + e)
	quit(1 if not _errors.is_empty() else 0)

func _check(ok: bool, msg: String) -> void:
	if not ok:
		_errors.append(msg)
