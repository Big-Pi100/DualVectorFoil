class_name InvaderVisual
extends Sprite2D

## 入侵者视觉：按变体切换正式蜡笔资产。
## 只负责贴图，不碰宿主 Hurtbox 的血量 / 信号契约（Signal 解耦铁律）。
## variant: 0=史莱姆 1=尖刺球 2=蝙蝠

const TEX_SLIME: Texture2D = preload("res://art/approved/Enemies/enemy_slime_idle_00_sprite.png")
const TEX_SPIKE: Texture2D = preload("res://art/approved/Enemies/enemy_spike_idle_00_sprite.png")
const TEX_BAT: Texture2D = preload("res://art/approved/Enemies/enemy_bat_idle_00_sprite.png")

@export_range(0, 2) var variant: int = 0

func _ready() -> void:
	apply_variant()

func apply_variant() -> void:
	match variant:
		0:
			texture = TEX_SLIME
		1:
			texture = TEX_SPIKE
		2:
			texture = TEX_BAT
		_:
			texture = TEX_SLIME

func set_variant(value: int) -> void:
	variant = clampi(value, 0, 2)
	apply_variant()
