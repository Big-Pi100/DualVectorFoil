class_name SoilPlot
extends Area2D

## 原位魔法花坛：播种 / 步数生长可视化 / 收割转化为永久战力。
## 战力加成只从 WorldState 读，不在本脚本直接改 Hitbox（避免跨场景丢失与作物类型加错属性）。

@export var plot_id: String = "room_01_plot_01"
@export var room_id: String = "room_01"
@export var default_seed_id: String = "flame_pepper" # 播种作物：flame_pepper=火焰辣椒(加攻击) / bounce_marshmallow=弹弹棉花糖(加生命)

## 作物显示名与加成属性——多生态区接入不同作物时的唯一提示来源。
const CROP_LABELS: Dictionary = {
	"flame_pepper": {"name": "火焰辣椒", "stat": "攻击"},
	"bounce_marshmallow": {"name": "弹弹棉花糖", "stat": "生命"},
}

func _crop_info() -> Dictionary:
	return CROP_LABELS.get(default_seed_id, {"name": default_seed_id, "stat": "战力"})

@onready var plant_visual: ColorRect = $PlantVisual
@onready var prompt_label: Label = $PromptLabel

var _player_in_range: Player = null

func _ready() -> void:
	prompt_label.visible = false
	monitoring = true
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)
	WorldState.plot_updated.connect(_on_plot_updated)
	WorldState.room_invaded.connect(_on_invasion_changed)
	WorldState.room_purified.connect(_on_invasion_changed)
	_refresh_visuals()

func _on_body_entered(body: Node2D) -> void:
	if body is Player:
		_player_in_range = body
		if not _player_in_range.interact_requested.is_connected(_on_interact):
			_player_in_range.interact_requested.connect(_on_interact)
		prompt_label.visible = true
		_refresh_visuals()

func _on_body_exited(body: Node2D) -> void:
	if body == _player_in_range:
		if _player_in_range.interact_requested.is_connected(_on_interact):
			_player_in_range.interact_requested.disconnect(_on_interact)
		_player_in_range = null
		prompt_label.visible = false

func _on_interact() -> void:
	if WorldState.invaded_rooms.has(room_id):
		prompt_label.text = "花坛受惊了！先赶走黑白怪"
		return

	var data: Dictionary = WorldState.farm_plots.get(plot_id, {})
	var stage: int = int(data.get("stage", 0))

	if stage == 0:
		WorldState.plant_seed(plot_id, room_id, default_seed_id)
	elif stage >= 3:
		var harvested: String = WorldState.harvest_and_convert(plot_id)
		if harvested != "" and _player_in_range != null:
			# 从唯一数据源同步到实体（含跨场景新实例）
			_player_in_range.apply_power_bonuses(
				WorldState.bonus_attack_damage,
				WorldState.bonus_max_hp
			)
			prompt_label.text = "收获成功！永久%s提升" % str(_crop_info().get("stat", "战力"))

func _on_plot_updated(updated_id: String, _data: Dictionary) -> void:
	if updated_id == plot_id:
		_refresh_visuals()

func _on_invasion_changed(changed_room_id: String) -> void:
	if changed_room_id == room_id:
		_refresh_visuals()

func _refresh_visuals() -> void:
	var data: Dictionary = WorldState.farm_plots.get(plot_id, {})
	var stage: int = int(data.get("stage", 0))
	var is_invaded: bool = WorldState.invaded_rooms.has(room_id)

	match stage:
		0:
			plant_visual.visible = false
			prompt_label.text = "[互动] 播种%s" % str(_crop_info().get("name", default_seed_id))
		1:
			plant_visual.visible = true
			plant_visual.size = Vector2(12, 12)
			plant_visual.position = Vector2(-6, -18)
			plant_visual.color = Color.GRAY if is_invaded else Color.LIME_GREEN
			prompt_label.text = "受惊暂停中..." if is_invaded else "种子期（继续探索长大）"
		2:
			plant_visual.visible = true
			plant_visual.size = Vector2(20, 26)
			plant_visual.position = Vector2(-10, -32)
			plant_visual.color = Color.GRAY if is_invaded else Color.ORANGE
			prompt_label.text = "受惊暂停中..." if is_invaded else "开花期（快熟啦）"
		3:
			plant_visual.visible = true
			plant_visual.size = Vector2(28, 38)
			plant_visual.position = Vector2(-14, -44)
			plant_visual.color = Color.GRAY if is_invaded else Color.GOLD
			prompt_label.text = "先清理入侵者再收割！" if is_invaded else "[互动] 收割并强化%s！" % str(_crop_info().get("stat", "战力"))
