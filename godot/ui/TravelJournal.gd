extends CanvasLayer

## 《二向箔》折叠画卷旅行手账（GDD 3.2 / 路线图第二阶段第 3 项）。
## 全局 Autoload：左页已探索画页印章 + 入侵涂鸦标记，右页花坛成熟度与一键战力转化。
## 与 VistaZone / TouchHUD 同构：运行时查找 WorldState 并订阅信号，零直接引用房间实体；
## 不写 class_name（Autoload 同名冲突，与 SceneTransition 一致）。

signal journal_toggled(open: bool)

const ROOM_NAMES: Dictionary = {
	"safe_house": "休息安全屋",
	"room_01": "画页一 · 风车草地",
	"room_02": "画页二 · 折纸角落",
}
const CROP_NAMES: Dictionary = {
	"flame_pepper": "火焰辣椒果",
	"bounce_marshmallow": "弹弹棉花糖",
	"glow_dandelion": "荧光蒲公英",
}
const STAGE_NAMES: Array[String] = ["", "种子期", "发芽开花期", "成熟发光期"]

@export var open_key_action: StringName = &"journal"
@export var room_ink_color: Color = Color(0.35, 0.22, 0.11, 1.0)
@export var invaded_ink_color: Color = Color(0.12, 0.12, 0.14, 1.0)

@onready var open_tab: Button = $OpenTab
@onready var root_control: Control = $JournalRoot
@onready var room_list: VBoxContainer = $JournalRoot/Paper/Columns/LeftPage/RoomList
@onready var plot_list: VBoxContainer = $JournalRoot/Paper/Columns/RightPage/PlotList
@onready var stats_label: Label = $JournalRoot/Paper/Columns/RightPage/StatsLabel
@onready var close_button: Button = $JournalRoot/Paper/Columns/RightPage/CloseButton

var _is_open: bool = false
var _world_state: Node = null

func _ready() -> void:
	layer = 90
	process_mode = Node.PROCESS_MODE_ALWAYS  # 暂停时仍可开合/刷新
	root_control.visible = false
	open_tab.pressed.connect(toggle_journal)
	close_button.pressed.connect(close_journal)
	_world_state = get_tree().root.get_node_or_null("WorldState")
	if _world_state != null:
		_connect_ws("room_changed", func(_id: String, _steps: int) -> void: refresh_all())
		_connect_ws("plot_updated", func(_id: String, _data: Dictionary) -> void: refresh_all())
		_connect_ws("room_invaded", func(_rid: String) -> void: refresh_all())
		_connect_ws("room_purified", func(_rid: String) -> void: refresh_all())
		_connect_ws("power_stat_changed", func(_n: String, _v: float) -> void: refresh_all())
		_connect_ws("vista_mode_changed", Callable(self, "_on_vista_mode_changed"))

func _connect_ws(signal_name: String, callable: Callable) -> void:
	if _world_state != null and not _world_state.is_connected(signal_name, callable):
		_world_state.connect(signal_name, callable)

func _on_vista_mode_changed(active: bool, _tz: float, _zd: float, _hf: float, _anim: String) -> void:
	open_tab.visible = not active  # 眺望全景时收起手账入口，与 HUD 淡出保持一致

func _input(event: InputEvent) -> void:
	if event.is_action_pressed(open_key_action):
		toggle_journal()
		get_viewport().set_input_as_handled()

# ===== 开合（打开时暂停世界，关闭恢复；幂等）=====

func is_open() -> bool:
	return _is_open

func toggle_journal() -> void:
	if _is_open:
		close_journal()
	else:
		open_journal()

func open_journal() -> void:
	if _is_open:
		return
	_is_open = true
	refresh_all()
	root_control.visible = true
	get_tree().paused = true
	journal_toggled.emit(true)

func close_journal() -> void:
	if not _is_open:
		return
	_is_open = false
	root_control.visible = false
	get_tree().paused = false
	journal_toggled.emit(false)

# ===== 画卷刷新 =====

func refresh_all() -> void:
	if not is_inside_tree() or root_control == null:
		return
	_refresh_rooms()
	_refresh_plots()
	_refresh_stats()

func _refresh_rooms() -> void:
	_clear_children(room_list)
	if _world_state == null:
		return
	var visited: Array = _world_state.get("visited_rooms")
	var invaded: Array = _world_state.get("invaded_rooms")
	for room_id: String in visited:
		var label := Label.new()
		label.name = "RoomBadge_%s" % room_id
		var display: String = str(ROOM_NAMES.get(room_id, room_id))
		if invaded.has(room_id):
			label.text = "✖ %s  · 黑白涂鸦中" % display
			label.add_theme_color_override("font_color", invaded_ink_color)
		else:
			label.text = "● %s  · 已涂色" % display
			label.add_theme_color_override("font_color", room_ink_color)
		room_list.add_child(label)

func _refresh_plots() -> void:
	_clear_children(plot_list)
	if _world_state == null:
		return
	var plots: Dictionary = _world_state.get("farm_plots")
	var invaded: Array = _world_state.get("invaded_rooms")
	for plot_id: String in plots.keys():
		var data: Dictionary = plots[plot_id]
		var room_id: String = str(data.get("room_id", ""))
		var crop_id: String = str(data.get("crop_id", ""))
		var stage: int = int(data.get("stage", 0))
		var display_room: String = str(ROOM_NAMES.get(room_id, room_id))
		var crop_name: String = str(CROP_NAMES.get(crop_id, crop_id))
		var stage_name: String = STAGE_NAMES[clampi(stage, 0, 3)]
		var row := HBoxContainer.new()
		row.name = "PlotRow_%s" % plot_id
		var label := Label.new()
		if invaded.has(room_id):
			label.text = "%s | %s | %s（受惊暂停）" % [display_room, crop_name, stage_name]
			label.add_theme_color_override("font_color", invaded_ink_color)
		else:
			label.text = "%s | %s | %s" % [display_room, crop_name, stage_name]
			label.add_theme_color_override("font_color", room_ink_color)
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(label)
		# 一键转化只认成熟（stage>=3）且未被入侵的地块，写入唯一走 WorldState
		if stage >= 3 and not invaded.has(room_id):
			var convert := Button.new()
			convert.name = "ConvertButton_%s" % plot_id
			convert.text = "转化"
			convert.pressed.connect(_on_convert_pressed.bind(plot_id))
			row.add_child(convert)
		plot_list.add_child(row)

func _refresh_stats() -> void:
	if _world_state == null:
		return
	var visited: Array = _world_state.get("visited_rooms")
	var steps: int = int(_world_state.get("total_room_transitions"))
	var atk: float = float(_world_state.get("bonus_attack_damage"))
	var hp: float = float(_world_state.get("bonus_max_hp"))
	stats_label.text = "已探索 %d 页 · 步数 %d · 攻击 +%d · 生命上限 +%d" % [
		visited.size(), steps, int(atk), int(hp)]

func _on_convert_pressed(plot_id: String) -> void:
	if _world_state == null:
		return
	var crop_id: String = str(_world_state.call("harvest_and_convert", plot_id))
	if crop_id != "":
		refresh_all()  # 转化后地块回空、攻击/生命加成变化 → 立刻重绘

func _clear_children(node: Node) -> void:
	for child: Node in node.get_children():
		node.remove_child(child)
		child.queue_free()
