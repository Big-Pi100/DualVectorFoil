extends SceneTree

## Phase 2 · Dialogue Manager 开篇剧情专项测试（GDD 3.2 / 路线图第 4 项）。
## 覆盖：Autoload 挂载、剧本运行时编译、逐行推进、选项分支、跳过零挫败、
## story_flag 落盘、对话框渲染/选项按钮、自动触发隔离（测试实例化的房间不播放）。
## 运行：godot --headless --path <项目根> --script res://tests/test_dialogue_system.gd

var _errors: Array[String] = []

func _initialize() -> void:
	call_deferred("_run_tests")

func _check(ok: bool, message: String) -> void:
	if ok:
		print("[PASS] ", message)
	else:
		_errors.append(message)
		print("[FAIL] ", message)

func _wait(sec: float) -> void:
	await create_timer(sec).timeout

func _run_tests() -> void:
	var dm := root.get_node_or_null("DialogueManager")
	var director := root.get_node_or_null("StoryDirector")
	var ws := root.get_node_or_null("WorldState")
	_check(dm != null, "DialogueManager 插件 Autoload 已注册")
	_check(director != null, "StoryDirector 剧情总线 Autoload 已注册")
	if dm == null or director == null or ws == null:
		quit(1)
		return

	ws.reset_state()
	paused = false

	# ===== A. 信号采集：逐行文本 / 选项 / 结束 =====
	var lines: Array = []
	var choice_events: Array = []
	var finished: Array = []
	director.line_shown.connect(func(character: String, text: String, _tags: PackedStringArray) -> void:
		lines.append([character, text]))
	director.choices_shown.connect(func(choices: Array) -> void:
		choice_events.append(choices))
	director.dialogue_finished.connect(func(dialogue_id: String) -> void:
		finished.append(dialogue_id))

	# ===== B. 开篇剧情：运行时编译 + 逐行推进 =====
	director.call("start", "prologue")
	await _wait(0.2)
	_check(director.call("is_active"), "start 后进入对话态")
	_check(paused, "对话期间世界暂停")
	_check(lines.size() >= 1, "编译并解析出第一行（实际 %d 行）" % lines.size())
	if lines.size() >= 1:
		_check(str(lines[0][0]) == "旁白", "首行说话人是旁白（%s）" % str(lines[0][0]))
		_check(str(lines[0][1]).contains("蜡笔绘本"), "首行正文来自 prologue.dialogue")

	# 一路推进直到出现选项
	var guard: int = 0
	while not bool(director.call("has_choices")) and guard < 30:
		director.call("next")
		await _wait(0.12)
		guard += 1
	_check(choice_events.size() >= 1, "推进到分支点触发 choices_shown")
	_check(bool(director.call("has_choices")), "分支点等待玩家选择")
	if choice_events.size() >= 1:
		var choices: Array = choice_events[choice_events.size() - 1]
		_check(choices.size() == 2, "开篇提供两个选项（实际 %d）" % choices.size())

	# 选第一个分支 → 继续推进到结束
	director.call("choose", 0)
	await _wait(0.2)
	guard = 0
	while bool(director.call("is_active")) and guard < 30:
		director.call("next")
		await _wait(0.12)
		guard += 1
	_check(not bool(director.call("is_active")), "选支后推进到对话结束")
	_check(finished.size() == 1 and str(finished[0]) == "prologue", "结束广播 dialogue_finished(prologue)")
	_check(not paused, "对话结束世界恢复运行")
	_check(bool(ws.story_flags.get("prologue_seen", false)), "开篇播完写入 prologue_seen flag")

	# ===== C. 跳过零挫败：任意时刻 skip 立即结束并恢复 =====
	lines.clear()
	director.call("start", "origami_bird")
	await _wait(0.2)
	_check(bool(director.call("is_active")), "NPC 对话可启动")
	director.call("skip")
	await _wait(0.1)
	_check(not bool(director.call("is_active")), "skip 立即结束对话")
	_check(not paused, "skip 后世界恢复运行")
	_check(bool(ws.story_flags.get("prologue_seen", false)), "skip NPC 对话不影响开篇 flag")

	# ===== D. 对话框渲染：订阅信号、显示正文、生成选项按钮 =====
	var balloon_scene: PackedScene = load("res://ui/DialogueBalloon.tscn") as PackedScene
	_check(balloon_scene != null, "DialogueBalloon 场景可加载")
	if balloon_scene != null:
		var balloon: CanvasLayer = balloon_scene.instantiate() as CanvasLayer
		root.add_child(balloon)
		await _wait(0.1)
		var panel: Control = balloon.get_node_or_null("RootControl") as Control
		var speaker: Label = balloon.get_node_or_null("RootControl/Panel/VBox/Speaker") as Label
		var text_label: RichTextLabel = balloon.get_node_or_null("RootControl/Panel/VBox/Text") as RichTextLabel
		var choices_box: VBoxContainer = balloon.get_node_or_null("RootControl/Panel/VBox/Choices") as VBoxContainer
		_check(panel != null and speaker != null and text_label != null and choices_box != null,
			"对话框节点树齐全")
		if panel != null:
			# 手动喂信号模拟一行 + 选项（不依赖时序）
			director.line_shown.emit("小折", "啾！测试一下。", PackedStringArray())
			_check(panel.visible and speaker.text == "小折" and text_label.text == "啾！测试一下。",
				"line_shown → 对话框显示说话人与正文")
			director.choices_shown.emit([{"text": "选项甲", "next_id": "x"}, {"text": "选项乙", "next_id": "y"}])
			_check(choices_box.get_child_count() == 2, "choices_shown → 生成两个选项按钮（实际 %d）" % choices_box.get_child_count())
			director.dialogue_finished.emit("origami_bird")
			_check(not panel.visible and choices_box.get_child_count() == 0, "结束 → 对话框隐藏并清空选项")
		balloon.queue_free()
		await _wait(0.1)

	# ===== E. 房间接线：SafeHouse 含对话节点，但测试实例化不自动播放 =====
	var safe_scene: PackedScene = load("res://world/rooms/SafeHouse.tscn") as PackedScene
	_check(safe_scene != null, "SafeHouse 场景可加载")
	if safe_scene != null:
		# 重置 flag 后实例化：若自动触发会污染本测试
		ws.story_flags.erase("prologue_seen")
		var safe: Node2D = safe_scene.instantiate() as Node2D
		root.add_child(safe)
		await _wait(0.6)  # 超过 trigger_delay 0.35
		_check(not bool(director.call("is_active")), "测试实例化的 SafeHouse 不自动播放（隔离）")
		_check(safe.get_node_or_null("DialogueBalloon") != null, "SafeHouse 内含对话框实例")
		var trigger: Node = safe.get_node_or_null("OrigamiBird")
		_check(trigger != null and trigger.has_signal("dialogue_requested"), "SafeHouse 内含折纸鸟剧情触发点")
		var bird_sprite: Sprite2D = safe.get_node_or_null("OrigamiBird/BirdSprite") as Sprite2D
		var bird_tex: Texture2D = bird_sprite.texture if bird_sprite != null else null
		_check(bird_tex != null and bird_tex.resource_path == "res://art/approved/Characters/origami_bird_idle_00.png",
			"折纸鸟使用正式资产而非星星占位 (实际=%s)" % (bird_tex.resource_path if bird_tex != null else "null"))
		var autostart: Node = safe.get_node_or_null("StoryAutoStart")
		_check(autostart != null, "SafeHouse 内含开篇自动触发节点")
		safe.queue_free()
		await _wait(0.1)

		# 正向验证：把它设为真实 current_scene 时应自动播放
		var real_safe: Node2D = safe_scene.instantiate() as Node2D
		root.add_child(real_safe)
		current_scene = real_safe
		await _wait(0.6)  # trigger_delay 0.35 + 余量
		_check(bool(director.call("is_active")), "真实主场景下 SafeHouse 自动播放开篇")
		director.call("skip")
		await _wait(0.1)
		current_scene = null
		real_safe.queue_free()
		await _wait(0.1)

	ws.reset_state()
	paused = false

	if _errors.is_empty():
		print("=== ALL DIALOGUE SYSTEM TESTS PASSED ===")
		quit(0)
	else:
		print("=== %d TEST(S) FAILED ===" % _errors.size())
		quit(1)
