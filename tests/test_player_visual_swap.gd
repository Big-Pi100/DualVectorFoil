extends SceneTree

## G5→Phase2 换装验收：主角正式蜡笔资产接入 + 动画状态机零破坏手感。
## 检查：8 动画帧加载、脚底锚点、状态切换优先级、判定体节点保留、零错误。

const PLAYER_SCENE: String = "res://entities/player/Player.tscn"
const EXPECTED_ANIMS: Array[String] = ["idle", "run", "jump", "attack", "hurt", "climb", "side", "back"]

var _fail_count: int = 0

func _check(ok: bool, label: String) -> void:
	if ok:
		print("  PASS  ", label)
	else:
		_fail_count += 1
		print("  FAIL  ", label)

func _initialize() -> void:
	print("=== PLAYER VISUAL SWAP GATE ===")
	var packed: PackedScene = load(PLAYER_SCENE)
	_check(packed != null, "Player.tscn 可加载")
	if packed == null:
		_finish()
		return
	var player: CharacterBody2D = packed.instantiate() as CharacterBody2D
	_check(player != null, "Player 实例化为 CharacterBody2D")
	if player == null:
		_finish()
		return
	root.add_child(player)
	# headless 同步执行时 add_child 的 _ready 延迟到帧末；手动触发以初始化 @onready 引用
	player.call("_ready")

	var sprite: AnimatedSprite2D = player.get_node_or_null("Visuals/Sprite") as AnimatedSprite2D
	_check(sprite != null, "AnimatedSprite2D 节点存在")
	_check(player.get_node_or_null("Visuals/BodyRect") == null, "旧 BodyRect 色块已移除")
	_check(player.get_node_or_null("Visuals/EyeRect") == null, "旧 EyeRect 色块已移除")

	# 判定体/盾牌节点必须保留（测试与手感依赖）
	for path: String in ["Visuals/WeaponPivot/SwordRect", "Visuals/WeaponPivot/ShieldRect",
			"Visuals/WeaponPivot/Hitbox", "DiveHitbox", "LedgeCheckTop", "LedgeCheckBottom"]:
		_check(player.get_node_or_null(path) != null, "保留节点 " + path)

	if sprite != null:
		var frames: SpriteFrames = sprite.sprite_frames
		_check(frames != null, "SpriteFrames 资源已挂接")
		if frames != null:
			for anim_name: String in EXPECTED_ANIMS:
				_check(frames.has_animation(anim_name), "动画存在: " + anim_name)
				if frames.has_animation(anim_name):
					_check(frames.get_frame_count(anim_name) == 1, "动画帧数=1: " + anim_name)
					var tex: Texture2D = frames.get_frame_texture(anim_name, 0)
					_check(tex != null and tex.get_width() > 0, "纹理有效: " + anim_name)
		# 脚底锚点：position.y = -296，标准帧脚底在局部 y=296 → 脚底落节点原点
		_check(is_equal_approx(sprite.position.y, -296.0), "脚底锚点对齐 (position.y=-296)")

	# 状态切换：驱动状态字段后调纯动画函数 _refresh_animation（只选贴图、不碰物理）。
	# 不走 _physics_process —— headless 无物理空间时 RayCast2D/move_and_slide 会报 null，
	# 那是测试脚手架限制，与换装逻辑无关。
	if sprite != null and sprite.sprite_frames != null:
		_check(sprite.animation == &"idle", "初始动画=idle")
		player.is_attacking = true
		player._refresh_animation()
		_check(sprite.animation == &"attack", "攻击态→attack")
		player.is_attacking = false
		player._hurt_anim_timer = 0.3
		player._refresh_animation()
		_check(sprite.animation == &"hurt", "受击态→hurt (最高优先级)")
		player._hurt_anim_timer = 0.0
		player._climb_anim_timer = 0.3
		player._refresh_animation()
		_check(sprite.animation == &"climb", "抓边态→climb")
		player._climb_anim_timer = 0.0
		player.is_diving = true
		player._refresh_animation()
		_check(sprite.animation == &"jump", "下砸态→jump")
		player.is_diving = false

	_finish()

func _finish() -> void:
	print("errors: %d" % _fail_count)
	if _fail_count == 0:
		print("=== PLAYER VISUAL SWAP GATE: PASS ===")
	else:
		print("=== PLAYER VISUAL SWAP GATE: FAIL (%d) ===" % _fail_count)
	quit(1 if _fail_count > 0 else 0)
