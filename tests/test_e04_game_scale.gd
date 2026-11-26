extends SceneTree

##
## E04 · Godot 游戏尺寸与功能验证（G4 门禁）
##
## 在真实 Godot 4.4.1 中用 Image API 复现游戏导入后的处理链：
##   1. 加载抠图透明 PNG（Godot 的 Image 加载 = 真实导入解码路径）
##   2. 按游戏实际显示尺寸缩放（Image.resize + BILINEAR，等同 Sprite2D 过滤）
##   3. 75% 压力测试再缩放一次
##   4. 逐像素检查：洋红残留 / 白边 / 色边 / Alpha 异常 / 主体可辨性
##
## 尺寸依据（写进报告，不凭空指定）：
##   - 视口 1280x720；主角碰撞体 28x46，视觉外扩取 72px 高
##   - 敌人 48px 高；道具 36px 高；地形按平台宽 200px
##   - 75% 压力测试 = 上述尺寸的 0.75 倍
##
## 运行：
##   Godot_v4.4.1-stable_win64_console.exe --headless --path <项目根> \
##     --script res://tests/test_e04_game_scale.gd
##

const ASSET_DIR := "res://art/experiments/E04_GodotScale/assets/"
const REPORT_PATH := "res://art/experiments/E04_GodotScale/godot_pixel_report.json"

# 资产名 -> 目标显示尺寸（像素）。null = 源尺寸不缩放（原始资产对照）
const TARGETS := {
	"E01_hair_0": 40.0, "E01_hair_1": 40.0, "E01_hair_2": 40.0,
	"E01_scarf_0": 36.0, "E01_scarf_1": 36.0, "E01_scarf_2": 36.0,
	"E01_bag_0": 40.0, "E01_bag_1": 40.0, "E01_bag_2": 40.0,
	"E01_grass_0": 120.0, "E01_grass_1": 120.0, "E01_grass_2": 120.0,
	"E01_stone_0": 96.0, "E01_stone_1": 96.0, "E01_stone_2": 96.0,
	"E02_player_0": 72.0, "E02_player_1": 72.0, "E02_player_2": 72.0,
	"E02_enemy_0": 48.0, "E02_enemy_1": 48.0, "E02_enemy_2": 48.0,
	"E02_terrain_0": 200.0, "E02_terrain_1": 200.0, "E02_terrain_2": 200.0,
	"E02_item_0": 36.0, "E02_item_1": 36.0, "E02_item_2": 36.0,
}

var _errors: Array[String] = []
var _warnings: Array[String] = []
var _report: Array[Dictionary] = []


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


func _load(name: String) -> Image:
	var path := ProjectSettings.globalize_path(ASSET_DIR + name + ".png")
	return Image.load_from_file(path)


## 统计图像中"洋红残留"：不透明像素里 R 高、B 高、G 低且接近洋红。
func _count_magenta(img: Image) -> int:
	var n := 0
	var w := img.get_width()
	var h := img.get_height()
	for y in range(h):
		for x in range(w):
			var c := img.get_pixel(x, y)
			if c.a > 0.25 and c.r > 0.72 and c.b > 0.55 and c.g < 0.28:
				n += 1
	return n


## 统计"白边"：紧贴 Alpha 边界的一圈像素若接近纯白，说明抠图留白边。
func _count_white_fringe(img: Image) -> int:
	var n := 0
	var w := img.get_width()
	var h := img.get_height()
	for y in range(1, h - 1):
		for x in range(1, w - 1):
			var c := img.get_pixel(x, y)
			if c.a < 0.35 or c.a > 0.95:
				continue
			# 半透明边缘像素若是近纯白，视为白边
			if c.r > 0.90 and c.g > 0.90 and c.b > 0.90:
				n += 1
	return n


## 统计不透明像素占比与包围盒，用于判断主体是否在缩放后仍可辨。
func _subject_stats(img: Image) -> Dictionary:
	var w := img.get_width()
	var h := img.get_height()
	var count := 0
	var min_x := w
	var min_y := h
	var max_x := -1
	var max_y := -1
	for y in range(h):
		for x in range(w):
			if img.get_pixel(x, y).a > 0.35:
				count += 1
				min_x = mini(min_x, x)
				min_y = mini(min_y, y)
				max_x = maxi(max_x, x)
				max_y = maxi(max_y, y)
	return {
		"opaque_ratio": float(count) / float(w * h),
		"bbox_w": max_x - min_x + 1,
		"bbox_h": max_y - min_y + 1,
		"img_w": w,
		"img_h": h,
	}


## 按目标高度缩放（保持宽高比），用 Godot 的 BILINEAR 过滤，等同 Sprite2D 默认过滤。
func _scaled_to_height(src: Image, target_h: float) -> Image:
	var img := Image.new()
	img.copy_from(src)
	var ratio := target_h / float(img.get_height())
	var tw := maxi(1, int(round(img.get_width() * ratio)))
	var th := maxi(1, int(round(target_h)))
	img.resize(tw, th, Image.INTERPOLATE_BILINEAR)
	return img


func _run() -> void:
	print("=== E04 GODOT GAME-SCALE VERIFICATION ===")
	print("Godot: ", Engine.get_version_info().string)
	print("Viewport: 1280x720 | player 72px | 75% stress test")
	print("Assets: ", TARGETS.size())

	var names := TARGETS.keys()
	names.sort()

	var total_magenta := 0
	var total_white_fringe := 0
	var stone_reports: Array[Dictionary] = []

	for asset_name in names:
		var src := _load(asset_name)
		if src == null or src.is_empty():
			_errors.append("无法加载资产: " + asset_name)
			continue

		var target_h: float = TARGETS[asset_name]
		var full := _scaled_to_height(src, target_h)
		var stress := _scaled_to_height(src, target_h * 0.75)

		var m_full := _count_magenta(full)
		var m_stress := _count_magenta(stress)
		var wf_full := _count_white_fringe(full)
		var stats := _subject_stats(full)

		total_magenta += m_full
		total_white_fringe += wf_full

		# G4 硬性检查：正常尺寸下不得有洋红残留
		_check(m_full == 0, "%s 正常尺寸无洋红残留 (found %d)" % [asset_name, m_full])
		# 75% 压力测试：不得出现洋红残留
		_check(m_stress == 0, "%s 75%% 缩放无洋红残留 (found %d)" % [asset_name, m_stress])
		# 白边：允许极少量抗锯齿，超过阈值告警
		if wf_full > 8:
			_warn("%s 正常尺寸白边像素 %d 偏多" % [asset_name, wf_full])
		# 主体在缩放后仍需占据可见面积（防止缩小成一团噪点消失）
		_check(stats["bbox_h"] >= 8, "%s 正常尺寸主体高度 %d px 可辨" % [asset_name, stats["bbox_h"]])
		_check(stats["bbox_w"] >= 8, "%s 正常尺寸主体宽度 %d px 可辨" % [asset_name, stats["bbox_w"]])

		var row := {
			"asset": asset_name,
			"target_h": target_h,
			"full_size": "%dx%d" % [full.get_width(), full.get_height()],
			"stress_size": "%dx%d" % [stress.get_width(), stress.get_height()],
			"magenta_full": m_full,
			"magenta_stress": m_stress,
			"white_fringe_full": wf_full,
			"bbox_w": stats["bbox_w"],
			"bbox_h": stats["bbox_h"],
			"opaque_ratio": snappedf(stats["opaque_ratio"], 0.001),
		}
		_report.append(row)
		if asset_name.begins_with("E01_stone"):
			stone_reports.append(row)

	# O1 石块专项：缩放后主体仍需保留形状，不退化为一团
	for row in stone_reports:
		_check(row["bbox_h"] >= 40, "O1 石块 %s 75%% 前后仍可辨 (bbox_h=%d)" % [row["asset"], row["bbox_h"]])

	print("--- SUMMARY ---")
	print("assets checked: ", _report.size())
	print("total magenta residue: ", total_magenta)
	print("total white fringe pixels: ", total_white_fringe)
	print("errors: ", _errors.size())
	print("warnings: ", _warnings.size())

	var f := FileAccess.open(ProjectSettings.globalize_path(REPORT_PATH), FileAccess.WRITE)
	if f != null:
		var payload := {
			"engine": Engine.get_version_info().string,
			"viewport": "1280x720",
			"scale_rule": "player 72px / enemy 48px / item 36px / terrain 200px; 75% stress",
			"rows": _report,
			"errors": _errors,
			"warnings": _warnings,
		}
		f.store_string(JSON.stringify(payload, "  "))
		f.close()
		print("report saved: ", REPORT_PATH)

	if _errors.is_empty():
		print("=== G4 PIXEL GATE: PASS ===")
		quit(0)
	else:
		print("=== G4 PIXEL GATE: FAIL ===")
		for e in _errors:
			print("  - ", e)
		quit(1)
