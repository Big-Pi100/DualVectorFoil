extends SceneTree

##
## G5 · 生产准入验证（精灵帧一致性 + Godot 尺寸链）
##
## 验证两类资产：
##   A. 主角标准化精灵帧（player_*_std.png，340x340，脚底锚点 y=296）
##      - 帧尺寸一致：全部同为 340x340
##      - 锚点一致：脚底 alpha 边界 y 落在同一行（容差 2px）
##      - 角色比例：各帧主体 bbox 高度不与画布比失控
##   B. G5 全部 12 张透明资产（5 主角 + 4 特效 + 3 UI）
##      - 按 Godot 游戏尺寸缩放（BILINEAR，等同 Sprite2D 过滤）
##      - 75% 压力缩放
##      - 逐像素检查洋红残留 / 白边 / 主体可辨性
##
## 尺寸依据：主角 72px、特效 40px、UI 56px（视口 1280x720，移动端触屏）
##
## 运行：
##   E:\godot\Godot_v4.4.1-stable_win64_console.exe --headless --path <项目根> \
##     --script res://tests/test_e05_g5_sprites.gd
##

const SPRITE_DIR := "res://art/experiments/E05_G5/sprites/"
const ASSET_DIR := "res://art/experiments/E05_G5/assets/"
const REPORT_PATH := "res://art/experiments/E05_G5/g5_pixel_report.json"

const FRAME_SIZE := Vector2i(340, 340)
const FOOT_ANCHOR_Y := 296

# 精灵帧名 -> 游戏显示高度
const SPRITE_TARGETS := {
	"player_attack_std": 72.0,
	"player_back_std": 72.0,
	"player_climb_std": 72.0,
	"player_hurt_std": 72.0,
	"player_jump_std": 72.0,
}

# 全部资产 -> 游戏显示高度
const ASSET_TARGETS := {
	"player_attack": 72.0, "player_back": 72.0, "player_climb": 72.0,
	"player_hurt": 72.0, "player_jump": 72.0,
	"fx_hit": 40.0, "fx_jump_puff": 40.0, "fx_purify": 40.0, "fx_harvest": 40.0,
	"ui_hud_frame": 56.0, "ui_heart_icon": 40.0, "ui_button_base": 64.0,
}

var _errors: Array[String] = []
var _warnings: Array[String] = []
var _rows: Array[Dictionary] = []


func _initialize() -> void:
	call_deferred("_run")


func _check(ok: bool, msg: String) -> void:
	if ok:
		print("[PASS] ", msg)
	else:
		_errors.append(msg)
		print("[FAIL] ", msg)


func _warn(msg: String) -> void:
	_warnings.append(msg)
	print("[WARN] ", msg)


func _load(dir: String, name: String) -> Image:
	return Image.load_from_file(ProjectSettings.globalize_path(dir + name + ".png"))


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
	var w := img.get_width()
	var h := img.get_height()
	for y in range(1, h - 1):
		for x in range(1, w - 1):
			var c := img.get_pixel(x, y)
			if c.a < 0.35 or c.a > 0.95:
				continue
			if c.r > 0.90 and c.g > 0.90 and c.b > 0.90:
				n += 1
	return n


func _subject_bbox(img: Image) -> Dictionary:
	var w := img.get_width()
	var h := img.get_height()
	var min_x := w
	var min_y := h
	var max_x := -1
	var max_y := -1
	var count := 0
	for y in range(h):
		for x in range(w):
			if img.get_pixel(x, y).a > 0.35:
				count += 1
				min_x = mini(min_x, x)
				min_y = mini(min_y, y)
				max_x = maxi(max_x, x)
				max_y = maxi(max_y, y)
	return {
		"min_x": min_x, "min_y": min_y, "max_x": max_x, "max_y": max_y,
		"w": max_x - min_x + 1, "h": max_y - min_y + 1,
		"opaque": count,
	}


func _scaled_to_height(src: Image, target_h: float) -> Image:
	var img := Image.new()
	img.copy_from(src)
	var ratio := target_h / float(img.get_height())
	var tw := maxi(1, int(round(img.get_width() * ratio)))
	var th := maxi(1, int(round(target_h)))
	img.resize(tw, th, Image.INTERPOLATE_BILINEAR)
	return img


func _run() -> void:
	print("=== G5 PRODUCTION GATE VERIFICATION ===")
	print("Godot: ", Engine.get_version_info().string)
	print("Frame canvas: 340x340 | foot anchor y=296 | player 72px")

	# ---- A. 精灵帧一致性 ----
	var frame_names := SPRITE_TARGETS.keys()
	frame_names.sort()
	var foot_ys: Array[int] = []
	var frame_heights: Array[int] = []

	for name in frame_names:
		var img := _load(SPRITE_DIR, name)
		if img == null or img.is_empty():
			_errors.append("无法加载精灵帧: " + name)
			continue
		_check(img.get_width() == FRAME_SIZE.x and img.get_height() == FRAME_SIZE.y,
			"%s 帧尺寸一致 %dx%d" % [name, img.get_width(), img.get_height()])
		var bb := _subject_bbox(img)
		foot_ys.append(bb["max_y"])
		frame_heights.append(bb["h"])
		_rows.append({
			"kind": "sprite_frame", "asset": name,
			"frame": "%dx%d" % [img.get_width(), img.get_height()],
			"bbox_w": bb["w"], "bbox_h": bb["h"],
			"foot_y": bb["max_y"],
		})

	if foot_ys.size() >= 2:
		var fmin: int = foot_ys.min()
		var fmax: int = foot_ys.max()
		_check(fmax - fmin <= 2, "精灵帧脚底锚点一致 (范围 %d..%d, 差 %d)" % [fmin, fmax, fmax - fmin])
	if frame_heights.size() >= 2:
		var hmin: int = frame_heights.min()
		var hmax: int = frame_heights.max()
		# 姿态不同导致高度不同（坐姿/腾空），只做失控检查：不超过 2.5 倍
		_check(float(hmax) / float(maxi(1, hmin)) <= 2.5,
			"精灵帧主体高度未失控 (min %d / max %d)" % [hmin, hmax])

	# ---- B. Godot 尺寸链 ----
	var asset_names := ASSET_TARGETS.keys()
	asset_names.sort()
	var total_magenta := 0
	var total_white := 0

	for name in asset_names:
		var src := _load(ASSET_DIR, name)
		if src == null or src.is_empty():
			_errors.append("无法加载资产: " + name)
			continue
		var target_h: float = ASSET_TARGETS[name]
		var full := _scaled_to_height(src, target_h)
		var stress := _scaled_to_height(src, target_h * 0.75)
		var m_full := _count_magenta(full)
		var m_stress := _count_magenta(stress)
		var wf := _count_white_fringe(full)
		var bb := _subject_bbox(full)
		total_magenta += m_full + m_stress
		total_white += wf

		_check(m_full == 0, "%s 正常尺寸无洋红残留 (%d)" % [name, m_full])
		_check(m_stress == 0, "%s 75%% 缩放无洋红残留 (%d)" % [name, m_stress])
		if wf > 8:
			_warn("%s 白边像素 %d 偏多" % [name, wf])
		_check(bb["h"] >= 8 and bb["w"] >= 8,
			"%s 游戏尺寸主体可辨 %dx%d" % [name, bb["w"], bb["h"]])

		_rows.append({
			"kind": "game_scale", "asset": name,
			"target_h": target_h,
			"full": "%dx%d" % [full.get_width(), full.get_height()],
			"stress": "%dx%d" % [stress.get_width(), stress.get_height()],
			"magenta_full": m_full, "magenta_stress": m_stress,
			"white_fringe": wf, "bbox_w": bb["w"], "bbox_h": bb["h"],
		})

	print("--- SUMMARY ---")
	print("rows: ", _rows.size())
	print("total magenta (full+stress): ", total_magenta)
	print("total white fringe: ", total_white)
	print("errors: ", _errors.size())
	print("warnings: ", _warnings.size())

	var f := FileAccess.open(ProjectSettings.globalize_path(REPORT_PATH), FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify({
			"engine": Engine.get_version_info().string,
			"frame_canvas": "340x340", "foot_anchor_y": FOOT_ANCHOR_Y,
			"scale_rule": "player 72px / fx 40px / ui 40-64px; 75% stress",
			"rows": _rows, "errors": _errors, "warnings": _warnings,
		}, "  "))
		f.close()
		print("report saved: ", REPORT_PATH)

	if _errors.is_empty():
		print("=== G5 PIXEL GATE: PASS ===")
		quit(0)
	else:
		print("=== G5 PIXEL GATE: FAIL ===")
		for e in _errors:
			print("  - ", e)
		quit(1)
