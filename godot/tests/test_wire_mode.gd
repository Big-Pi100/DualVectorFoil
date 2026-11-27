extends SceneTree

## 线框稿模式：**这一版产物到底有没有把贴图去干净**。
##
## 背景（2026-11-27 第六次）——白哥原话：
##   「你把所有贴图都去掉，出单纯的线框设计稿，然后在这个线框设计稿玩，
##     被认可了以后完了以后把线框替换成贴图。不然现在贴图素材不全，
##     看起来乱七八糟，反而更麻烦」
##
## 为什么这个测试必须存在：
##   线框稿的全部价值在于"只看空间，不被美术干扰"。只要漏进一张贴图，
##   它的价值就归零 —— 而且**不会让任何逻辑测试变红**（人照样能走、敌人照样会死）。
##   这种"只影响判断、不影响功能"的错，只能靠专门的判据守。
##
##   W1  Terrain 子树里 0 个贴图节点（Sprite2D / TextureRect / Polygon2D）
##   W2  房间根下有 WireOverlay（实体占位）
##   W3  玩家的 AnimatedSprite2D 被隐藏（人换成了几何框）
##   W4  每一只敌人的 Visual 都被隐藏（换成了菱形/三角）
##   W5  地形轮廓是 Line2D（线框），不是整块填充
##
## 反向验证的做法：把蓝图头部的 `wireframe=1` 改成 `0` 重新生成，
## W1 会列出 Backdrop*/Ground* 一串贴图节点、W2 直接没有节点 —— 全红。

const ROOM_PATH: String = "res://world/rooms/Room01.tscn"

var _fail: int = 0
var _root: Node = null
var _room: Node = null

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	_root = Node.new()
	root.add_child(_root)
	var ps: PackedScene = load(ROOM_PATH) as PackedScene
	if ps == null:
		push_error("加载失败：%s" % ROOM_PATH)
		quit(2)
		return
	_room = ps.instantiate()
	_root.add_child(_room)
	# 敌人要等 BaseRoom 走完入侵流程才生成；overlay 的 _process 也在这些帧里跑起来
	await _frames(10)
	if _room.has_method("_setup_invasion_state"):
		_room.call("_setup_invasion_state")
	await _frames(10)

	print("--- 线框稿模式 ---")
	_test_w1_no_textures()
	_test_w2_overlay()
	_test_w3_player_sprite_hidden()
	_test_w4_enemy_sprites_hidden()
	_test_w5_edges_are_lines()
	_test_w6_postprocess_off()

	print("WIRE: %s（%d 项失败）" % ["PASS" if _fail == 0 else "FAIL", _fail])
	quit(0 if _fail == 0 else 1)

#------------------------------------------------------------------------------

func _test_w1_no_textures() -> void:
	var terrain: Node = _room.get_node_or_null("Terrain")
	if terrain == null:
		_check(false, "W1 房间没有 Terrain 节点")
		return
	var bad: Array[String] = []
	var stack: Array[Node] = [terrain]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		if n is Sprite2D or n is TextureRect or n is Polygon2D:
			bad.append("%s(%s)" % [n.name, n.get_class()])
		stack.append_array(n.get_children())
	_check(bad.is_empty(), "W1 Terrain 里 0 个贴图节点（实际 %d：%s）"
		% [bad.size(), str(bad.slice(0, 6))])

func _test_w2_overlay() -> void:
	var ov: Node = _room.get_node_or_null("WireOverlay")
	_check(ov != null, "W2 房间根下有 WireOverlay（实体占位）")
	if ov != null:
		_check(ov.get_script() != null, "W2 WireOverlay 挂了脚本（否则它什么都不画）")

func _test_w3_player_sprite_hidden() -> void:
	var spr: Node = _room.get_node_or_null("Player/Visuals/Sprite")
	if spr == null:
		_check(false, "W3 找不到 Player/Visuals/Sprite")
		return
	_check(not (spr as CanvasItem).visible,
		"W3 玩家的 pixel sprite 已隐藏（换成几何框）")

func _test_w4_enemy_sprites_hidden() -> void:
	var inv: Node = _room.get_node_or_null("InvadersContainer")
	if inv == null:
		_check(false, "W4 没有 InvadersContainer")
		return
	var total: int = 0
	var leaked: Array[String] = []
	for c: Node in inv.get_children():
		var vis: Node = c.get_node_or_null("Visual")
		if vis == null:
			continue
		total += 1
		if (vis as CanvasItem).visible:
			leaked.append(c.name)
	# 敌人是运行时生成的，0 只说明入侵没起来 —— 那这条判据等于没测
	_check(total >= 10, "W4 场上有 ≥10 只敌人可测（实际 %d）" % total)
	_check(leaked.is_empty(), "W4 全部敌人的 Visual 都已隐藏（漏了 %d 只：%s）"
		% [leaked.size(), str(leaked.slice(0, 6))])

func _test_w5_edges_are_lines() -> void:
	var blocks: Node = _room.get_node_or_null("Terrain/Blocks")
	if blocks == null:
		_check(false, "W5 没有 Terrain/Blocks")
		return
	var lines: int = 0
	var rects: int = 0
	for c: Node in blocks.get_children():
		if c is Line2D:
			lines += 1
		elif c is ColorRect and String(c.name).begins_with("Block") \
				and not String(c.name).begins_with("BlockFill"):
			# `BlockFill*` 是线框版的淡填充（用来区分实心/空腔），不算"实心色块"；
			# 旧的 `Block%d` 才是整块不透明色块。
			rects += 1
	# 线框版每个实心矩形 = 1 条 Line2D 描边；
	# 如果这里还是 Block%d 的实心色块，说明 _emit_box 没走线框分支。
	_check(lines > 0 and rects == 0,
		"W5 地形轮廓用 Line2D 画（描边 %d 条，实心色块 %d 个）" % [lines, rects])

#------------------------------------------------------------------------------

## 线框稿运行时也不许有氛围调色。
##
## 紫月环境光 + 去饱和 + 纸纹是给"有贴图的成品"配的：叠在深底几何图上，
## 紫光会把冷色描边染得和背景分不开，去饱和会把橙色平台变成灰线。
## 三种颜色分不开 = 线框稿白做。这条和 W1 是一对：
## W1 管"没有美术资源"，W6 管"没有美术处理"。
func _test_w6_postprocess_off() -> void:
	var ppl: Node = _room.get_node_or_null("PostProcessLayer")
	if ppl == null:
		# 没有这个节点也算合格：房间本来就不带调色层
		_check(true, "W6 房间没有 PostProcessLayer（无需关闭）")
		return
	_check(not (ppl as CanvasLayer).visible,
		"W6 PostProcessLayer 已隐藏（紫月/去饱和/纸纹不参与线框稿）")

#------------------------------------------------------------------------------

func _check(ok: bool, msg: String) -> void:
	if ok:
		print("  ok   %s" % msg)
	else:
		print("  FAIL %s" % msg)
		_fail += 1

func _frames(n: int) -> void:
	for i: int in range(n):
		await process_frame
