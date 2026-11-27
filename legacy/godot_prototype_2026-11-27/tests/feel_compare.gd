extends SceneTree
## 两套预设的实测对照 —— 同一套测量动作，分别跑 aos 与 crayon。
##
##     godot --headless --path godot --script res://tests/feel_compare.gd
##
## 量的不是"配置里写了多少"，而是"跑起来是什么"：
##   满跳高度 / 轻点跳高度 / 加速到满速要几帧 / 松手后几帧停 / 翻滚位移。
## 这几项决定手感，配置表看不出来。

const PRESETS := ["aos", "crayon"]
const SEG_LEN := 800        # 每个预设占多少帧

var scene: Node
var player: CharacterBody2D
var pi := -1
var t := 0
var res: Dictionary = {}
var cur: Dictionary = {}
var y0 := 0.0
var apex := 0.0
var x0 := 0.0
var accel_frames := -1
var decel_frames := -1
var roll_peak_v := 0.0


func _initialize() -> void:
	scene = load("res://scenes/main.tscn").instantiate()
	root.add_child(scene)
	player = scene.get_node("Player")
	print("[cmp] 场景已加载")


func _physics_process(_delta: float) -> bool:
	t += 1

	# ── 切预设 ──
	if pi < 0 or t >= SEG_LEN:
		pi += 1
		if pi >= PRESETS.size():
			_report()
			return true
		t = 1
		cur = {}
		res[PRESETS[pi]] = cur
		player.apply_preset(PRESETS[pi])
		player.global_position = Vector2(200, 420)
		player.velocity = Vector2.ZERO
		for a in ["move_right", "jump", "dash"]:
			Input.action_release(a)
		accel_frames = -1
		decel_frames = -1
		roll_peak_v = 0.0

	# ── 1..40 站稳 ──
	if t == 40:
		y0 = player.global_position.y
		apex = y0
		Input.action_press("jump")
	if t > 40 and t < 300:
		apex = minf(apex, player.global_position.y)
	if t == 300:
		Input.action_release("jump")
		cur["full_jump"] = y0 - apex

	# ── 300..420 落地 ──
	if t == 420:
		cur["tap_base"] = player.global_position.y
		apex = player.global_position.y
		Input.action_press("jump")
	if t == 424:
		Input.action_release("jump")
	if t > 424 and t < 560:
		apex = minf(apex, player.global_position.y)
	if t == 560:
		cur["tap_jump"] = cur["tap_base"] - apex

	# ── 560..660 水平加速 ──
	if t == 570:
		x0 = player.global_position.x
		Input.action_press("move_right")
	if t > 570 and t < 640 and accel_frames < 0:
		if absf(player.velocity.x) >= player.p.spd_run * 0.98:
			accel_frames = t - 570
	if t == 640:
		cur["accel_frames"] = accel_frames
		cur["spd_steady"] = absf(player.velocity.x)
		Input.action_release("move_right")
	if t > 640 and t < 700 and decel_frames < 0:
		if absf(player.velocity.x) < 0.5:
			decel_frames = t - 640
	if t == 700:
		cur["decel_frames"] = decel_frames

	# ── 700..760 翻滚 ──
	# 挪回空地并让朝向朝左：PlatA 的底边在 y=342，玩家身高 100，
	# 站着时头就在平台高度上，向右滚会撞平台侧面（不是代码问题，是场景太窄）。
	if t == 708:
		player.global_position = Vector2(200, 420)
		player.velocity = Vector2.ZERO
		player.facing = -1
	if t == 710:
		cur["roll_x0"] = player.global_position.x
		Input.action_press("dash")
	if t == 715:
		Input.action_release("dash")
	if t > 712 and t < 760:
		roll_peak_v = maxf(roll_peak_v, absf(player.velocity.x))
	if t == 760:
		cur["roll_dx"] = absf(player.global_position.x - cur["roll_x0"])
		cur["roll_peak_v"] = roll_peak_v

	return false


func _report() -> void:
	print("\n════════ 实测对照（120Hz 物理步）════════")
	print("%-24s %13s %13s" % ["项目", "aos", "crayon"])
	var rows := [
		["full_jump", "满跳高度 px", "%.1f"],
		["tap_jump", "轻点跳 px（按 4 帧）", "%.1f"],
		["spd_steady", "水平稳态速度 px/s", "%.1f"],
		["accel_frames", "0→满速 帧", "%d"],
		["decel_frames", "松手→停 帧", "%d"],
		["roll_dx", "翻滚位移 px", "%.1f"],
		["roll_peak_v", "翻滚峰值速度 px/s", "%.1f"],
	]
	for r in rows:
		var a = res["aos"].get(r[0], null)
		var c = res["crayon"].get(r[0], null)
		print("%-24s %13s %13s" % [r[1],
			("—" if a == null else r[2] % a),
			("—" if c == null else r[2] % c)])
	print("════════════════════════════════════════\n")
