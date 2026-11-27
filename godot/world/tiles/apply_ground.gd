extends SceneTree

## 给房间的 Floor 挂 TileMapLayer，把三段底板换成真地形贴图。
##
## **为什么用脚本改场景而不是手改 .tscn**：TileMapLayer 的 `tile_map_data`
## 是 PackedByteArray（每个 cell 十几个字节的二进制），手写等于赌格式。
## 让引擎 set_cell + ResourceSaver 写，才能保证编辑器打开也是这样。
##
## 用法：
##   godot --headless --path godot --script res://world/tiles/apply_ground.gd
##
## 几何（8 个房间完全一致，已核对）：
##   Floor 在 (640, 620)，碰撞 1200×40 → 全局 x 40..1240，地面顶 y=600
##   底板瓦片 96×144，草皮顶在 tile 的 y=0
##   ⇒ GroundTiles.position = (-640, -20)，让 tile(0,0) 的左上角落在全局 (0, 600)
##
## 铺法：全部用 mid（source 1）横铺 14 块 = 1344px，屏幕 1280 内铺满，
## 右侧 64px 被屏幕裁掉。**不铺 left/right** —— 7 个房间的地面都是整条连续，
## 没有坑或断崖，端头瓦片插进连续地面会露出圆石收口（见 gen_tileset.gd 注释）。
##
## 保留原 ColorRect `Visual`：它是兜底底色，也是 test_world_visual_swap.gd
## 钉住的接口。TileMapLayer 叠在它上面，摘掉就退回色块。

const ROOMS: Array[String] = [
	"res://world/rooms/SafeHouse.tscn",
	"res://world/rooms/Room01.tscn",
	"res://world/rooms/Room02.tscn",
	"res://world/rooms/Room03.tscn",
	"res://world/rooms/Room04.tscn",
	"res://world/rooms/Room05.tscn",
]

const TILESET_PATH := "res://world/tiles/ground_tileset.tres"
const MID_SOURCE := 1
const MID_COLS := 4
const TILE_W := 96
## 1344 / 96 = 14 块，覆盖 1280 屏幕宽；多出来的 64px 裁在屏幕外
const TILE_COUNT := 14
## tile(0,0) 左上角落到全局 (0, 600)，而 Floor 在 (640, 620)
const LAYER_POS := Vector2(-640.0, -20.0)

var _fail := 0

func _initialize() -> void:
	var ts: TileSet = load(TILESET_PATH) as TileSet
	if ts == null:
		push_error("TileSet 加载失败：%s（先跑 gen_tileset.gd）" % TILESET_PATH)
		quit(1)
		return

	for path: String in ROOMS:
		_apply(path, ts)

	if _fail > 0:
		print("APPLY GROUND: FAIL (%d)" % _fail)
		quit(1)
		return
	print("APPLY GROUND: PASS %d 个房间" % ROOMS.size())
	quit(0)

func _apply(path: String, ts: TileSet) -> void:
	var ps: PackedScene = load(path) as PackedScene
	if ps == null:
		push_error("%s 加载失败" % path)
		_fail += 1
		return
	var room: Node2D = ps.instantiate() as Node2D
	if room == null:
		push_error("%s 不是 Node2D 场景" % path)
		_fail += 1
		return

	var floor_node: Node2D = room.get_node_or_null("Floor") as Node2D
	if floor_node == null:
		push_error("%s 没有 Floor 节点" % path.get_file())
		_fail += 1
		room.free()
		return

	# 幂等：已经有就删掉重建，避免重复跑时叠出两层
	var old: Node = floor_node.get_node_or_null("GroundTiles")
	if old != null:
		floor_node.remove_child(old)
		old.free()

	var layer := TileMapLayer.new()
	layer.name = "GroundTiles"
	layer.tile_set = ts
	layer.position = LAYER_POS
	# 地形是背景，不该吃掉鼠标/触摸（HUD 与门都在它上面）
	layer.y_sort_enabled = false

	for i: int in range(TILE_COUNT):
		layer.set_cell(Vector2i(i, 0), MID_SOURCE, Vector2i(i % MID_COLS, 0))

	# 插在 Visual 之后、GrassDecor 之前：盖住底色，又不挡草皮点缀
	var visual_idx := -1
	for i: int in range(floor_node.get_child_count()):
		if floor_node.get_child(i).name == "Visual":
			visual_idx = i
			break
	floor_node.add_child(layer)
	# **必须设 owner，否则 pack() 静默丢弃这个节点**
	# owner 要指向场景根（room），不是父节点 —— 写成 floor_node 会存成
	# 一个嵌套子场景，打开编辑器看到的是"Floor 里套了个独立场景"。
	# 没有这行时 ResourceSaver.save 会成功、文件也会变，但 GroundTiles 不在里头。
	layer.owner = room
	if visual_idx >= 0:
		floor_node.move_child(layer, visual_idx + 1)

	# 回读验证：set_cell 了不等于存下来了
	var used: int = layer.get_used_cells().size()
	if used != TILE_COUNT:
		push_error("%s 铺了 %d 块，期望 %d" % [path.get_file(), used, TILE_COUNT])
		_fail += 1
		room.free()
		return

	var out := PackedScene.new()
	var err: int = out.pack(room)
	if err != OK:
		push_error("%s pack 失败（%d）" % [path.get_file(), err])
		_fail += 1
		room.free()
		return
	err = ResourceSaver.save(out, path)
	room.free()
	if err != OK:
		push_error("%s 保存失败（%d）" % [path.get_file(), err])
		_fail += 1
		return

	# 再读一遍：保存成功 ≠ 打开有内容。
	# **必须 CACHE_MODE_IGNORE**：`load()` 会命中 ResourceLoader 缓存，
	# 刚 save 的路径读回来还是旧版本 —— 于是工具自己报 FAIL，而文件其实是对的。
	# （这是自测里最容易骗过自己的一类错：验证手段比被验证的东西更不可靠。）
	var check: PackedScene = ResourceLoader.load(
		path, "PackedScene", ResourceLoader.CACHE_MODE_IGNORE) as PackedScene
	if check == null:
		push_error("%s 从磁盘重读失败" % path.get_file())
		_fail += 1
		return
	var re: Node = check.instantiate()
	var re_layer: TileMapLayer = re.get_node_or_null("Floor/GroundTiles") as TileMapLayer
	var re_used := re_layer.get_used_cells().size() if re_layer != null else -1
	re.free()
	if re_used != TILE_COUNT:
		push_error("%s 回读只有 %d 块瓦片" % [path.get_file(), re_used])
		_fail += 1
		return
	print("  ok  %s  %d 块" % [path.get_file(), re_used])
