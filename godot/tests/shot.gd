extends SceneTree
## 渲染快照 —— 跑真实窗口渲染（不能 headless，headless 是 dummy 渲染器出不了图）。
##
##     godot --path godot --script res://tests/shot.gd
##
## 出图到项目根 shots/godot_smoke.png。

const OUT := "E:/IdentityCard/game-soulkeep/shots/godot_smoke.png"

var frames := 0
var player: Node2D


func _initialize() -> void:
	var scene: Node = load("res://scenes/main.tscn").instantiate()
	root.add_child(scene)
	player = scene.get_node("Player")
	print("[shot] 场景已加载")


func _process(delta: float) -> bool:
	frames += 1

	# 落地后往右走几步，在"站在地上走路"的姿态截图 —— 这样能看出人物与地面的比例
	if frames == 20:
		Input.action_press("move_right")

	if frames == 46:
		var img: Image = root.get_texture().get_image()
		if img == null:
			print("[shot] FAIL 拿不到画面纹理")
			return true
		var err := img.save_png(OUT)
		print("[shot] 保存 %s -> %s  size=%s" % [OUT, "ok" if err == OK else "err %d" % err, str(img.get_size())])
		print("[shot] 玩家位置 = %s  速度 = %s" % [str(player.global_position), str(player.velocity)])
		return true

	if frames > 200:
		print("[shot] FAIL 200 帧内没完成截图")
		return true
	return false
