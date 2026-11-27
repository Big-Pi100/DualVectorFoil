extends SceneTree

## 场景装配门禁（全量遍历）：资产换装后，防止「单张资产 PASS、装进场景全乱套」。
## 检查四层：① 所有场景可实例化 ② 所有 Sprite 不用 1024 原图/渲染尺寸失控
## ③ 所有碰撞体尺寸合法 ④ 所有触屏按钮两两不重叠、无死区、不压画面中央。
## 与美术门禁 G0–G5（管单张图）互补：这里管「图装进 Godot 之后」。

const ROOM_SCENES: Array[String] = [
	"res://world/rooms/Room01.tscn", "res://world/rooms/Room02.tscn",
	"res://world/rooms/Room03.tscn", "res://world/rooms/Room04.tscn",
	"res://world/rooms/Room05.tscn", "res://world/rooms/SafeHouse.tscn",
]
const ENTITY_SCENES: Array[String] = [
	"res://entities/player/Player.tscn", "res://world/enemies/Invader.tscn",
	"res://world/interactables/SoilPlot.tscn", "res://world/interactables/RestBench.tscn",
	"res://ui/TouchHUD.tscn", "res://ui/TravelJournal.tscn",
]
const MAX_TEXTURE_W: float = 512.0   # 超过即用了 1024 原图而非游戏尺寸标准版
const MAX_RENDER: float = 500.0      # 单个 Sprite 渲染包围盒上限（视口 1280×720）
## 上限 1300：旧地板 1200×40；蓝图地形会合并出跨整面墙的天花板/地面（1248×48），
## 那是合法的整块地形，不是导入事故。真要防的是"尺寸离谱到物理会炸"的碰撞体。
const MAX_COLLISION: float = 1300.0

var _fail_count: int = 0
var _sprite_count: int = 0
var _collision_count: int = 0
var _button_count: int = 0
var _manifest_paths: Dictionary = {}

func _check(ok: bool, label: String) -> void:
	if ok:
		return
	_fail_count += 1
	print("  FAIL  ", label)

func _initialize() -> void:
	print("=== SCENE ASSEMBLY GATE (full traversal) ===")
	_load_manifest()
	for path: String in ROOM_SCENES:
		_audit_scene(path)
	for path: String in ENTITY_SCENES:
		_audit_scene(path)
	_audit_player_anchor()
	_audit_touch_hud()
	print("coverage: sprites=%d collisions=%d buttons=%d" % [_sprite_count, _collision_count, _button_count])
	_finish()

func _load_manifest() -> void:
	var f: FileAccess = FileAccess.open("res://art/approved/manifest.json", FileAccess.READ)
	if f == null:
		_check(false, "manifest.json 无法读取")
		return
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	if parsed is Dictionary:
		for key: String in (parsed as Dictionary).keys():
			var entry: Variant = (parsed as Dictionary)[key]
			if entry is Dictionary and (entry as Dictionary).has("approved"):
				var approved: String = (entry as Dictionary)["approved"]
				_manifest_paths[approved] = true
	f.close()

func _audit_scene(path: String) -> void:
	var packed: PackedScene = load(path) as PackedScene
	_check(packed != null, path + " 可加载")
	if packed == null:
		return
	var inst: Node = packed.instantiate()
	_check(inst != null, path + " 可实例化")
	if inst == null:
		return
	# 部分节点的贴图由脚本在 _ready/apply_variant 里赋值（如 InvaderVisual），
	# headless 下 instantiate 不跑 _ready，这里显式触发一次再检查，避免误报。
	for n: Node in inst.find_children("*", "", true, false):
		if n.has_method("apply_variant"):
			n.call("apply_variant")
	var stack: Array[Node] = [inst]
	while not stack.is_empty():
		var node: Node = stack.pop_back() as Node
		for child: Node in node.get_children():
			stack.append(child)
		if node is Sprite2D:
			_audit_sprite(path, node as Sprite2D)
		elif node is CollisionShape2D:
			_audit_collision(path, node as CollisionShape2D)
	inst.free()

func _audit_sprite(scene_path: String, sprite: Sprite2D) -> void:
	if sprite.texture == null:
		_check(false, "%s/%s 纹理为 null" % [scene_path, sprite.name])
		return
	_sprite_count += 1
	var tex: Texture2D = sprite.texture
	var tw: float = float(tex.get_width())
	var th: float = float(tex.get_height())
	var rw: float = tw * absf(sprite.scale.x)
	var rh: float = th * absf(sprite.scale.y)
	var label: String = "%s/%s (%s)" % [scene_path, sprite.name, tex.resource_path.get_file()]
	_check(tw <= MAX_TEXTURE_W, label + " 用了原图不是标准版 (tex %.0f)" % tw)
	_check(rw <= MAX_RENDER and rh <= MAX_RENDER, label + " 渲染尺寸失控 %.0fx%.0f" % [rw, rh])
	# manifest 追溯：场景直接引用的纹理必须在 approved 清单里（_200 标准版也要登记）
	var rel: String = tex.resource_path.trim_prefix("res://")
	_check(_manifest_paths.has(rel), label + " 未在 manifest.json 登记")

func _audit_collision(scene_path: String, shape: CollisionShape2D) -> void:
	if shape.shape == null:
		_check(false, "%s/%s shape 为 null" % [scene_path, shape.name])
		return
	_collision_count += 1
	if shape.shape is RectangleShape2D:
		var size: Vector2 = (shape.shape as RectangleShape2D).size
		_check(size.x > 0.0 and size.y > 0.0,
			"%s/%s 碰撞体尺寸非正 (%.0fx%.0f)" % [scene_path, shape.name, size.x, size.y])
		_check(size.x <= MAX_COLLISION and size.y <= MAX_COLLISION,
			"%s/%s 碰撞体尺寸异常 (%.0fx%.0f)" % [scene_path, shape.name, size.x, size.y])

func _audit_player_anchor() -> void:
	var packed: PackedScene = load("res://entities/player/Player.tscn") as PackedScene
	if packed == null:
		return
	var player: Node2D = packed.instantiate() as Node2D
	var sprite: AnimatedSprite2D = player.get_node_or_null("Visuals/Sprite") as AnimatedSprite2D
	_check(sprite != null, "主角 AnimatedSprite2D 存在")
	if sprite != null:
		var body_h: float = 251.0 * sprite.scale.y
		_check(absf(body_h - 72.0) <= 1.0, "主角渲染主体高 ≈72px（实测 %.1f）" % body_h)
		var foot_y: float = sprite.position.y + 125.0 * sprite.scale.y
		_check(absf(foot_y) <= 1.0, "脚底对齐碰撞体底部 y≈0（实测 %.2f）" % foot_y)
	player.free()

func _audit_touch_hud() -> void:
	var packed: PackedScene = load("res://ui/TouchHUD.tscn") as PackedScene
	if packed == null:
		return
	var hud: CanvasLayer = packed.instantiate() as CanvasLayer
	var group: Control = hud.get_node_or_null("RootControl/RightButtonsGroup") as Control
	if group == null:
		_check(false, "RightButtonsGroup 存在")
		hud.free()
		return
	# 全按钮两两不重叠（而不只是抽查翻滚/主攻）
	var buttons: Array[Button] = []
	for child: Node in hud.find_children("*", "Button", true, false):
		buttons.append(child as Button)
	_button_count = buttons.size()
	for i: int in range(buttons.size()):
		for j: int in range(i + 1, buttons.size()):
			var ri: Rect2 = _rect(buttons[i])
			var rj: Rect2 = _rect(buttons[j])
			_check(not ri.intersects(rj), "按钮重叠: %s / %s" % [buttons[i].name, buttons[j].name])
	# 道具星星主体 36px：灯塔灯 / 风车叶片等装饰放大不得失控（曾出现 2.2 倍→79px）
	#
	# 2026-11-27：这些装饰从 `Sprite2D`（借 item_star 的图）换成了 `Polygon2D`
	# 原始几何体。原来这里写 `find_child(...) as Sprite2D`，换完之后拿到 null、
	# 循环空转 —— **全称判断在空集合上永远为真**，测试照样绿，等于判据被删了都没人知道。
	# 所以两件事一起改：量形状而不是量节点类型；再断言"至少量到几个"，
	# 让"空转"本身变成失败。
	var measured: int = 0
	for path_key: String in ["LampStar", "Blade0", "Blade1", "Blade2"]:
		for room_path: String in ROOM_SCENES:
			var rp: PackedScene = load(room_path) as PackedScene
			if rp == null:
				continue
			var ri: Node = rp.instantiate()
			var deco: Node2D = ri.find_child(path_key, true, false) as Node2D
			if deco != null:
				var rendered_h: float = _visual_height(deco)
				if rendered_h > 0.0:
					measured += 1
					_check(rendered_h <= 72.0,
						"%s/%s 道具渲染高 %.0fpx 超基线" % [room_path, path_key, rendered_h])
			ri.free()
	_check(measured >= 4, "装饰高度判据至少量到 4 个节点（实测 %d 个，判据空转）" % measured)
	var group_left: float = group.anchor_left * 1280.0
	_check(is_equal_approx(group_left, 704.0), "按钮组起点 x=704 与摇杆判定边界对齐（无死区）")
	var interact: Button = hud.get_node_or_null("RootControl/BtnInteract") as Button
	_check(interact != null and is_equal_approx(interact.anchor_left, 1.0), "交互键在右上角不压画面中央")
	hud.free()

## 装饰节点的**渲染高度**：Sprite2D 量贴图高×scale，Polygon2D 量多边形包围盒高×scale。
## 不按节点类型分两支判据 —— 换实现方式时判据应当跟着形状走。
func _visual_height(n: Node2D) -> float:
	if n is Sprite2D:
		var s := n as Sprite2D
		if s.texture == null:
			return 0.0
		return float(s.texture.get_height()) * absf(s.scale.y)
	if n is Polygon2D:
		var p := n as Polygon2D
		if p.polygon.is_empty():
			return 0.0
		var lo: float = INF
		var hi: float = -INF
		for v: Vector2 in p.polygon:
			lo = minf(lo, v.y)
			hi = maxf(hi, v.y)
		return (hi - lo) * absf(p.scale.y)
	return 0.0


func _rect(btn: Button) -> Rect2:
	return Rect2(btn.offset_left, btn.offset_top, btn.offset_right - btn.offset_left,
		btn.offset_bottom - btn.offset_top)

func _finish() -> void:
	print("errors: %d" % _fail_count)
	if _fail_count == 0:
		print("=== SCENE ASSEMBLY GATE: PASS ===")
	else:
		print("=== SCENE ASSEMBLY GATE: FAIL (%d) ===" % _fail_count)
	quit(1 if _fail_count > 0 else 0)
