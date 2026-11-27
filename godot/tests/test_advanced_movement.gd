extends SceneTree

## 升级版手感 headless 测试：逐条覆盖《重生细胞》复刻动作。
## 运行：godot --headless --path <项目根> --script res://tests/test_advanced_movement.gd

# 不用 class_name 静态注解：--script 模式下 Autoload 全局名晚于类型解析，
# 会在编译测试脚本时连带编译 Player/TouchHUD 并误报 WorldState 未定义。
var _player
var _hud
var _floor: StaticBody2D
var _oneway: StaticBody2D
var _errors: Array[String] = []
var _skill_slots: Array[int] = []
var _respawns: int = 0
var _interacts: int = 0

func _initialize() -> void:
	# Autoload 全局标识符在 _initialize 之后才注册，推迟一帧再加载含 WorldState 引用的场景
	call_deferred("_setup")

func _setup() -> void:
	var packed: PackedScene = load("res://entities/player/Player.tscn")
	_player = packed.instantiate()
	_player.global_position = Vector2(0, 570) # 贴近地板，减少测试等待帧
	root.add_child(_player)

	_floor = StaticBody2D.new()
	var fs := CollisionShape2D.new()
	fs.name = "CollisionShape2D"
	var frect := RectangleShape2D.new()
	frect.size = Vector2(2000, 40)
	fs.shape = frect
	_floor.add_child(fs)
	_floor.global_position = Vector2(0, 620)
	root.add_child(_floor)

	# 单向平台在 y=500，组别 one_way_platform
	_oneway = StaticBody2D.new()
	_oneway.add_to_group("one_way_platform")
	_oneway.collision_layer = 2 # 与 Player.one_way_platform_layer 一致
	_oneway.collision_mask = 0
	var os := CollisionShape2D.new()
	os.name = "CollisionShape2D"
	var orect := RectangleShape2D.new()
	orect.size = Vector2(300, 40) # 加厚到 40px，验证层屏蔽不依赖厚度
	os.shape = orect
	os.one_way_collision = true
	_oneway.add_child(os)
	_oneway.global_position = Vector2(600, 500)
	root.add_child(_oneway)

	var hud_packed: PackedScene = load("res://ui/TouchHUD.tscn")
	_hud = hud_packed.instantiate()
	root.add_child(_hud)
	_hud.bind_player(_player)

	_player.skill_triggered.connect(func(slot: int) -> void: _skill_slots.append(slot))
	_player.respawn_requested.connect(func() -> void: _respawns += 1)
	_player.interact_requested.connect(func() -> void: _interacts += 1)

	await _frames(20)
	_check(_player.is_on_floor(), "角色应落在普通地板上")

	# ===== 1. 普通地板「下+跳」不应掉出地图（修复 #1）=====
	# 判据：只下推、不跳 → 应保持在地面；下+跳 → 应是向上跳（vy<0），而非下沉穿透。
	_player.virtual_move_vector = Vector2(0, 1) # 仅下推
	await _frames(3)
	_player.virtual_move_vector = Vector2.ZERO
	_check(_player.is_on_floor(), "普通地板仅下推不应下穿")
	_player.virtual_move_vector = Vector2(0, 1)
	_player.request_jump()
	await _frames(2)
	_player.virtual_move_vector = Vector2.ZERO
	_check(_player.velocity.y < 0.0, "普通地板下+跳应变成普通跳跃（vy<0），实际 vy=%.1f" % _player.velocity.y)

	# ===== 2. 单向平台下穿 =====
	await _frames(60)
	_player.global_position = Vector2(600, 470) # 站在单向平台上方
	_player.velocity = Vector2.ZERO
	await _frames(12)
	_check(_player.is_on_floor(), "角色应站在单向平台上")
	_player.virtual_move_vector = Vector2(0, 1)
	_player.request_jump()
	await _frames(3)
	_player.virtual_move_vector = Vector2.ZERO
	_check(not _player.is_on_floor(), "单向平台下+跳应离开平台")
	# 等下穿窗口（0.22s ≈ 13 帧）+ 落体时间，40px 厚平台需完整穿过
	await _frames(28)
	_check(_player.global_position.y > 520.0, "下穿后应落到 40px 厚平台下方（y>520），实际 y=%.1f" % _player.global_position.y)

	# ===== 3. 空中下砸 =====
	await _frames(50)
	_player.global_position = Vector2(0, 200)
	_player.velocity = Vector2.ZERO
	await _frames(2)
	_player.virtual_move_vector = Vector2(0, 1)
	_player.request_jump()
	await _frames(2)
	_player.virtual_move_vector = Vector2.ZERO
	_check(_player.is_diving, "空中下+跳应触发下砸")
	_check(_player.is_invincible, "下砸期间应无敌")
	await _frames(40)
	_check(not _player.is_diving, "落地后下砸应结束")

	# ===== 4. 攻击前冲（修复 #2）=====
	await _frames(20)
	_player.virtual_primary_held = true
	await _frames(2)
	_check(_player.velocity.x > 100.0, "攻击前冲应产生水平速度，vx=%.1f" % _player.velocity.x)
	_player.virtual_primary_held = false
	await _frames(20)

	# ===== 5. 翻滚打断攻击后摇 =====
	_player.virtual_primary_held = true
	await _frames(2)
	_check(_player.is_attacking, "攻击应开始")
	_player.request_roll()
	await _frames(2)
	_check(_player.is_rolling, "翻滚应打断攻击后摇")
	_check(not _player.is_attacking, "翻滚后攻击状态应立即结束")
	_player.virtual_primary_held = false
	await _frames(25)

	# ===== 5b. 方向相关翻滚：按输入方向，无输入才沿朝向 =====
	await _frames(10) # 确保上一段翻滚的 cooldown 已结束
	_player.set("facing_dir", 1.0) # 先朝右
	_player.virtual_move_vector = Vector2(-1, 0) # 同时按左 → 应向左后撤翻滚
	_player.request_roll()
	await _frames(2)
	_check(_player.is_rolling, "方向翻滚应触发")
	_check(_player.get("facing_dir") == -1.0, "翻滚应同步转向为输入方向（左）")
	_check(_player.velocity.x < -100.0, "翻滚应朝输入方向（左），vx=%.1f" % _player.velocity.x)
	_player.virtual_move_vector = Vector2.ZERO
	await _frames(30) # 等翻滚 + cooldown 结束

	_player.set("facing_dir", 1.0)
	_player.request_roll() # 无方向输入
	await _frames(2)
	_check(_player.velocity.x > 100.0, "无输入时翻滚应沿当前朝向（右），vx=%.1f" % _player.velocity.x)
	await _frames(30)

	# ===== 6. 格挡 cooldown（修复 #3）=====
	# 判据：格挡中立刻再请求，不应重置持续时间 —— 若被重启，总时长会明显超过 parry_duration。
	_player.request_parry()
	_check(_player.is_parrying, "首次格挡应成功")
	await _frames(8) # 消耗掉 parry_duration 的一部分
	_player.request_parry() # 若此处被错误重启，下面 13 帧后仍会 is_parrying
	await _frames(13) # 距首次请求约 21 帧 ≈ 0.35s，已超过 parry_duration=0.28s
	_check(not _player.is_parrying, "重复格挡应被 cooldown 拦截，不应重启计时")
	await _frames(30)
	_check(not _player.is_parrying, "格挡应按时结束")

	# ===== 6b. 格挡方向判定：盾牌在身前，只挡身前攻击 =====
	_player.set("facing_dir", 1.0) # 固定朝右，确保方向判据稳定
	_player.request_parry()
	_check(_player.is_parrying, "方向测试：格挡应生效")
	var hp_parry: float = float(_player.get("hp"))
	# knockback.x < 0 → 攻击来自右侧（朝右时的身前）→ 应挡住
	_player.take_damage(12.0, Vector2(-120.0, 0.0))
	_check(is_equal_approx(_player.get("hp"), hp_parry), "身前攻击应被格挡，不扣血")
	# knockback.x > 0 → 攻击来自左侧（背后）→ 应突破格挡
	_player.take_damage(12.0, Vector2(120.0, 0.0))
	_check(is_equal_approx(_player.get("hp"), hp_parry - 12.0), "背后攻击应突破格挡，扣血")
	await _frames(22)
	_check(not _player.is_parrying, "方向测试后格挡应结束")

	# ===== 7. 技能 / 血瓶 / 互动信号 =====
	var hp_before: float = float(_player.get("hp"))
	_player.take_damage(30.0)
	_check(is_equal_approx(_player.get("hp"), hp_before - 30.0), "受伤应扣血")
	_player.use_flask()
	_check(_player.get("hp") > hp_before - 30.0, "血瓶应回血")
	_player.trigger_skill(1)
	_player.trigger_skill(2)
	_player.request_interact()
	_check(_skill_slots == [1, 2], "技能槽信号应为 [1,2]，实际 %s" % [str(_skill_slots)])
	_check(_interacts == 1, "互动信号应触发一次，实际 %d" % _interacts)

	# ===== 8. 零惩罚失败（S1：死亡有 0.7s 倒地演出，respawn 因此是延时的）=====
	_player.take_damage(999.0)
	_check(is_equal_approx(float(_player.get("hp")), 0.0),
		"死亡瞬间血量归零且不被同一帧回满，实际 %.0f" % float(_player.get("hp")))
	_check(bool(_player.get("is_dead")), "死亡瞬间进入死亡态")
	_check(_respawns == 0, "倒地演出期间尚未请求复活，实际 %d" % _respawns)
	var respawn_waited: bool = false
	for i: int in range(180):
		if _respawns > 0:
			respawn_waited = true
			break
		await _frames(1)
	_check(respawn_waited, "倒地演出结束后触发一次 respawn_requested，实际 %d" % _respawns)
	_player.call("revive")
	_check(not bool(_player.get("is_dead")), "复活后退出死亡态")
	_check(is_equal_approx(_player.get("hp"), _player.max_hp), "复活后回满血")

	# ===== 9. TouchHUD 输入注入 =====
	_player.virtual_move_vector = Vector2(1, 0)
	await _frames(8)
	_check(_player.velocity.x > 50.0, "HUD 虚拟摇杆应驱动移动，vx=%.1f" % _player.velocity.x)
	_player.virtual_move_vector = Vector2.ZERO

	if _errors.is_empty():
		print("[PASS] 升级版手感测试全部通过（下穿/下砸/前冲/打断/格挡/信号/HUD）")
	else:
		printerr("[FAIL] 升级版手感测试失败 %d 项:" % _errors.size())
		for e: String in _errors:
			printerr("  - " + e)
	quit(1 if not _errors.is_empty() else 0)

func _frames(n: int) -> void:
	for i: int in range(n):
		await physics_frame

func _check(ok: bool, msg: String) -> void:
	if not ok:
		_errors.append(msg)
