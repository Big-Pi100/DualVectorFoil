extends SceneTree

## 主角行为 headless 测试：真实驱动 _physics_process，覆盖跑/跳/翻滚/攻击路径。
## 运行：godot --headless --path <项目根> --script res://tests/test_player_behavior.gd

var _player: CharacterBody2D
var _floor: StaticBody2D
var _errors: Array[String] = []

func _initialize() -> void:
	# 搭建最小测试场景：玩家 + 地板
	var packed: PackedScene = load("res://entities/player/Player.tscn")
	_player = packed.instantiate() as CharacterBody2D
	_player.global_position = Vector2(0, 20)
	root.add_child(_player)

	_floor = StaticBody2D.new()
	var floor_shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(2000, 40)
	floor_shape.shape = rect
	_floor.add_child(floor_shape)
	_floor.global_position = Vector2(0, 80)
	root.add_child(_floor)

	await _wait_frames(20)
	_check(_player.is_on_floor(), "角色应落在地板上，实际 y=%.1f" % _player.global_position.y)

	# 1. 移动
	Input.action_press("move_right")
	await _wait_frames(12)
	Input.action_release("move_right")
	_check(_player.velocity.x > 50.0, "按右键后应向右移动，实际 vx=%.1f" % _player.velocity.x)

	# 2. 跳跃（落地后按跳）
	await _wait_frames(30)
	Input.action_press("jump")
	await _wait_frames(2)
	Input.action_release("jump")
	_check(_player.velocity.y < 0.0, "跳跃后应有向上速度，实际 vy=%.1f" % _player.velocity.y)

	# 3. 折叠（二段跳）：**必须先解锁**——S2 之前这里能过只是因为二段跳默认打开，
	#    它其实从没被"锁"过。现在二段跳是能力，未解锁时按第二下不该有任何反应。
	#
	#    时机也很重要：原来是起跳后 8 帧（0.13s）就按，那时 vy 还在 -630 附近，
	#    "vy < -200" 这条断言**不按第二下也一样成立** —— 它测不出二段跳有没有发生。
	#    改成等接近顶点（单跳 917ms，顶点约 0.46s）再按，此时 vy 接近 0，
	#    二段一生效就会突变到 -697，两者才分得开。
	await _wait_frames(28)
	var vy_apex: float = _player.velocity.y
	Input.action_press("jump")
	await _wait_frames(2)
	Input.action_release("jump")
	_check(_player.velocity.y < -600.0 == false,
		"未解锁折叠时按第二下不应二段跳（顶点 vy=%.1f → 按后 vy=%.1f）"
		% [vy_apex, _player.velocity.y])

	# 3b. 落地后解锁，同一个动作必须真的生效 ——
	#     否则上面那条只证明"按键没反应"，证明不了"能力锁"。
	await _wait_frames(60)
	_check(_player.is_on_floor(), "解锁前应已落回地板，实际 y=%.1f" % _player.global_position.y)
	_world_state().call("unlock_ability", "fold")
	await _wait_frames(4)
	_check(_player.can_double_jump, "解锁折叠后落地应重新充能（can_double_jump=%s）"
		% str(_player.can_double_jump))

	Input.action_press("jump")
	await _wait_frames(2)
	Input.action_release("jump")
	await _wait_frames(28)
	var vy_apex2: float = _player.velocity.y
	Input.action_press("jump")
	await _wait_frames(2)
	Input.action_release("jump")
	_check(_player.velocity.y < -600.0,
		"解锁折叠后同一时机应能二段跳（顶点 vy=%.1f → 按后 vy=%.1f）"
		% [vy_apex2, _player.velocity.y])

	# 4. 攻击：检查攻击状态与判定框激活
	await _wait_frames(60)
	Input.action_press("attack")
	await _wait_frames(3)
	Input.action_release("attack")
	_check(_player.get("is_attacking") == true, "攻击后 is_attacking 应为 true")
	_check(_player.velocity.x > 0.0, "攻击前冲应产生水平速度，实际 vx=%.1f" % _player.velocity.x)
	var hitbox_node: Area2D = _player.get_node("Visuals/WeaponPivot/Hitbox")
	var shape: CollisionShape2D = hitbox_node.get_node("CollisionShape2D")
	await _wait_frames(2)
	_check(not shape.disabled, "攻击期间 Hitbox 应启用")

	# 5. 翻滚：攻击结束后按翻滚，检查无敌帧
	await _wait_frames(20)
	Input.action_press("roll")
	await _wait_frames(3)
	Input.action_release("roll")
	_check(_player.get("is_rolling") == true, "翻滚后 is_rolling 应为 true")
	_check(_player.get("is_invincible") == true, "翻滚中 is_invincible 应为 true")

	# 6. 全局时间恢复：确认 hitstop 未把 time_scale 卡住
	await _wait_frames(30)
	_check(is_equal_approx(Engine.time_scale, 1.0), "Engine.time_scale 应恢复为 1.0，实际 %.3f" % Engine.time_scale)

	if _errors.is_empty():
		print("[PASS] 主角行为测试全部通过（跑/跳/二段跳/攻击/翻滚/时间恢复）")
	else:
		printerr("[FAIL] 行为测试失败 %d 项:" % _errors.size())
		for e: String in _errors:
			printerr("  - " + e)
	quit(1 if not _errors.is_empty() else 0)

func _wait_frames(n: int) -> void:
	for i: int in range(n):
		await physics_frame

## `--script` 模式下 autoload 的全局名在**编译期**还没注册，
## 直接写 `WorldState.xxx` 会 Compile Error（Identifier not found）。
## 入口脚本只能走 /root 取节点；场景里的脚本不受影响。
func _world_state() -> Node:
	return root.get_node("/root/WorldState")

func _check(ok: bool, msg: String) -> void:
	if not ok:
		_errors.append(msg)
