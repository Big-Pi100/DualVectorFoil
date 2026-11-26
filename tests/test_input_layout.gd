extends SceneTree

## PC 调试键位断言：左手 ADSW+Space+Q，右手 JKLUIO；F/E/H/Shift 应完全退出。
## 运行：godot --headless --path <项目根> --script res://tests/test_input_layout.gd

var _errors: Array[String] = []

func _initialize() -> void:
	call_deferred("_run_tests")

func _check(ok: bool, message: String) -> void:
	if ok:
		print("[PASS] ", message)
	else:
		_errors.append(message)
		print("[FAIL] ", message)

func _physical_codes(action: String) -> Array[int]:
	var result: Array[int] = []
	if not InputMap.has_action(action):
		return result
	for event: InputEvent in InputMap.action_get_events(action):
		if event is InputEventKey:
			result.append((event as InputEventKey).physical_keycode)
	return result

func _expect(action: String, expected: Array[int], label: String) -> void:
	var actual: Array[int] = _physical_codes(action)
	var sorted_expected: Array[int] = expected.duplicate()
	var sorted_actual: Array[int] = actual.duplicate()
	sorted_expected.sort()
	sorted_actual.sort()
	_check(sorted_actual == sorted_expected, "%s: %s 应为 %s，实际 %s" % [action, label, str(sorted_expected), str(sorted_actual)])

func _run_tests() -> void:
	# ===== 左手：ADSW + Space + Q =====
	_expect("move_left", [65, 4194319], "A + ←")
	_expect("move_right", [68, 4194321], "D + →")
	_expect("move_up", [87, 4194320], "W + ↑")
	_expect("move_down", [83, 4194322], "S + ↓")
	_expect("jump", [32], "Space")
	_expect("heal", [81], "Q（左手小指补位）")

	# ===== 右手：JKLUIO =====
	_expect("primary_attack", [74], "J")
	_expect("secondary_action", [75], "K")
	_expect("roll", [76], "L（已去 Shift）")
	_expect("interact", [85], "U（原 F）")
	_expect("skill_1", [73], "I（原 Q）")
	_expect("skill_2", [79], "O（原 E）")
	_expect("journal", [77], "M（折叠画卷手账）")
	_expect("attack", [74], "J（旧别名兼容）")

	# ===== 禁用键：F/E/H/Shift 不得出现在任何 action =====
	var banned: Dictionary = {
		70: "F", 69: "E", 72: "H", 4194325: "Shift"
	}
	for action_name: String in InputMap.get_actions():
		for keycode: int in _physical_codes(action_name):
			if banned.has(keycode):
				_check(false, "禁用键 %s 仍绑在动作 %s 上" % [str(banned[keycode]), action_name])
	_check(true, "F/E/H/Shift 未绑定任何动作")

	# ===== 14 个自定义动作全部存在（Godot 内建 ui_* 不计）=====
	var expected_actions: Array[String] = [
		"move_left", "move_right", "move_up", "move_down", "jump", "heal",
		"primary_attack", "secondary_action", "roll", "interact",
		"skill_1", "skill_2", "journal", "attack",
	]
	var missing: Array[String] = []
	for action_name: String in expected_actions:
		if not InputMap.has_action(action_name):
			missing.append(action_name)
	_check(missing.is_empty(), "14 个自定义动作齐全，缺失=%s" % str(missing))

	if _errors.is_empty():
		print("=== ALL INPUT LAYOUT TESTS PASSED ===")
		quit(0)
	else:
		print("=== %d TEST(S) FAILED ===" % _errors.size())
		quit(1)
