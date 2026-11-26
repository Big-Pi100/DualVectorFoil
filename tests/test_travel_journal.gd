extends SceneTree

## Phase 2 · 折叠画卷旅行手账专项测试（GDD 3.2）。
## 覆盖：Autoload 挂载、开合与暂停幂等、房间印章、入侵标记、花坛成熟度、
## 一键战力转化走 WorldState 唯一入口、信号自动刷新、眺望时收入口。
## 运行：godot --headless --path <项目根> --script res://tests/test_travel_journal.gd

var _errors: Array[String] = []

func _initialize() -> void:
	call_deferred("_run_tests")

func _check(ok: bool, message: String) -> void:
	if ok:
		print("[PASS] ", message)
	else:
		_errors.append(message)
		print("[FAIL] ", message)

func _run_tests() -> void:
	var ws = root.get_node_or_null("WorldState")
	_check(ws != null, "Autoload WorldState 已注册")
	var journal = root.get_node_or_null("TravelJournal")
	_check(journal != null, "Autoload TravelJournal 已注册")
	if ws == null or journal == null:
		quit(1)
		return

	ws.reset_state()
	paused = false

	var journal_root: Control = journal.get_node_or_null("JournalRoot") as Control
	var room_list: VBoxContainer = journal.get_node_or_null("JournalRoot/Paper/Columns/LeftPage/RoomList") as VBoxContainer
	var plot_list: VBoxContainer = journal.get_node_or_null("JournalRoot/Paper/Columns/RightPage/PlotList") as VBoxContainer
	var stats_label: Label = journal.get_node_or_null("JournalRoot/Paper/Columns/RightPage/StatsLabel") as Label
	var open_tab: Button = journal.get_node_or_null("OpenTab") as Button
	var nodes_ok: bool = journal_root != null and room_list != null and plot_list != null \
		and stats_label != null and open_tab != null
	_check(nodes_ok, "手账节点树齐全（Root/RoomList/PlotList/StatsLabel/OpenTab）")
	if not nodes_ok:
		quit(1)
		return

	# ===== A. 开合 + 暂停，幂等 =====
	_check(not journal.is_open(), "初始为合上状态")
	_check(not journal_root.visible, "初始画卷隐藏")
	journal.open_journal()
	_check(journal.is_open() and journal_root.visible, "打开：状态置位且画卷可见")
	_check(paused, "打开：世界暂停")
	journal.open_journal()
	_check(journal_root.visible, "重复打开幂等")
	journal.close_journal()
	_check(not journal.is_open() and not journal_root.visible, "合上：状态复位且画卷隐藏")
	_check(not paused, "合上：世界恢复运行")
	journal.close_journal()
	_check(not paused, "重复合上幂等")

	# ===== B. 房间印章：已探索画页自动涂色，入侵页显示涂鸦标记 =====
	ws.notify_room_entered("room_01")
	ws.notify_room_entered("room_02")
	journal.refresh_all()
	_check(room_list.get_child_count() == 2, "两间已探索房间 → 两枚印章（实际 %d）" % room_list.get_child_count())
	var badge_1: Label = room_list.get_child(0) as Label
	_check(badge_1 != null and badge_1.text.contains("已涂色"), "普通房间印章显示已涂色")

	ws.invaded_rooms.append("room_01")
	ws.room_invaded.emit("room_01")  # 信号应自动刷新手账
	var badge_invaded: Label = room_list.get_child(0) as Label
	_check(badge_invaded != null and badge_invaded.text.contains("黑白涂鸦中"), "入侵房间印章显示涂鸦标记（信号自动刷新）")

	# ===== C. 花坛成熟度 + 入侵暂停，不销毁作物 =====
	ws.plant_seed("plot_a", "room_02", "flame_pepper")
	ws.plot_updated.emit("plot_a", ws.farm_plots["plot_a"])
	_check(plot_list.get_child_count() == 1, "播种一行花坛记录（实际 %d）" % plot_list.get_child_count())
	var row_seed: Node = plot_list.get_child(0)
	_check(row_seed.get_child(0).text.contains("种子期"), "新播种显示种子期")
	_check(row_seed.get_node_or_null("ConvertButton_plot_a") == null, "未成熟不提供转化按钮")

	# 手动推进到成熟（步数生长在 test_gameplay_loop 已覆盖，此处只验证手账展示）
	var mature: Dictionary = ws.farm_plots["plot_a"]
	mature["stage"] = 3
	ws.farm_plots["plot_a"] = mature
	ws.plot_updated.emit("plot_a", mature)
	var row_mature: Node = plot_list.get_child(0)
	_check(row_mature.get_child(0).text.contains("成熟发光期"), "成熟显示成熟发光期")
	_check(row_mature.get_node_or_null("ConvertButton_plot_a") != null, "成熟出现转化按钮")

	# 入侵房间里的作物：暂停提示 + 不给转化按钮 + 作物仍在（零永久损失）
	ws.plant_seed("plot_b", "room_01", "bounce_marshmallow")
	var invaded_plot: Dictionary = ws.farm_plots["plot_b"]
	invaded_plot["stage"] = 3
	ws.farm_plots["plot_b"] = invaded_plot
	ws.plot_updated.emit("plot_b", invaded_plot)
	var row_invaded_plot: Node = plot_list.get_child(1)
	_check(row_invaded_plot.get_child(0).text.contains("受惊暂停"), "被入侵地块的作物显示受惊暂停")
	_check(row_invaded_plot.get_node_or_null("ConvertButton_plot_b") == null, "被入侵地块不可转化")
	_check(ws.farm_plots.has("plot_b"), "入侵期间作物数据仍在（零永久损失）")

	# ===== D. 一键战力转化：走 WorldState 唯一入口，加成生效 =====
	var atk_before: float = ws.bonus_attack_damage
	# 注意：plot_b 的刷新会重建整张列表，必须从当前列表重新取按钮，不能用旧行引用
	var current_row_a: Node = plot_list.get_child(0)
	var convert_button: Button = current_row_a.get_node_or_null("ConvertButton_plot_a") as Button
	_check(convert_button != null, "成熟地块转化按钮可点击")
	if convert_button != null:
		convert_button.pressed.emit()
	_check(is_equal_approx(ws.bonus_attack_damage, atk_before + 5.0),
		"火焰辣椒果转化 → 攻击 +5（实际 %.1f）" % ws.bonus_attack_damage)
	_check(int(ws.farm_plots["plot_a"].get("stage", 0)) == 0, "转化后地块回到空地")
	_check((plot_list.get_child(0) as Node).get_node_or_null("ConvertButton_plot_a") == null,
		"转化后转化按钮消失（画卷即时重绘）")

	# power_stat_changed 也应触发刷新：stats 文本包含加成
	stats_label.text = ""
	ws.power_stat_changed.emit("attack", ws.bonus_attack_damage)
	_check(stats_label.text.contains("攻击 +5"), "战力信号触发统计刷新（%s）" % stats_label.text)

	# ===== E. 眺望时收起手账入口 =====
	ws.set_vista_mode(true)
	_check(not open_tab.visible, "眺望全景：手账入口收起")
	ws.set_vista_mode(false)
	_check(open_tab.visible, "退出眺望：手账入口恢复")

	# 收尾：确保不残留暂停状态影响其他测试
	journal.close_journal()
	paused = false
	ws.reset_state()

	if _errors.is_empty():
		print("=== ALL TRAVEL JOURNAL TESTS PASSED ===")
		quit(0)
	else:
		print("=== %d TEST(S) FAILED ===" % _errors.size())
		quit(1)
