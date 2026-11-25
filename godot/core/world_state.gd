extends Node
## 全局世界状态（Autoload: WorldState）
##
## 只放**跨房间要活下来**的东西。房间里能重建的都别放这儿
## （比如"当前这屏的敌人还剩几只"），否则存档会越来越脏。
##
## 存档格式是 JSON，不用 `ResourceSaver`：JSON 能 diff、能手改、
## 出了坏档还能肉眼看出哪一行坏了。代价是类型要自己保证。

## 剧情开关，例如 {"met_origami_bird": true}
var flags: Dictionary = {}
## 已解锁能力，例如 ["double_jump", "flame_crayon"]
var unlocked: Array[String] = []
## 走过的房间 id，手账/地图涂色用
var visited: Array[String] = []
## 当前所在房间
var current_room: String = ""
## 房间切换计数 —— 驱动物理式生长、入侵判定这类"按探索进度推进"的系统
var steps: int = 0

const SAVE_PATH := "user://save.json"
const SAVE_VERSION := 1


## 切房间时调这个，统一推进计数和已访问表
func travel_to(room_id: String) -> void:
	if room_id != current_room:
		steps += 1
	current_room = room_id
	if not visited.has(room_id):
		visited.append(room_id)


func set_flag(key: String, value := true) -> void:
	flags[key] = value


func has_flag(key: String) -> bool:
	return bool(flags.get(key, false))


func unlock(ability: String) -> void:
	if not unlocked.has(ability):
		unlocked.append(ability)


func has_ability(ability: String) -> bool:
	return unlocked.has(ability)


## path 可传：测试用独立文件，免得把玩家的真存档覆盖掉
func save_game(path: String = SAVE_PATH) -> bool:
	var data := {
		"version": SAVE_VERSION,
		"flags": flags,
		"unlocked": unlocked,
		"visited": visited,
		"current_room": current_room,
		"steps": steps,
	}
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		push_error("WorldState: 存档写入失败 %s（%s）" % [path, error_string(FileAccess.get_open_error())])
		return false
	f.store_string(JSON.stringify(data, "\t"))
	f.close()
	return true


## 返回 false = 没有存档或存档坏了，调用方应该按新游戏处理
func load_game(path: String = SAVE_PATH) -> bool:
	if not FileAccess.file_exists(path):
		return false
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return false
	var text := f.get_as_text()
	f.close()

	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("WorldState: 存档不是合法 JSON 对象，按新游戏处理")
		return false
	var d: Dictionary = parsed
	# 版本比当前新 = 用户降级了，不认识的字段会丢，宁可拒绝
	if int(d.get("version", 0)) > SAVE_VERSION:
		push_error("WorldState: 存档版本 %s 高于当前 %s" % [d.get("version"), SAVE_VERSION])
		return false

	flags = d.get("flags", {})
	visited.assign(d.get("visited", []))
	unlocked.assign(d.get("unlocked", []))
	current_room = str(d.get("current_room", ""))
	steps = int(d.get("steps", 0))
	return true


func reset() -> void:
	flags.clear()
	unlocked.clear()
	visited.clear()
	current_room = ""
	steps = 0
