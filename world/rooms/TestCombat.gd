extends Node2D

## 白盒手感试跑场景：把 TouchHUD 绑定到 Player。
## 正式游戏里这段绑定由房间管理器/GameRoot 负责，此处仅作最小验证。

@onready var player: Player = $Player
@onready var touch_hud: TouchHUD = $TouchHUD

func _ready() -> void:
	touch_hud.bind_player(player)
	player.health_changed.connect(_on_health_changed)
	player.skill_triggered.connect(_on_skill_triggered)
	player.respawn_requested.connect(_on_respawn_requested)

func _on_health_changed(current_hp: float, max_hp: float) -> void:
	print("[TestCombat] HP %.0f/%.0f" % [current_hp, max_hp])

func _on_skill_triggered(slot: int) -> void:
	print("[TestCombat] Skill slot %d triggered" % slot)

func _on_respawn_requested() -> void:
	# 零惩罚失败：仅送回房间入口，不掉落任何材料/进度
	player.global_position = Vector2(300, 400)
	player.velocity = Vector2.ZERO
	print("[TestCombat] 玩家倒地，已送回入口（无掉落）")
