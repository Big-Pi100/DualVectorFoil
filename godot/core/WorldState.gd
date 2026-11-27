extends Node

## 《二向箔》全局状态单例 —— 跨房间统一数据源（AGENTS.md 铁律）。
## 作物生长只认房间切换步数，禁止绑定现实时间；
## 入侵只暂停生长 + 灰度去色，严禁销毁或永久扣除已种作物。

signal room_changed(new_room_id: String, total_steps: int)
signal plot_updated(plot_id: String, plot_data: Dictionary)
signal room_invaded(room_id: String)
signal room_purified(room_id: String)
signal power_stat_changed(stat_name: String, new_value: float)
## 风景眺望表现层事件：VistaZone 广播，Camera/HUD 各自订阅（跨模块零直接引用）。
signal vista_mode_changed(active: bool, target_zoom: float, zoom_duration: float, hud_fade_duration: float, vista_anim: String)

@export var steps_per_growth_stage: int = 2   # 测试期设小：每 2 次「离开房间」长一阶段（正式版可调 4）
@export var invasion_check_interval: int = 5  # 每 5 次房间切换检查一次温和入侵

# stage: 0=空地, 1=种子期, 2=发芽开花期, 3=成熟发光期
var story_flags: Dictionary = {}
var unlocked_abilities: Array[String] = []
var visited_rooms: Array[String] = []
var farm_plots: Dictionary = {}
var invaded_rooms: Array[String] = []
var total_room_transitions: int = 0

# 战力加成：唯一数据源。Player / 武器在 _ready 读取并订阅 power_stat_changed，
# 避免「WorldState 记一份、实体又自己加一份」导致换场景后加成丢失或作物类型加错属性。
var bonus_attack_damage: float = 0.0
var bonus_max_hp: float = 0.0

# 最近休息点：零惩罚失败送回 + 长椅存档共用。
const DEFAULT_REST_SCENE: String = "res://world/rooms/SafeHouse.tscn"
const DEFAULT_REST_MARKER: String = "SpawnFromRest"
var last_rest_scene_path: String = DEFAULT_REST_SCENE
var last_rest_spawn_marker: String = DEFAULT_REST_MARKER

# 眺望是纯表现层状态，不进存档：切场景自动恢复常态镜头与 HUD。
var vista_active: bool = false
const DEFAULT_VISTA_ZOOM: float = 0.72
const DEFAULT_VISTA_ZOOM_DURATION: float = 1.1
const DEFAULT_VISTA_HUD_FADE: float = 0.35

signal rest_point_changed(scene_path: String, spawn_marker: String)

func notify_room_entered(room_id: String) -> void:
	total_room_transitions += 1
	if not visited_rooms.has(room_id):
		visited_rooms.append(room_id)

	_advance_all_crops(room_id)
	_try_trigger_gentle_invasion(room_id)
	room_changed.emit(room_id, total_room_transitions)

func plant_seed(plot_id: String, room_id: String, crop_id: String) -> void:
	var data: Dictionary = {
		"room_id": room_id,
		"crop_id": crop_id,
		"steps": 0,
		"stage": 1,
	}
	farm_plots[plot_id] = data
	plot_updated.emit(plot_id, data)

func harvest_and_convert(plot_id: String) -> String:
	if not farm_plots.has(plot_id):
		return ""
	var data: Dictionary = farm_plots[plot_id]
	if int(data.get("stage", 0)) < 3:
		return ""

	var crop_id: String = str(data.get("crop_id", "flame_pepper"))
	# 收割后重置为空地（不销毁花坛本身）
	farm_plots[plot_id] = {
		"room_id": data.get("room_id", ""),
		"crop_id": "",
		"steps": 0,
		"stage": 0,
	}
	plot_updated.emit(plot_id, farm_plots[plot_id])

	# 永久战力加成：按作物类型走对应属性，绝不错加
	match crop_id:
		"flame_pepper":
			bonus_attack_damage += 5.0
			power_stat_changed.emit("attack", bonus_attack_damage)
		"bounce_marshmallow":
			bonus_max_hp += 20.0
			power_stat_changed.emit("max_hp", bonus_max_hp)
	return crop_id

func _advance_all_crops(current_room_id: String) -> void:
	for plot_id: String in farm_plots.keys():
		var data: Dictionary = farm_plots[plot_id]
		var stage: int = int(data.get("stage", 0))
		var plot_room: String = str(data.get("room_id", ""))
		# 只有已播种、未成熟、所在房间未被入侵的作物才自然生长；
		# 且只有玩家离开该房间去探索时才推进（同一房间来回踩不算）。
		if stage >= 1 and stage < 3 and not invaded_rooms.has(plot_room) and plot_room != current_room_id:
			var new_steps: int = int(data.get("steps", 0)) + 1
			data["steps"] = new_steps
			if new_steps >= steps_per_growth_stage:
				data["steps"] = 0
				data["stage"] = stage + 1
			farm_plots[plot_id] = data
			plot_updated.emit(plot_id, data)

func _try_trigger_gentle_invasion(current_room_id: String) -> void:
	if total_room_transitions % invasion_check_interval != 0:
		return

	# 候选：种有作物、非当前所在房间、尚未被入侵
	var candidates: Array[String] = []
	for plot_id: String in farm_plots.keys():
		var data: Dictionary = farm_plots[plot_id]
		var r_id: String = str(data.get("room_id", ""))
		if int(data.get("stage", 0)) >= 1 and r_id != "" and r_id != current_room_id:
			if not invaded_rooms.has(r_id) and not candidates.has(r_id):
				candidates.append(r_id)

	if candidates.is_empty():
		return

	var chosen_room: String = candidates.pick_random()
	invaded_rooms.append(chosen_room)
	room_invaded.emit(chosen_room)

func purify_room(room_id: String) -> void:
	if not invaded_rooms.has(room_id):
		return
	invaded_rooms.erase(room_id)
	# 清怪奖励：该房间所有未成熟作物立刻推进 1 阶段（不是销毁）
	for plot_id: String in farm_plots.keys():
		var data: Dictionary = farm_plots[plot_id]
		if str(data.get("room_id", "")) == room_id:
			var stage: int = int(data.get("stage", 0))
			if stage >= 1 and stage < 3:
				data["stage"] = stage + 1
				farm_plots[plot_id] = data
				plot_updated.emit(plot_id, data)
	room_purified.emit(room_id)

# ===== 最近休息点 =====

func set_rest_point(scene_path: String, spawn_marker: String = DEFAULT_REST_MARKER) -> void:
	if scene_path.is_empty():
		return
	last_rest_scene_path = scene_path
	last_rest_spawn_marker = spawn_marker
	rest_point_changed.emit(scene_path, spawn_marker)

# ===== 风景眺望（VistaZone 事件总线）=====

## 唯一入口：眺望点进入/退出都走这里广播，避免相机与 HUD 各自轮询状态。
func set_vista_mode(active: bool, target_zoom: float = DEFAULT_VISTA_ZOOM,
		zoom_duration: float = DEFAULT_VISTA_ZOOM_DURATION,
		hud_fade_duration: float = DEFAULT_VISTA_HUD_FADE,
		vista_anim: String = "back") -> void:
	if vista_active == active:
		return
	vista_active = active
	vista_mode_changed.emit(active, target_zoom, zoom_duration, hud_fade_duration, vista_anim)

# ===== JSON 存档（user://save_data.json）=====

const SAVE_PATH: String = "user://save_data.json"
const SAVE_VERSION: int = 1

## 序列化全局状态。JSON 只存基础类型；失败返回具体 Error。
func save_game() -> Error:
	var payload: Dictionary = {
		"version": SAVE_VERSION,
		"story_flags": story_flags,
		"unlocked_abilities": unlocked_abilities,
		"visited_rooms": visited_rooms,
		"farm_plots": farm_plots,
		"invaded_rooms": invaded_rooms,
		"total_room_transitions": total_room_transitions,
		"bonus_attack_damage": bonus_attack_damage,
		"bonus_max_hp": bonus_max_hp,
		"last_rest_scene_path": last_rest_scene_path,
		"last_rest_spawn_marker": last_rest_spawn_marker,
	}
	var file: FileAccess = FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if file == null:
		return FileAccess.get_open_error()
	file.store_string(JSON.stringify(payload, "\t"))
	file.close()
	return OK

func has_save() -> bool:
	return FileAccess.file_exists(SAVE_PATH)

## 反序列化并广播信号，让已存在的实体（Player/SoilPlot）同步到存档状态。
func load_game() -> Error:
	if not FileAccess.file_exists(SAVE_PATH):
		return ERR_FILE_NOT_FOUND
	var file: FileAccess = FileAccess.open(SAVE_PATH, FileAccess.READ)
	if file == null:
		return FileAccess.get_open_error()
	var text: String = file.get_as_text()
	file.close()

	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		return ERR_PARSE_ERROR
	var data: Dictionary = parsed as Dictionary
	if int(data.get("version", 0)) != SAVE_VERSION:
		return ERR_INVALID_DATA

	story_flags = _dict_str_variant(data.get("story_flags", {}))
	unlocked_abilities = _array_str(data.get("unlocked_abilities", []))
	visited_rooms = _array_str(data.get("visited_rooms", []))
	invaded_rooms = _array_str(data.get("invaded_rooms", []))
	farm_plots = _dict_plots(data.get("farm_plots", {}))
	total_room_transitions = int(data.get("total_room_transitions", 0))
	bonus_attack_damage = float(data.get("bonus_attack_damage", 0.0))
	bonus_max_hp = float(data.get("bonus_max_hp", 0.0))
	last_rest_scene_path = str(data.get("last_rest_scene_path", DEFAULT_REST_SCENE))
	last_rest_spawn_marker = str(data.get("last_rest_spawn_marker", DEFAULT_REST_MARKER))

	# 重广播：已加载的实体无需重新进场景即可同步战力 / 农田 / 休息点
	for plot_id: String in farm_plots.keys():
		plot_updated.emit(plot_id, farm_plots[plot_id])
	power_stat_changed.emit("attack", bonus_attack_damage)
	power_stat_changed.emit("max_hp", bonus_max_hp)
	rest_point_changed.emit(last_rest_scene_path, last_rest_spawn_marker)
	return OK

func delete_save() -> void:
	var dir: DirAccess = DirAccess.open("user://")
	if dir != null and dir.file_exists("save_data.json"):
		dir.remove("save_data.json")

# ===== JSON 反序列化辅助：JSON.parse_string 出来的是 Variant，需显式恢复类型 =====

func _dict_str_variant(raw: Variant) -> Dictionary:
	var out: Dictionary = {}
	if typeof(raw) != TYPE_DICTIONARY:
		return out
	for key: Variant in (raw as Dictionary).keys():
		out[str(key)] = (raw as Dictionary)[key]
	return out

func _array_str(raw: Variant) -> Array[String]:
	var out: Array[String] = []
	if typeof(raw) != TYPE_ARRAY:
		return out
	for item: Variant in raw as Array:
		out.append(str(item))
	return out

func _dict_plots(raw: Variant) -> Dictionary:
	var out: Dictionary = {}
	if typeof(raw) != TYPE_DICTIONARY:
		return out
	var source: Dictionary = raw as Dictionary
	for key: Variant in source.keys():
		var plot: Variant = source[key]
		if typeof(plot) != TYPE_DICTIONARY:
			continue
		var p: Dictionary = plot as Dictionary
		out[str(key)] = {
			"room_id": str(p.get("room_id", "")),
			"crop_id": str(p.get("crop_id", "")),
			"steps": int(p.get("steps", 0)),
			"stage": int(p.get("stage", 0)),
		}
	return out

# ===== 测试 / 新游戏用：重置全局状态 =====
func reset_state() -> void:
	story_flags.clear()
	unlocked_abilities.clear()
	visited_rooms.clear()
	farm_plots.clear()
	invaded_rooms.clear()
	total_room_transitions = 0
	bonus_attack_damage = 0.0
	bonus_max_hp = 0.0
	last_rest_scene_path = DEFAULT_REST_SCENE
	last_rest_spawn_marker = DEFAULT_REST_MARKER
	vista_active = false
