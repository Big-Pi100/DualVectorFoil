extends SceneTree
## 资产接线守卫 —— 「美术换过之后，代码真的没有一处还指着旧图」变成可执行断言。
##
##     godot --headless --path godot --script res://tests/asset_wiring.gd
##
## 为什么需要它：`art/README §3` 定的规矩是「同一游戏不应存在两个主角」。
## 但换素材是**静默失败**的典型场景 —— 少改一张图，游戏照跑，只是某条动画
## 里冒出旧主角，而且只有玩到那个状态才看得见。这个测试把五件事钉死：
##
##   1. `res://` 下任何脚本/场景都不得再出现旧产线路径（hero/ tiles/ bg/）
##      —— 连注释里也不行。查的是字符串，不做语法分析：宁可逼你把注释换个说法，
##      也不要出现「代码干净、注释指的是一张已删除的图」这种半死状态。
##   2. player.gd 的 ANIM 表里每个状态都能加载，且是 340×340 的**单帧**标准化图
##   3. 场景树里每个 Sprite2D 的贴图要么来自 `assets/art/`，要么是程序化生成
##      （目前只有背景的 GradientTexture2D 属于后者，白名单显式列出）
##   4. **底板条摆得对不对**：实测像素宽 == 声明长度，中间段数 == 公式算出的 N
##      —— 图对了但摆错位置（差一格、缩放 1.2 倍）在这里红
##   5. 镜像 `assets/art/` 与真源 `art/approved/` 的 SYNC_STAMP 对得上
##   6. 打印资产接入覆盖率 —— 库里真正被游戏用到的有几张
##
## 加新资产后这里会红，是好事：那说明「入库」和「接进游戏」被分开了，
## 而 ART_GUIDE 的资产三态里第三态（游戏内验收）本来就不该自动成立。

const LEGACY_TOKENS := [
	"assets/hero/", "assets/tiles/", "assets/bg/",
	"hero_stand", "hero_walk", "hero_jump", "hero_attack", "bg_hall",
]
const EXPECT_FRAME := Vector2i(340, 340)
const ART_ROOT := "res://assets/art/"
const STAMP := "res://assets/art/SYNC_STAMP.txt"

var fail := 0


func _bad(msg: String) -> void:
	fail += 1
	print("  ✗ %s" % msg)


func _ok(msg: String) -> void:
	print("  ✓ %s" % msg)


func _initialize() -> void:
	var scene: Node = load("res://scenes/main.tscn").instantiate()
	root.add_child(scene)
	await process_frame

	_check_no_legacy_reference()
	_check_player_anim()
	var used := _check_scene_textures(scene)
	_check_strips(scene)
	_check_stamp(used)

	print("\n[assets] 结果：%s" % ("PASS" if fail == 0 else "FAIL %d 项" % fail))
	quit(0 if fail == 0 else 1)


# ── 1. 旧路径清零 ────────────────────────────────────────────
func _check_no_legacy_reference() -> void:
	print("\n[1] 旧产线路径")
	var hits: Array[String] = []
	var files: Array[String] = []
	_walk("res://", files)
	for path in files:
		if path == "res://tests/asset_wiring.gd":
			continue          # 本文件的 LEGACY_TOKENS 就是在写这些字符串，不能自报
		if not (path.ends_with(".gd") or path.ends_with(".tscn") or path.ends_with(".tres")):
			continue
		var text := FileAccess.get_file_as_string(path)
		for token in LEGACY_TOKENS:
			if text.contains(token):
				hits.append("%s 含 %s" % [path, token])
	if hits.is_empty():
		_ok("脚本/场景里没有旧产线路径（扫了 %d 个文件）" % files.size())
	else:
		for h in hits:
			_bad(h)


# ── 2. ANIM 表 ───────────────────────────────────────────────
func _check_player_anim() -> void:
	print("\n[2] player.gd 状态表")
	var player: Node = root.get_node("Main/Player")
	var anim: Dictionary = player.get_script().get_script_constant_map()["ANIM"]
	for state in anim:
		var path: String = anim[state]
		if not path.begins_with(ART_ROOT):
			_bad("%s → %s 不在 assets/art/ 下" % [state, path])
			continue
		if not ResourceLoader.exists(path):
			_bad("%s → 文件不存在 %s" % [state, path])
			continue
		var tex: Texture2D = load(path)
		if tex.get_size() != Vector2(EXPECT_FRAME):
			_bad("%s → %s 尺寸 %s，期望 %s" % [state, path, tex.get_size(), EXPECT_FRAME])
			continue
		_ok("%-7s → %s" % [state, path.get_file()])

	var sprite: Sprite2D = player.get_node("Sprite")
	if sprite.hframes != 1 or sprite.vframes != 1:
		_bad("Sprite 不是单帧（hframes=%d vframes=%d）—— 标准化图是一态一图" % [sprite.hframes, sprite.vframes])
	else:
		_ok("Sprite 单帧渲染")


# ── 3. 场景贴图来源 ──────────────────────────────────────────
func _check_scene_textures(scene: Node) -> Dictionary:
	print("\n[3] 场景树贴图来源")
	var used: Dictionary = {}
	var procedural := 0
	for node in _all_sprites(scene):
		var tex: Texture2D = node.texture
		if tex == null:
			_bad("%s 贴图为 null" % node.get_path())
			continue
		var rp := tex.resource_path
		# 空路径 = 运行时 new 的；含 "::" = 场景内嵌 sub_resource（如背景渐变）。
		# 两者都不是文件资产，只有程序化渐变在白名单里。
		if rp == "" or rp.contains("::"):
			procedural += 1
			if not (tex is GradientTexture2D):
				_bad("%s 用的是程序化贴图（%s），不在白名单" % [node.get_path(), tex.get_class()])
			continue
		if not rp.begins_with(ART_ROOT):
			_bad("%s 引用了 %s —— 不是 approved 资产" % [node.get_path(), rp])
			continue
		used[rp] = true
	# 玩家是实例化的，当帧只会显示一态；把 ANIM 全表并进来才算真实接入面
	var anim: Dictionary = root.get_node("Main/Player").get_script().get_script_constant_map()["ANIM"]
	for state in anim:
		used[anim[state]] = true
	_ok("%d 个 Sprite2D 全部指向 assets/art/（另有 %d 个程序化渐变）" % [_all_sprites(scene).size() - procedural, procedural])
	return used


# ── 4. 底板条摆位 ────────────────────────────────────────────
func _check_strips(scene: Node) -> void:
	print("\n[4] 底板条（左端 + 中间×N + 右端）")
	for node_name in ["Ground", "PlatA", "PlatB"]:
		var strip: Node2D = scene.get_node_or_null(node_name)
		if strip == null:
			_bad("场景里没有 %s" % node_name)
			continue
		var cap_w: int = strip.left_tex.get_width()
		var mid_w: int = strip.mid_tex.get_width()
		var span := int(round(strip.length_px)) - cap_w * 2
		var want_n := int(round(float(span) / float(mid_w)))
		if strip.sections != want_n:
			_bad("%s 中间段 %d，公式算 %d（长度 %.0f / 端点 %d / 中段 %d）"
				% [node_name, strip.sections, want_n, strip.length_px, cap_w, mid_w])
			continue
		if want_n * mid_w != span:
			_bad("%s 长度 %.0f 不是 %d + %d×N —— 规则外的长度，别在场景里硬塞"
				% [node_name, strip.length_px, cap_w * 2, mid_w])
			continue
		var w: float = strip.measured_width()
		if absf(w - strip.length_px) > 0.5:
			_bad("%s 实测宽 %.1f ≠ 声明 %.0f（差 %.1f，摆位漏了一段或缩放过了）"
				% [node_name, w, strip.length_px, strip.length_px - w])
			continue
		_ok("%-6s 长 %4.0f = %d + %d×%d，实测 %.0f" % [node_name, strip.length_px, cap_w * 2, mid_w, want_n, w])


# ── 5. 镜像新鲜度 ────────────────────────────────────────────
func _check_stamp(used: Dictionary) -> void:
	print("\n[5] 镜像 SYNC_STAMP")
	if not FileAccess.file_exists(STAMP):
		_bad("缺 SYNC_STAMP.txt —— 跑 python art/tools/sync_godot.py")
		return
	var text := FileAccess.get_file_as_string(STAMP)
	var counted := 0
	for line in text.split("\n"):
		if line.begins_with("files"):
			counted = int(line.split("=")[1].strip_edges())
	var on_disk := 0
	var files: Array[String] = []
	_walk(ART_ROOT, files)
	for f in files:
		if f.ends_with(".png") or f.ends_with(".json"):
			on_disk += 1
	if counted == on_disk:
		_ok("stamp 记 %d 张，磁盘 %d 张，一致" % [counted, on_disk])
	else:
		_bad("stamp 记 %d 张，磁盘 %d 张 —— 镜像被手改过或忘了 sync" % [counted, on_disk])
	_ok("本期接入 %d / %d 张（其余已入库未接线，见 art/README §2 资产三态）" % [used.size(), on_disk - 1])


# ── 工具 ─────────────────────────────────────────────────────
func _walk(dir_path: String, out: Array[String]) -> void:
	var d := DirAccess.open(dir_path)
	if d == null:
		return
	d.list_dir_begin()
	var name := d.get_next()
	while name != "":
		if name.begins_with("."):
			name = d.get_next()
			continue
		var full := dir_path.path_join(name)
		if d.current_is_dir():
			_walk(full, out)
		else:
			out.append(full)
		name = d.get_next()
	d.list_dir_end()


func _all_sprites(n: Node) -> Array[Sprite2D]:
	var out: Array[Sprite2D] = []
	if n is Sprite2D:
		out.append(n)
	for c in n.get_children():
		out.append_array(_all_sprites(c))
	return out
