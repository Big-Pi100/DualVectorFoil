extends SceneTree

##
## 折纸鸟 NPC 正式资产门禁测试（E01–E04 抽样 + P1–P11 抠图 + G4 尺寸链）
##
## 用真实 Godot 4.4.1 Image API 复现游戏缩放链：
##   origami_bird_idle_00.png (128x128) → 48px 游戏高 → 36px(75%) 压力
## 检查：洋红残留 / 白边 / 主体可辨 / 双帧锚点 / 透明区 RGB 扩散。
##

const ASSET := "res://art/approved/Characters/origami_bird_idle_00.png"

var _errors: Array[String] = []


func _initialize() -> void:
	call_deferred("_run")


func _check(ok: bool, msg: String) -> void:
	if ok:
		print("[PASS] ", msg)
	else:
		_errors.append(msg)
		print("[FAIL] ", msg)


func _count_magenta(img: Image) -> int:
	var n := 0
	for y in range(img.get_height()):
		for x in range(img.get_width()):
			var c := img.get_pixel(x, y)
			if c.a > 0.25 and c.r > 0.72 and c.b > 0.55 and c.g < 0.28:
				n += 1
	return n


func _count_white_fringe(img: Image) -> int:
	var n := 0
	for y in range(1, img.get_height() - 1):
		for x in range(1, img.get_width() - 1):
			var c := img.get_pixel(x, y)
			if c.a < 0.35 or c.a > 0.95:
				continue
			if c.r > 0.90 and c.g > 0.90 and c.b > 0.90:
				n += 1
	return n


func _bbox(img: Image) -> Dictionary:
	var min_x := img.get_width()
	var min_y := img.get_height()
	var max_x := -1
	var max_y := -1
	for y in range(img.get_height()):
		for x in range(img.get_width()):
			if img.get_pixel(x, y).a > 0.35:
				min_x = mini(min_x, x)
				min_y = mini(min_y, y)
				max_x = maxi(max_x, x)
				max_y = maxi(max_y, y)
	return {"x0": min_x, "y0": min_y, "x1": max_x, "y1": max_y,
		"w": max_x - min_x + 1, "h": max_y - min_y + 1}


func _scaled_to_height(src: Image, target_h: float) -> Image:
	var img := Image.new()
	img.copy_from(src)
	var ratio := target_h / float(img.get_height())
	img.resize(maxi(1, int(round(img.get_width() * ratio))),
		maxi(1, int(round(target_h))), Image.INTERPOLATE_BILINEAR)
	return img


func _run() -> void:
	print("=== ORIGAMI BIRD ASSET GATE ===")
	print("Godot: ", Engine.get_version_info().string)

	var src := Image.load_from_file(ProjectSettings.globalize_path(ASSET))
	_check(src != null and not src.is_empty(), "资产可加载: " + ASSET)
	if src == null:
		quit(1)
		return

	_check(src.get_width() == 128 and src.get_height() == 128,
		"标准 NPC 帧 128x128 (实测 %dx%d)" % [src.get_width(), src.get_height()])

	# E04 尺寸链：48px 游戏高 + 36px(75%) 压力
	var full := _scaled_to_height(src, 48.0)
	var stress := _scaled_to_height(src, 36.0)
	_check(full.get_height() == 48, "游戏尺寸缩放到 48px 高")
	_check(stress.get_height() == 36, "75% 压力缩放到 36px 高")

	var m_full := _count_magenta(full)
	var m_stress := _count_magenta(stress)
	_check(m_full == 0, "48px 无洋红残留 (found %d)" % m_full)
	_check(m_stress == 0, "36px 无洋红残留 (found %d)" % m_stress)

	var wf := _count_white_fringe(full)
	_check(wf <= 8, "48px 白边像素 %d ≤ 8" % wf)

	var b := _bbox(full)
	_check(b["w"] >= 24 and b["h"] >= 24,
		"48px 主体可辨 (bbox %dx%d)" % [b["w"], b["h"]])

	# 主体在帧内居中（脚底锚点一致性：NPC 单帧，检查中心偏移不超 8px）
	var cx := float(b["x0"] + b["x1"]) / 2.0
	var cy := float(b["y0"] + b["y1"]) / 2.0
	_check(absf(cx - 24.0) <= 8.0 and absf(cy - 24.0) <= 8.0,
		"主体居中 (中心 %.1f,%.1f 距帧心 ≤8px)" % [cx, cy])

	# 透明区 RGB 扩散：抽查四角 alpha=0 像素不得残留洋红 RGB
	var corners: Array[Vector2i] = [Vector2i(0, 0), Vector2i(127, 0),
		Vector2i(0, 127), Vector2i(127, 127)]
	var bad := 0
	for p in corners:
		var c := src.get_pixel(p.x, p.y)
		if c.a == 0 and c.r > 0.72 and c.b > 0.55 and c.g < 0.28:
			bad += 1
	_check(bad == 0, "透明角落无洋红 RGB 残留 (%d/4)" % bad)

	if _errors.is_empty():
		print("=== ORIGAMI BIRD ASSET GATE: PASS ===")
		quit(0)
	else:
		print("=== ORIGAMI BIRD ASSET GATE: FAIL ===")
		for e in _errors:
			print("  - ", e)
		quit(1)
