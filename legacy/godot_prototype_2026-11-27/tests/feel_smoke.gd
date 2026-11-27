extends SceneTree
## 手感冒烟测试 —— 无头跑，量出实际数值跟 web 原型的标定值对账。
##
##     godot --headless --path godot --script res://tests/feel_smoke.gd
##
## 对账基线（src/game.js aos 预设）：
##   满跳 203.8 px（按住到落地）、轻点约 48px（跳一格）、地面速度 270 px/s。
##   差别来自"松手切断"：CUT_V=400 把上升速度直接压到 400，所以按得越短跳得越矮。

var frames := 0
var player: CharacterBody2D
var y_ground := 0.0
var apex_full := 1e9
var apex_tap := 1e9
var x_at_231 := 0.0
var fail := 0


func _initialize() -> void:
	var scene: Node = load("res://scenes/main.tscn").instantiate()
	root.add_child(scene)
	player = scene.get_node("Player")
	print("[smoke] 场景已加载")


func _physics_process(delta: float) -> bool:
	frames += 1

	# ── 0-30：自由落体到地面 ──
	if frames == 30:
		y_ground = player.global_position.y
		print("[smoke] 落地 y=%.2f  on_floor=%s" % [y_ground, player.is_on_floor()])
		if not player.is_on_floor():
			print("[FAIL] 30 帧内没落到地面"); fail += 1
		if absf(y_ground - 420.0) > 2.0:
			print("[FAIL] 落点 %.2f 应为 420.0" % y_ground); fail += 1
		Input.action_press("jump")          # 满跳：按住不放

	# ── 30-160：满跳，记录最高点 ──
	if frames > 30 and frames < 160:
		apex_full = minf(apex_full, player.global_position.y)
	if frames == 160:
		Input.action_release("jump")
		var h := y_ground - apex_full
		print("[smoke] 满跳高度 = %.1f px（基线 203.8，容差 ±8）" % h)
		if absf(h - 203.8) > 8.0:
			print("[WARN] 偏离基线 %.1f px，需按 Godot 积分器重新标定 P_JUMP_V" % (h - 203.8))

	# ── 160-200：落回地面 ──
	if frames == 200:
		var back := absf(player.global_position.y - y_ground) < 2.0
		print("[smoke] 满跳后回落地: %s" % back)

	# ── 200-260：向右跑，量水平速度 ──
	if frames == 200:
		Input.action_press("move_right")
	if frames == 230:
		x_at_231 = player.global_position.x
	if frames == 260:
		Input.action_release("move_right")
		var spd := (player.global_position.x - x_at_231) / (30.0 / 120.0)
		print("[smoke] 水平速度 = %.1f px/s（基线 270，容差 ±20）" % spd)
		if absf(spd - 270.0) > 20.0:
			print("[FAIL] 水平速度偏离"); fail += 1

	# ── 290-310：松手后摩擦应归零 ──
	if frames == 310:
		print("[smoke] 松手 50 帧后 vx=%.1f（应为 0）" % player.velocity.x)
		if absf(player.velocity.x) > 0.5:
			print("[FAIL] 摩擦没把速度归零"); fail += 1

	# ── 320-420：轻点跳（按 4 帧），验证可变跳跃高度 ──
	if frames == 320:
		Input.action_press("jump")
	if frames == 324:
		Input.action_release("jump")
	if frames > 324 and frames < 420:
		apex_tap = minf(apex_tap, player.global_position.y)
	if frames == 420:
		print("[smoke] 轻点跳高度 = %.1f px（设计约 48 = 一格，容差 ±12）" % (y_ground - apex_tap))
		var tap_h := y_ground - apex_tap
		if tap_h > 80.0:
			print("[FAIL] 轻点跳太高，松手切断没生效"); fail += 1
		print("[smoke] 结果：%s" % ("PASS" if fail == 0 else "FAIL %d" % fail))
		return true

	return false
