extends SceneTree

## 生成地面 TileSet：把三段底板切成 96×144 的瓦片。
##
## **为什么用脚本生成而不是手写 .tres**：TileSet 的 .tres 里
## `0:0/0 = 0`、`physics_layer_0/...` 这些键是引擎内部格式，
## 手写只能靠猜——猜错的表现是"资源能加载但一块瓦片都没有"，
## 而你打开编辑器只会看到一个空白 TileSet。让引擎自己写，格式必然对。
##
## 用法：
##   godot --headless --path godot --script res://world/tiles/gen_tileset.gd
##
## 产物：res://world/tiles/ground_tileset.tres
##
## 瓦片布局（三个 atlas source，都按 96 宽切）：
##   source 0 · ground_left   → 0:0                左端收口（圆石）
##   source 1 · ground_mid    → 0:0 1:0 2:0 3:0    中间段，384 = 4 × 96，循环用
##   source 2 · ground_right  → 0:0                右端收口（圆石）
##
## left / right 目前没有消费点：7 个房间的地面都是"整条连续"，没有坑或断崖。
## 留着是因为以后要做坑——那时端头瓦片就是坑的两壁。现在生成进 TileSet
## 不占什么，但**别在场景里乱用**：地面中间插一块 left 会露出圆石收口。

const TILE_W := 96
const TILE_H := 144

const SOURCES := {
	0: {"path": "res://art/approved/Terrain/ground_left.png",  "cols": 1},
	1: {"path": "res://art/approved/Terrain/ground_mid.png",   "cols": 4},
	2: {"path": "res://art/approved/Terrain/ground_right.png", "cols": 1},
}

const OUT_PATH := "res://world/tiles/ground_tileset.tres"

var _fail := 0

func _initialize() -> void:
	var ts := TileSet.new()
	ts.tile_size = Vector2i(TILE_W, TILE_H)

	for sid: int in SOURCES.keys():
		var cfg: Dictionary = SOURCES[sid]
		var tex: Texture2D = load(cfg["path"]) as Texture2D
		if tex == null:
			push_error("纹理加载失败：%s" % cfg["path"])
			_fail += 1
			continue
		var src := TileSetAtlasSource.new()
		src.texture = tex
		src.texture_region_size = Vector2i(TILE_W, TILE_H)
		# 按图宽算出能切几列，与配置对不上就报错（图改了尺寸不会静默错位）
		var cols: int = tex.get_width() / TILE_W
		var rows: int = tex.get_height() / TILE_H
		if cols != int(cfg["cols"]) or rows != 1:
			push_error("%s 切出来是 %d×%d 块，配置写的是 %d×1 —— 底板尺寸变了？"
				% [cfg["path"], cols, rows, int(cfg["cols"])])
			_fail += 1
			continue
		for x: int in range(cols):
			src.create_tile(Vector2i(x, 0))
		ts.add_source(src, sid)
		print("  source %d  %s  %d 块 %d×%d" % [sid, cfg["path"].get_file(), cols, TILE_W, TILE_H])

	if _fail > 0:
		print("GEN TILESET: FAIL (%d)" % _fail)
		quit(1)
		return

	var err: int = ResourceSaver.save(ts, OUT_PATH)
	if err != OK:
		push_error("保存失败 %s（错误码 %d）" % [OUT_PATH, err])
		quit(1)
		return

	# 回读验证：保存成功 ≠ 读出来有瓦片。手写 .tres 最常见的坑就是这个。
	var back: TileSet = load(OUT_PATH) as TileSet
	var total := 0
	for sid: int in back.get_source_count():
		var src_id: int = back.get_source_id(sid)
		var src: TileSetAtlasSource = back.get_source(src_id) as TileSetAtlasSource
		total += src.get_tiles_count()
	print("  回读：%d 个 source，共 %d 块瓦片，tile_size %s"
		% [back.get_source_count(), total, back.tile_size])
	if total != 6:
		print("GEN TILESET: FAIL —— 期望 6 块瓦片，读回 %d 块" % total)
		quit(1)
		return

	print("GEN TILESET: PASS → %s" % OUT_PATH)
	quit(0)
