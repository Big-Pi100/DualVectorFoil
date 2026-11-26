extends SceneTree

## 场景比例门禁：防止美术换装后视觉尺寸、脚底锚点、触屏布局再次脱钩。
## 独立断言「渲染出来的尺寸」而非只查节点字段，避免 test_player_visual_swap 漏检 scale 的问题。

const PLAYER_SCENE: String = "res://entities/player/Player.tscn"
const HUD_SCENE: String = "res://ui/TouchHUD.tscn"
const ROOM_SCENES: Array[String] = [
	"res://world/rooms/Room03.tscn",
	"res://world/rooms/Room04.tscn",
	"res://world/rooms/Room05.tscn",
]
const LANDMARK_PATHS: Array[String] = ["Windmill/Tower", "PaperBooks/Book0", "Lighthouse/TowerBase"]
const LANDMARK_LIMITS: Array[float] = [300.0, 300.0, 450.0]

var _fail_count: int = 0

func _check(ok: bool, label: String) -> void:
	if ok:
		print("  PASS  ", label)
	else:
		_fail_count += 1
		print("  FAIL  ", label)

func _initialize() -> void:
	print("=== SCENE PROPORTION AUDIT ===")
	_audit_player()
	_audit_landmarks()
	_audit_touch_hud()
	_finish()

func _audit_player() -> void:
	var packed: PackedScene = load(PLAYER_SCENE)
	var player: Node2D = packed.instantiate() as Node2D
	var sprite: AnimatedSprite2D = player.get_node_or_null("Visuals/Sprite") as AnimatedSprite2D
	_check(sprite != null, "主角 AnimatedSprite2D 存在")
	if sprite == null:
		return
	_check(is_equal_approx(sprite.scale.x, 0.287) and is_equal_approx(sprite.scale.y, 0.287),
		"主角 scale=0.287（340px 帧主体 251px → 游戏内 72px）")
	var body_h: float = 251.0 * sprite.scale.y
	_check(absf(body_h - 72.0) <= 1.0, "主角渲染主体高 ≈72px（实测 %.1f）" % body_h)
	# centered=true：脚底在纹理 y=295，相对中心 +125px，缩放后落到节点原点
	var foot_y: float = sprite.position.y + 125.0 * sprite.scale.y
	_check(absf(foot_y) <= 1.0, "脚底对齐碰撞体底部 y≈0（实测 %.2f）" % foot_y)
	var hitbox_shape: RectangleShape2D = player.get_node_or_null(
		"Visuals/WeaponPivot/Hitbox/CollisionShape2D").shape as RectangleShape2D
	_check(hitbox_shape != null and is_equal_approx(hitbox_shape.size.x, 44.0),
		"剑判定体保持 44px（挂在 Visuals 下、不受 Sprite 缩放影响）")

func _audit_landmarks() -> void:
	for i: int in range(ROOM_SCENES.size()):
		var packed: PackedScene = load(ROOM_SCENES[i])
		var room: Node2D = packed.instantiate() as Node2D
		var node: Sprite2D = room.get_node_or_null(LANDMARK_PATHS[i]) as Sprite2D
		_check(node != null, "地标存在: " + LANDMARK_PATHS[i])
		if node == null or node.texture == null:
			continue
		var tex_w: float = float(node.texture.get_width())
		var rendered_w: float = tex_w * node.scale.x
		_check(tex_w <= 256.0, "地标用 200px 标准版而非 1024 原图 (%s, tex=%.0f)" % [LANDMARK_PATHS[i], tex_w])
		_check(rendered_w <= LANDMARK_LIMITS[i],
			"地标渲染宽度 %.0fpx ≤ %.0fpx (%s)" % [rendered_w, LANDMARK_LIMITS[i], LANDMARK_PATHS[i]])

func _audit_touch_hud() -> void:
	var packed: PackedScene = load(HUD_SCENE)
	var hud: CanvasLayer = packed.instantiate() as CanvasLayer
	var group: Control = hud.get_node_or_null("RootControl/RightButtonsGroup") as Control
	if group == null:
		_check(false, "RightButtonsGroup 存在")
		return
	var roll: Button = group.get_node_or_null("BtnRoll") as Button
	var primary: Button = group.get_node_or_null("BtnPrimaryAttack") as Button
	var secondary: Button = group.get_node_or_null("BtnSecondary") as Button
	var jump: Button = group.get_node_or_null("BtnJump") as Button
	_check(_no_overlap(roll, primary), "翻滚键与主攻击键不重叠")
	_check(_no_overlap(roll, secondary), "翻滚键与盾键不重叠")
	_check(_no_overlap(roll, jump), "翻滚键与跳跃键不重叠")
	var group_left: float = group.anchor_left * 1280.0
	_check(is_equal_approx(group_left, 704.0), "按钮组起点 x=704 与摇杆判定边界对齐（无死区）")
	var interact: Button = hud.get_node_or_null("RootControl/BtnInteract") as Button
	_check(interact != null and is_equal_approx(interact.anchor_left, 1.0)
		and is_equal_approx(interact.anchor_top, 0.0), "交互键移到右上角，不压画面中央")

func _no_overlap(a: Control, b: Control) -> bool:
	if a == null or b == null:
		return false
	var ra: Rect2 = Rect2(a.offset_left, a.offset_top, a.offset_right - a.offset_left,
		a.offset_bottom - a.offset_top)
	var rb: Rect2 = Rect2(b.offset_left, b.offset_top, b.offset_right - b.offset_left,
		b.offset_bottom - b.offset_top)
	return not ra.intersects(rb)

func _finish() -> void:
	print("errors: %d" % _fail_count)
	if _fail_count == 0:
		print("=== SCENE PROPORTION AUDIT: PASS ===")
	else:
		print("=== SCENE PROPORTION AUDIT: FAIL (%d) ===" % _fail_count)
	quit(1 if _fail_count > 0 else 0)
