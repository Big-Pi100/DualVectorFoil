extends SceneTree

## 跳跃高度实测闸门：用真实物理帧跑，不接受"常量算出来的值"。
##
## 为什么必须有这套：`FEEL_TABLE.md` 写单跳 204px（4.25 格）× 滞空 917ms，
## 这是关卡平台间距的唯一依据（`04 §4` 的折叠门 4.5–6.5 格全靠它）。
## 而 2026-11-27 实测发现代码只有 91px —— 文档和代码差 2.2 倍，
## 房间自然只能是一条平路。以后每次动重力/起跳速度，这套必须红。
##
## 判据全部来自 FEEL_TABLE 的 aos 列 ±5% 区间：
##   跳跃高度 196~212 / 滞空 880~970ms / 二段增量 116~142px

const GATE_HEIGHT_MIN: float = 196.0
const GATE_HEIGHT_MAX: float = 212.0
const GATE_AIR_MIN: float = 880.0
const GATE_AIR_MAX: float = 970.0
const GATE_DOUBLE_MIN: float = 116.0
const GATE_DOUBLE_MAX: float = 142.0

var _fail: int = 0

func _initialize() -> void:
	await _run()

func _check(ok: bool, msg: String) -> void:
	if ok:
		print("  ok   %s" % msg)
	else:
		_fail += 1
		print("  FAIL %s" % msg)

func _build_stage() -> Array:
	var scene := Node2D.new()
	root.add_child(scene)

	var ground := StaticBody2D.new()
	ground.position = Vector2(640.0, 660.0)
	var col := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(2400.0, 40.0)   # 顶部 y = 640
	col.shape = rect
	ground.add_child(col)
	scene.add_child(ground)

	var player: CharacterBody2D = load("res://entities/player/Player.tscn").instantiate()
	player.position = Vector2(640.0, 400.0)
	scene.add_child(player)
	return [scene, player]

## 让角色掉到地面上并稳定若干帧
func _settle(player: CharacterBody2D) -> void:
	for i: int in range(180):
		await physics_frame
		if player.is_on_floor():
			for j: int in range(6):
				await physics_frame
			return

## 从当前站立点起跳，返回 {height, air_ms, apex_frames}
func _measure_jump(player: CharacterBody2D, use_double: bool) -> Dictionary:
	var start_y: float = player.global_position.y
	player.can_double_jump = false if not use_double else true
	player.velocity.y = player.jump_velocity

	var apex_y: float = start_y
	var apex_frames: int = 0
	var frames: int = 0
	var double_used: bool = false
	var after_double_start: float = 0.0
	var total_height: float = 0.0

	for i: int in range(400):
		await physics_frame
		frames += 1
		var y: float = player.global_position.y
		if y < apex_y:
			apex_y = y
			apex_frames = frames
		# 二段：在到达顶点后立刻补跳（最优时机的模型）
		if use_double and not double_used and player.velocity.y >= -20.0:
			double_used = true
			after_double_start = y
			player.can_double_jump = true
			player.velocity.y = player.double_jump_velocity
		if i > 8 and player.is_on_floor():
			break

	var single_height: float = start_y - apex_y
	total_height = start_y - apex_y
	if use_double:
		# apex_y 会在二段后继续更新，single_height 这里代表总高
		total_height = start_y - apex_y
	return {
		"height": total_height,
		"air_ms": float(frames) * 1000.0 / 60.0,
	}

func _run() -> void:
	print("--- 跳跃高度实测（真实物理帧，60Hz）---")

	var stage: Array = _build_stage()
	var player: CharacterBody2D = stage[1]
	await _settle(player)
	_check(player.is_on_floor(), "角色已落到地面")

	var single: Dictionary = await _measure_jump(player, false)
	var h: float = single["height"]
	var air: float = single["air_ms"]
	print("  实测单跳 = %.1f px（%.2f 格），滞空 %.0f ms" % [h, h / 48.0, air])
	_check(h >= GATE_HEIGHT_MIN and h <= GATE_HEIGHT_MAX,
		"单跳高度 %.1f 落在 %d~%d（FEEL_TABLE aos）" % [h, int(GATE_HEIGHT_MIN), int(GATE_HEIGHT_MAX)])
	_check(air >= GATE_AIR_MIN and air <= GATE_AIR_MAX,
		"滞空 %.0f ms 落在 %d~%d" % [air, int(GATE_AIR_MIN), int(GATE_AIR_MAX)])

	await _settle(player)
	var dbl: Dictionary = await _measure_jump(player, true)
	var total: float = dbl["height"]
	var inc: float = total - h
	print("  实测二段总高 = %.1f px，增量 %.1f px（%.2f 格）" % [total, inc, total / 48.0])
	_check(inc >= GATE_DOUBLE_MIN and inc <= GATE_DOUBLE_MAX,
		"二段增量 %.1f 落在 %d~%d" % [inc, int(GATE_DOUBLE_MIN), int(GATE_DOUBLE_MAX)])

	# 关卡设计要用整数格说话：把结论直接打出来，文档抄它
	print("  → 单跳 %.2f 格 / 二段总高 %.2f 格；平台间距安全值建议 ≤ %d 格（单跳）/ ≤ %d 格（二段）"
		% [h / 48.0, total / 48.0, int(floor((h - 24.0) / 48.0)), int(floor((total - 24.0) / 48.0))])

	print("JUMP GATE: %s" % ("PASS" if _fail == 0 else "FAIL"))
	print("errors: %d" % _fail)
	quit(1 if _fail > 0 else 0)
