extends SceneTree
## 沸腾线 shader 效果采样 —— 跑真实窗口渲染，隔 200ms 截两帧。
##
##     godot --path godot --script res://tests/boil_shot.gd
##
## 判据（由 tests/boil_check.py 比对）：
##   - 两帧必须**有差异**（说明在抖，不是死图）
##   - 差异必须**小**（说明是线条微动，不是白噪声糊成一片）
##   - 画面外圈不能变黑/透明（说明 UV 夹边界生效，没采到图外像素）

const OUT_A := "E:/IdentityCard/game-soulkeep/shots/godot_boil_a.png"
const OUT_B := "E:/IdentityCard/game-soulkeep/shots/godot_boil_b.png"
const GAP_MS := 200.0

var frames := 0
var t_first := 0
var took_first := false


func _initialize() -> void:
	var scene: Node = load("res://scenes/main.tscn").instantiate()
	root.add_child(scene)
	var bg: Sprite2D = scene.get_node("Background")
	var mat := ShaderMaterial.new()
	mat.shader = load("res://world/shaders/boiling_line.gdshader")
	bg.material = mat
	print("[boil] 背景已挂 boiling_line.gdshader")


func _process(_delta: float) -> bool:
	frames += 1
	if frames < 10:
		return false          # 等一帧渲染稳定

	if not took_first:
		if _grab(OUT_A):
			took_first = true
			t_first = Time.get_ticks_msec()
			print("[boil] 第一帧 %s" % OUT_A)
		elif frames > 60:
			print("[boil] FAIL 拿不到画面纹理")
			return true
		return false

	if Time.get_ticks_msec() - t_first >= GAP_MS:
		if _grab(OUT_B):
			print("[boil] 第二帧 %s（间隔 %d ms）" % [OUT_B, Time.get_ticks_msec() - t_first])
		return true          # 无论成败都结束

	if frames > 400:
		print("[boil] FAIL 超时")
		return true
	return false


func _grab(path: String) -> bool:
	var img: Image = root.get_texture().get_image()
	if img == null:
		return false
	return img.save_png(path) == OK
