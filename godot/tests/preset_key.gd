extends SceneTree
## 验证 F1 / F2 预设切换链路真的能走通（不是只有 apply_preset 能调）。
##
##     godot --headless --path godot --script res://tests/preset_key.gd

var scene: Node
var player: CharacterBody2D
var f := 0
var fail := 0


func _initialize() -> void:
	scene = load("res://scenes/main.tscn").instantiate()
	root.add_child(scene)
	player = scene.get_node("Player")


func _key(code: Key) -> void:
	var ev := InputEventKey.new()
	ev.keycode = code
	ev.physical_keycode = code
	ev.pressed = true
	Input.parse_input_event(ev)
	var up := InputEventKey.new()
	up.keycode = code
	up.physical_keycode = code
	up.pressed = false
	Input.parse_input_event(up)


func _physics_process(_delta: float) -> bool:
	f += 1
	if f == 5:
		if player.preset_name != "aos":
			print("[FAIL] 初始应是 aos，实际 %s" % player.preset_name); fail += 1
		_key(KEY_F2)
	if f == 10:
		if player.preset_name != "crayon":
			print("[FAIL] 按 F2 没切到 crayon，实际 %s" % player.preset_name); fail += 1
		if absf(player.p.jump_v - 480.0) > 0.01:
			print("[FAIL] crayon 的 jump_v 应为 480，实际 %s" % player.p.jump_v); fail += 1
		_key(KEY_F1)
	if f == 15:
		if player.preset_name != "aos":
			print("[FAIL] 按 F1 没切回 aos，实际 %s" % player.preset_name); fail += 1
		print("[key] F1/F2 切换：%s" % ("PASS" if fail == 0 else "FAIL %d" % fail))
		return true
	return false
