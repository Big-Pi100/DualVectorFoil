extends SceneTree
## 引擎环境守卫 —— 把「Godot 版本定死」这件事变成可执行的断言，而不是文档里的一句话。
##
##     godot --headless --path godot --script res://tests/env_check.gd
##
## 为什么需要它：整套手感数字（满跳 203.9 / 滞空 917ms / 水平 270）是在
## **4.7.2 + 120Hz 物理步 + 线性过滤** 这一组前提下测出来的。换掉任何一个，
## 数字就不再可比，而失败是静默的 —— 测试依旧 PASS，只是数值悄悄变了。
##
## 改这些值时，先想清楚是「引擎升级」还是「配置松动」：
##   - 引擎升级 → 改 EXPECT_MINOR，并重跑 feel_smoke 对账，把新数值写进 FEEL_TABLE
##   - 配置松动 → 不要改这里，先问为什么要松

const EXPECT_MAJOR := 4
const EXPECT_MINOR := 7
const EXPECT_BUILD := "ed1daf0bf"          # 4.7.2-stable 的 commit 前缀
const EXPECT_TICKS := 120
const EXPECT_RENDERER := "gl_compatibility"
const EXPECT_FILTER := 1                   # 1 = linear，蜡笔是连续色调，不能是 nearest
const EXPECT_VIEW_W := 960
const EXPECT_VIEW_H := 540

var fail := 0


func _check(label: String, actual: Variant, expected: Variant) -> void:
	var ok := str(actual) == str(expected)
	if not ok:
		fail += 1
	print("  %s %-28s %s" % ["✓" if ok else "✗", label, str(actual)])
	if not ok:
		print("     期望 %s" % str(expected))


func _initialize() -> void:
	var v: Dictionary = Engine.get_version_info()
	print("[env] 引擎 %s" % str(v["string"]))

	# major / minor / build 三项全锁死。连 patch 升级也会红 —— 这是刻意的：
	# 升级引擎是个「决定」，不该因为随手装了个新版就悄悄发生。
	_check("major", v["major"], EXPECT_MAJOR)
	_check("minor", v["minor"], EXPECT_MINOR)
	_check("build 前缀", str(v["hash"]).substr(0, EXPECT_BUILD.length()), EXPECT_BUILD)

	_check("物理步 Hz", ProjectSettings.get_setting("physics/common/physics_ticks_per_second"), EXPECT_TICKS)
	_check("渲染后端", ProjectSettings.get_setting("rendering/renderer/rendering_method"), EXPECT_RENDERER)
	_check("纹理过滤", ProjectSettings.get_setting("rendering/textures/canvas_textures/default_texture_filter"), EXPECT_FILTER)
	_check("逻辑宽", ProjectSettings.get_setting("display/window/size/viewport_width"), EXPECT_VIEW_W)
	_check("逻辑高", ProjectSettings.get_setting("display/window/size/viewport_height"), EXPECT_VIEW_H)

	if v["major"] != EXPECT_MAJOR or v["minor"] != EXPECT_MINOR:
		print("\n跑错引擎了。本项目锁定 Godot %d.%d（见 docs/gdd/07 §9）。" % [EXPECT_MAJOR, EXPECT_MINOR])
		print("命令：E:/godot/Godot_v4.7.2-stable_win64_console.exe --path godot --headless --script res://tests/env_check.gd")

	print("\n[env] 结果：%s" % ("PASS" if fail == 0 else "FAIL %d 项" % fail))
	quit(0 if fail == 0 else 1)
