extends SceneTree
## 世界数据守卫：world_map.json / rooms.json 能不能被 Godot 直接读、且内容自洽。
##
## 为什么要有这一层：地图数据是 Python 生成的，Godot 只是消费者。
## 生成器里的规则（矩形不重叠、门双向、房间尺寸在范围内）如果只在 Python 侧断言，
## 有一天有人手改了 json、或者只跑了 build 没跑 slice，Godot 会用一份过期/半成品的数据
## 跑起来，而且**不会报错** —— 房间对不上、门是堵的，全靠肉眼看。
##
## 跑：godot --headless --path godot --script res://tests/world_data.gd

const MAP_PATH := "res://data/world_map.json"
const ROOMS_PATH := "res://data/rooms.json"

var _fail := 0
var _pass := 0


func _ok(msg: String) -> void:
	_pass += 1
	print("  ✓ ", msg)


func _bad(msg: String) -> void:
	_fail += 1
	print("  ✗ ", msg)


func _load_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		_bad("%s 不存在（先跑 tools/worldmap/build_world.py）" % path)
		return null
	var txt := FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(txt)
	if parsed == null:
		_bad("%s 不是合法 JSON" % path)
	return parsed


func _init() -> void:
	print("[world] 世界数据守卫")
	var world: Variant = _load_json(MAP_PATH)
	var rooms: Variant = _load_json(ROOMS_PATH)
	if world == null or rooms == null:
		print("\n结果：%d 通过 / %d 失败" % [_pass, _fail])
		quit(1 if _fail > 0 else 0)
		return

	var meta: Dictionary = world["meta"]
	var wr: Array = world["rooms"]
	var links: Array = world["links"]
	var wt: Array = world["warps"]

	# ── 1. 规模 ──────────────────────────────────────────────
	print("\n[1] 规模")
	if int(meta["room_count"]) == wr.size():
		_ok("%d 间房（与 meta 一致）" % wr.size())
	else:
		_bad("meta 说 %s 间，实际 %d 间" % [meta["room_count"], wr.size()])
	if int(meta["link_count"]) == links.size():
		_ok("%d 条连接" % links.size())
	else:
		_bad("meta 说 %s 条连接，实际 %d 条" % [meta["link_count"], links.size()])
	if int(meta["grid"]) == 48:
		_ok("网格 = 48px")
	else:
		_bad("网格 %s ≠ 48" % meta["grid"])

	# ── 2. 每间房：坐标是整格、尺寸在界内、像素值对得上 ──────────
	print("\n[2] 房间矩形")
	var ids: Array[String] = []
	var gsz := int(meta["grid"])
	var mw := int(meta["width"])
	var mh := int(meta["height"])
	for r in wr:
		var id := String(r["id"])
		ids.append(id)
		var rect: Dictionary = r["rect"]
		var px: Dictionary = r["rect_px"]
		var x := int(rect["x"]); var y := int(rect["y"])
		var w := int(rect["w"]); var h := int(rect["h"])
		if px["x"] != x * gsz or px["y"] != y * gsz or px["w"] != w * gsz or px["h"] != h * gsz:
			_bad("%s 的 rect_px 与 rect×48 对不上" % id)
		if x < 0 or y < 0 or x + w > mw or y + h > mh:
			_bad("%s 越出地图 %d×%d" % [id, mw, mh])
		if w < 40 or h < 11:
			_bad("%s 尺寸异常 %d×%d" % [id, w, h])
	if _fail == 0:
		_ok("%d 间房的坐标/像素/边界全部自洽" % wr.size())

	# id 唯一
	var uniq := {}
	for i in ids:
		uniq[i] = true
	if uniq.size() == ids.size():
		_ok("房间 id 唯一")
	else:
		_bad("房间 id 重复：%d 个定义只有 %d 个 id" % [ids.size(), uniq.size()])

	# ── 3. 门必须双向 ────────────────────────────────────────
	print("\n[3] 门双向")
	var room_map: Dictionary = rooms["rooms"]
	var have := {}
	for rid in room_map:
		for e in room_map[rid]["exits"]:
			have["%s>%s" % [rid, e["to"]]] = true
	var one_way := 0
	for l in links:
		var a := String(l["from"]); var b := String(l["to"])
		if not have.has("%s>%s" % [a, b]):
			_bad("%s 没有通往 %s 的门洞" % [a, b]); one_way += 1
		if not have.has("%s>%s" % [b, a]):
			_bad("%s 没有通往 %s 的门洞" % [b, a]); one_way += 1
	if one_way == 0:
		_ok("%d 条连接全部双向（%d 个门洞）" % [links.size(), have.size()])

	# ── 4. 房间字符地图：行列数必须等于矩形的 w/h ────────────────
	print("\n[4] 房间字符地图")
	var bad_dim := 0
	for rid in room_map:
		var rm: Dictionary = room_map[rid]
		var w := int(rm["w"]); var h := int(rm["h"])
		var grid: Array = rm["grid"]
		if grid.size() != h:
			_bad("%s grid 有 %d 行，应为 %d" % [rid, grid.size(), h]); bad_dim += 1
			continue
		for row in grid:
			if String(row).length() != w:
				_bad("%s 某行宽 %d，应为 %d" % [rid, String(row).length(), w]); bad_dim += 1
				break
	if bad_dim == 0:
		_ok("%d 间房的字符地图行列数全部对得上" % room_map.size())

	if room_map.size() != wr.size():
		_bad("world_map 有 %d 间房，rooms.json 只有 %d 间 —— 只跑了 build 没跑 slice？"
		     % [wr.size(), room_map.size()])
	else:
		_ok("rooms.json 与 world_map.json 房间数一致")

	# ── 5. 传送点必须是真的非物理连接 ──────────────────────────
	print("\n[5] 传送")
	var by_id := {}
	for r in wr:
		by_id[String(r["id"])] = r["rect"]
	var bad_warp := 0
	for wp in wt:
		var a := String(wp["from"]); var b := String(wp["to"])
		if not by_id.has(a) or not by_id.has(b):
			_bad("传送 %s→%s 有端点不存在" % [a, b]); bad_warp += 1
			continue
		# 传送的两端不该相邻 —— 相邻的两间用走的就行，不需要传送
		var ra: Dictionary = by_id[a]; var rb: Dictionary = by_id[b]
		var ox: int = mini(int(ra["x"]) + int(ra["w"]), int(rb["x"]) + int(rb["w"])) - maxi(int(ra["x"]), int(rb["x"]))
		var oy: int = mini(int(ra["y"]) + int(ra["h"]), int(rb["y"]) + int(rb["h"])) - maxi(int(ra["y"]), int(rb["y"]))
		if ox > 0 and oy > 0:
			_bad("传送 %s→%s 的两间房重叠了" % [a, b]); bad_warp += 1
	if bad_warp == 0:
		_ok("%d 条传送（非物理连接）" % wt.size())

	print("\n结果：%d 通过 / %d 失败" % [_pass, _fail])
	quit(1 if _fail > 0 else 0)
