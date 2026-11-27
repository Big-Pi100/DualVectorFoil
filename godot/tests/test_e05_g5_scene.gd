extends SceneTree

##
## G5 · Godot 真实场景集成验证
##
## 用 PackedScene 实例化 G5_Showcase.tscn（走 Godot 真实资源导入链），
## 验证 12 张资产作为 Sprite2D 在场景树中：
##   - 纹理成功加载（Texture2D 非 null、尺寸 > 0）
##   - 节点 visible、在场景树中
##   - 变换/位置有效
## 不依赖 headless 下不可靠的 SubViewport 截图（E04 已证实）。
##
## 运行：
##   E:\godot\Godot_v4.4.1-stable_win64_console.exe --headless --path <项目根> \
##     --script res://tests/test_e05_g5_scene.gd
##

const SCENE_PATH := "res://art/experiments/E05_G5/G5_Showcase.tscn"
const REPORT_PATH := "res://art/experiments/E05_G5/g5_scene_report.json"
const EXPECTED := [
	"player_attack", "player_back", "player_climb", "player_hurt", "player_jump",
	"fx_hit", "fx_jump_puff", "fx_purify", "fx_harvest",
	"ui_hud_frame", "ui_heart_icon", "ui_button_base",
]

var _errors: Array[String] = []
var _rows: Array[Dictionary] = []


func _initialize() -> void:
	call_deferred("_run")


func _check(ok: bool, msg: String) -> void:
	if ok:
		print("[PASS] ", msg)
	else:
		_errors.append(msg)
		print("[FAIL] ", msg)


func _run() -> void:
	print("=== G5 GODOT SCENE INTEGRATION ===")
	print("Godot: ", Engine.get_version_info().string)

	var packed: PackedScene = load(SCENE_PATH)
	if packed == null:
		_errors.append("无法加载场景: " + SCENE_PATH)
		_finish()
		return

	var inst: Node = packed.instantiate()
	root.add_child(inst)
	await process_frame

	var sprites: Array[Sprite2D] = []
	_collect_sprites(inst, sprites)
	_check(sprites.size() == EXPECTED.size(),
		"场景含 %d 个精灵 (期望 %d)" % [sprites.size(), EXPECTED.size()])

	var found: Dictionary = {}
	for sp in sprites:
		var n: String = sp.name
		found[n] = true
		var tex: Texture2D = sp.texture
		var tex_ok: bool = tex != null and tex.get_width() > 0 and tex.get_height() > 0
		_check(tex_ok, "%s 纹理导入成功 %s" % [n,
			("%dx%d" % [tex.get_width(), tex.get_height()]) if tex != null else "null"])
		_check(sp.visible and sp.is_inside_tree(), "%s 在场景树中且可见" % n)
		var pos: Vector2 = sp.position
		_check(pos.x >= 0 and pos.y >= 0 and pos.x <= 1280 and pos.y <= 720,
			"%s 变换在视口内 (%.0f,%.0f)" % [n, pos.x, pos.y])
		_rows.append({
			"node": n,
			"texture": ("%dx%d" % [tex.get_width(), tex.get_height()]) if tex != null else "null",
			"position": "%d,%d" % [int(pos.x), int(pos.y)],
			"visible": sp.visible,
		})

	for expected_name in EXPECTED:
		_check(found.has("Sprite_" + expected_name), "资产节点齐全: " + expected_name)

	_finish()


func _collect_sprites(node: Node, out: Array[Sprite2D]) -> void:
	if node is Sprite2D:
		out.append(node)
	for c in node.get_children():
		_collect_sprites(c, out)


func _finish() -> void:
	print("--- SUMMARY ---")
	print("sprites checked: ", _rows.size())
	print("errors: ", _errors.size())
	var f := FileAccess.open(ProjectSettings.globalize_path(REPORT_PATH), FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify({
			"engine": Engine.get_version_info().string,
			"scene": SCENE_PATH,
			"rows": _rows,
			"errors": _errors,
		}, "  "))
		f.close()
		print("report saved: ", REPORT_PATH)
	if _errors.is_empty():
		print("=== G5 SCENE GATE: PASS ===")
		quit(0)
	else:
		print("=== G5 SCENE GATE: FAIL ===")
		for e in _errors:
			print("  - ", e)
		quit(1)
