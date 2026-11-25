extends SceneTree
## 出两张对照图：F1（aos）满跳顶点 / F2（crayon）满跳顶点。
## 带窗口跑，headless 出不了图。
##
##     godot --path godot --script res://tests/shot_preset.gd

const DIR := "E:/IdentityCard/game-soulkeep/shots/"

var frames := 0
var player: Node2D
var shots := 0


func _initialize() -> void:
	var scene: Node = load("res://scenes/main.tscn").instantiate()
	root.add_child(scene)
	player = scene.get_node("Player")


func _save(name: String) -> void:
	var img: Image = root.get_texture().get_image()
	if img == null:
		print("[shot] 取图失败")
		return
	var path := DIR + name
	var err := img.save_png(path)
	print("[shot] %s -> %s  y=%.1f" % [path, "ok" if err == OK else str(err), player.global_position.y])


func _process(_delta: float) -> bool:
	frames += 1

	# 第一次：aos
	if frames == 5:
		player.apply_preset("aos")
		player.global_position = Vector2(200, 420)
	if frames == 20:
		Input.action_press("jump")
	if frames == 44:
		_save("godot_preset_aos.png")
		Input.action_release("jump")

	# 第二次：crayon
	if frames == 90:
		player.apply_preset("crayon")
		player.global_position = Vector2(200, 420)
		player.velocity = Vector2.ZERO
	if frames == 105:
		Input.action_press("jump")
	if frames == 126:
		_save("godot_preset_crayon.png")
		Input.action_release("jump")
	if frames == 140:
		return true
	return false
