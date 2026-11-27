@tool
extends SceneTree

## 一次性工具：用 Godot SpriteFrames API 正式生成主角动画帧资源。
## 8 个状态各 1 帧（340x340 脚底锚点 y=296），靠 AnimatedSprite2D.position 对齐脚底。

const ANIMS: Array[String] = ["idle", "run", "jump", "attack", "hurt", "climb", "side", "back"]
const OUT_PATH: String = "res://entities/player/PlayerFrames.tres"

func _initialize() -> void:
	var frames := SpriteFrames.new()
	if frames.has_animation("default"):
		frames.remove_animation("default")
	for anim_name in ANIMS:
		frames.add_animation(anim_name)
		frames.set_animation_speed(anim_name, 10.0)
		frames.set_animation_loop(anim_name, true)
		var tex: Texture2D = load("res://art/approved/Characters/player_%s_00_sprite.png" % anim_name)
		if tex == null:
			push_error("纹理加载失败: " + anim_name)
			quit(1)
			return
		frames.add_frame(anim_name, tex)
	var err: int = ResourceSaver.save(frames, OUT_PATH)
	if err != OK:
		push_error("保存 SpriteFrames 失败: %d" % err)
		quit(1)
		return
	print("OK 生成 %s，动画数=%d" % [OUT_PATH, frames.get_animation_names().size()])
	quit(0)
